import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  withTenant,
  type PrismaClient,
  type PropertyStatus,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { assertAgencyCanGrow, audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import type {
  ListPropertiesQuery,
  PermitInput,
  ProjectInput,
  PropertyCreateInput,
  PropertyUpdateInput,
} from './inventory.schemas';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const DAY_MS = 86_400_000;

/** Which status a listing may move to from each status. */
export const STATUS_TRANSITIONS: Record<PropertyStatus, readonly PropertyStatus[]> = {
  draft: ['active', 'archived'],
  active: ['under_offer', 'sold', 'rented', 'archived'],
  under_offer: ['active', 'sold', 'rented', 'archived'],
  sold: ['archived'],
  rented: ['active', 'archived'],
  archived: ['draft'],
};

const listSelect = {
  id: true,
  reference: true,
  title: true,
  listingType: true,
  propertyType: true,
  completion: true,
  status: true,
  emirate: true,
  community: true,
  building: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  price: true,
  rentPeriod: true,
  listingExpiresAt: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  assigned: { select: { id: true, user: { select: { fullName: true } } } },
} as const;

const detailInclude = {
  assigned: { select: { id: true, user: { select: { fullName: true, email: true } } } },
  project: { select: { id: true, name: true } },
  permits: { orderBy: { validUntil: 'desc' } },
} as const;

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private canManage(ctx: TenantRequestContext) {
    return hasPermission(ctx.role, 'property:manage');
  }

  // ───── listings ─────

  list(ctx: TenantRequestContext, q: ListPropertiesQuery) {
    return this.run(ctx, async (tx) => {
      const where: Prisma.PropertyWhereInput = {
        tenantId: ctx.tenantId,
        deletedAt: null,
        ...(q.status ? { status: q.status } : { status: { not: 'archived' } }),
        ...(q.listingType ? { listingType: q.listingType } : {}),
        ...(q.propertyType ? { propertyType: q.propertyType } : {}),
        ...(q.emirate ? { emirate: q.emirate } : {}),
        ...(q.mine && ctx.membershipId ? { assignedMembershipId: ctx.membershipId } : {}),
        ...(q.bedrooms !== undefined ? { bedrooms: q.bedrooms } : {}),
        ...(q.minPrice !== undefined || q.maxPrice !== undefined
          ? {
              price: {
                ...(q.minPrice !== undefined ? { gte: q.minPrice } : {}),
                ...(q.maxPrice !== undefined ? { lte: q.maxPrice } : {}),
              },
            }
          : {}),
        ...(q.q
          ? {
              OR: [
                { reference: { contains: q.q, mode: 'insensitive' } },
                { title: { contains: q.q, mode: 'insensitive' } },
                { community: { contains: q.q, mode: 'insensitive' } },
                { building: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.property.findMany({
          where,
          select: listSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: q.limit + 1,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        }),
        tx.property.count({ where }),
      ]);
      const hasMore = rows.length > q.limit;
      const data = hasMore ? rows.slice(0, q.limit) : rows;
      return { data, total, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
    });
  }

  get(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const property = await tx.property.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        include: detailInclude,
      });
      if (!property) throw notFound('Listing');
      return property;
    });
  }

  create(ctx: TenantRequestContext, input: PropertyCreateInput) {
    this.assertEmirate(input.emirate);
    return this.run(ctx, async (tx) => {
      const { reference, assignedMembershipId, ...rest } = input;
      let assignee: string | null = ctx.membershipId;
      if (assignedMembershipId !== undefined && assignedMembershipId !== ctx.membershipId) {
        if (!this.canManage(ctx)) {
          throw new AppError(
            403,
            'PERMISSION_DENIED',
            'Only managers can assign listings to others.',
          );
        }
        assignee =
          assignedMembershipId === null
            ? null
            : (await this.assertActiveMember(tx, assignedMembershipId)).id;
      }
      if (rest.projectId) await this.assertProject(tx, rest.projectId);
      this.assertRentPeriod(rest.listingType, rest.rentPeriod);
      await assertAgencyCanGrow(tx, ctx.tenantId, 'listing');

      const data = {
        ...rest,
        tenantId: ctx.tenantId,
        assignedMembershipId: assignee,
        createdBy: ctx.userId,
        rentPeriod: rest.listingType === 'rent' ? (rest.rentPeriod ?? 'yearly') : null,
      };
      const property = reference
        ? await tx.property
            .create({ data: { ...data, reference }, include: detailInclude })
            .catch(duplicateReference)
        : await this.createWithGeneratedReference(tx, data);

      await audit(tx, ctx, {
        action: 'property.created',
        entityType: 'property',
        entityId: property.id,
        after: { reference: property.reference, status: property.status },
      });
      return property;
    });
  }

  update(ctx: TenantRequestContext, id: string, input: PropertyUpdateInput) {
    if (input.emirate) this.assertEmirate(input.emirate);
    return this.run(ctx, async (tx) => {
      const current = await this.loadEditable(tx, ctx, id);
      const { assignedMembershipId, ...rest } = input;
      const data: Prisma.PropertyUncheckedUpdateInput = { ...rest };

      if (
        assignedMembershipId !== undefined &&
        assignedMembershipId !== current.assignedMembershipId
      ) {
        if (!this.canManage(ctx)) {
          throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can reassign listings.');
        }
        data.assignedMembershipId =
          assignedMembershipId === null
            ? null
            : (await this.assertActiveMember(tx, assignedMembershipId)).id;
      }
      if (rest.projectId) await this.assertProject(tx, rest.projectId);
      const listingType = rest.listingType ?? current.listingType;
      const rentPeriod = rest.rentPeriod !== undefined ? rest.rentPeriod : current.rentPeriod;
      this.assertRentPeriod(listingType, rentPeriod);
      if (listingType === 'sale') data.rentPeriod = null;
      else if (!rentPeriod) data.rentPeriod = 'yearly';

      const updated = await tx.property
        .update({ where: { id: current.id }, data, include: detailInclude })
        .catch(duplicateReference);
      const keys = Object.keys(data);
      await audit(tx, ctx, {
        action: 'property.updated',
        entityType: 'property',
        entityId: current.id,
        before: pickJson(current, keys),
        after: pickJson(updated, keys),
      });
      return updated;
    });
  }

  setStatus(ctx: TenantRequestContext, id: string, status: PropertyStatus) {
    return this.run(ctx, async (tx) => {
      const current = await this.loadEditable(tx, ctx, id);
      if (current.status === status) return this.reload(tx, current.id);
      if (!STATUS_TRANSITIONS[current.status].includes(status)) {
        throw new AppError(
          409,
          'INVALID_STATUS_CHANGE',
          `A ${current.status.replace('_', ' ')} listing cannot become ${status.replace('_', ' ')}.`,
        );
      }
      if (status === 'sold' && current.listingType !== 'sale') {
        throw new AppError(409, 'INVALID_STATUS_CHANGE', 'Only a sale listing can be sold.');
      }
      if (status === 'rented' && current.listingType !== 'rent') {
        throw new AppError(409, 'INVALID_STATUS_CHANGE', 'Only a rental listing can be rented.');
      }

      const data: Prisma.PropertyUncheckedUpdateInput = { status };
      if (status === 'active') {
        const agency = await tx.agency.findUniqueOrThrow({ where: { id: ctx.tenantId } });
        if (agency.approvalStatus === 'pending') {
          throw new AppError(
            403,
            'AGENCY_AWAITING_APPROVAL',
            'Listings can go live once PropForce approves your agency.',
          );
        }
        await this.assertPublishable(tx, ctx, current);
        data.listingExpiresAt = await this.freshUntil(tx, ctx);
        data.verifiedAt = new Date();
        data.verifiedBy = ctx.userId;
      }
      const updated = await tx.property.update({
        where: { id: current.id },
        data,
        include: detailInclude,
      });
      await audit(tx, ctx, {
        action: 'property.status_changed',
        entityType: 'property',
        entityId: current.id,
        before: { status: current.status },
        after: { status },
      });
      return updated;
    });
  }

  /** Confirms the listing is still available and extends how long it stays fresh. */
  verify(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const current = await this.loadEditable(tx, ctx, id);
      const updated = await tx.property.update({
        where: { id: current.id },
        data: {
          verifiedAt: new Date(),
          verifiedBy: ctx.userId,
          ...(current.status === 'active'
            ? { listingExpiresAt: await this.freshUntil(tx, ctx) }
            : {}),
        },
        include: detailInclude,
      });
      await audit(tx, ctx, {
        action: 'property.verified',
        entityType: 'property',
        entityId: current.id,
      });
      return updated;
    });
  }

  remove(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const current = await this.loadEditable(tx, ctx, id);
      if (!['draft', 'archived'].includes(current.status)) {
        throw new AppError(409, 'INVALID_STATUS_CHANGE', 'Archive the listing before deleting it.');
      }
      if (!this.canManage(ctx) && current.status !== 'draft') {
        throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can delete archived listings.');
      }
      await tx.property.update({ where: { id: current.id }, data: { deletedAt: new Date() } });
      await audit(tx, ctx, {
        action: 'property.deleted',
        entityType: 'property',
        entityId: current.id,
        before: { reference: current.reference, status: current.status },
      });
    });
  }

  // ───── permits ─────

  addPermit(ctx: TenantRequestContext, propertyId: string, input: PermitInput) {
    return this.run(ctx, async (tx) => {
      const property = await this.loadEditable(tx, ctx, propertyId);
      const permit = await tx.propertyPermit
        .create({ data: { ...input, tenantId: ctx.tenantId, propertyId: property.id } })
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) {
            throw new AppError(
              409,
              'CONFLICT_DUPLICATE',
              'This permit number is already used on another listing.',
            );
          }
          throw err;
        });
      await audit(tx, ctx, {
        action: 'property.permit_added',
        entityType: 'property',
        entityId: property.id,
        after: { authority: permit.authority, permitNumber: permit.permitNumber },
      });
      return permit;
    });
  }

  removePermit(ctx: TenantRequestContext, propertyId: string, permitId: string) {
    return this.run(ctx, async (tx) => {
      const property = await this.loadEditable(tx, ctx, propertyId);
      const deleted = await tx.propertyPermit.deleteMany({
        where: { id: permitId, propertyId: property.id },
      });
      if (deleted.count !== 1) throw notFound('Permit');
      await audit(tx, ctx, {
        action: 'property.permit_removed',
        entityType: 'property',
        entityId: property.id,
      });
    });
  }

  // ───── projects ─────

  listProjects(ctx: TenantRequestContext) {
    return this.run(ctx, (tx) =>
      tx.project.findMany({
        where: { tenantId: ctx.tenantId },
        include: { _count: { select: { properties: { where: { deletedAt: null } } } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  createProject(ctx: TenantRequestContext, input: ProjectInput) {
    this.assertEmirate(input.emirate);
    return this.run(ctx, async (tx) => {
      const project = await tx.project
        .create({ data: { ...input, tenantId: ctx.tenantId } })
        .catch((err: unknown) => {
          if (isUniqueViolation(err)) {
            throw new AppError(
              409,
              'CONFLICT_DUPLICATE',
              'A project with this name already exists.',
            );
          }
          throw err;
        });
      await audit(tx, ctx, {
        action: 'project.created',
        entityType: 'project',
        entityId: project.id,
        after: { name: project.name },
      });
      return project;
    });
  }

  // ───── dashboard ─────

  /** Counts for the agency dashboard. Agents also get their own numbers. */
  summary(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const base = { tenantId: ctx.tenantId, deletedAt: null };
      const byStatus = await tx.property.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      });
      const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Partial<
        Record<PropertyStatus, number>
      >;
      const soon = new Date(Date.now() + 3 * DAY_MS);
      const [needsVerification, mine, members, pendingInvitations] = await Promise.all([
        tx.property.count({
          where: { ...base, status: 'active', listingExpiresAt: { lte: soon } },
        }),
        ctx.membershipId
          ? tx.property.count({
              where: {
                ...base,
                assignedMembershipId: ctx.membershipId,
                status: { not: 'archived' },
              },
            })
          : Promise.resolve(0),
        tx.membership.count({ where: { tenantId: ctx.tenantId, status: 'active' } }),
        tx.invitation.count({
          where: {
            tenantId: ctx.tenantId,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        }),
      ]);
      return {
        listings: {
          draft: counts.draft ?? 0,
          active: counts.active ?? 0,
          underOffer: counts.under_offer ?? 0,
          sold: counts.sold ?? 0,
          rented: counts.rented ?? 0,
          archived: counts.archived ?? 0,
          mine,
          needsVerification,
        },
        team: { activeMembers: members, pendingInvitations },
      };
    });
  }

  // ───── helpers ─────

  private async loadEditable(tx: TransactionClient, ctx: TenantRequestContext, id: string) {
    const property = await tx.property.findFirst({
      where: { id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!property) throw notFound('Listing');
    if (!this.canManage(ctx) && property.assignedMembershipId !== ctx.membershipId) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You can only change listings assigned to you.');
    }
    return property;
  }

  private reload(tx: TransactionClient, id: string) {
    return tx.property.findUniqueOrThrow({ where: { id }, include: detailInclude });
  }

  private assertEmirate(emirate: string) {
    if (!(this.config.supportedEmirates as string[]).includes(emirate)) {
      throw new AppError(400, 'VALIDATION_FAILED', `${emirate} is not supported yet.`, [
        { path: 'emirate', message: `Supported: ${this.config.supportedEmirates.join(', ')}` },
      ]);
    }
  }

  private assertRentPeriod(listingType: string, rentPeriod: string | null | undefined) {
    if (listingType === 'sale' && rentPeriod) {
      throw new AppError(400, 'VALIDATION_FAILED', 'A sale listing has no rent period.', [
        { path: 'rentPeriod', message: 'Only for rentals' },
      ]);
    }
  }

  private async assertProject(tx: TransactionClient, projectId: string) {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
  }

  private async assertActiveMember(tx: TransactionClient, membershipId: string) {
    const member = await tx.membership.findFirst({
      where: { id: membershipId, status: 'active' },
    });
    if (!member) throw notFound('Member');
    return member;
  }

  /** A listing can go live only with the basics filled in and, if required, a valid permit. */
  private async assertPublishable(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    p: { id: string; price: unknown; areaSqft: unknown; community: string | null },
  ) {
    const missing: { path: string; message: string }[] = [];
    if (p.price == null) missing.push({ path: 'price', message: 'Required to publish' });
    if (p.areaSqft == null) missing.push({ path: 'areaSqft', message: 'Required to publish' });
    if (!p.community) missing.push({ path: 'community', message: 'Required to publish' });

    const settings = await tx.agencySettings.findUniqueOrThrow({
      where: { tenantId: ctx.tenantId },
    });
    if (settings.requirePermitToPublish) {
      const today = new Date(new Date().toISOString().slice(0, 10));
      const valid = await tx.propertyPermit.count({
        where: { propertyId: p.id, validUntil: { gte: today } },
      });
      if (valid === 0) {
        missing.push({ path: 'permits', message: 'Add a valid advertising permit to publish' });
      }
    }
    if (missing.length > 0) {
      throw new AppError(
        422,
        'LISTING_INCOMPLETE',
        'This listing is not ready to publish.',
        missing,
      );
    }
  }

  private async freshUntil(tx: TransactionClient, ctx: TenantRequestContext) {
    const settings = await tx.agencySettings.findUniqueOrThrow({
      where: { tenantId: ctx.tenantId },
    });
    return new Date(Date.now() + settings.listingFreshnessDays * DAY_MS);
  }

  private async createWithGeneratedReference(
    tx: TransactionClient,
    data: Omit<Prisma.PropertyUncheckedCreateInput, 'reference'>,
  ) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = generateReference();
      const exists = await tx.property.findFirst({
        where: { tenantId: data.tenantId, reference },
        select: { id: true },
      });
      if (!exists) {
        return tx.property.create({ data: { ...data, reference }, include: detailInclude });
      }
    }
    throw new AppError(409, 'CONFLICT_DUPLICATE', 'Could not generate a unique reference. Retry.');
  }
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateReference(): string {
  let out = 'PF-';
  for (let i = 0; i < 6; i++) out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return out;
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function duplicateReference(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new AppError(409, 'CONFLICT_DUPLICATE', 'Another listing already uses this reference.', [
      { path: 'reference', message: 'Already in use' },
    ]);
  }
  throw err;
}

function pickJson(obj: object, keys: string[]): Prisma.InputJsonValue {
  const source = obj as Record<string, unknown>;
  return JSON.parse(
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, source[k] ?? null]))),
  ) as Prisma.InputJsonValue;
}

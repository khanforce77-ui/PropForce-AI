import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  withTenant,
  type PrismaClient,
  type Role,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { assertKycComplete } from '../kyc/kyc-rules';
import { PRIVILEGED_ROLES } from './permissions';
import type { TenantRequestContext } from './tenant.guard';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/** Writes an audit row inside the caller's tenant transaction, so it commits with the change. */
export async function audit(tx: TransactionClient, ctx: TenantRequestContext, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorType: ctx.platform ? 'platform' : 'user',
      actorUserId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      ...(entry.before != null ? { before: entry.before } : {}),
      ...(entry.after != null ? { after: entry.after } : {}),
    },
  });
  if (ctx.platform) {
    // A platform admin changed an agency they are not a member of: also log it platform-wide.
    await tx.platformAuditLog.create({
      data: {
        actorUserId: ctx.userId,
        action: `agency_data.${entry.action}`,
        targetType: entry.entityType,
        targetId: entry.entityId ?? null,
        after: { tenantId: ctx.tenantId, ...((entry.after as object | null | undefined) ?? {}) },
      },
    });
  }
}

/**
 * Platform rules an agency must meet before growing: not waiting for (or refused) platform
 * approval, and within its plan's seat or listing limit.
 */
export async function assertAgencyCanGrow(
  tx: TransactionClient,
  tenantId: string,
  what: 'seat' | 'listing',
) {
  const agency = await tx.agency.findUniqueOrThrow({ where: { id: tenantId } });
  if (agency.approvalStatus === 'pending') {
    throw new AppError(
      403,
      'AGENCY_AWAITING_APPROVAL',
      'Your agency is waiting for PropForce approval. You can prepare drafts in the meantime.',
    );
  }
  if (what === 'seat' && agency.seatLimit !== null) {
    const now = new Date();
    const [members, invites] = await Promise.all([
      tx.membership.count({ where: { tenantId, status: { not: 'removed' } } }),
      tx.invitation.count({
        where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      }),
    ]);
    if (members + invites >= agency.seatLimit) {
      throw new AppError(
        409,
        'PLAN_LIMIT_REACHED',
        `Your plan allows ${agency.seatLimit} team members including pending invitations.`,
      );
    }
  }
  if (what === 'listing' && agency.listingLimit !== null) {
    const listings = await tx.property.count({ where: { tenantId, deletedAt: null } });
    if (listings >= agency.listingLimit) {
      throw new AppError(
        409,
        'PLAN_LIMIT_REACHED',
        `Your plan allows ${agency.listingLimit} listings. Archive and delete old ones or upgrade.`,
      );
    }
  }
}

const memberSelect = {
  id: true,
  role: true,
  status: true,
  brn: true,
  teamId: true,
  createdAt: true,
  user: { select: { id: true, fullName: true, email: true } },
} as const;

@Injectable()
export class TenancyService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  // ───── agency ─────

  getAgency(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const agency = await tx.agency.findUnique({ where: { id: ctx.tenantId } });
      if (!agency) throw notFound('Agency');
      return agency;
    });
  }

  updateAgency(
    ctx: TenantRequestContext,
    data: {
      name?: string | undefined;
      tradeLicenseNo?: string | null | undefined;
      orn?: string | null | undefined;
      website?: string | null | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const before = await tx.agency.findUniqueOrThrow({ where: { id: ctx.tenantId } });
      const after = await tx.agency.update({
        where: { id: ctx.tenantId },
        data: stripUndefined(data),
      });
      await audit(tx, ctx, {
        action: 'agency.updated',
        entityType: 'agency',
        entityId: ctx.tenantId,
        before: pick(before, Object.keys(stripUndefined(data))),
        after: pick(after, Object.keys(stripUndefined(data))),
      });
      return after;
    });
  }

  /** Marks onboarding complete: a pending agency becomes active. Idempotent. */
  completeOnboarding(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const agency = await tx.agency.findUniqueOrThrow({ where: { id: ctx.tenantId } });
      if (agency.status !== 'pending' || agency.approvalStatus === 'pending') return agency;
      // With registration documents required, every required file must be uploaded first, and
      // PropForce then reviews them: the agency always waits for approval.
      const kyc = await assertKycComplete(tx, ctx.tenantId);
      const approval = await tx.featureFlag.findUnique({
        where: { key: 'platform.require_agency_approval' },
      });
      const needsApproval =
        (kyc || approval?.enabled === true) && agency.approvalStatus !== 'approved';
      const updated = await tx.agency.update({
        where: { id: ctx.tenantId },
        data: needsApproval
          ? { approvalStatus: 'pending', onboardedAt: new Date() }
          : { status: 'active', onboardedAt: new Date() },
      });
      await audit(tx, ctx, {
        action: needsApproval ? 'agency.submitted_for_approval' : 'agency.onboarded',
        entityType: 'agency',
        entityId: ctx.tenantId,
        before: { status: 'pending' },
        after: { status: updated.status, approvalStatus: updated.approvalStatus },
      });
      return updated;
    });
  }

  getSettings(ctx: TenantRequestContext) {
    return this.run(ctx, (tx) =>
      tx.agencySettings.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } }),
    );
  }

  /** Outbound voice cannot be enabled here: only a platform admin can, after verifying approvals. */
  updateSettings(
    ctx: TenantRequestContext,
    data: {
      listingFreshnessDays?: number | undefined;
      branding?: Prisma.InputJsonValue | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const clean = stripUndefined(data);
      const before = await tx.agencySettings.findUniqueOrThrow({
        where: { tenantId: ctx.tenantId },
      });
      const after = await tx.agencySettings.update({
        where: { tenantId: ctx.tenantId },
        data: clean,
      });
      await audit(tx, ctx, {
        action: 'agency.settings_updated',
        entityType: 'agency_settings',
        entityId: ctx.tenantId,
        before: pick(before, Object.keys(clean)),
        after: pick(after, Object.keys(clean)),
      });
      return after;
    });
  }

  // ───── members ─────

  listMembers(ctx: TenantRequestContext) {
    return this.run(ctx, (tx) =>
      tx.membership.findMany({
        where: { tenantId: ctx.tenantId, status: { not: 'removed' } },
        select: memberSelect,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  updateMember(
    ctx: TenantRequestContext,
    membershipId: string,
    data: { role?: Role | undefined; teamId?: string | null | undefined },
  ) {
    return this.run(ctx, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId, status: { not: 'removed' } },
      });
      if (!target) throw notFound('Member');

      if (data.role !== undefined && data.role !== target.role) {
        if (target.id === ctx.membershipId) {
          throw new AppError(403, 'PERMISSION_DENIED', 'You cannot change your own role.');
        }
        const touchesPrivileged =
          PRIVILEGED_ROLES.includes(target.role) || PRIVILEGED_ROLES.includes(data.role);
        if (touchesPrivileged && ctx.role !== 'owner') {
          throw new AppError(
            403,
            'PERMISSION_DENIED',
            'Only an owner can grant or change owner and admin roles.',
          );
        }
        if (target.role === 'owner')
          await this.assertAnotherActiveOwner(tx, ctx.tenantId, target.id);
      }
      if (data.teamId) await this.assertTeam(tx, data.teamId);

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: stripUndefined(data),
        select: memberSelect,
      });
      await audit(tx, ctx, {
        action: 'member.updated',
        entityType: 'membership',
        entityId: target.id,
        before: { role: target.role, teamId: target.teamId },
        after: { role: updated.role, teamId: updated.teamId },
      });
      return updated;
    });
  }

  setMemberStatus(ctx: TenantRequestContext, membershipId: string, status: 'active' | 'suspended') {
    return this.run(ctx, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId, status: { not: 'removed' } },
      });
      if (!target) throw notFound('Member');
      if (target.id === ctx.membershipId) {
        throw new AppError(403, 'PERMISSION_DENIED', 'You cannot change your own access.');
      }
      if (PRIVILEGED_ROLES.includes(target.role) && ctx.role !== 'owner') {
        throw new AppError(403, 'PERMISSION_DENIED', 'Only an owner can suspend owners or admins.');
      }
      if (status === 'suspended' && target.role === 'owner') {
        await this.assertAnotherActiveOwner(tx, ctx.tenantId, target.id);
      }
      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { status },
        select: memberSelect,
      });
      await audit(tx, ctx, {
        action: status === 'suspended' ? 'member.suspended' : 'member.reactivated',
        entityType: 'membership',
        entityId: target.id,
        before: { status: target.status },
        after: { status },
      });
      return updated;
    });
  }

  // ───── teams ─────

  listTeams(ctx: TenantRequestContext) {
    return this.run(ctx, (tx) =>
      tx.team.findMany({
        where: { tenantId: ctx.tenantId },
        include: { _count: { select: { memberships: true } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  createTeam(ctx: TenantRequestContext, name: string) {
    return this.run(ctx, async (tx) => {
      const team = await tx.team
        .create({ data: { tenantId: ctx.tenantId, name } })
        .catch(uniqueToConflict('team'));
      await audit(tx, ctx, {
        action: 'team.created',
        entityType: 'team',
        entityId: team.id,
        after: { name },
      });
      return team;
    });
  }

  renameTeam(ctx: TenantRequestContext, teamId: string, name: string) {
    return this.run(ctx, async (tx) => {
      const team = await this.assertTeam(tx, teamId);
      const updated = await tx.team
        .update({ where: { id: team.id }, data: { name } })
        .catch(uniqueToConflict('team'));
      await audit(tx, ctx, {
        action: 'team.renamed',
        entityType: 'team',
        entityId: team.id,
        before: { name: team.name },
        after: { name },
      });
      return updated;
    });
  }

  deleteTeam(ctx: TenantRequestContext, teamId: string) {
    return this.run(ctx, async (tx) => {
      const team = await this.assertTeam(tx, teamId);
      await tx.team.delete({ where: { id: team.id } }); // memberships keep working; team_id set null
      await audit(tx, ctx, {
        action: 'team.deleted',
        entityType: 'team',
        entityId: team.id,
        before: { name: team.name },
      });
    });
  }

  // ───── audit log ─────

  listAuditLogs(
    ctx: TenantRequestContext,
    q: {
      limit: number;
      cursor?: string | undefined;
      action?: string | undefined;
      entityType?: string | undefined;
    },
  ) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(q.action ? { action: q.action } : {}),
          ...(q.entityType ? { entityType: q.entityType } : {}),
        },
        // Newest first; id breaks ties between rows created in the same millisecond.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > q.limit;
      const data = hasMore ? rows.slice(0, q.limit) : rows;
      return { data, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
    });
  }

  // ───── helpers ─────

  private async assertTeam(tx: TransactionClient, teamId: string) {
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) throw notFound('Team');
    return team;
  }

  private async assertAnotherActiveOwner(
    tx: TransactionClient,
    tenantId: string,
    exceptId: string,
  ) {
    const owners = await tx.membership.count({
      where: { tenantId, role: 'owner', status: 'active', id: { not: exceptId } },
    });
    if (owners === 0) {
      throw new AppError(409, 'LAST_OWNER', 'An agency must keep at least one active owner.');
    }
  }
}

function stripUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

function pick(obj: object, keys: string[]): Prisma.InputJsonValue {
  const source = obj as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, (source[k] ?? null) as Prisma.InputJsonValue]));
}

const uniqueToConflict = (what: string) => (err: unknown) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new AppError(409, 'CONFLICT_DUPLICATE', `A ${what} with this name already exists.`);
  }
  throw err;
};

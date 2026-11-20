import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  withPlatformAdmin,
  withTenant,
  type AgencyStatus,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';

export interface AgencyPlanInput {
  plan?: string | undefined;
  seatLimit?: number | null | undefined;
  listingLimit?: number | null | undefined;
}

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const conflict = (message: string) => new AppError(409, 'INVALID_STATUS_CHANGE', message);

const DAY_MS = 86_400_000;

/** Read-only, cross-agency figures for platform administrators. */
@Injectable()
export class PlatformService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  summary(adminUserId: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const weekAgo = new Date(Date.now() - 7 * DAY_MS);
      const [agenciesByStatus, users, newUsers, newAgencies, listingsByStatus, verifiedUsers] =
        await Promise.all([
          tx.agency.groupBy({ by: ['status'], _count: { _all: true } }),
          tx.user.count(),
          tx.user.count({ where: { createdAt: { gte: weekAgo } } }),
          tx.agency.count({ where: { createdAt: { gte: weekAgo } } }),
          tx.property.groupBy({
            by: ['status'],
            where: { deletedAt: null },
            _count: { _all: true },
          }),
          tx.user.count({ where: { emailVerifiedAt: { not: null } } }),
        ]);
      const agencies = Object.fromEntries(agenciesByStatus.map((r) => [r.status, r._count._all]));
      const listings = Object.fromEntries(listingsByStatus.map((r) => [r.status, r._count._all]));
      const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
      return {
        agencies: {
          total: sum(agencies),
          active: agencies.active ?? 0,
          pending: agencies.pending ?? 0,
          suspended: agencies.suspended ?? 0,
          newThisWeek: newAgencies,
        },
        users: { total: users, verified: verifiedUsers, newThisWeek: newUsers },
        listings: { total: sum(listings), live: listings.active ?? 0, draft: listings.draft ?? 0 },
      };
    });
  }

  agencies(adminUserId: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const rows = await tx.agency.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          name: true,
          emirate: true,
          status: true,
          orn: true,
          createdAt: true,
          onboardedAt: true,
          approvalStatus: true,
          statusReason: true,
          plan: true,
          seatLimit: true,
          listingLimit: true,
          memberships: {
            where: { status: 'active' },
            select: { role: true, user: { select: { fullName: true, email: true } } },
          },
          _count: { select: { properties: { where: { deletedAt: null } } } },
        },
      });
      return rows.map(({ memberships, _count, ...a }) => {
        const owner = memberships.find((m) => m.role === 'owner')?.user ?? null;
        return { ...a, owner, members: memberships.length, listings: _count.properties };
      });
    });
  }

  recentUsers(adminUserId: string, q?: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const users = await tx.user.findMany({
        where: q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { fullName: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          isPlatformAdmin: true,
          suspendedAt: true,
          suspendedReason: true,
          id: true,
          fullName: true,
          email: true,
          createdAt: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          memberships: {
            select: { role: true, agency: { select: { id: true, name: true } } },
          },
        },
      });
      return users;
    });
  }

  // ───── agency controls ─────

  approveAgency(adminUserId: string, agencyId: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_approved', (a) => {
      if (a.approvalStatus !== 'pending')
        throw conflict('This agency is not waiting for approval.');
      return {
        approvalStatus: 'approved',
        status: 'active',
        statusReason: null,
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      };
    });
  }

  rejectAgency(adminUserId: string, agencyId: string, reason: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_rejected', (a) => {
      if (a.approvalStatus !== 'pending')
        throw conflict('This agency is not waiting for approval.');
      return {
        approvalStatus: 'rejected',
        status: 'cancelled',
        statusReason: reason,
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      };
    });
  }

  suspendAgency(adminUserId: string, agencyId: string, reason: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_suspended', (a) => {
      if (a.status === 'suspended') throw conflict('This agency is already suspended.');
      if (a.status === 'cancelled') throw conflict('This agency is closed.');
      return { status: 'suspended', statusReason: reason };
    });
  }

  reactivateAgency(adminUserId: string, agencyId: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_reactivated', (a) => {
      if (a.status !== 'suspended') throw conflict('Only a suspended agency can be reactivated.');
      const status: AgencyStatus =
        a.onboardedAt && a.approvalStatus !== 'pending' ? 'active' : 'pending';
      return { status, statusReason: null };
    });
  }

  updateAgencyPlan(adminUserId: string, agencyId: string, input: AgencyPlanInput) {
    const data = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Prisma.AgencyUpdateInput;
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_plan_changed', () => data);
  }

  /**
   * Applies a platform change to one agency inside that agency's tenant context (RLS allows it
   * because the tenant matches), writes the agency's own audit log as the platform, and the
   * platform audit log.
   */
  private async changeAgency(
    adminUserId: string,
    agencyId: string,
    action: string,
    change: (agency: Prisma.AgencyGetPayload<object>) => Prisma.AgencyUpdateInput,
  ) {
    return withTenant(this.prisma, { tenantId: agencyId, userId: adminUserId }, async (tx) => {
      const before = await tx.agency.findUnique({ where: { id: agencyId } });
      if (!before) throw notFound('Agency');
      const data = change(before);
      const after = await tx.agency.update({ where: { id: agencyId }, data });
      const keys = Object.keys(data);
      const diff = {
        before: pickJson(before, keys),
        after: pickJson(after, keys),
      };
      await tx.auditLog.create({
        data: {
          tenantId: agencyId,
          actorType: 'platform',
          actorUserId: adminUserId,
          action,
          entityType: 'agency',
          entityId: agencyId,
          ...diff,
        },
      });
      await this.platformAudit(tx, adminUserId, action, 'agency', agencyId, diff, before.name);
      return after;
    });
  }

  // ───── user controls ─────

  suspendUser(adminUserId: string, userId: string, reason: string) {
    if (adminUserId === userId) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You cannot suspend your own account.');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('User');
      if (user.suspendedAt) throw conflict('This user is already suspended.');
      const updated = await tx.user.update({
        where: { id: userId },
        data: { suspendedAt: new Date(), suspendedReason: reason },
        select: { id: true, email: true, suspendedAt: true, suspendedReason: true },
      });
      // Sign them out everywhere, now.
      const sessions = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.user_suspended',
        'user',
        userId,
        {
          after: { reason, sessionsRevoked: sessions.count },
        },
        user.email,
      );
      return updated;
    });
  }

  reactivateUser(adminUserId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('User');
      if (!user.suspendedAt) throw conflict('This user is not suspended.');
      const updated = await tx.user.update({
        where: { id: userId },
        data: { suspendedAt: null, suspendedReason: null },
        select: { id: true, email: true, suspendedAt: true, suspendedReason: true },
      });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.user_reactivated',
        'user',
        userId,
        {},
        updated.email,
      );
      return updated;
    });
  }

  // ───── settings and flags ─────

  listFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  setFlag(adminUserId: string, key: string, enabled: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { key } });
      if (!flag) throw notFound('Setting');
      const updated = await tx.featureFlag.update({ where: { key }, data: { enabled } });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.setting_changed',
        'feature_flag',
        key,
        {
          before: { enabled: flag.enabled },
          after: { enabled },
        },
        key,
      );
      return updated;
    });
  }

  auditLog() {
    return this.prisma.platformAuditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  private async platformAudit(
    tx: TransactionClient,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    diff: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
    targetLabel: string,
  ) {
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: actorUserId },
      select: { email: true },
    });
    await tx.platformAuditLog.create({
      data: {
        actorUserId,
        action,
        targetType,
        targetId,
        ...(diff.before !== undefined ? { before: diff.before } : {}),
        after: {
          ...((diff.after as object | undefined) ?? {}),
          target: targetLabel,
          by: actor.email,
        },
      },
    });
  }
}

function pickJson(obj: object, keys: string[]): Prisma.InputJsonValue {
  const source = obj as Record<string, unknown>;
  return JSON.parse(
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, source[k] ?? null]))),
  ) as Prisma.InputJsonValue;
}

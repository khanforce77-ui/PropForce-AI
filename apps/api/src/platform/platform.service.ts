import { Inject, Injectable } from '@nestjs/common';
import { withPlatformAdmin, type PrismaClient } from '@propforce/db';
import { PRISMA } from '../database/database.module';

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

  recentUsers(adminUserId: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const users = await tx.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
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
}

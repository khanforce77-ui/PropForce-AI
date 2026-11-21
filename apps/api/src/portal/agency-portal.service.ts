import { Inject, Injectable } from '@nestjs/common';
import { withTenant, type Prisma, type PrismaClient, type TransactionClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import { ownMembershipId, type TenantRequestContext } from '../tenancy/tenant.guard';
import type { AgentProfileInput, ListEnquiriesQuery } from './portal.schemas';

const DAY = 86_400_000;
const profileSelect = {
  id: true,
  role: true,
  brn: true,
  publicPhoneE164: true,
  whatsappE164: true,
  user: { select: { fullName: true } },
} as const;

/** The agency's side of the portal: agents' public contact details and incoming enquiries. */
@Injectable()
export class AgencyPortalService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private seesAll(ctx: TenantRequestContext) {
    return hasPermission(ctx.role, 'property:manage');
  }

  /** Active agents with their public details and the last 30 days of portal activity. */
  agents(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const since = new Date(Date.now() - 30 * DAY);
      const [members, enquiries, clicks] = await Promise.all([
        tx.membership.findMany({
          where: {
            tenantId: ctx.tenantId,
            status: 'active',
            ...(this.seesAll(ctx) ? {} : { id: ownMembershipId(ctx) }),
          },
          select: profileSelect,
          orderBy: { createdAt: 'asc' },
        }),
        tx.portalEnquiry.groupBy({
          by: ['membershipId'],
          where: { tenantId: ctx.tenantId, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        tx.portalContactEvent.groupBy({
          by: ['membershipId', 'channel'],
          where: { tenantId: ctx.tenantId, createdAt: { gte: since } },
          _count: { _all: true },
        }),
      ]);
      return {
        data: members.map((m) => ({
          id: m.id,
          name: m.user.fullName,
          role: m.role,
          brn: m.brn,
          publicPhoneE164: m.publicPhoneE164,
          whatsappE164: m.whatsappE164,
          last30Days: {
            enquiries: enquiries.find((e) => e.membershipId === m.id)?._count._all ?? 0,
            whatsappClicks:
              clicks.find((c) => c.membershipId === m.id && c.channel === 'whatsapp')?._count
                ._all ?? 0,
            callClicks:
              clicks.find((c) => c.membershipId === m.id && c.channel === 'call')?._count._all ?? 0,
          },
        })),
      };
    });
  }

  /** Agents edit their own public details; managers can edit anyone's. */
  updateAgent(ctx: TenantRequestContext, membershipId: string, input: AgentProfileInput) {
    if (membershipId !== ctx.membershipId && !this.seesAll(ctx)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You can only edit your own public profile.');
    }
    return this.run(ctx, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId, status: { not: 'removed' } },
        select: profileSelect,
      });
      if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
      const data: Prisma.MembershipUncheckedUpdateInput = {};
      if (input.publicPhoneE164 !== undefined) data.publicPhoneE164 = input.publicPhoneE164;
      if (input.whatsappE164 !== undefined) data.whatsappE164 = input.whatsappE164;
      if (input.brn !== undefined) data.brn = input.brn;
      const updated = await tx.membership.update({
        where: { id: target.id },
        data,
        select: profileSelect,
      });
      await audit(tx, ctx, {
        action: 'member.public_profile_updated',
        entityType: 'membership',
        entityId: target.id,
        before: {
          publicPhoneE164: target.publicPhoneE164,
          whatsappE164: target.whatsappE164,
          brn: target.brn,
        },
        after: {
          publicPhoneE164: updated.publicPhoneE164,
          whatsappE164: updated.whatsappE164,
          brn: updated.brn,
        },
      });
      return {
        id: updated.id,
        name: updated.user.fullName,
        role: updated.role,
        brn: updated.brn,
        publicPhoneE164: updated.publicPhoneE164,
        whatsappE164: updated.whatsappE164,
      };
    });
  }

  /** Enquiries from the portal. Agents see their own; managers see the whole agency. */
  enquiries(ctx: TenantRequestContext, q: ListEnquiriesQuery) {
    return this.run(ctx, async (tx) => {
      const where: Prisma.PortalEnquiryWhereInput = {
        tenantId: ctx.tenantId,
        ...(q.status ? { status: q.status } : {}),
        ...(!this.seesAll(ctx)
          ? { membershipId: ownMembershipId(ctx) }
          : q.mine && ctx.membershipId
            ? { membershipId: ctx.membershipId }
            : {}),
      };
      const [rows, total] = await Promise.all([
        tx.portalEnquiry.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
            email: true,
            message: true,
            status: true,
            consentMarketing: true,
            createdAt: true,
            leadId: true,
            property: { select: { id: true, reference: true, title: true, community: true } },
            agent: { select: { id: true, user: { select: { fullName: true } } } },
          },
        }),
        tx.portalEnquiry.count({ where }),
      ]);
      return { data: rows, total, page: q.page, pageSize: q.pageSize };
    });
  }

  setEnquiryStatus(
    ctx: TenantRequestContext,
    id: string,
    status: ListEnquiriesQuery['status'] & string,
  ) {
    return this.run(ctx, async (tx) => {
      const current = await tx.portalEnquiry.findFirst({
        where: {
          id,
          tenantId: ctx.tenantId,
          ...(this.seesAll(ctx) ? {} : { membershipId: ownMembershipId(ctx) }),
        },
      });
      if (!current) throw new AppError(404, 'NOT_FOUND', 'Enquiry not found.');
      const updated = await tx.portalEnquiry.update({
        where: { id: current.id },
        data: { status },
        select: { id: true, status: true },
      });
      await audit(tx, ctx, {
        action: 'portal_enquiry.status_changed',
        entityType: 'portal_enquiry',
        entityId: current.id,
        before: { status: current.status },
        after: { status },
      });
      return updated;
    });
  }
}

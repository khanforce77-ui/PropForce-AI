import { Inject, Injectable } from '@nestjs/common';
import {
  withPlatformAdmin,
  withTenant,
  type Prisma,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PRISMA } from '../database/database.module';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import {
  BILLING_PROVIDER,
  BillingNotConfiguredError,
  type BillingProvider,
} from './billing-provider';
import type { CapsBody, PlanUpdateBody, SubscriptionSetBody } from './billing.schemas';

export const TRIAL_DAYS = 14;
const DUBAI_OFFSET_MS = 4 * 3_600_000;

/** Start of the current calendar month in Dubai (UTC+4, no daylight saving). */
export function monthStart(now = new Date()): Date {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DUBAI_OFFSET_MS);
}

const planSelect = {
  code: true,
  name: true,
  priceMonthlyAed: true,
  seatLimit: true,
  listingLimit: true,
  aiRepliesMonthly: true,
  whatsappNumbers: true,
  storageGb: true,
  leadBooster: true,
  voice: true,
  active: true,
  sortOrder: true,
} as const;

type PlanRow = Prisma.BillingPlanGetPayload<{ select: typeof planSelect }>;
const planOut = (p: PlanRow) => ({
  ...p,
  priceMonthlyAed: p.priceMonthlyAed == null ? null : Number(p.priceMonthlyAed),
});

async function monthlyUsage(tx: TransactionClient, since: Date) {
  // Sequential: one transaction connection runs one query at a time.
  const aiReplies = await tx.aiRun.count({ where: { createdAt: { gte: since } } });
  const whatsappMessages = await tx.message.count({
    where: { direction: 'outbound', createdAt: { gte: since } },
  });
  return { ai_replies: aiReplies, whatsapp_messages: whatsappMessages };
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * True when the agency has a blocking AI-replies cap and has reached it this month. Called
   * inside the AI reply claim (tenant context already set).
   */
  static async aiRepliesBlocked(tx: TransactionClient, tenantId: string, now = new Date()) {
    const cap = await tx.spendingCap.findUnique({
      where: { tenantId_meter: { tenantId, meter: 'ai_replies' } },
    });
    if (!cap || cap.action !== 'block') return false;
    const used = await tx.aiRun.count({ where: { createdAt: { gte: monthStart(now) } } });
    return used >= cap.monthlyLimit;
  }

  overview(ctx: TenantRequestContext) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const agency = await tx.agency.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: {
          plan: true,
          seatLimit: true,
          listingLimit: true,
          createdAt: true,
          subscription: { include: { plan: { select: planSelect } } },
        },
      });
      const plans = await tx.billingPlan.findMany({
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
        select: planSelect,
      });
      const sub = agency.subscription;
      // No subscription row yet: the agency is on the plan label the platform set, as a trial.
      const plan =
        sub?.plan ??
        (await tx.billingPlan.findUnique({ where: { code: agency.plan }, select: planSelect })) ??
        (await tx.billingPlan.findUnique({ where: { code: 'trial' }, select: planSelect }));
      const since = monthStart();
      const members = await tx.membership.count({ where: { status: { not: 'removed' } } });
      const invites = await tx.invitation.count({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      const listings = await tx.property.count({ where: { deletedAt: null } });
      const numbers = await tx.whatsAppAccount.count({
        where: { status: { not: 'disconnected' } },
      });
      const used = await monthlyUsage(tx, since);
      const caps = await tx.spendingCap.findMany({
        select: { meter: true, monthlyLimit: true, action: true },
      });
      return {
        subscription: {
          planCode: plan?.code ?? agency.plan,
          status: sub?.status ?? 'trialing',
          trialEndsAt:
            sub?.trialEndsAt ??
            (sub ? null : new Date(agency.createdAt.getTime() + TRIAL_DAYS * 86_400_000)),
          currentPeriodEnd: sub?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
          managedBy: sub?.provider ?? (sub ? 'manual' : null),
        },
        plan: plan ? planOut(plan) : null,
        plans: plans.map(planOut),
        periodStart: since,
        usage: {
          seats: { used: members + invites, limit: agency.seatLimit },
          listings: { used: listings, limit: agency.listingLimit },
          whatsappNumbers: { used: numbers, limit: plan?.whatsappNumbers ?? null },
          aiReplies: { used: used.ai_replies, included: plan?.aiRepliesMonthly ?? null },
          whatsappMessages: { used: used.whatsapp_messages },
        },
        caps: caps.map((c) => ({
          ...c,
          used: used[c.meter],
          reached: used[c.meter] >= c.monthlyLimit,
        })),
        provider: { configured: this.provider.configured, name: this.provider.name },
      };
    });
  }

  async checkout(ctx: TenantRequestContext, planCode: string) {
    const plan = await this.prisma.billingPlan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.active) throw new AppError(404, 'NOT_FOUND', 'Plan not found.');
    if (plan.priceMonthlyAed == null) {
      throw new AppError(409, 'PLAN_NOT_PRICED', 'Contact PropForce for this plan.');
    }
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: ctx.userId },
        select: { email: true },
      });
      return await this.provider.createCheckout({
        tenantId: ctx.tenantId,
        planCode,
        customerEmail: user.email,
        returnUrl: `${this.config.webUrl}/app/${ctx.tenantId}/billing`,
      });
    } catch (e) {
      if (e instanceof BillingNotConfiguredError) {
        throw new AppError(
          503,
          'BILLING_NOT_CONFIGURED',
          'Online payment is not set up yet. Contact PropForce to change your plan.',
        );
      }
      throw e;
    }
  }

  setCaps(ctx: TenantRequestContext, body: CapsBody) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const before = await tx.spendingCap.findMany({
        select: { meter: true, monthlyLimit: true, action: true },
      });
      for (const c of body.caps) {
        if (c.monthlyLimit === null) {
          await tx.spendingCap.deleteMany({ where: { meter: c.meter } });
        } else {
          await tx.spendingCap.upsert({
            where: { tenantId_meter: { tenantId: ctx.tenantId, meter: c.meter } },
            create: {
              tenantId: ctx.tenantId,
              meter: c.meter,
              monthlyLimit: c.monthlyLimit,
              action: c.action,
            },
            update: { monthlyLimit: c.monthlyLimit, action: c.action },
          });
        }
      }
      const after = await tx.spendingCap.findMany({
        select: { meter: true, monthlyLimit: true, action: true },
      });
      await audit(tx, ctx, {
        action: 'billing.caps_changed',
        entityType: 'agency',
        entityId: ctx.tenantId,
        before: before as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
      });
      return { caps: after };
    });
  }

  // ───── platform admin ─────

  platformOverview(adminUserId: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const plans = await tx.billingPlan.findMany({
        orderBy: { sortOrder: 'asc' },
        select: planSelect,
      });
      const subs = await tx.subscription.findMany({
        select: {
          tenantId: true,
          planCode: true,
          status: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          provider: true,
          agency: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });
      const agencies = await tx.agency.count({ where: { isPlatformOwned: false } });
      const price = new Map(
        plans.map((p) => [p.code, p.priceMonthlyAed == null ? null : Number(p.priceMonthlyAed)]),
      );
      const active = subs.filter((s) => s.status === 'active');
      const byStatus = { trialing: 0, active: 0, past_due: 0, cancelled: 0 };
      for (const s of subs) byStatus[s.status] += 1;
      return {
        plans: plans.map(planOut),
        metrics: {
          agencies,
          withoutSubscription: Math.max(0, agencies - subs.length),
          byStatus,
          /** Monthly recurring revenue in AED before VAT, from active subscriptions with a price. */
          mrrAed: active.reduce((a, s) => a + (price.get(s.planCode) ?? 0), 0),
          activeUnpriced: active.filter((s) => price.get(s.planCode) == null).length,
        },
        subscriptions: subs.map((s) => ({
          tenantId: s.tenantId,
          agencyName: s.agency.name,
          planCode: s.planCode,
          status: s.status,
          trialEndsAt: s.trialEndsAt,
          currentPeriodEnd: s.currentPeriodEnd,
          managedBy: s.provider ?? 'manual',
        })),
        provider: { configured: this.provider.configured, name: this.provider.name },
      };
    });
  }

  updatePlan(adminUserId: string, code: string, body: PlanUpdateBody) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const before = await tx.billingPlan.findUnique({ where: { code }, select: planSelect });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Plan not found.');
      const after = await tx.billingPlan.update({
        where: { code },
        data: body,
        select: planSelect,
      });
      await this.platformAudit(tx, adminUserId, 'platform.plan_changed', 'billing_plan', code, {
        before: planOut(before),
        after: planOut(after),
      });
      return planOut(after);
    });
  }

  /**
   * Sets an agency's subscription by hand (until a payment provider manages it) and, by default,
   * copies the plan's seat and listing limits onto the agency, where they are enforced.
   */
  setSubscription(adminUserId: string, tenantId: string, body: SubscriptionSetBody) {
    return withTenant(this.prisma, { tenantId, userId: adminUserId }, async (tx) => {
      const agency = await tx.agency.findUnique({
        where: { id: tenantId },
        select: { name: true, plan: true, seatLimit: true, listingLimit: true, subscription: true },
      });
      if (!agency) throw new AppError(404, 'NOT_FOUND', 'Agency not found.');
      const plan = await tx.billingPlan.findUnique({ where: { code: body.planCode } });
      if (!plan) throw new AppError(404, 'NOT_FOUND', 'Plan not found.');
      const dates = {
        ...(body.trialEndsAt !== undefined
          ? { trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null }
          : {}),
        ...(body.currentPeriodEnd !== undefined
          ? { currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null }
          : {}),
      };
      const sub = await tx.subscription.upsert({
        where: { tenantId },
        create: {
          tenantId,
          planCode: plan.code,
          status: body.status,
          provider: 'manual',
          ...dates,
        },
        update: { planCode: plan.code, status: body.status, ...dates },
      });
      const agencyData = {
        plan: plan.code,
        ...(body.applyLimits ? { seatLimit: plan.seatLimit, listingLimit: plan.listingLimit } : {}),
      };
      await tx.agency.update({ where: { id: tenantId }, data: agencyData });
      const diff = {
        before: {
          plan: agency.plan,
          seatLimit: agency.seatLimit,
          listingLimit: agency.listingLimit,
          status: agency.subscription?.status ?? null,
        },
        after: { ...agencyData, status: sub.status },
      };
      await tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'platform',
          actorUserId: adminUserId,
          action: 'platform.subscription_set',
          entityType: 'agency',
          entityId: tenantId,
          ...diff,
        },
      });
      await this.platformAudit(tx, adminUserId, 'platform.subscription_set', 'agency', tenantId, {
        ...diff,
        after: { ...diff.after, target: agency.name },
      });
      return sub;
    });
  }

  private async platformAudit(
    tx: TransactionClient,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    diff: { before: object; after: object },
  ) {
    await tx.platformAuditLog.create({
      data: {
        actorUserId,
        action,
        targetType,
        targetId,
        before: diff.before as Prisma.InputJsonValue,
        after: diff.after as Prisma.InputJsonValue,
      },
    });
  }
}

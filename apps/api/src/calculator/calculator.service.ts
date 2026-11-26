import { Inject, Injectable } from '@nestjs/common';
import { withTenant, type PrismaClient, type TransactionClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import { estimate, type FeeRuleInput } from './calculator';
import type {
  AffordabilityBody,
  EstimateBody,
  RoiBody,
  RuleOverrideInput,
} from './calculator.schemas';
import { affordability, roi } from './roi';

@Injectable()
export class CalculatorService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private effectiveRules(tx: TransactionClient, ctx: TenantRequestContext, emirate: string) {
    return effectiveFeeRules(tx, ctx.tenantId, emirate);
  }

  rules(ctx: TenantRequestContext, emirate: string) {
    return this.run(ctx, async (tx) => ({ data: await this.effectiveRules(tx, ctx, emirate) }));
  }

  estimate(ctx: TenantRequestContext, body: EstimateBody) {
    return this.run(ctx, async (tx) => {
      const rules = await this.effectiveRules(tx, ctx, body.emirate);
      return { emirate: body.emirate, ...estimate(body, rules) };
    });
  }

  /**
   * Buy-to-let return. Buying costs come from the agency's fee rules (cash or mortgage purchase),
   * so they match the cost estimate; area and service charge default to the linked listing's.
   */
  roi(ctx: TenantRequestContext, body: RoiBody) {
    return this.run(ctx, async (tx) => {
      let { areaSqft, serviceChargePerSqft } = body;
      if (body.propertyId) {
        const p = await tx.property.findFirst({
          where: { id: body.propertyId, deletedAt: null },
          select: { areaSqft: true, serviceChargePerSqft: true },
        });
        if (!p) throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
        areaSqft ??= p.areaSqft != null ? Number(p.areaSqft) : undefined;
        serviceChargePerSqft ??=
          p.serviceChargePerSqft != null ? Number(p.serviceChargePerSqft) : undefined;
      }
      const rules = await this.effectiveRules(tx, ctx, body.emirate);
      const costs = estimate(
        {
          calculator: body.mortgage ? 'mortgage' : 'ready_sale',
          price: body.price,
          downPaymentPct: body.mortgage?.downPaymentPct,
          interestRatePct: body.mortgage?.interestRatePct,
          years: body.mortgage?.years,
          national: body.mortgage?.national,
        },
        rules,
      );
      // Only the buyer's non-refundable costs count towards the investment.
      const buyingCosts = costs.items
        .filter((x) => !x.refundable && x.payer !== 'seller' && x.payer !== 'landlord')
        .reduce((a, x) => a + x.total, 0);
      return {
        emirate: body.emirate,
        ...roi({ ...body, areaSqft, serviceChargePerSqft, buyingCosts }),
        buyingCostItems: costs.items
          .filter((x) => !x.refundable && x.payer !== 'seller' && x.payer !== 'landlord')
          .map((x) => ({ label: x.label, total: x.total, status: x.rule.status })),
        unverifiedCount: costs.unverifiedCount,
      };
    });
  }

  affordability(body: AffordabilityBody) {
    return affordability(body);
  }

  /** Sets the agency's own value for a fee, optionally confirming it was checked. Audited. */
  setOverride(ctx: TenantRequestContext, input: RuleOverrideInput) {
    return this.run(ctx, async (tx) => {
      const template = await tx.feeRule.findFirst({
        where: { tenantId: null, emirate: input.emirate, code: input.code },
      });
      if (!template) throw new AppError(404, 'NOT_FOUND', 'There is no such fee for this emirate.');
      const data = {
        ratePct: input.ratePct,
        amount: input.amount,
        vat: input.vat ?? template.vat,
        source: input.source,
        status: input.verified ? 'verified' : 'unverified_sample',
        verifiedBy: input.verified ? ctx.userId : null,
        verifiedAt: input.verified ? new Date() : null,
      };
      const existing = await tx.feeRule.findFirst({
        where: { tenantId: ctx.tenantId, emirate: input.emirate, code: input.code },
      });
      const saved = existing
        ? await tx.feeRule.update({ where: { id: existing.id }, data })
        : await tx.feeRule.create({
            data: {
              ...data,
              tenantId: ctx.tenantId,
              emirate: input.emirate,
              code: input.code,
              label: template.label,
              calculators: template.calculators,
              payer: template.payer,
              basis: template.basis,
              refundable: template.refundable,
            },
          });
      await audit(tx, ctx, {
        action: 'fee_rule.set',
        entityType: 'fee_rule',
        entityId: saved.id,
        before: existing
          ? {
              ratePct: existing.ratePct?.toString() ?? null,
              amount: existing.amount?.toString() ?? null,
              status: existing.status,
            }
          : null,
        after: {
          emirate: input.emirate,
          code: input.code,
          ratePct: input.ratePct,
          amount: input.amount,
          status: data.status,
        },
      });
      return { id: saved.id, status: saved.status };
    });
  }

  /** Goes back to PropForce's template for this fee. */
  removeOverride(ctx: TenantRequestContext, emirate: string, code: string) {
    return this.run(ctx, async (tx) => {
      const existing = await tx.feeRule.findFirst({
        where: { tenantId: ctx.tenantId, emirate, code },
      });
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'This fee uses the PropForce template.');
      await tx.feeRule.delete({ where: { id: existing.id } });
      await audit(tx, ctx, {
        action: 'fee_rule.reset',
        entityType: 'fee_rule',
        entityId: existing.id,
        before: { emirate, code },
      });
    });
  }
}

/** PropForce's templates for the emirate, with this agency's own values in their place. */
export async function effectiveFeeRules(tx: TransactionClient, tenantId: string, emirate: string) {
  const rows = await tx.feeRule.findMany({
    where: { emirate, OR: [{ tenantId: null }, { tenantId }] },
    orderBy: [{ code: 'asc' }],
  });
  const own = new Map(rows.filter((r) => r.tenantId).map((r) => [r.code, r]));
  return rows
    .filter((r) => r.tenantId === null)
    .map((t): FeeRuleInput & { template: { ratePct: number | null; amount: number | null } } => {
      const r = own.get(t.code) ?? t;
      return {
        code: t.code,
        label: t.label,
        calculators: t.calculators,
        payer: t.payer,
        basis: t.basis,
        ratePct: r.ratePct == null ? null : Number(r.ratePct),
        amount: r.amount == null ? null : Number(r.amount),
        vat: r.vat,
        refundable: t.refundable,
        source: r.source,
        status: r.status,
        verifiedAt: r.verifiedAt,
        isOverride: r !== t,
        template: {
          ratePct: t.ratePct == null ? null : Number(t.ratePct),
          amount: t.amount == null ? null : Number(t.amount),
        },
      };
    });
}

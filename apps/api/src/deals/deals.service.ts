import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  withTenant,
  type DealType,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import { ownMembershipId, type TenantRequestContext } from '../tenancy/tenant.guard';
import { CLOSED_STAGES, commissionBreakdown, DEFAULT_TASKS, stagesFor } from './deal-rules';
import type {
  CommissionStatusInput,
  DealCreateInput,
  DealStageInput,
  DealUpdateInput,
  ListDealsQuery,
  SplitsInput,
  TaskCreateInput,
  TaskUpdateInput,
} from './deals.schemas';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));
const isClosed = (stage: string) => (CLOSED_STAGES as readonly string[]).includes(stage);

const member = { select: { id: true, user: { select: { fullName: true } } } } as const;
/** Dubai is UTC+4 all year. */
const DUBAI_OFFSET_MS = 4 * 3_600_000;

const dealSelect = {
  id: true,
  reference: true,
  type: true,
  stage: true,
  price: true,
  commissionPercent: true,
  commissionAmount: true,
  vatPercent: true,
  commissionStatus: true,
  invoiceNumber: true,
  invoicedAt: true,
  commissionReceivedAt: true,
  expectedCloseDate: true,
  closedAt: true,
  lostReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  lead: { select: { id: true, stage: true } },
  contact: { select: { id: true, fullName: true, phoneE164: true } },
  property: { select: { id: true, reference: true, title: true, community: true, status: true } },
  agent: member,
  splits: {
    select: { id: true, membershipId: true, partyName: true, percent: true, member },
    orderBy: { createdAt: 'asc' },
  },
} as const;
type DealRow = Prisma.DealGetPayload<{ select: typeof dealSelect }>;

/** Adds the commission breakdown; Decimal columns go out as numbers. */
function present(d: DealRow) {
  const splits = d.splits.map((s) => ({
    id: s.id,
    membershipId: s.membershipId,
    partyName: s.partyName,
    name: s.member?.user.fullName ?? s.partyName ?? '',
    percent: Number(s.percent),
  }));
  return {
    ...d,
    price: Number(d.price),
    commissionPercent: num(d.commissionPercent),
    commissionAmount: num(d.commissionAmount),
    vatPercent: Number(d.vatPercent),
    splits,
    commission: commissionBreakdown({
      price: Number(d.price),
      commissionPercent: num(d.commissionPercent),
      commissionAmount: num(d.commissionAmount),
      vatPercent: Number(d.vatPercent),
      splits,
    }),
  };
}

@Injectable()
export class DealsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private canManage(ctx: TenantRequestContext) {
    return hasPermission(ctx.role, 'crm:manage');
  }

  /** Agents see deals they run or share commission on; managers see all. */
  private scope(ctx: TenantRequestContext): Prisma.DealWhereInput {
    if (this.canManage(ctx)) return {};
    const me = ownMembershipId(ctx);
    return { OR: [{ agentMembershipId: me }, { splits: { some: { membershipId: me } } }] };
  }

  private async find(tx: TransactionClient, ctx: TenantRequestContext, id: string) {
    const d = await tx.deal.findFirst({
      where: { AND: [{ id }, this.scope(ctx)] },
      select: dealSelect,
    });
    if (!d) throw notFound('Deal');
    return d;
  }

  /** Only the deal's own agent or a manager changes it; split holders can only look. */
  private assertCanEdit(ctx: TenantRequestContext, d: { agent: { id: string } }) {
    if (!this.canManage(ctx) && d.agent.id !== ctx.membershipId) {
      throw new AppError(
        403,
        'PERMISSION_DENIED',
        'Only the deal agent or a manager can change it.',
      );
    }
  }

  list(ctx: TenantRequestContext, q: ListDealsQuery) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.deal.findMany({
        where: {
          AND: [
            this.scope(ctx),
            q.type ? { type: q.type } : {},
            q.open === true ? { stage: { notIn: [...CLOSED_STAGES] } } : {},
            q.open === false ? { stage: { in: [...CLOSED_STAGES] } } : {},
            q.q
              ? {
                  OR: [
                    { reference: { contains: q.q, mode: 'insensitive' } },
                    { contact: { fullName: { contains: q.q, mode: 'insensitive' } } },
                  ],
                }
              : {},
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 300,
        select: dealSelect,
      });
      return { data: rows.map(present) };
    });
  }

  get(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const d = await this.find(tx, ctx, id);
      const tasks = await tx.dealTask.findMany({
        where: { dealId: id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      const history = await tx.auditLog.findMany({
        where: { entityType: 'deal', entityId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          before: true,
          after: true,
          createdAt: true,
          actorUserId: true,
        },
      });
      return { ...present(d), stages: stagesFor(d.type), tasks, history };
    });
  }

  create(ctx: TenantRequestContext, input: DealCreateInput) {
    return this.run(ctx, async (tx) => {
      let contactId = input.contactId ?? null;
      if (input.leadId) {
        const lead = await tx.lead.findFirst({
          where: {
            AND: [
              { id: input.leadId },
              this.canManage(ctx) ? {} : { assignedMembershipId: ownMembershipId(ctx) },
            ],
          },
          select: { id: true, contactId: true },
        });
        if (!lead) throw notFound('Lead');
        if (contactId && contactId !== lead.contactId) {
          throw new AppError(422, 'VALIDATION_FAILED', 'The contact must be the lead’s contact.');
        }
        contactId = lead.contactId;
      }
      if (!contactId)
        throw new AppError(422, 'VALIDATION_FAILED', 'Choose the lead or the client.');
      const contact = await tx.contact.findFirst({
        where: { id: contactId },
        select: { id: true },
      });
      if (!contact) throw notFound('Contact');
      if (input.propertyId) {
        const p = await tx.property.findFirst({
          where: { id: input.propertyId, deletedAt: null },
          select: { listingType: true },
        });
        if (!p) throw notFound('Listing');
        if ((p.listingType === 'rent') !== (input.type === 'rental')) {
          throw new AppError(
            422,
            'VALIDATION_FAILED',
            'A sale deal needs a sale listing, a rental deal a rental listing.',
          );
        }
      }
      const agentId = input.agentMembershipId ?? ownMembershipId(ctx);
      if (agentId !== ctx.membershipId && !this.canManage(ctx)) {
        throw new AppError(
          403,
          'PERMISSION_DENIED',
          'Only managers can create deals for other agents.',
        );
      }
      await this.assertActiveMember(tx, agentId);
      const stages = stagesFor(input.type);
      const stage = input.stage ?? stages[0]!;
      if (!stages.includes(stage) || isClosed(stage)) {
        throw new AppError(422, 'VALIDATION_FAILED', 'Choose an open stage for a new deal.');
      }
      const reference = await this.nextReference(tx, ctx.tenantId);
      const deal = await tx.deal.create({
        data: {
          tenantId: ctx.tenantId,
          reference,
          type: input.type,
          stage,
          leadId: input.leadId ?? null,
          contactId,
          propertyId: input.propertyId ?? null,
          agentMembershipId: agentId,
          price: input.price,
          commissionPercent: input.commissionPercent ?? null,
          commissionAmount: input.commissionAmount ?? null,
          vatPercent: input.vatPercent,
          expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        },
        select: { id: true },
      });
      // The deal agent gets the whole commission share until someone splits it.
      await tx.dealCommissionSplit.create({
        data: { tenantId: ctx.tenantId, dealId: deal.id, membershipId: agentId, percent: 100 },
      });
      await tx.dealTask.createMany({
        data: DEFAULT_TASKS[input.type].map((title, position) => ({
          tenantId: ctx.tenantId,
          dealId: deal.id,
          title,
          position,
        })),
      });
      if (input.leadId) {
        await tx.leadActivity.create({
          data: {
            tenantId: ctx.tenantId,
            leadId: input.leadId,
            type: 'note',
            body: `Deal ${reference} opened (${input.type}, AED ${input.price.toLocaleString('en-US')})`,
            actorUserId: ctx.userId,
          },
        });
      }
      await audit(tx, ctx, {
        action: 'deal.created',
        entityType: 'deal',
        entityId: deal.id,
        after: { reference, type: input.type, stage, price: input.price },
      });
      return present(await this.find(tx, ctx, deal.id));
    });
  }

  update(ctx: TenantRequestContext, id: string, input: DealUpdateInput) {
    return this.run(ctx, async (tx) => {
      const d = await this.find(tx, ctx, id);
      this.assertCanEdit(ctx, d);
      if (input.agentMembershipId && input.agentMembershipId !== d.agent.id) {
        if (!this.canManage(ctx)) {
          throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can change the deal agent.');
        }
        await this.assertActiveMember(tx, input.agentMembershipId);
      }
      const { expectedCloseDate, ...rest } = input;
      await tx.deal.update({
        where: { id },
        data: {
          ...rest,
          ...(expectedCloseDate !== undefined
            ? { expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null }
            : {}),
        },
      });
      await audit(tx, ctx, {
        action: 'deal.updated',
        entityType: 'deal',
        entityId: id,
        before: {
          price: Number(d.price),
          commissionPercent: num(d.commissionPercent),
          commissionAmount: num(d.commissionAmount),
        },
        after: input as Prisma.InputJsonValue,
      });
      return present(await this.find(tx, ctx, id));
    });
  }

  setStage(ctx: TenantRequestContext, id: string, input: DealStageInput) {
    return this.run(ctx, async (tx) => {
      const d = await this.find(tx, ctx, id);
      this.assertCanEdit(ctx, d);
      if (!stagesFor(d.type).includes(input.stage)) {
        throw new AppError(422, 'VALIDATION_FAILED', `Unknown stage for a ${d.type} deal.`);
      }
      if (input.stage === d.stage) return present(d);
      if (isClosed(d.stage) && !this.canManage(ctx)) {
        throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can reopen a closed deal.');
      }
      const now = new Date();
      await tx.deal.update({
        where: { id },
        data: {
          stage: input.stage,
          closedAt: isClosed(input.stage) ? now : null,
          lostReason: input.stage === 'fallen_through' ? (input.reason ?? null) : null,
        },
      });
      if (input.stage === 'completed') await this.onCompleted(tx, ctx, d);
      if (d.lead) {
        await tx.leadActivity.create({
          data: {
            tenantId: ctx.tenantId,
            leadId: d.lead.id,
            type: 'note',
            body: `Deal ${d.reference}: ${d.stage.replaceAll('_', ' ')} → ${input.stage.replaceAll('_', ' ')}${input.reason ? ` (${input.reason})` : ''}`,
            actorUserId: ctx.userId,
          },
        });
      }
      await audit(tx, ctx, {
        action: 'deal.stage_changed',
        entityType: 'deal',
        entityId: id,
        before: { stage: d.stage },
        after: { stage: input.stage, ...(input.reason ? { reason: input.reason } : {}) },
      });
      return present(await this.find(tx, ctx, id));
    });
  }

  /** Replaces the commission splits. Managers only: it decides who gets paid. */
  setSplits(ctx: TenantRequestContext, id: string, input: SplitsInput) {
    return this.run(ctx, async (tx) => {
      if (!this.canManage(ctx)) {
        throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can change commission splits.');
      }
      const d = await this.find(tx, ctx, id);
      for (const s of input.splits)
        if (s.membershipId) await this.assertActiveMember(tx, s.membershipId);
      await tx.dealCommissionSplit.deleteMany({ where: { dealId: id } });
      await tx.dealCommissionSplit.createMany({
        data: input.splits.map((s) => ({
          tenantId: ctx.tenantId,
          dealId: id,
          membershipId: s.membershipId ?? null,
          partyName: s.membershipId ? null : (s.partyName ?? null),
          percent: s.percent,
        })),
      });
      await audit(tx, ctx, {
        action: 'deal.splits_changed',
        entityType: 'deal',
        entityId: id,
        before: d.splits.map((s) => ({
          membershipId: s.membershipId,
          partyName: s.partyName,
          percent: Number(s.percent),
        })),
        after: input.splits as Prisma.InputJsonValue,
      });
      return present(await this.find(tx, ctx, id));
    });
  }

  setCommissionStatus(ctx: TenantRequestContext, id: string, input: CommissionStatusInput) {
    return this.run(ctx, async (tx) => {
      if (!this.canManage(ctx)) {
        throw new AppError(403, 'PERMISSION_DENIED', 'Only managers record invoices and payments.');
      }
      const d = await this.find(tx, ctx, id);
      const now = new Date();
      await tx.deal.update({
        where: { id },
        data: {
          commissionStatus: input.status,
          invoiceNumber: input.invoiceNumber ?? d.invoiceNumber,
          invoicedAt: input.status === 'pending' ? null : (d.invoicedAt ?? now),
          commissionReceivedAt: input.status === 'received' ? now : null,
        },
      });
      await audit(tx, ctx, {
        action: `deal.commission_${input.status}`,
        entityType: 'deal',
        entityId: id,
        before: { status: d.commissionStatus },
        after: { status: input.status, invoiceNumber: input.invoiceNumber ?? d.invoiceNumber },
      });
      return present(await this.find(tx, ctx, id));
    });
  }

  addTask(ctx: TenantRequestContext, id: string, input: TaskCreateInput) {
    return this.run(ctx, async (tx) => {
      const d = await this.find(tx, ctx, id);
      this.assertCanEdit(ctx, d);
      const last = await tx.dealTask.aggregate({ where: { dealId: id }, _max: { position: true } });
      return tx.dealTask.create({
        data: {
          tenantId: ctx.tenantId,
          dealId: id,
          title: input.title,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          position: (last._max.position ?? -1) + 1,
        },
      });
    });
  }

  updateTask(ctx: TenantRequestContext, id: string, taskId: string, input: TaskUpdateInput) {
    return this.run(ctx, async (tx) => {
      const d = await this.find(tx, ctx, id);
      this.assertCanEdit(ctx, d);
      const task = await tx.dealTask.findFirst({ where: { id: taskId, dealId: id } });
      if (!task) throw notFound('Task');
      return tx.dealTask.update({
        where: { id: taskId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.dueDate !== undefined
            ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
            : {}),
          ...(input.done !== undefined
            ? input.done
              ? { doneAt: task.doneAt ?? new Date(), doneBy: task.doneBy ?? ctx.userId }
              : { doneAt: null, doneBy: null }
            : {}),
        },
      });
    });
  }

  removeTask(ctx: TenantRequestContext, id: string, taskId: string) {
    return this.run(ctx, async (tx) => {
      const d = await this.find(tx, ctx, id);
      this.assertCanEdit(ctx, d);
      const res = await tx.dealTask.deleteMany({ where: { id: taskId, dealId: id } });
      if (!res.count) throw notFound('Task');
    });
  }

  /** Pipeline value and commission per stage, for the board header. */
  summary(ctx: TenantRequestContext, type: DealType) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.deal.findMany({
        where: { AND: [this.scope(ctx), { type }] },
        select: dealSelect,
      });
      const byStage: Record<string, { count: number; value: number; commission: number }> = {};
      for (const s of stagesFor(type)) byStage[s] = { count: 0, value: 0, commission: 0 };
      for (const d of rows.map(present)) {
        const b = byStage[d.stage] ?? (byStage[d.stage] = { count: 0, value: 0, commission: 0 });
        b.count += 1;
        b.value += d.price;
        b.commission += d.commission.gross;
      }
      return { type, stages: byStage };
    });
  }

  /**
   * Commission revenue by Dubai calendar month: deals completed (gross commission earned),
   * commission invoiced and commission received; what is still owed; the open pipeline; and each
   * team member's share of completed deals in the period. Amounts are AED before VAT.
   */
  revenue(ctx: TenantRequestContext, months: number) {
    return this.run(ctx, async (tx) => {
      const now = new Date();
      const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
      const monthKey = (d: Date) => {
        const l = new Date(d.getTime() + DUBAI_OFFSET_MS);
        return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, '0')}`;
      };
      const keys: string[] = [];
      for (let i = months - 1; i >= 0; i--) {
        const m = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - i, 1));
        keys.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`);
      }
      const since = new Date(
        Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - (months - 1), 1) - DUBAI_OFFSET_MS,
      );
      const rows = (
        await tx.deal.findMany({
          where: {
            OR: [
              { stage: { notIn: [...CLOSED_STAGES] } },
              { stage: 'completed', commissionStatus: { not: 'received' } },
              { closedAt: { gte: since } },
              { invoicedAt: { gte: since } },
              { commissionReceivedAt: { gte: since } },
            ],
          },
          select: dealSelect,
        })
      ).map(present);

      const byMonth = new Map(
        keys.map((k) => [k, { month: k, completedDeals: 0, earned: 0, invoiced: 0, received: 0 }]),
      );
      const outstanding = { notInvoiced: 0, invoicedUnpaid: 0 };
      const pipeline = { sale: { deals: 0, commission: 0 }, rental: { deals: 0, commission: 0 } };
      const people = new Map<string, { membershipId: string; name: string; amount: number }>();
      let agencyShare = 0;
      let coBrokers = 0;

      for (const d of rows) {
        const gross = d.commission.gross;
        if (!(CLOSED_STAGES as readonly string[]).includes(d.stage)) {
          pipeline[d.type].deals += 1;
          pipeline[d.type].commission += gross;
          continue;
        }
        if (d.stage !== 'completed') continue;
        if (d.commissionStatus === 'pending') outstanding.notInvoiced += gross;
        if (d.commissionStatus === 'invoiced') outstanding.invoicedUnpaid += gross;
        const closed = d.closedAt && byMonth.get(monthKey(d.closedAt));
        if (closed) {
          closed.completedDeals += 1;
          closed.earned += gross;
          agencyShare += d.commission.agencyAmount;
          for (const sp of d.commission.splits) {
            if (!sp.membershipId) {
              coBrokers += sp.amount;
              continue;
            }
            const name = d.splits.find((x) => x.membershipId === sp.membershipId)?.name ?? '';
            const p = people.get(sp.membershipId) ?? {
              membershipId: sp.membershipId,
              name,
              amount: 0,
            };
            p.amount += sp.amount;
            people.set(sp.membershipId, p);
          }
        }
        const inv = d.invoicedAt && byMonth.get(monthKey(d.invoicedAt));
        if (inv) inv.invoiced += gross;
        const rec = d.commissionReceivedAt && byMonth.get(monthKey(d.commissionReceivedAt));
        if (rec) rec.received += gross;
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const series = [...byMonth.values()].map((m) => ({
        ...m,
        earned: r2(m.earned),
        invoiced: r2(m.invoiced),
        received: r2(m.received),
      }));
      return {
        months,
        series,
        totals: {
          completedDeals: series.reduce((a, m) => a + m.completedDeals, 0),
          earned: r2(series.reduce((a, m) => a + m.earned, 0)),
          received: r2(series.reduce((a, m) => a + m.received, 0)),
          agencyShare: r2(agencyShare),
          coBrokers: r2(coBrokers),
        },
        outstanding: {
          notInvoiced: r2(outstanding.notInvoiced),
          invoicedUnpaid: r2(outstanding.invoicedUnpaid),
        },
        pipeline: {
          sale: { ...pipeline.sale, commission: r2(pipeline.sale.commission) },
          rental: { ...pipeline.rental, commission: r2(pipeline.rental.commission) },
        },
        team: [...people.values()]
          .map((p) => ({ ...p, amount: r2(p.amount) }))
          .sort((a, b) => b.amount - a.amount),
      };
    });
  }

  // ───── helpers ─────

  /** Won deal: the lead is won and the listing sold / rented (if it was still on the market). */
  private async onCompleted(tx: TransactionClient, ctx: TenantRequestContext, d: DealRow) {
    if (d.lead && d.lead.stage !== 'won') {
      await tx.lead.update({
        where: { id: d.lead.id },
        data: { stage: 'won', closedAt: new Date() },
      });
      await tx.leadActivity.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: d.lead.id,
          type: 'stage_changed',
          fromValue: d.lead.stage,
          toValue: 'won',
          body: `Deal ${d.reference} completed`,
          actorUserId: ctx.userId,
        },
      });
    }
    if (d.property && ['active', 'under_offer'].includes(d.property.status)) {
      const status = d.type === 'sale' ? 'sold' : 'rented';
      await tx.property.update({ where: { id: d.property.id }, data: { status } });
      await audit(tx, ctx, {
        action: 'property.status_changed',
        entityType: 'property',
        entityId: d.property.id,
        before: { status: d.property.status },
        after: { status, reason: `deal ${d.reference} completed` },
      });
    }
  }

  private async nextReference(tx: TransactionClient, tenantId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deal-ref:${tenantId}`}, 0))`;
    const count = await tx.deal.count();
    return `DL-${String(count + 1).padStart(5, '0')}`;
  }

  private async assertActiveMember(tx: TransactionClient, membershipId: string) {
    const m = await tx.membership.findFirst({
      where: { id: membershipId, status: 'active' },
      select: { id: true },
    });
    if (!m) throw new AppError(422, 'INVALID_MEMBER', 'Choose an active team member.');
  }
}

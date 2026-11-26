import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  withTenant,
  type ConsentChannel,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { currentConsent } from '../crm/consent';
import { PRISMA } from '../database/database.module';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import type {
  InstallmentAddInput,
  InstallmentUpdateInput,
  ListPlansQuery,
  PlanCreateInput,
  PlanUpdateInput,
} from './payment-reminders.schemas';
import { dubaiToday, isoDate, parseDate } from './reminder-schedule';
import type { ReminderChannelName } from './reminder-templates';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const num = (d: Prisma.Decimal) => Number(d);

/** Reminder channel → the consent channel that governs it. */
export const CONSENT_CHANNEL: Record<ReminderChannelName, ConsentChannel> = {
  email: 'email',
  sms: 'sms',
  ai_call: 'phone_call',
};
export const CONSENT_METHOD = 'Payment plan agreement';

/** Payment plans exist only for developer accounts. Runs inside the tenant transaction. */
export async function assertDeveloper(tx: TransactionClient, tenantId: string) {
  const agency = await tx.agency.findUniqueOrThrow({
    where: { id: tenantId },
    select: { kind: true, name: true },
  });
  if (agency.kind !== 'developer') {
    throw new AppError(
      403,
      'DEVELOPER_ONLY',
      'Payment plans and payment reminders are available for developer accounts.',
    );
  }
  return agency;
}

const installmentSelect = {
  id: true,
  seq: true,
  label: true,
  dueDate: true,
  amount: true,
  status: true,
  paidAt: true,
  paidNote: true,
} as const;

type InstallmentRow = Prisma.PaymentInstallmentGetPayload<{ select: typeof installmentSelect }>;

const serializeInstallment = (i: InstallmentRow, today: Date) => ({
  ...i,
  amount: num(i.amount),
  dueDate: isoDate(i.dueDate),
  overdue: i.status === 'pending' && i.dueDate.getTime() < today.getTime(),
});

function summarize(installments: InstallmentRow[], today: Date) {
  const pending = installments.filter((i) => i.status === 'pending');
  const next = pending.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  return {
    scheduledTotal: installments.reduce((s, i) => s + num(i.amount), 0),
    paidTotal: installments
      .filter((i) => i.status === 'paid')
      .reduce((s, i) => s + num(i.amount), 0),
    outstanding: pending.reduce((s, i) => s + num(i.amount), 0),
    overdueCount: pending.filter((i) => i.dueDate.getTime() < today.getTime()).length,
    nextDue: next
      ? { label: next.label, dueDate: isoDate(next.dueDate), amount: num(next.amount) }
      : null,
  };
}

@Injectable()
export class PaymentPlansService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
      await assertDeveloper(tx, ctx.tenantId);
      return fn(tx);
    });
  }

  list(ctx: TenantRequestContext, q: ListPlansQuery) {
    return this.run(ctx, async (tx) => {
      const today = dubaiToday(new Date());
      const where: Prisma.PaymentPlanWhereInput = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.q
          ? {
              OR: [
                { projectName: { contains: q.q, mode: 'insensitive' } },
                { unitRef: { contains: q.q, mode: 'insensitive' } },
                { contact: { fullName: { contains: q.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const plans = await tx.paymentPlan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: {
          contact: { select: { id: true, fullName: true, phoneE164: true, email: true } },
          installments: { select: installmentSelect },
        },
      });
      return {
        data: plans.map(({ installments, totalPrice, ...p }) => ({
          ...p,
          totalPrice: num(totalPrice),
          installmentCount: installments.length,
          ...summarize(installments, today),
        })),
      };
    });
  }

  get(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, (tx) => this.load(tx, id));
  }

  private async load(tx: TransactionClient, id: string) {
    const today = dubaiToday(new Date());
    const plan = await tx.paymentPlan.findUnique({
      where: { id },
      include: {
        contact: {
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
            email: true,
            doNotContact: true,
            consents: {
              select: { channel: true, purpose: true, status: true, method: true, createdAt: true },
            },
          },
        },
        installments: { select: installmentSelect, orderBy: { seq: 'asc' } },
      },
    });
    if (!plan) throw notFound('Payment plan');
    const { consents, ...contact } = plan.contact;
    const consent = currentConsent(consents).filter((c) => c.purpose === 'service');
    const reminderConsent = Object.fromEntries(
      (Object.keys(CONSENT_CHANNEL) as ReminderChannelName[]).map((ch) => [
        ch,
        consent.find((c) => c.channel === CONSENT_CHANNEL[ch])?.status ?? 'unknown',
      ]),
    ) as Record<ReminderChannelName, 'granted' | 'withdrawn' | 'unknown'>;
    return {
      ...plan,
      totalPrice: num(plan.totalPrice),
      contact: { ...contact, reminderConsent },
      installments: plan.installments.map((i) => serializeInstallment(i, today)),
      ...summarize(plan.installments, today),
    };
  }

  create(ctx: TenantRequestContext, input: PlanCreateInput) {
    return this.run(ctx, async (tx) => {
      let contactId = input.contactId;
      if (contactId) {
        const exists = await tx.contact.findUnique({
          where: { id: contactId },
          select: { id: true },
        });
        if (!exists) throw notFound('Buyer');
      } else {
        const buyer = input.buyer!;
        if (buyer.phone) {
          const clash = await tx.contact.findFirst({
            where: { phoneE164: buyer.phone },
            select: { id: true },
          });
          if (clash) {
            throw new AppError(
              409,
              'CONTACT_PHONE_EXISTS',
              'A buyer with this phone number already exists. Choose them from your buyers instead.',
              [{ path: 'buyer.phone', message: 'Already used by another contact' }],
            );
          }
        }
        const contact = await tx.contact.create({
          data: {
            tenantId: ctx.tenantId,
            fullName: buyer.fullName,
            phoneE164: buyer.phone ?? null,
            email: buyer.email ?? null,
            source: 'manual',
            tags: ['buyer'],
            createdBy: ctx.userId,
          },
        });
        contactId = contact.id;
        await audit(tx, ctx, {
          action: 'contact.created',
          entityType: 'contact',
          entityId: contact.id,
          after: { source: 'manual', via: 'payment_plan' },
        });
      }

      const plan = await tx.paymentPlan.create({
        data: {
          tenantId: ctx.tenantId,
          contactId,
          projectName: input.projectName,
          unitRef: input.unitRef || null,
          totalPrice: input.totalPrice,
          notes: input.notes || null,
          createdBy: ctx.userId,
        },
      });
      await tx.paymentInstallment.createMany({
        data: [...input.installments]
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((i, idx) => ({
            tenantId: ctx.tenantId,
            planId: plan.id,
            seq: idx + 1,
            label: i.label,
            dueDate: parseDate(i.dueDate),
            amount: i.amount,
          })),
      });
      await this.recordConsent(tx, ctx, contactId, input.reminderConsent, plan.id);
      await audit(tx, ctx, {
        action: 'payment_plan.created',
        entityType: 'payment_plan',
        entityId: plan.id,
        after: {
          installments: input.installments.length,
          totalPrice: input.totalPrice,
          reminderConsent: input.reminderConsent,
        },
      });
      return this.load(tx, plan.id);
    });
  }

  /** Records the buyer's agreement to payment reminders on the chosen channels (service purpose). */
  private async recordConsent(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    contactId: string,
    channels: ReminderChannelName[],
    planId: string,
  ) {
    for (const ch of new Set(channels)) {
      await tx.consentRecord.create({
        data: {
          tenantId: ctx.tenantId,
          contactId,
          channel: CONSENT_CHANNEL[ch],
          purpose: 'service',
          status: 'granted',
          method: CONSENT_METHOD,
          evidence: `payment_plan:${planId}`,
          recordedBy: ctx.userId,
        },
      });
    }
  }

  /** Grant or withdraw payment-reminder consent for one channel of this plan's buyer. */
  setConsent(
    ctx: TenantRequestContext,
    id: string,
    channel: ReminderChannelName,
    status: 'granted' | 'withdrawn',
  ) {
    return this.run(ctx, async (tx) => {
      const plan = await tx.paymentPlan.findUnique({ where: { id }, select: { contactId: true } });
      if (!plan) throw notFound('Payment plan');
      await tx.consentRecord.create({
        data: {
          tenantId: ctx.tenantId,
          contactId: plan.contactId,
          channel: CONSENT_CHANNEL[channel],
          purpose: 'service',
          status,
          method: status === 'granted' ? CONSENT_METHOD : 'Withdrawn by developer staff',
          evidence: `payment_plan:${id}`,
          recordedBy: ctx.userId,
        },
      });
      await audit(tx, ctx, {
        action: `consent.${status}`,
        entityType: 'contact',
        entityId: plan.contactId,
        after: { channel: CONSENT_CHANNEL[channel], purpose: 'service', via: 'payment_plan' },
      });
      return this.load(tx, id);
    });
  }

  update(ctx: TenantRequestContext, id: string, input: PlanUpdateInput) {
    return this.run(ctx, async (tx) => {
      const before = await tx.paymentPlan.findUnique({ where: { id } });
      if (!before) throw notFound('Payment plan');
      const data: Prisma.PaymentPlanUpdateInput = {};
      if (input.projectName !== undefined) data.projectName = input.projectName;
      if (input.unitRef !== undefined) data.unitRef = input.unitRef || null;
      if (input.totalPrice !== undefined) data.totalPrice = input.totalPrice;
      if (input.notes !== undefined) data.notes = input.notes || null;
      if (input.remindersPaused !== undefined) data.remindersPaused = input.remindersPaused;
      if (input.status !== undefined) data.status = input.status;
      await tx.paymentPlan.update({ where: { id }, data });
      await audit(tx, ctx, {
        action: 'payment_plan.updated',
        entityType: 'payment_plan',
        entityId: id,
        after: { ...input },
      });
      return this.load(tx, id);
    });
  }

  remove(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const plan = await tx.paymentPlan.findUnique({ where: { id }, select: { id: true } });
      if (!plan) throw notFound('Payment plan');
      await tx.paymentPlan.delete({ where: { id } });
      await audit(tx, ctx, {
        action: 'payment_plan.deleted',
        entityType: 'payment_plan',
        entityId: id,
      });
    });
  }

  addInstallment(ctx: TenantRequestContext, planId: string, input: InstallmentAddInput) {
    return this.run(ctx, async (tx) => {
      const plan = await tx.paymentPlan.findUnique({ where: { id: planId }, select: { id: true } });
      if (!plan) throw notFound('Payment plan');
      const last = await tx.paymentInstallment.findFirst({
        where: { planId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      const created = await tx.paymentInstallment.create({
        data: {
          tenantId: ctx.tenantId,
          planId,
          seq: (last?.seq ?? 0) + 1,
          label: input.label,
          dueDate: parseDate(input.dueDate),
          amount: input.amount,
        },
      });
      await audit(tx, ctx, {
        action: 'payment_installment.created',
        entityType: 'payment_installment',
        entityId: created.id,
        after: { planId, dueDate: input.dueDate, amount: input.amount },
      });
      return this.load(tx, planId);
    });
  }

  updateInstallment(
    ctx: TenantRequestContext,
    planId: string,
    installmentId: string,
    input: InstallmentUpdateInput,
  ) {
    return this.run(ctx, async (tx) => {
      const before = await tx.paymentInstallment.findFirst({
        where: { id: installmentId, planId },
      });
      if (!before) throw notFound('Installment');
      const data: Prisma.PaymentInstallmentUpdateInput = {};
      if (input.label !== undefined) data.label = input.label;
      if (input.dueDate !== undefined) data.dueDate = parseDate(input.dueDate);
      if (input.amount !== undefined) data.amount = input.amount;
      if (input.paidNote !== undefined) data.paidNote = input.paidNote || null;
      if (input.status !== undefined && input.status !== before.status) {
        data.status = input.status;
        data.paidAt = input.status === 'paid' ? new Date() : null;
      }
      await tx.paymentInstallment.update({ where: { id: installmentId }, data });
      await audit(tx, ctx, {
        action: 'payment_installment.updated',
        entityType: 'payment_installment',
        entityId: installmentId,
        before: {
          status: before.status,
          dueDate: isoDate(before.dueDate),
          amount: num(before.amount),
        },
        after: { ...input },
      });
      // A plan whose installments are all settled is complete.
      const open = await tx.paymentInstallment.count({ where: { planId, status: 'pending' } });
      const plan = await tx.paymentPlan.findUniqueOrThrow({ where: { id: planId } });
      if (open === 0 && plan.status === 'active') {
        await tx.paymentPlan.update({ where: { id: planId }, data: { status: 'completed' } });
      } else if (open > 0 && plan.status === 'completed') {
        await tx.paymentPlan.update({ where: { id: planId }, data: { status: 'active' } });
      }
      return this.load(tx, planId);
    });
  }

  removeInstallment(ctx: TenantRequestContext, planId: string, installmentId: string) {
    return this.run(ctx, async (tx) => {
      const before = await tx.paymentInstallment.findFirst({
        where: { id: installmentId, planId },
      });
      if (!before) throw notFound('Installment');
      const count = await tx.paymentInstallment.count({ where: { planId } });
      if (count <= 1) {
        throw new AppError(409, 'LAST_INSTALLMENT', 'A plan needs at least one installment.');
      }
      await tx.paymentInstallment.delete({ where: { id: installmentId } });
      await audit(tx, ctx, {
        action: 'payment_installment.deleted',
        entityType: 'payment_installment',
        entityId: installmentId,
        before: { planId, dueDate: isoDate(before.dueDate), amount: num(before.amount) },
      });
      return this.load(tx, planId);
    });
  }
}

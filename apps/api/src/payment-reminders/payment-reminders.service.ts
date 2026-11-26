import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  listPaymentReminderTenants,
  Prisma,
  withTenant,
  type PrismaClient,
  type ReminderDispatchStatus,
  type TransactionClient,
} from '@propforce/db';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { mayContact } from '../crm/consent';
import { PRISMA } from '../database/database.module';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { EmailSender } from '../email/email.sender';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import { assertDeveloper, CONSENT_CHANNEL } from './payment-plans.service';
import type {
  ConfigUpdateInput,
  PreviewInput,
  TemplateUpdateInput,
} from './payment-reminders.schemas';
import {
  REMINDER_CALLER,
  SMS_SENDER,
  type ReminderCaller,
  type SmsSender,
} from './reminder-channels';
import {
  daysBetween,
  defaultRules,
  dubaiToday,
  dueWindow,
  formatAed,
  formatDate,
  inCallWindow,
  type ReminderRule,
} from './reminder-schedule';
import {
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  REMINDER_CHANNELS,
  REMINDER_STAGES,
  renderCall,
  renderEmail,
  renderSms,
  resolveTemplate,
  SAMPLE_VALUES,
  SMS_MAX_LENGTH,
  stageForOffset,
  templateKey,
  unknownPlaceholders,
  type ReminderChannelName,
  type ReminderStage,
  type ReminderTemplate,
  type TemplateKey,
  type TemplateValues,
} from './reminder-templates';

export const OUTBOUND_CALLS_FLAG = 'voice.outbound_calls';

type Config = {
  rules: ReminderRule[];
  templates: Partial<Record<TemplateKey, ReminderTemplate>>;
  replyToEmail: string | null;
  contactPhone: string | null;
  paymentInstructions: string | null;
};

export interface RunSummary {
  considered: number;
  sent: number;
  skippedNoConsent: number;
  skippedNoAddress: number;
  providerPending: number;
  failed: number;
  /** AI calls left for a later run because it is outside calling hours. */
  deferredCalls: number;
}

const emptySummary = (): RunSummary => ({
  considered: 0,
  sent: 0,
  skippedNoConsent: 0,
  skippedNoAddress: 0,
  providerPending: 0,
  failed: 0,
  deferredCalls: 0,
});

interface Job {
  dispatchId: string;
  channel: ReminderChannelName;
  to: string;
  customerName: string;
  email?: { subject: string; html: string; text: string; replyTo?: string };
  sms?: string;
  call?: { firstMessage: string; instructions: string; fromPhoneNumberId: string | null };
  installmentId: string;
}

function parseRules(value: Prisma.JsonValue): ReminderRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return [];
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.offsetDays !== 'number') return [];
    const channels = Array.isArray(o.channels)
      ? (o.channels.filter((c) =>
          (REMINDER_CHANNELS as readonly string[]).includes(c as string),
        ) as ReminderChannelName[])
      : [];
    return [{ id: o.id, offsetDays: o.offsetDays, channels, active: o.active !== false }];
  });
}

function parseTemplates(value: Prisma.JsonValue): Config['templates'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Config['templates'] = {};
  for (const [k, v] of Object.entries(value)) {
    if (!(k in DEFAULT_TEMPLATES) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.body === 'string') {
      out[k as TemplateKey] = {
        subject: typeof o.subject === 'string' ? o.subject : '',
        body: o.body,
      };
    }
  }
  return out;
}

@Injectable()
export class PaymentRemindersService {
  private readonly logger = new Logger(PaymentRemindersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly email: EmailSender,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(REMINDER_CALLER) private readonly caller: ReminderCaller,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {}

  private run<T>(
    ctx: TenantRequestContext,
    fn: (tx: TransactionClient, developerName: string) => Promise<T>,
  ) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
      const agency = await assertDeveloper(tx, ctx.tenantId);
      return fn(tx, agency.name);
    });
  }

  /** Reads the developer's config, creating it with the recommended schedule on first use. */
  private async config(tx: TransactionClient, tenantId: string): Promise<Config> {
    let row = await tx.paymentReminderConfig.findUnique({ where: { tenantId } });
    if (!row) {
      row = await tx.paymentReminderConfig.create({
        data: { tenantId, rules: defaultRules() as unknown as Prisma.InputJsonValue },
      });
    }
    return {
      rules: parseRules(row.rules),
      templates: parseTemplates(row.templates),
      replyToEmail: row.replyToEmail,
      contactPhone: row.contactPhone,
      paymentInstructions: row.paymentInstructions,
    };
  }

  private async outboundCallsAllowed(tx: TransactionClient, tenantId: string) {
    const flag = await tx.featureFlag.findUnique({ where: { key: OUTBOUND_CALLS_FLAG } });
    const overrides = (flag?.overrides ?? {}) as Record<string, unknown>;
    return (
      overrides[tenantId] === true || (flag?.enabled === true && overrides[tenantId] !== false)
    );
  }

  private channelStatus(callsAllowed: boolean) {
    return {
      email: { ready: true, note: 'Sent from noreply@propforce.io.' },
      sms: this.sms.configured
        ? { ready: true, note: null }
        : {
            ready: false,
            note: 'SMS provider not connected yet. SMS reminders are logged, not sent.',
          },
      ai_call: !this.caller.configured
        ? {
            ready: false,
            note: 'AI calling is not connected yet. Call reminders are logged, not placed.',
          }
        : !callsAllowed
          ? { ready: false, note: 'Outbound AI calls are not switched on for your account yet.' }
          : {
              ready: true,
              note: `Calls are placed between ${this.appConfig.voice.callingHours.from}:00 and ${this.appConfig.voice.callingHours.to}:00 Dubai time.`,
            },
    };
  }

  getConfig(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const c = await this.config(tx, ctx.tenantId);
      const callsAllowed = await this.outboundCallsAllowed(tx, ctx.tenantId);
      return {
        rules: c.rules.sort((a, b) => a.offsetDays - b.offsetDays),
        replyToEmail: c.replyToEmail,
        contactPhone: c.contactPhone,
        paymentInstructions: c.paymentInstructions,
        channels: this.channelStatus(callsAllowed),
      };
    });
  }

  updateConfig(ctx: TenantRequestContext, input: ConfigUpdateInput) {
    return this.run(ctx, async (tx) => {
      await this.config(tx, ctx.tenantId);
      const data: Prisma.PaymentReminderConfigUpdateInput = { updatedBy: ctx.userId };
      if (input.rules) {
        const seen = new Set<string>();
        const rules = input.rules.map((r) => ({
          id: r.id ?? randomUUID(),
          offsetDays: r.offsetDays,
          channels: [...new Set(r.channels)],
          active: r.active,
        }));
        for (const r of rules) {
          const k = `${r.offsetDays}`;
          if (seen.has(k)) {
            throw new AppError(
              400,
              'VALIDATION_FAILED',
              'Each reminder day can only appear once.',
              [{ path: 'rules', message: `Two reminders on day ${r.offsetDays}` }],
            );
          }
          seen.add(k);
        }
        data.rules = rules as unknown as Prisma.InputJsonValue;
      }
      if (input.replyToEmail !== undefined) data.replyToEmail = input.replyToEmail || null;
      if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone || null;
      if (input.paymentInstructions !== undefined) {
        data.paymentInstructions = input.paymentInstructions || null;
      }
      await tx.paymentReminderConfig.update({ where: { tenantId: ctx.tenantId }, data });
      await audit(tx, ctx, {
        action: 'payment_reminders.config_updated',
        entityType: 'payment_reminder_config',
        entityId: ctx.tenantId,
        after: { ...input } as Prisma.InputJsonValue,
      });
      return null;
    }).then(() => this.getConfig(ctx));
  }

  listTemplates(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const c = await this.config(tx, ctx.tenantId);
      return {
        placeholders: PLACEHOLDERS,
        smsMaxLength: SMS_MAX_LENGTH,
        data: REMINDER_CHANNELS.flatMap((channel) =>
          REMINDER_STAGES.map((stage) => {
            const t = resolveTemplate(c.templates, templateKey(channel, stage));
            return {
              channel,
              stage,
              ...t,
              default: DEFAULT_TEMPLATES[templateKey(channel, stage)],
            };
          }),
        ),
      };
    });
  }

  private validateTemplate(channel: ReminderChannelName, t: ReminderTemplate) {
    const unknown = [...unknownPlaceholders(t.subject), ...unknownPlaceholders(t.body)];
    if (unknown.length) {
      throw new AppError(400, 'VALIDATION_FAILED', 'The template uses unknown placeholders.', [
        {
          path: 'body',
          message: `Unknown: ${[...new Set(unknown)].map((u) => `{{${u}}}`).join(', ')}`,
        },
      ]);
    }
    if (channel === 'email' && !t.subject.trim()) {
      throw new AppError(400, 'VALIDATION_FAILED', 'An email needs a subject.', [
        { path: 'subject', message: 'Required' },
      ]);
    }
    if (channel === 'ai_call' && !t.subject.trim()) {
      throw new AppError(400, 'VALIDATION_FAILED', 'A call needs an opening line.', [
        { path: 'subject', message: 'Required' },
      ]);
    }
    if (channel === 'ai_call' && !/\bAI\b/.test(t.subject)) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'The opening line must tell the buyer they are speaking with an AI assistant.',
        [{ path: 'subject', message: 'Mention that this is an AI assistant' }],
      );
    }
    if (channel === 'sms' && t.body.length > SMS_MAX_LENGTH) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        `SMS text is limited to ${SMS_MAX_LENGTH} characters.`,
        [{ path: 'body', message: 'Too long' }],
      );
    }
  }

  saveTemplate(
    ctx: TenantRequestContext,
    channel: ReminderChannelName,
    stage: ReminderStage,
    input: TemplateUpdateInput,
  ) {
    const t = { subject: channel === 'sms' ? '' : input.subject, body: input.body };
    this.validateTemplate(channel, t);
    return this.run(ctx, async (tx) => {
      const c = await this.config(tx, ctx.tenantId);
      const templates = { ...c.templates, [templateKey(channel, stage)]: t };
      await tx.paymentReminderConfig.update({
        where: { tenantId: ctx.tenantId },
        data: { templates: templates as Prisma.InputJsonValue, updatedBy: ctx.userId },
      });
      await audit(tx, ctx, {
        action: 'payment_reminders.template_saved',
        entityType: 'payment_reminder_config',
        entityId: ctx.tenantId,
        after: { key: templateKey(channel, stage) },
      });
      return { channel, stage, ...t, edited: true };
    });
  }

  resetTemplate(ctx: TenantRequestContext, channel: ReminderChannelName, stage: ReminderStage) {
    return this.run(ctx, async (tx) => {
      const c = await this.config(tx, ctx.tenantId);
      const templates = { ...c.templates };
      delete templates[templateKey(channel, stage)];
      await tx.paymentReminderConfig.update({
        where: { tenantId: ctx.tenantId },
        data: { templates: templates as Prisma.InputJsonValue, updatedBy: ctx.userId },
      });
      await audit(tx, ctx, {
        action: 'payment_reminders.template_reset',
        entityType: 'payment_reminder_config',
        entityId: ctx.tenantId,
        after: { key: templateKey(channel, stage) },
      });
      return { channel, stage, ...DEFAULT_TEMPLATES[templateKey(channel, stage)], edited: false };
    });
  }

  private sampleValues(c: Config, developerName: string, stage: ReminderStage): TemplateValues {
    return {
      ...SAMPLE_VALUES,
      developer_name: developerName,
      days: stage === 'due' ? '0' : stage === 'before' ? '7' : '3',
      ...(c.paymentInstructions ? { payment_instructions: c.paymentInstructions } : {}),
      ...(c.contactPhone ? { contact_phone: c.contactPhone } : {}),
      ...(c.replyToEmail ? { reply_email: c.replyToEmail } : {}),
    };
  }

  /** Renders a template (saved, or the unsaved text sent) with sample buyer data. */
  preview(ctx: TenantRequestContext, input: PreviewInput) {
    return this.run(ctx, async (tx, developerName) => {
      const c = await this.config(tx, ctx.tenantId);
      const saved = resolveTemplate(c.templates, templateKey(input.channel, input.stage));
      const t = { subject: input.subject ?? saved.subject, body: input.body ?? saved.body };
      const values = this.sampleValues(c, developerName, input.stage);
      const unknown = [
        ...new Set([...unknownPlaceholders(t.subject), ...unknownPlaceholders(t.body)]),
      ];
      if (input.channel === 'email')
        return { channel: input.channel, unknown, ...renderEmail(t, values) };
      if (input.channel === 'sms') {
        const text = renderSms(t, values);
        return {
          channel: input.channel,
          unknown,
          text,
          length: text.length,
          segments: Math.ceil(text.length / 153) || 1,
        };
      }
      return { channel: input.channel, unknown, ...renderCall(t, values) };
    });
  }

  /** Sends the email template, filled with sample data, to the signed-in user's own address. */
  async sendTestEmail(ctx: TenantRequestContext, stage: ReminderStage) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { email: true },
    });
    const message = await this.run(ctx, async (tx, developerName) => {
      const c = await this.config(tx, ctx.tenantId);
      const t = resolveTemplate(c.templates, templateKey('email', stage));
      return {
        rendered: renderEmail(t, this.sampleValues(c, developerName, stage)),
        replyTo: c.replyToEmail,
      };
    });
    await this.email.send({
      to: user.email,
      subject: `[Test] ${message.rendered.subject}`,
      text: message.rendered.text,
      html: message.rendered.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return { sentTo: user.email };
  }

  log(ctx: TenantRequestContext, q: { planId?: string | undefined; limit: number }) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.paymentReminderDispatch.findMany({
        where: q.planId ? { installment: { planId: q.planId } } : {},
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        select: {
          id: true,
          channel: true,
          status: true,
          offsetDays: true,
          recipient: true,
          detail: true,
          createdAt: true,
          installment: {
            select: {
              id: true,
              label: true,
              dueDate: true,
              plan: {
                select: {
                  id: true,
                  projectName: true,
                  unitRef: true,
                  contact: { select: { id: true, fullName: true } },
                },
              },
            },
          },
        },
      });
      return {
        data: rows.map((r) => ({
          ...r,
          installment: {
            ...r.installment,
            dueDate: r.installment.dueDate.toISOString().slice(0, 10),
          },
        })),
      };
    });
  }

  /** "Run now" for one developer (owners and admins). */
  async runForTenant(ctx: TenantRequestContext): Promise<RunSummary> {
    await this.run(ctx, async () => null);
    const summary = await this.runTenant(ctx.tenantId, new Date());
    await withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
      audit(tx, ctx, {
        action: 'payment_reminders.run',
        entityType: 'payment_reminder_config',
        entityId: ctx.tenantId,
        after: { ...summary },
      }),
    );
    return summary;
  }

  /** The daily run for every active developer. Each developer runs in its own tenant context. */
  async runAll(now = new Date()) {
    const tenants = await listPaymentReminderTenants(this.prisma);
    const total = emptySummary();
    for (const tenantId of tenants) {
      try {
        const s = await this.runTenant(tenantId, now);
        for (const k of Object.keys(total) as (keyof RunSummary)[]) total[k] += s[k];
      } catch (err) {
        this.logger.error(
          `Payment reminders failed for tenant ${tenantId}: ${(err as Error).message}`,
        );
      }
    }
    return { tenants: tenants.length, ...total };
  }

  /**
   * Finds every reminder due today (or missed in the last CATCH_UP_DAYS) for unpaid installments of
   * active, unpaused plans, and settles each one exactly once per installment, rule and channel:
   * skipped (no consent / no address), provider pending, or sent / failed.
   */
  async runTenant(tenantId: string, now: Date): Promise<RunSummary> {
    const summary = emptySummary();
    const today = dubaiToday(now);
    const callWindow = inCallWindow(now, this.appConfig.voice.callingHours);

    const jobs = await withTenant(
      this.prisma,
      { tenantId },
      async (tx) => {
        const agency = await tx.agency.findUniqueOrThrow({
          where: { id: tenantId },
          select: { kind: true, name: true, status: true },
        });
        if (agency.kind !== 'developer' || agency.status !== 'active') return [];
        const c = await this.config(tx, tenantId);
        const callsAllowed = await this.outboundCallsAllowed(tx, tenantId);
        const line = await tx.voiceLine.findFirst({
          where: { active: true },
          orderBy: { createdAt: 'asc' },
          select: { providerPhoneNumberId: true },
        });
        const out: Job[] = [];

        for (const rule of c.rules.filter((r) => r.active && r.channels.length)) {
          const { from, to } = dueWindow(today, rule.offsetDays);
          const stage = stageForOffset(rule.offsetDays);
          const installments = await tx.paymentInstallment.findMany({
            where: {
              status: 'pending',
              dueDate: { gte: from, lte: to },
              plan: { status: 'active', remindersPaused: false },
            },
            include: {
              plan: {
                include: {
                  contact: { select: { id: true, fullName: true, email: true, phoneE164: true } },
                },
              },
              dispatches: { where: { ruleId: rule.id }, select: { channel: true } },
            },
          });

          for (const inst of installments) {
            const done = new Set(inst.dispatches.map((d) => d.channel));
            const contact = inst.plan.contact;
            const values: TemplateValues = {
              buyer_name: contact.fullName,
              developer_name: agency.name,
              project: inst.plan.projectName,
              unit: inst.plan.unitRef ?? '',
              installment: inst.label,
              amount: formatAed(Number(inst.amount)),
              due_date: formatDate(inst.dueDate),
              days: String(Math.abs(daysBetween(today, inst.dueDate))),
              payment_instructions:
                c.paymentInstructions ?? 'Please use the payment details in your agreement.',
              contact_phone: c.contactPhone ?? '',
              reply_email: c.replyToEmail ?? '',
            };

            for (const channel of rule.channels) {
              if (done.has(channel)) continue;
              summary.considered += 1;
              const record = async (
                status: ReminderDispatchStatus,
                recipient: string | null,
                detail: string | null,
              ) => {
                const id = randomUUID();
                const res = await tx.paymentReminderDispatch.createMany({
                  data: [
                    {
                      id,
                      tenantId,
                      installmentId: inst.id,
                      ruleId: rule.id,
                      offsetDays: rule.offsetDays,
                      channel,
                      status,
                      recipient,
                      detail,
                    },
                  ],
                  skipDuplicates: true,
                });
                return res.count === 1 ? id : null;
              };

              const address = channel === 'email' ? contact.email : contact.phoneE164;
              if (!(await mayContact(tx, contact.id, CONSENT_CHANNEL[channel], 'service'))) {
                if (
                  await record(
                    'skipped_no_consent',
                    null,
                    `No ${CONSENT_CHANNEL[channel]} service consent`,
                  )
                ) {
                  summary.skippedNoConsent += 1;
                }
                continue;
              }
              if (!address) {
                if (
                  await record(
                    'skipped_no_address',
                    null,
                    channel === 'email' ? 'No email' : 'No phone',
                  )
                ) {
                  summary.skippedNoAddress += 1;
                }
                continue;
              }
              const t = resolveTemplate(c.templates, templateKey(channel, stage));
              if (channel === 'email') {
                const id = await record('sending', address, null);
                if (id) {
                  out.push({
                    dispatchId: id,
                    channel,
                    to: address,
                    customerName: contact.fullName,
                    installmentId: inst.id,
                    email: {
                      ...renderEmail(t, values),
                      ...(c.replyToEmail ? { replyTo: c.replyToEmail } : {}),
                    },
                  });
                }
              } else if (channel === 'sms') {
                if (!this.sms.configured) {
                  if (await record('provider_pending', address, 'SMS provider not connected')) {
                    summary.providerPending += 1;
                  }
                  continue;
                }
                const id = await record('sending', address, null);
                if (id) {
                  out.push({
                    dispatchId: id,
                    channel,
                    to: address,
                    customerName: contact.fullName,
                    installmentId: inst.id,
                    sms: renderSms(t, values),
                  });
                }
              } else {
                if (!this.caller.configured || !callsAllowed) {
                  const why = !this.caller.configured
                    ? 'AI calling not connected'
                    : 'Outbound AI calls not switched on';
                  if (await record('provider_pending', address, why)) summary.providerPending += 1;
                  continue;
                }
                if (!callWindow) {
                  // Not recorded: a later run inside calling hours places it.
                  summary.deferredCalls += 1;
                  continue;
                }
                const id = await record('sending', address, null);
                if (id) {
                  out.push({
                    dispatchId: id,
                    channel,
                    to: address,
                    customerName: contact.fullName,
                    installmentId: inst.id,
                    call: {
                      ...renderCall(t, values),
                      fromPhoneNumberId: line?.providerPhoneNumberId ?? null,
                    },
                  });
                }
              }
            }
          }
        }
        return out;
      },
      { timeoutMs: 60_000 },
    );

    // Sends happen outside the transaction; each claimed row is then settled.
    for (const job of jobs) {
      let status: ReminderDispatchStatus = 'sent';
      let detail: string | null = null;
      try {
        if (job.email) {
          await this.email.send({ to: job.to, ...job.email });
        } else if (job.sms) {
          detail = (await this.sms.send({ toE164: job.to, text: job.sms, tenantId })).messageId;
        } else if (job.call) {
          detail = (
            await this.caller.placeCall({
              tenantId,
              toE164: job.to,
              customerName: job.customerName,
              ...job.call,
              metadata: {
                source: 'payment_reminder',
                tenantId,
                dispatchId: job.dispatchId,
                installmentId: job.installmentId,
              },
            })
          ).providerCallId;
        }
        summary.sent += 1;
      } catch (err) {
        status = 'failed';
        detail = ((err as Error).message || 'Send failed').slice(0, 300);
        summary.failed += 1;
        this.logger.warn(`Payment reminder ${job.dispatchId} (${job.channel}) failed: ${detail}`);
      }
      await withTenant(this.prisma, { tenantId }, (tx) =>
        tx.paymentReminderDispatch.update({
          where: { id: job.dispatchId },
          data: { status, detail },
        }),
      );
    }
    return summary;
  }
}

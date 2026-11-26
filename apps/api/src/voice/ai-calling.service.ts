import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { dubaiKnowledge } from '@propforce/ai';
import { mayContact } from '../crm/consent';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import type { CallReport, CallStatusUpdate } from './vapi-report';
import { VoiceDialer, type DialInput } from './voice-dialer';
import type {
  BulkCallBody,
  PlaceCallBody,
  ScriptCreateBody,
  ScriptUpdateBody,
} from './voice.schemas';

type Script = Prisma.VoiceScriptGetPayload<{ select: typeof scriptSelect }>;
interface CallEnv {
  line: { id: string; providerPhoneNumberId: string } | null;
  agencyName: string;
  agentName: string;
}

export const OUTBOUND_FLAG = 'voice.outbound_calls';
/** At most this many AI calls to one person per rolling day, and per rolling week. */
export const MAX_CALLS_PER_DAY = 1;
export const MAX_CALLS_PER_WEEK = 2;
const DAY_MS = 86_400_000;

const scriptSelect = {
  id: true,
  name: true,
  purpose: true,
  language: true,
  firstMessage: true,
  instructions: true,
  questions: true,
  transcriptPolicy: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Hour of day in Dubai (UTC+4, no daylight saving). */
export const dubaiHour = (now: Date) => (now.getUTCHours() + 4) % 24;

const DUBAI_OFFSET_MS = 4 * 3_600_000;
const HOUR_MS = 3_600_000;
/** Bulk calls are booked this far apart, so they don't all ring at once. */
export const BULK_SPACING_SEC = 60;
const MAX_SCHEDULE_AHEAD_MS = 30 * 86_400_000;

export interface CallSlot {
  earliestAt: Date;
  latestAt: Date;
  /** Ring now rather than book with the provider. */
  immediate: boolean;
}

/** The calling-hours window (Dubai time) on the Dubai calendar day of `t`. */
export function callingWindow(t: Date, from: number, to: number) {
  const dayStart =
    Math.floor((t.getTime() + DUBAI_OFFSET_MS) / 86_400_000) * 86_400_000 - DUBAI_OFFSET_MS;
  return { start: new Date(dayStart + from * HOUR_MS), end: new Date(dayStart + to * HOUR_MS) };
}

/**
 * `count` call times from `start`, `spacingSec` apart, each inside calling hours: a time
 * before the window moves to its start, and one at or after its end rolls to the next day.
 * Exported for tests.
 */
export function callSlots(
  start: Date,
  count: number,
  spacingSec: number,
  from: number,
  to: number,
): CallSlot[] {
  const out: CallSlot[] = [];
  let t = start.getTime();
  for (let i = 0; i < count; i++) {
    let w = callingWindow(new Date(t), from, to);
    if (t < w.start.getTime()) t = w.start.getTime();
    if (t >= w.end.getTime()) {
      w = callingWindow(new Date(w.start.getTime() + 86_400_000), from, to);
      t = w.start.getTime();
    }
    out.push({ earliestAt: new Date(t), latestAt: w.end, immediate: false });
    t += spacingSec * 1000;
  }
  return out;
}

/** A display name safe to put in a prompt: letters, spaces and a few marks only. */
function safeName(s: string | null | undefined): string | null {
  if (!s || /^\+?\d[\d\s-]*$/.test(s)) return null;
  const clean = s
    .replace(/[^\p{L}\p{M} .'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, 60) : null;
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(contact_name|agent_name|agency_name)\s*\}\}/g, (_, k: string) => {
    return vars[k] ?? '';
  });
}

/**
 * The agency's own instructions plus PropForce's calling rules, which always come last and win.
 * Exported for tests.
 */
export function buildInstructions(
  script: { instructions: string; questions: string[]; purpose: string; language: string },
  vars: { contact_name: string; agent_name: string; agency_name: string },
): string {
  const about =
    script.purpose === 'marketing'
      ? `property offers from ${vars.agency_name}, which they agreed to hear about`
      : `their property enquiry with ${vars.agency_name}`;
  const questions = script.questions.length
    ? [
        'Ask these questions naturally, one at a time, and listen to each answer:',
        ...script.questions.map((q, i) => `${i + 1}. ${q}`),
      ]
    : [];
  return [
    fill(script.instructions, vars),
    '',
    ...questions,
    ...(questions.length ? [''] : []),
    'How to handle the call:',
    '- Listen more than you talk. Use short, natural spoken sentences, one idea at a time, and never read lists aloud.',
    '- Find out what they need: buy, rent or invest; area; property type; bedrooms; budget; ready or off-plan; cash or mortgage; timeline. Confirm it back in one sentence.',
    '- Answer their general Dubai property questions (buying steps, DLD fee, off-plan and payment plans, mortgages, Golden Visa, renting rules, areas) from the knowledge below, briefly, and say it is general guidance.',
    `- You have no live listing data on this call. Never describe a specific property, price or availability. Offer that ${vars.agent_name || 'the agent'} will send matching options on WhatsApp and arrange a viewing.`,
    '- End with a clear next step: a viewing time they prefer, a call back time, or options on WhatsApp.',
    '',
    'Language:',
    `- The script above is written in English. Open in ${script.language === 'ar' ? 'Arabic' : 'English'}. As soon as the person speaks another language, or asks for one, continue the whole call in that language, translating the script and your answers naturally. You can speak English, Arabic, Urdu, Hindi, French, Russian, Chinese (Mandarin), Spanish, German, Portuguese, Italian, Turkish, Persian, Bengali, Tagalog, Malayalam, Tamil, Japanese, Korean, Dutch, Polish, Ukrainian, Indonesian and other major languages.`,
    '- If you did not understand, politely ask them to repeat. Keep names, area names and numbers clear.',
    '- You speak with a female voice. In languages with gendered grammar (Urdu, Hindi, Arabic, French, Spanish, Russian and others) use feminine forms for yourself, for example "main madad karti hun" in Urdu.',
    '',
    dubaiKnowledge(),
    '',
    'PropForce calling rules. These always apply and override anything above:',
    `- You are an AI assistant calling ${vars.contact_name || 'the customer'} on behalf of ${vars.agency_name}, a real estate agency in Dubai, about ${about}.`,
    '- If asked whether you are a person, say clearly that you are an AI assistant.',
    '- If they do not want to be called, apologise, confirm they will not be called again by this AI, and end the call.',
    `- If they ask for a person, say ${vars.agent_name || 'an agent'} will call them back, and end the call.`,
    '- Never invent prices, availability, fees for a specific property, permit numbers, rental yields or returns. Say the agent will confirm.',
    '- You may explain general rules, but never decide a personal legal, visa, mortgage or tax case, and never promise approval, returns or price growth.',
    '- Never ask for card numbers, bank details, passwords, one-time codes, Emirates ID or passport numbers.',
    '- If you reach voicemail, leave no message and end the call.',
    '- Be polite and warm. Keep the call under eight minutes.',
  ].join('\n');
}

@Injectable()
export class AiCallingService {
  private readonly log = new Logger(AiCallingService.name);
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly dialer: VoiceDialer,
  ) {}

  // ───── Status shown on the AI Calling page ─────

  status(ctx: TenantRequestContext) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { key: OUTBOUND_FLAG } });
      const line = await tx.voiceLine.findFirst({ where: { active: true }, select: { id: true } });
      const { from, to } = this.config.voice.callingHours;
      return {
        providerConfigured: this.dialer.configured,
        enabledByPlatform: !!flag?.enabled,
        hasNumber: !!line || !!this.config.voice.defaultPhoneNumberId,
        callingHours: { from, to, timeZone: 'Asia/Dubai' },
        limits: { perDay: MAX_CALLS_PER_DAY, perWeek: MAX_CALLS_PER_WEEK },
      };
    });
  }

  // ───── Scripts ─────

  listScripts(ctx: TenantRequestContext) {
    return withTenant(this.prisma, ctx, async (tx) => ({
      data: await tx.voiceScript.findMany({
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
        select: scriptSelect,
      }),
    }));
  }

  createScript(ctx: TenantRequestContext, body: ScriptCreateBody) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const script = await tx.voiceScript.create({
        data: { tenantId: ctx.tenantId, ...body, createdBy: ctx.userId },
        select: scriptSelect,
      });
      await audit(tx, ctx, {
        action: 'voice.script_created',
        entityType: 'voice_script',
        entityId: script.id,
        after: { name: script.name, purpose: script.purpose },
      });
      return script;
    });
  }

  updateScript(ctx: TenantRequestContext, id: string, body: ScriptUpdateBody) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const before = await tx.voiceScript.findFirst({ where: { id }, select: scriptSelect });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Script not found.');
      const after = await tx.voiceScript.update({
        where: { id },
        data: body,
        select: scriptSelect,
      });
      await audit(tx, ctx, {
        action: 'voice.script_updated',
        entityType: 'voice_script',
        entityId: id,
        before: { name: before.name, purpose: before.purpose, active: before.active },
        after: { name: after.name, purpose: after.purpose, active: after.active },
      });
      return after;
    });
  }

  // ───── Placing a call ─────

  /**
   * Checks every rule, records the call, then asks the provider to dial now or at the booked
   * time. Fails closed: no consent, a do-not-contact flag, outside calling hours, too many
   * recent calls, the platform switch off or the provider not set up all refuse the call before
   * anything is dialled.
   */
  async placeCall(ctx: TenantRequestContext, body: PlaceCallBody) {
    const now = new Date();
    const slot = body.scheduledAt
      ? this.bookedSlot(new Date(body.scheduledAt), now)
      : this.nowSlot(now);
    this.assertConfigured();
    const prepared = await withTenant(this.prisma, ctx, async (tx) => {
      await this.assertEnabled(tx);
      const script = await this.activeScript(tx, body.scriptId);
      const env = await this.callEnv(tx, ctx);
      return this.prepare(tx, ctx, script, env, body.contactId, body.leadId ?? null, slot);
    });
    return this.dial(ctx, prepared, slot);
  }

  /**
   * Books one AI call per contact, a minute or more apart and only inside calling hours (later
   * calls roll to the next day's window). Each contact passes the same checks as a single call;
   * the ones that fail are listed with the reason, and the rest still go ahead.
   */
  async placeBulk(ctx: TenantRequestContext, body: BulkCallBody) {
    const now = new Date();
    const { from, to } = this.config.voice.callingHours;
    const start = body.startAt ? new Date(body.startAt) : now;
    if (start.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) {
      throw new AppError(422, 'VALIDATION_FAILED', 'Calls can be booked up to 30 days ahead.');
    }
    this.assertConfigured();
    const { script, env } = await withTenant(this.prisma, ctx, async (tx) => {
      await this.assertEnabled(tx);
      return {
        script: await this.activeScript(tx, body.scriptId),
        env: await this.callEnv(tx, ctx),
      };
    });

    const ids = [...new Set(body.contactIds)];
    const slots = callSlots(start < now ? now : start, ids.length, BULK_SPACING_SEC, from, to);
    const booked: { contactId: string; callId: string; at: string }[] = [];
    const skipped: { contactId: string; reason: string }[] = [];
    for (const [i, contactId] of ids.entries()) {
      const slot = slots[i]!;
      const at = slot.earliestAt.getTime() - now.getTime() < 30_000 ? null : slot;
      try {
        const prepared = await withTenant(this.prisma, ctx, (tx) =>
          this.prepare(tx, ctx, script, env, contactId, null, at ?? this.nowSlot(now)),
        );
        const r = await this.dial(ctx, prepared, at ?? this.nowSlot(now));
        booked.push({ contactId, callId: r.id, at: slot.earliestAt.toISOString() });
      } catch (e) {
        skipped.push({
          contactId,
          reason: e instanceof AppError ? e.message : 'The call could not be booked.',
        });
      }
    }
    return { booked, skipped };
  }

  private assertConfigured() {
    if (!this.dialer.configured) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'AI calling is not set up yet.');
    }
  }

  /** A call to ring right away: only allowed inside calling hours. */
  private nowSlot(now: Date): CallSlot {
    const { from, to } = this.config.voice.callingHours;
    const hour = dubaiHour(now);
    if (hour < from || hour >= to) {
      throw new AppError(
        409,
        'OUTSIDE_CALLING_HOURS',
        `AI calls can only be made between ${from}:00 and ${to}:00 Dubai time.`,
      );
    }
    return { earliestAt: now, latestAt: callingWindow(now, from, to).end, immediate: true };
  }

  /** A call booked for a chosen time, which must fall inside calling hours. */
  private bookedSlot(at: Date, now: Date): CallSlot {
    const { from, to } = this.config.voice.callingHours;
    if (at.getTime() <= now.getTime() + 60_000) return this.nowSlot(now);
    if (at.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) {
      throw new AppError(422, 'VALIDATION_FAILED', 'Calls can be booked up to 30 days ahead.');
    }
    const hour = dubaiHour(at);
    if (hour < from || hour >= to) {
      throw new AppError(
        422,
        'OUTSIDE_CALLING_HOURS',
        `Pick a time between ${from}:00 and ${to}:00 Dubai time.`,
      );
    }
    return { earliestAt: at, latestAt: callingWindow(at, from, to).end, immediate: false };
  }

  private async assertEnabled(tx: TransactionClient) {
    const flag = await tx.featureFlag.findUnique({ where: { key: OUTBOUND_FLAG } });
    if (!flag?.enabled) {
      throw new AppError(
        409,
        'FEATURE_DISABLED',
        'AI calling is not switched on for agencies yet. PropForce will enable it.',
      );
    }
  }

  private async activeScript(tx: TransactionClient, id: string) {
    const script = await tx.voiceScript.findFirst({
      where: { id, active: true },
      select: scriptSelect,
    });
    if (!script) throw new AppError(404, 'NOT_FOUND', 'Script not found or switched off.');
    return script;
  }

  /** The agency's calling number and names used in every call it places. */
  private async callEnv(tx: TransactionClient, ctx: TenantRequestContext) {
    const line = await tx.voiceLine.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, providerPhoneNumberId: true },
    });
    if (!line && !this.config.voice.defaultPhoneNumberId) {
      throw new AppError(
        409,
        'INTEGRATION_NOT_CONFIGURED',
        'No calling number is set up for this agency yet.',
      );
    }
    const agency = await tx.agency.findUnique({
      where: { id: ctx.tenantId },
      select: { name: true },
    });
    const me = await tx.user.findUnique({ where: { id: ctx.userId }, select: { fullName: true } });
    return {
      line,
      agencyName: safeName(agency?.name) ?? 'the agency',
      agentName: ctx.platform ? '' : (safeName(me?.fullName) ?? ''),
    };
  }

  /** Per-contact checks, then the call row. Throws an AppError saying why a call can't go. */
  private async prepare(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    script: Script,
    env: CallEnv,
    contactId: string,
    leadId: string | null,
    slot: CallSlot,
  ) {
    const all = hasPermission(ctx.role, 'crm:manage');
    const contact = await tx.contact.findFirst({
      where: { id: contactId },
      select: { id: true, fullName: true, phoneE164: true, ownerMembershipId: true },
    });
    if (!contact || (!all && contact.ownerMembershipId !== ctx.membershipId)) {
      throw new AppError(404, 'NOT_FOUND', 'Contact not found.');
    }
    if (!contact.phoneE164) {
      throw new AppError(422, 'NO_PHONE', 'This contact has no phone number.');
    }
    if (leadId) {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, contactId: contact.id },
        select: { id: true },
      });
      if (!lead) throw new AppError(404, 'NOT_FOUND', 'Lead not found for this contact.');
    }
    if (!(await mayContact(tx, contact.id, 'phone_call', script.purpose))) {
      throw new AppError(
        403,
        'CONSENT_REQUIRED',
        script.purpose === 'marketing'
          ? 'This contact has not agreed to marketing phone calls.'
          : 'This contact has not agreed to phone calls about their enquiry.',
      );
    }
    const now = Date.now();
    const recent = await tx.voiceCall.findMany({
      where: {
        contactId: contact.id,
        direction: 'outbound',
        status: { not: 'failed' },
        createdAt: { gte: new Date(now - 7 * DAY_MS) },
      },
      select: { createdAt: true },
    });
    const today = recent.filter((c) => c.createdAt.getTime() >= now - DAY_MS).length;
    if (today >= MAX_CALLS_PER_DAY || recent.length >= MAX_CALLS_PER_WEEK) {
      throw new AppError(
        429,
        'CALL_LIMIT',
        `This contact was already called recently (limit ${MAX_CALLS_PER_DAY} a day, ${MAX_CALLS_PER_WEEK} a week).`,
      );
    }

    const call = await tx.voiceCall.create({
      data: {
        tenantId: ctx.tenantId,
        lineId: env.line?.id ?? null,
        providerCallId: `pending-${crypto.randomUUID()}`,
        direction: 'outbound',
        callerE164: contact.phoneE164,
        contactId: contact.id,
        scriptId: script.id,
        leadId,
        requestedBy: ctx.membershipId,
        status: 'queued',
        scheduledAt: slot.immediate ? null : slot.earliestAt,
        keepTranscript: script.transcriptPolicy === 'full_transcript',
      },
      select: { id: true },
    });
    await audit(tx, ctx, {
      action: slot.immediate ? 'voice.call_placed' : 'voice.call_scheduled',
      entityType: 'voice_call',
      entityId: call.id,
      after: {
        contactId: contact.id,
        scriptId: script.id,
        purpose: script.purpose,
        ...(slot.immediate ? {} : { scheduledAt: slot.earliestAt.toISOString() }),
      },
    });
    const vars = {
      contact_name: safeName(contact.fullName) ?? '',
      agent_name: env.agentName,
      agency_name: env.agencyName,
    };
    return {
      callId: call.id,
      dial: {
        fromPhoneNumberId: env.line?.providerPhoneNumberId ?? null,
        toE164: contact.phoneE164,
        customerName: vars.contact_name || null,
        firstMessage: fill(script.firstMessage, vars),
        instructions: buildInstructions(script, vars),
        questions: script.questions,
        language: script.language === 'ar' ? ('ar' as const) : ('en' as const),
        metadata: { propforceCallId: call.id, tenantId: ctx.tenantId, source: 'ai_calling' },
      } satisfies DialInput,
    };
  }

  private async dial(
    ctx: TenantRequestContext,
    prepared: { callId: string; dial: DialInput },
    slot: CallSlot,
  ) {
    try {
      const { providerCallId } = await this.dialer.startCall({
        ...prepared.dial,
        ...(slot.immediate
          ? {}
          : { schedule: { earliestAt: slot.earliestAt, latestAt: slot.latestAt } }),
      });
      const status = slot.immediate ? ('ringing' as const) : ('queued' as const);
      await withTenant(this.prisma, ctx, (tx) =>
        tx.voiceCall.update({
          where: { id: prepared.callId },
          data: { providerCallId: providerCallId.slice(0, 200), status },
        }),
      );
      return {
        id: prepared.callId,
        status,
        ...(slot.immediate ? {} : { scheduledAt: slot.earliestAt.toISOString() }),
      };
    } catch (e) {
      const message = e instanceof AppError ? e.message : 'The call could not be started.';
      await withTenant(this.prisma, ctx, (tx) =>
        tx.voiceCall.update({
          where: { id: prepared.callId },
          data: { status: 'failed', error: message.slice(0, 300) },
        }),
      );
      throw e instanceof AppError
        ? e
        : new AppError(502, 'PROVIDER_ERROR', 'The call could not be started. Try again later.');
    }
  }

  // ───── Provider webhooks for calls we placed ─────

  private findOurs(tx: TransactionClient, propforceCallId: string, providerCallId: string) {
    return tx.voiceCall.findFirst({
      where: {
        id: propforceCallId,
        direction: 'outbound',
        // The provider id is set once dialled; before that only our placeholder is stored.
        OR: [{ providerCallId }, { providerCallId: { startsWith: 'pending-' } }],
      },
      select: { id: true, status: true, contactId: true, keepTranscript: true, leadId: true },
    });
  }

  async recordStatus(u: CallStatusUpdate): Promise<'updated' | 'unknown_call'> {
    if (!u.propforceCallId || !u.tenantId) return 'unknown_call';
    const { propforceCallId } = u;
    return withTenant(this.prisma, { tenantId: u.tenantId }, async (tx) => {
      const call = await this.findOurs(tx, propforceCallId, u.providerCallId);
      if (!call) return 'unknown_call' as const;
      // Never move a finished call backwards.
      if (call.status === 'ended' || call.status === 'failed') return 'updated' as const;
      await tx.voiceCall.update({
        where: { id: call.id },
        data: { status: u.status, providerCallId: u.providerCallId.slice(0, 200) },
      });
      return 'updated' as const;
    });
  }

  async recordReport(r: CallReport): Promise<'stored' | 'unknown_call'> {
    if (!r.propforceCallId || !r.tenantId) return 'unknown_call';
    const { propforceCallId, tenantId } = r;
    return withTenant(this.prisma, { tenantId }, async (tx) => {
      const call = await this.findOurs(tx, propforceCallId, r.providerCallId);
      if (!call) return 'unknown_call' as const;
      const outcome =
        r.outcome ??
        (r.endedReason && /no-answer|busy|did-not-answer/i.test(r.endedReason)
          ? 'no_answer'
          : r.endedReason && /voicemail/i.test(r.endedReason)
            ? 'voicemail'
            : null);
      await tx.voiceCall.update({
        where: { id: call.id },
        data: {
          providerCallId: r.providerCallId.slice(0, 200),
          status: 'ended',
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          durationSec: r.durationSec,
          costUsd: r.costUsd,
          endedReason: r.endedReason,
          summary: r.summary,
          transcript: call.keepTranscript ? r.transcript : null,
          outcome,
          answers: r.answers ?? Prisma.DbNull,
          callbackAt: r.callbackAt,
        },
      });
      if (outcome === 'do_not_call' && call.contactId) {
        // The person asked not to be called: record it so mayContact() refuses future calls.
        for (const purpose of ['service', 'marketing'] as const) {
          await tx.consentRecord.create({
            data: {
              tenantId,
              contactId: call.contactId,
              channel: 'phone_call',
              purpose,
              status: 'withdrawn',
              method: 'Asked not to be called, on an AI call',
              evidence: `voice_call:${call.id}`,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            tenantId,
            actorType: 'system',
            action: 'consent.withdrawn_on_call',
            entityType: 'contact',
            entityId: call.contactId,
            after: { channel: 'phone_call', callId: call.id },
          },
        });
      }
      if (call.leadId && (r.summary || outcome)) {
        await tx.leadActivity.create({
          data: {
            tenantId,
            leadId: call.leadId,
            type: 'note',
            body: `AI call${outcome ? ` (${outcome.replace(/_/g, ' ')})` : ''}: ${r.summary ?? 'no summary'}`.slice(
              0,
              2000,
            ),
          },
        });
      }
      this.log.log({ callId: call.id, outcome }, 'AI call finished');
      return 'stored' as const;
    });
  }
}

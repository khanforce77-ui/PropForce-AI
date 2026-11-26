import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { mayContact } from '../crm/consent';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import type { CallReport, CallStatusUpdate } from './vapi-report';
import { VoiceDialer } from './voice-dialer';
import type { PlaceCallBody, ScriptCreateBody, ScriptUpdateBody } from './voice.schemas';

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
    'PropForce calling rules. These always apply and override anything above:',
    `- You are an AI assistant calling ${vars.contact_name || 'the customer'} on behalf of ${vars.agency_name}, a real estate agency in Dubai, about ${about}.`,
    '- If asked whether you are a person, say clearly that you are an AI assistant.',
    '- If they do not want to be called, apologise, confirm they will not be called again by this AI, and end the call.',
    `- If they ask for a person, say ${vars.agent_name || 'an agent'} will call them back, and end the call.`,
    '- Never invent prices, availability, fees, permit numbers, rental yields or returns. Say the agent will confirm.',
    '- Never give legal, visa, mortgage or tax advice.',
    '- Never ask for card numbers, bank details, passwords, one-time codes, Emirates ID or passport numbers.',
    '- If you reach voicemail, leave no message and end the call.',
    '- Be polite and brief. Keep the call under five minutes.',
    script.language === 'ar'
      ? '- Speak Arabic. Switch to English if the person prefers.'
      : '- Speak English. Switch to Arabic if the person prefers and you can.',
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
   * Checks every rule, records the call, then asks the provider to dial. Fails closed: no
   * consent, a do-not-contact flag, outside calling hours, too many recent calls, the platform
   * switch off or the provider not set up all refuse the call before anything is dialled.
   */
  async placeCall(ctx: TenantRequestContext, body: PlaceCallBody) {
    const { from, to } = this.config.voice.callingHours;
    const hour = dubaiHour(new Date());
    if (hour < from || hour >= to) {
      throw new AppError(
        409,
        'OUTSIDE_CALLING_HOURS',
        `AI calls can only be made between ${from}:00 and ${to}:00 Dubai time.`,
      );
    }
    if (!this.dialer.configured) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'AI calling is not set up yet.');
    }

    const prepared = await withTenant(this.prisma, ctx, async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { key: OUTBOUND_FLAG } });
      if (!flag?.enabled) {
        throw new AppError(
          409,
          'FEATURE_DISABLED',
          'AI calling is not switched on for agencies yet. PropForce will enable it.',
        );
      }
      const script = await tx.voiceScript.findFirst({
        where: { id: body.scriptId, active: true },
        select: scriptSelect,
      });
      if (!script) throw new AppError(404, 'NOT_FOUND', 'Script not found or switched off.');

      const all = hasPermission(ctx.role, 'crm:manage');
      const contact = await tx.contact.findFirst({
        where: { id: body.contactId },
        select: { id: true, fullName: true, phoneE164: true, ownerMembershipId: true },
      });
      if (!contact || (!all && contact.ownerMembershipId !== ctx.membershipId)) {
        throw new AppError(404, 'NOT_FOUND', 'Contact not found.');
      }
      if (!contact.phoneE164) {
        throw new AppError(422, 'NO_PHONE', 'This contact has no phone number.');
      }
      if (body.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: body.leadId, contactId: contact.id },
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
      const me = await tx.user.findUnique({
        where: { id: ctx.userId },
        select: { fullName: true },
      });

      const call = await tx.voiceCall.create({
        data: {
          tenantId: ctx.tenantId,
          lineId: line?.id ?? null,
          providerCallId: `pending-${crypto.randomUUID()}`,
          direction: 'outbound',
          callerE164: contact.phoneE164,
          contactId: contact.id,
          scriptId: script.id,
          leadId: body.leadId ?? null,
          requestedBy: ctx.membershipId,
          status: 'queued',
          keepTranscript: script.transcriptPolicy === 'full_transcript',
        },
        select: { id: true },
      });
      await audit(tx, ctx, {
        action: 'voice.call_placed',
        entityType: 'voice_call',
        entityId: call.id,
        after: { contactId: contact.id, scriptId: script.id, purpose: script.purpose },
      });
      const vars = {
        contact_name: safeName(contact.fullName) ?? '',
        agent_name: ctx.platform ? '' : (safeName(me?.fullName) ?? ''),
        agency_name: safeName(agency?.name) ?? 'the agency',
      };
      return {
        callId: call.id,
        dial: {
          fromPhoneNumberId: line?.providerPhoneNumberId ?? null,
          toE164: contact.phoneE164,
          customerName: vars.contact_name || null,
          firstMessage: fill(script.firstMessage, vars),
          instructions: buildInstructions(script, vars),
          questions: script.questions,
          language: script.language === 'ar' ? ('ar' as const) : ('en' as const),
          metadata: { propforceCallId: call.id, tenantId: ctx.tenantId, source: 'ai_calling' },
        },
      };
    });

    try {
      const { providerCallId } = await this.dialer.startCall(prepared.dial);
      await withTenant(this.prisma, ctx, (tx) =>
        tx.voiceCall.update({
          where: { id: prepared.callId },
          data: { providerCallId: providerCallId.slice(0, 200), status: 'ringing' },
        }),
      );
      return { id: prepared.callId, status: 'ringing' as const };
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

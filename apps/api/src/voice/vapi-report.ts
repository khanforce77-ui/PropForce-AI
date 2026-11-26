import { CALL_OUTCOMES, type CallOutcome } from './call-outcomes';

/**
 * Parses Vapi server messages (https://docs.vapi.ai/server-url/events). Only the end-of-call
 * report is stored; everything else is acknowledged and ignored. Parsing is defensive because the
 * provider adds fields over time: unknown shapes return null rather than throwing.
 */
export interface CallReport {
  providerCallId: string;
  providerPhoneNumberId: string;
  direction: 'inbound' | 'outbound';
  callerE164: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  costUsd: number | null;
  endedReason: string | null;
  summary: string | null;
  transcript: string | null;
  /** From the structured-data analysis of outbound calls. */
  outcome: CallOutcome | null;
  answers: Record<string, string> | null;
  callbackAt: string | null;
  /** Our own ids, sent with outbound calls and returned unchanged. */
  propforceCallId: string | null;
  tenantId: string | null;
}

/** A progress update for an outbound call. */
export interface CallStatusUpdate {
  providerCallId: string;
  propforceCallId: string | null;
  tenantId: string | null;
  status: 'ringing' | 'in_progress' | 'ended';
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown, max = 100_000): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const E164 = /^\+[1-9]\d{6,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => {
  const s = str(v, 36);
  return s && UUID.test(s) ? s.toLowerCase() : null;
};

/** Our ids from call metadata (call.metadata, or the assistant's metadata). */
function ours(
  m: Obj,
  call: Obj | null,
): { propforceCallId: string | null; tenantId: string | null } {
  const meta = obj(call?.metadata) ?? obj(obj(m.assistant)?.metadata) ?? obj(m.metadata);
  return { propforceCallId: uuid(meta?.propforceCallId), tenantId: uuid(meta?.tenantId) };
}

function structured(m: Obj): Pick<CallReport, 'outcome' | 'answers' | 'callbackAt'> {
  const data = obj(obj(m.analysis)?.structuredData);
  const outcomeRaw = str(data?.outcome, 40);
  const outcome = (CALL_OUTCOMES as readonly string[]).includes(outcomeRaw ?? '')
    ? (outcomeRaw as CallOutcome)
    : null;
  const rawAnswers = obj(data?.answers);
  const answers: Record<string, string> = {};
  for (let i = 1; i <= 10; i++) {
    const a = str(rawAnswers?.[`q${i}`], 1000);
    if (a) answers[`q${i}`] = a;
  }
  return {
    outcome,
    answers: Object.keys(answers).length ? answers : null,
    callbackAt: str(data?.callbackAt, 200),
  };
}

const STATUS: Record<string, CallStatusUpdate['status']> = {
  ringing: 'ringing',
  queued: 'ringing',
  'in-progress': 'in_progress',
  forwarding: 'in_progress',
  ended: 'ended',
};

export function parseVapiStatus(body: unknown): CallStatusUpdate | null {
  const m = obj(obj(body)?.message);
  if (!m || str(m.type, 100) !== 'status-update') return null;
  const call = obj(m.call);
  const providerCallId = str(call?.id, 200);
  const status = STATUS[str(m.status, 40) ?? ''];
  if (!providerCallId || !status) return null;
  return { providerCallId, status, ...ours(m, call) };
}

/** The summary from the legacy analysis plan, or a structured output whose name says "summary". */
function summaryOf(m: Obj): string | null {
  const legacy = str(obj(m.analysis)?.summary, 4000);
  if (legacy) return legacy;
  const outputs = obj(obj(m.artifact)?.structuredOutputs);
  for (const v of Object.values(outputs ?? {})) {
    const o = obj(v);
    if (o && /summary/i.test(String(o.name ?? ''))) {
      const r = str(o.result, 4000);
      if (r) return r;
    }
  }
  return null;
}

export function parseVapiMessage(body: unknown): { type: string; report: CallReport | null } {
  const m = obj(obj(body)?.message);
  const type = str(m?.type, 100) ?? 'unknown';
  if (!m || type !== 'end-of-call-report') return { type, report: null };

  const call = obj(m.call);
  const providerCallId = str(call?.id, 200);
  const providerPhoneNumberId = str(call?.phoneNumberId, 100) ?? str(obj(m.phoneNumber)?.id, 100);
  const ids = ours(m, call);
  // Outbound calls we placed are found by our own ids; others need the line's number.
  if (!providerCallId || (!providerPhoneNumberId && !ids.propforceCallId)) {
    return { type, report: null };
  }

  const caller = str(obj(m.customer)?.number, 32) ?? str(obj(call?.customer)?.number, 32);
  const startedAt = date(m.startedAt ?? call?.startedAt);
  const endedAt = date(m.endedAt ?? call?.endedAt);
  const cost = typeof m.cost === 'number' && Number.isFinite(m.cost) ? m.cost : null;
  return {
    type,
    report: {
      providerCallId,
      providerPhoneNumberId: providerPhoneNumberId ?? '',
      direction: str(call?.type, 50) === 'outboundPhoneCall' ? 'outbound' : 'inbound',
      callerE164: caller && E164.test(caller) ? caller : null,
      startedAt,
      endedAt,
      durationSec:
        startedAt && endedAt && endedAt >= startedAt
          ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
          : null,
      costUsd: cost !== null && cost >= 0 ? Math.round(cost * 10_000) / 10_000 : null,
      endedReason: str(m.endedReason, 200),
      summary: summaryOf(m),
      transcript: str(obj(m.artifact)?.transcript) ?? str(m.transcript),
      ...structured(m),
      ...ids,
    },
  };
}

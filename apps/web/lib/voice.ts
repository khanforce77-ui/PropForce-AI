export interface CallRow {
  id: string;
  direction: 'inbound' | 'outbound';
  callerE164: string | null;
  startedAt: string | null;
  durationSec: number | null;
  endedReason: string | null;
  summary: string | null;
  costUsd: number | null;
  status: CallStatus;
  /** Set when the call was booked for later. */
  scheduledAt: string | null;
  outcome: CallOutcome | null;
  error: string | null;
  createdAt: string;
  contact: { id: string; fullName: string } | null;
  line: { label: string | null; phoneE164: string | null } | null;
  script: { id: string; name: string } | null;
}

export interface CallDetail extends CallRow {
  transcript: string | null;
  keepTranscript: boolean;
  answers: Record<string, string> | null;
  callbackAt: string | null;
  line: (NonNullable<CallRow['line']> & { transcriptPolicy: TranscriptPolicy }) | null;
  script: { id: string; name: string; questions: string[] } | null;
}

export type CallStatus = 'queued' | 'ringing' | 'in_progress' | 'ended' | 'failed';
export type CallOutcome =
  | 'interested'
  | 'not_interested'
  | 'callback_requested'
  | 'viewing_requested'
  | 'wrong_number'
  | 'do_not_call'
  | 'no_answer'
  | 'voicemail'
  | 'other';

export const STATUS_LABEL: Record<CallStatus, string> = {
  queued: 'Starting',
  ringing: 'Ringing',
  in_progress: 'On the call',
  ended: 'Ended',
  failed: 'Failed',
};

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  interested: 'Interested',
  not_interested: 'Not interested',
  callback_requested: 'Wants a call back',
  viewing_requested: 'Wants a viewing',
  wrong_number: 'Wrong number',
  do_not_call: 'Asked not to be called',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  other: 'Other',
};

export interface CallScript {
  id: string;
  name: string;
  purpose: 'service' | 'marketing';
  language: 'en' | 'ar';
  firstMessage: string;
  instructions: string;
  questions: string[];
  transcriptPolicy: TranscriptPolicy;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiCallingStatus {
  providerConfigured: boolean;
  enabledByPlatform: boolean;
  hasNumber: boolean;
  callingHours: { from: number; to: number; timeZone: string };
  limits: { perDay: number; perWeek: number };
}

/** Why calls cannot be placed yet, or null when they can. */
export function notReadyReason(s: AiCallingStatus | null): string | null {
  if (!s) return null;
  if (!s.providerConfigured) return 'AI calling is being set up by PropForce and is not live yet.';
  if (!s.hasNumber)
    return 'No calling number is assigned to your agency yet. Contact PropForce support.';
  if (!s.enabledByPlatform) return 'AI calling is not switched on yet. PropForce will enable it.';
  return null;
}

export type TranscriptPolicy = 'summary_only' | 'full_transcript';

export interface VoiceLine {
  id: string;
  provider: string;
  providerPhoneNumberId: string;
  phoneE164: string | null;
  label: string | null;
  transcriptPolicy: TranscriptPolicy;
  active: boolean;
  createdAt: string;
}

export const duration = (s: number | null) =>
  s == null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const when = (s: string | null) =>
  s
    ? new Date(s).toLocaleString('en-AE', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Dubai',
      })
    : '–';

/** "2026-11-27T10:30" typed in a datetime-local box, read as Dubai time. */
export const dubaiInputToIso = (v: string) => new Date(`${v}:00+04:00`).toISOString();

/** Tomorrow at the start of calling hours, Dubai time, as a datetime-local value. */
export function nextCallingStart(fromHour: number): string {
  const dubaiNow = new Date(Date.now() + 4 * 3_600_000);
  const d = new Date(dubaiNow);
  if (dubaiNow.getUTCHours() >= fromHour) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T${String(fromHour).padStart(2, '0')}:00`;
}

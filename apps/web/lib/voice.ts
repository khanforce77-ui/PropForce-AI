export interface CallRow {
  id: string;
  direction: 'inbound' | 'outbound';
  callerE164: string | null;
  startedAt: string | null;
  durationSec: number | null;
  endedReason: string | null;
  summary: string | null;
  costUsd: number | null;
  contact: { id: string; fullName: string } | null;
  line: { label: string | null; phoneE164: string | null };
}

export interface CallDetail extends CallRow {
  transcript: string | null;
  line: CallRow['line'] & { transcriptPolicy: TranscriptPolicy };
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

export type CampaignStatus =
  'draft' | 'pending_approval' | 'approved' | 'sending' | 'completed' | 'cancelled';
export type RecipientStatus = 'queued' | 'skipped' | 'sent' | 'failed' | 'replied';

export interface Audience {
  tags?: string[];
  sources?: string[];
  stages?: string[];
  intents?: string[];
  emirate?: string;
  communities?: string[];
}

export interface Campaign {
  id: string;
  name: string;
  templateName: string;
  languageCode: string;
  bodyParams: string[];
  audience: Audience;
  status: CampaignStatus;
  dailyLimit: number;
  submittedAt: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  account: { id: string; displayPhoneNumber: string; status: string };
  counts: Record<RecipientStatus, number>;
  sentLast24h?: number;
}

export interface Recipient {
  id: string;
  status: RecipientStatus;
  skipReason: string | null;
  errorCode: number | null;
  sentAt: string | null;
  repliedAt: string | null;
  contact: { id: string; fullName: string; phoneE164: string | null };
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for approval',
  approved: 'Approved',
  sending: 'Sending',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  queued: 'Queued',
  skipped: 'Skipped',
  sent: 'Sent',
  failed: 'Failed',
  replied: 'Replied',
};

export const SKIP_LABEL: Record<string, string> = {
  no_phone: 'No mobile number',
  do_not_contact: 'Do not contact',
  no_marketing_consent: 'No WhatsApp marketing consent',
};

/** Comma or semicolon separated text → trimmed list. */
export const splitList = (v: string) =>
  v
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

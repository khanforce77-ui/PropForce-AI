export type ReminderChannel = 'email' | 'sms' | 'ai_call';
export type ReminderStage = 'before' | 'due' | 'overdue';
export type InstallmentStatus = 'pending' | 'paid' | 'waived';
export type PlanStatus = 'active' | 'completed' | 'cancelled';
export type ConsentState = 'granted' | 'withdrawn' | 'unknown';

export const CHANNEL_LABEL: Record<ReminderChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  ai_call: 'AI call',
};
export const STAGE_LABEL: Record<ReminderStage, string> = {
  before: 'Before the due date',
  due: 'On the due date',
  overdue: 'Overdue',
};

export interface NextDue {
  label: string;
  dueDate: string;
  amount: number;
}

export interface PlanSummary {
  id: string;
  projectName: string;
  unitRef: string | null;
  totalPrice: number;
  status: PlanStatus;
  remindersPaused: boolean;
  createdAt: string;
  contact: { id: string; fullName: string; phoneE164: string | null; email: string | null };
  installmentCount: number;
  scheduledTotal: number;
  paidTotal: number;
  outstanding: number;
  overdueCount: number;
  nextDue: NextDue | null;
}

export interface Installment {
  id: string;
  seq: number;
  label: string;
  dueDate: string;
  amount: number;
  status: InstallmentStatus;
  paidAt: string | null;
  paidNote: string | null;
  overdue: boolean;
}

export interface PlanDetail extends Omit<PlanSummary, 'contact' | 'installmentCount'> {
  notes: string | null;
  contact: PlanSummary['contact'] & {
    doNotContact: boolean;
    reminderConsent: Record<ReminderChannel, ConsentState>;
  };
  installments: Installment[];
}

export interface ReminderRule {
  id: string;
  offsetDays: number;
  channels: ReminderChannel[];
  active: boolean;
}

export interface ReminderConfig {
  rules: ReminderRule[];
  replyToEmail: string | null;
  contactPhone: string | null;
  paymentInstructions: string | null;
  channels: Record<ReminderChannel, { ready: boolean; note: string | null }>;
}

export interface ReminderTemplate {
  channel: ReminderChannel;
  stage: ReminderStage;
  subject: string;
  body: string;
  edited: boolean;
  default: { subject: string; body: string };
}

export interface TemplateList {
  placeholders: Record<string, string>;
  smsMaxLength: number;
  data: ReminderTemplate[];
}

export type DispatchStatus =
  'sending' | 'sent' | 'skipped_no_consent' | 'skipped_no_address' | 'provider_pending' | 'failed';

export const DISPATCH_LABEL: Record<DispatchStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  skipped_no_consent: 'Not sent: no consent',
  skipped_no_address: 'Not sent: no email/phone',
  provider_pending: 'Not sent: channel not connected',
  failed: 'Failed',
};

export interface Dispatch {
  id: string;
  channel: ReminderChannel;
  status: DispatchStatus;
  offsetDays: number;
  recipient: string | null;
  detail: string | null;
  createdAt: string;
  installment: {
    id: string;
    label: string;
    dueDate: string;
    plan: {
      id: string;
      projectName: string;
      unitRef: string | null;
      contact: { id: string; fullName: string };
    };
  };
}

export interface RunSummary {
  considered: number;
  sent: number;
  skippedNoConsent: number;
  skippedNoAddress: number;
  providerPending: number;
  failed: number;
  deferredCalls: number;
}

const aed = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 2 });
export const aedText = (n: number) => `AED ${aed.format(n)}`;

export const dateText = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function describeOffset(offsetDays: number): string {
  if (offsetDays === 0) return 'On the due date';
  const n = Math.abs(offsetDays);
  const d = n === 1 ? 'day' : 'days';
  return offsetDays < 0 ? `${n} ${d} before` : `${n} ${d} overdue`;
}

/** Adds months to a YYYY-MM-DD date, clamping to the month's last day. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export interface DraftInstallment {
  label: string;
  dueDate: string;
  amount: string;
}

/**
 * Splits a price into a down payment plus equal installments every `everyMonths` months.
 * The last installment absorbs rounding so the total matches.
 */
export function generateSchedule(input: {
  total: number;
  downPercent: number;
  count: number;
  everyMonths: number;
  firstDate: string;
}): DraftInstallment[] {
  const { total, downPercent, count, everyMonths, firstDate } = input;
  const out: DraftInstallment[] = [];
  const down = Math.round(total * downPercent) / 100;
  if (down > 0) out.push({ label: 'Down payment', dueDate: firstDate, amount: down.toFixed(2) });
  const rest = Math.round((total - down) * 100) / 100;
  if (count > 0 && rest > 0) {
    const each = Math.floor((rest / count) * 100) / 100;
    for (let i = 0; i < count; i++) {
      const amount = i === count - 1 ? rest - each * (count - 1) : each;
      out.push({
        label: `Installment ${i + 1}`,
        dueDate: addMonths(firstDate, everyMonths * (down > 0 ? i + 1 : i)),
        amount: amount.toFixed(2),
      });
    }
  }
  return out;
}

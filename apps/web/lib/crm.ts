export type ContactSource =
  'manual' | 'import' | 'whatsapp' | 'portal' | 'referral' | 'website' | 'walk_in' | 'other';
export type ConsentChannel = 'whatsapp' | 'sms' | 'email' | 'phone_call';
export type ConsentPurpose = 'service' | 'marketing';
export type LeadIntent = 'buy' | 'rent' | 'sell' | 'let';
export type LeadStage =
  'new' | 'contacted' | 'qualified' | 'viewing' | 'negotiating' | 'won' | 'lost';

interface MemberRef {
  id: string;
  user: { fullName: string };
}

export interface ContactSummary {
  id: string;
  fullName: string;
  phoneE164: string | null;
  email: string | null;
  source: ContactSource;
  tags: string[];
  doNotContact: boolean;
  createdAt: string;
  owner: MemberRef | null;
  _count: { leads: number };
}

export interface ConsentRecord {
  id: string;
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  status: 'granted' | 'withdrawn';
  method: string;
  evidence: string | null;
  createdAt: string;
}

export interface ConsentState {
  channel: ConsentChannel;
  purpose: ConsentPurpose;
  status: 'granted' | 'withdrawn' | 'unknown';
  method: string | null;
  at: string | null;
}

export interface LeadSummary {
  id: string;
  intent: LeadIntent;
  stage: LeadStage;
  source: ContactSource;
  emirate: string | null;
  communities: string[];
  propertyTypes: string[];
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  budgetMin: string | null;
  budgetMax: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  contact: { id: string; fullName: string; phoneE164: string | null; email: string | null };
  assigned: MemberRef | null;
  property: { id: string; reference: string; title: string | null } | null;
}

export interface ContactDetail extends Omit<ContactSummary, '_count'> {
  nationality: string | null;
  preferredLanguage: string | null;
  notes: string | null;
  ownerMembershipId: string | null;
  consents: ConsentRecord[];
  consentState: ConsentState[];
  leads: LeadSummary[];
}

export interface LeadActivity {
  id: string;
  type: 'note' | 'stage_changed' | 'assigned' | 'created';
  body: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface LeadDetail extends LeadSummary {
  lostReason: string | null;
  closedAt: string | null;
  activities: LeadActivity[];
}

export interface Page<T> {
  data: T[];
  total: number;
  nextCursor: string | null;
}

export interface CrmSummary {
  open: number;
  stages: Partial<Record<LeadStage, number>>;
  followUpsDue: number;
  newThisWeek: number;
  contacts: number;
}

export const STAGES: LeadStage[] = [
  'new',
  'contacted',
  'qualified',
  'viewing',
  'negotiating',
  'won',
  'lost',
];
export const OPEN_STAGES: LeadStage[] = STAGES.filter((s) => s !== 'won' && s !== 'lost');

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  viewing: 'Viewing',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
};

export const STAGE_TONE: Record<LeadStage, string> = {
  new: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  contacted: 'bg-muted text-foreground',
  qualified: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  viewing: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  negotiating: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  won: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  lost: 'bg-muted text-muted-foreground',
};

export const INTENT_LABEL: Record<LeadIntent, string> = {
  buy: 'Wants to buy',
  rent: 'Wants to rent',
  sell: 'Selling',
  let: 'Letting out',
};

export const SOURCES: ContactSource[] = [
  'manual',
  'referral',
  'walk_in',
  'website',
  'portal',
  'whatsapp',
  'import',
  'other',
];

export const CHANNEL_LABEL: Record<ConsentChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  phone_call: 'Phone calls',
};
export const PURPOSE_LABEL: Record<ConsentPurpose, string> = {
  service: 'Replies & updates',
  marketing: 'Marketing',
};

const aed = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });
export function budgetLabel(l: {
  budgetMin: string | number | null;
  budgetMax: string | number | null;
}): string {
  const min = l.budgetMin != null ? Number(l.budgetMin) : null;
  const max = l.budgetMax != null ? Number(l.budgetMax) : null;
  if (min == null && max == null) return 'Budget not set';
  if (min != null && max != null) return `AED ${aed.format(min)} – ${aed.format(max)}`;
  return min != null ? `From AED ${aed.format(min)}` : `Up to AED ${aed.format(max!)}`;
}

export function bedsLabel(l: Pick<LeadSummary, 'bedroomsMin' | 'bedroomsMax'>): string | null {
  const f = (n: number) => (n === 0 ? 'Studio' : `${n}`);
  const { bedroomsMin: a, bedroomsMax: b } = l;
  if (a == null && b == null) return null;
  if (a != null && b != null) return a === b ? `${f(a)} bed` : `${f(a)}–${f(b)} beds`;
  return a != null ? `${f(a)}+ beds` : `Up to ${f(b!)} beds`;
}

export const canManageCrm = (role: string | undefined) =>
  role === 'owner' || role === 'admin' || role === 'manager';

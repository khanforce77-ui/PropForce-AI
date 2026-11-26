export interface BillingPlan {
  code: string;
  name: string;
  priceMonthlyAed: number | null;
  seatLimit: number | null;
  listingLimit: number | null;
  aiRepliesMonthly: number | null;
  whatsappNumbers: number | null;
  storageGb: number | null;
  leadBooster: boolean;
  voice: 'none' | 'inbound' | 'inbound_outbound';
  active: boolean;
  sortOrder: number;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type Meter = 'ai_replies' | 'whatsapp_messages';

export interface BillingOverview {
  subscription: {
    planCode: string;
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    managedBy: string | null;
  };
  plan: BillingPlan | null;
  plans: BillingPlan[];
  periodStart: string;
  usage: {
    seats: { used: number; limit: number | null };
    listings: { used: number; limit: number | null };
    whatsappNumbers: { used: number; limit: number | null };
    aiReplies: { used: number; included: number | null };
    whatsappMessages: { used: number };
  };
  caps: {
    meter: Meter;
    monthlyLimit: number;
    action: 'warn' | 'block';
    used: number;
    reached: boolean;
  }[];
  provider: { configured: boolean; name: string | null };
}

export interface PlatformBilling {
  plans: BillingPlan[];
  metrics: {
    agencies: number;
    withoutSubscription: number;
    byStatus: Record<SubscriptionStatus, number>;
    mrrAed: number;
    activeUnpriced: number;
  };
  subscriptions: {
    tenantId: string;
    agencyName: string;
    planCode: string;
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    managedBy: string;
  }[];
  provider: { configured: boolean; name: string | null };
}

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  cancelled: 'Cancelled',
};

export const VOICE_LABEL: Record<BillingPlan['voice'], string> = {
  none: '–',
  inbound: 'Inbound',
  inbound_outbound: 'Inbound + outbound',
};

export const limitText = (n: number | null) =>
  n == null ? 'Unlimited' : n.toLocaleString('en-AE');
export const priceText = (n: number | null) =>
  n == null ? 'Price on request' : `AED ${n.toLocaleString('en-AE')} / month`;
export const dateText = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString('en-AE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Dubai',
      })
    : '–';

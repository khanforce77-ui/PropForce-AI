export interface RevenueMonth {
  month: string;
  completedDeals: number;
  earned: number;
  invoiced: number;
  received: number;
}

export interface RevenueReport {
  months: number;
  series: RevenueMonth[];
  totals: {
    completedDeals: number;
    earned: number;
    received: number;
    agencyShare: number;
    coBrokers: number;
  };
  outstanding: { notInvoiced: number; invoicedUnpaid: number };
  pipeline: Record<'sale' | 'rental', { deals: number; commission: number }>;
  team: { membershipId: string; name: string; amount: number }[];
}

export interface PlatformUsageRow {
  tenantId: string;
  name: string;
  agencyStatus: string;
  planCode: string;
  subscriptionStatus: string;
  mrrAed: number | null;
  aiReplies: number;
  aiTokens: number;
  whatsappOutbound: number;
  voiceCalls: number;
  voiceMinutes: number;
  voiceCostUsd: number;
}

export interface PlatformUsage {
  since: string;
  agencies: PlatformUsageRow[];
  totals: {
    mrrAed: number;
    aiTokens: number;
    aiReplies: number;
    whatsappOutbound: number;
    voiceCalls: number;
    voiceCostUsd: number;
  };
}

export const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 0 })}`;

/** "2026-11" -> "Nov 2026" */
export const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

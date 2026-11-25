import type { DealType } from '@propforce/db';

/**
 * Deal pipelines for UAE transactions. The order matters: the board shows stages left to right.
 * `completed` and `fallen_through` close the deal.
 */
export const SALE_STAGES = [
  'offer_made',
  'offer_accepted',
  'mou_signed',
  'deposit_paid',
  'mortgage_approval',
  'noc_issued',
  'transfer_booked',
  'completed',
  'fallen_through',
] as const;

export const RENTAL_STAGES = [
  'offer_made',
  'offer_accepted',
  'contract_signed',
  'deposit_paid',
  'ejari_registered',
  'keys_handed_over',
  'completed',
  'fallen_through',
] as const;

export const CLOSED_STAGES = ['completed', 'fallen_through'] as const;

export const stagesFor = (type: DealType): readonly string[] =>
  type === 'sale' ? SALE_STAGES : RENTAL_STAGES;

/** Starting checklist per type; agencies can add, tick and remove items. */
export const DEFAULT_TASKS: Record<DealType, string[]> = {
  sale: [
    'Form F (MOU) signed by buyer and seller',
    '10% deposit cheque received',
    'Mortgage pre-approval / final offer letter',
    'Developer NOC issued',
    'Transfer appointment booked at DLD trustee office',
    'Title deed issued to buyer',
    'Commission invoice sent',
  ],
  rental: [
    'Tenancy contract signed',
    'Security deposit received',
    'Rent cheques collected',
    'Ejari registered',
    'Keys handed over',
    'Commission invoice sent',
  ],
};

export interface CommissionInput {
  price: number;
  commissionPercent: number | null;
  commissionAmount: number | null;
  vatPercent: number;
  splits: { percent: number; membershipId: string | null; partyName: string | null }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Gross commission (fixed amount wins over a percentage), VAT on top, and each split's share of
 * the gross. Whatever the splits do not cover is the agency's share.
 */
export function commissionBreakdown(i: CommissionInput) {
  const gross =
    i.commissionAmount != null
      ? i.commissionAmount
      : i.commissionPercent != null
        ? (i.price * i.commissionPercent) / 100
        : 0;
  const vat = (gross * i.vatPercent) / 100;
  const splits = i.splits.map((s) => ({ ...s, amount: round2((gross * s.percent) / 100) }));
  const splitPercent = i.splits.reduce((a, s) => a + s.percent, 0);
  return {
    gross: round2(gross),
    vat: round2(vat),
    total: round2(gross + vat),
    splits,
    agencyPercent: round2(Math.max(0, 100 - splitPercent)),
    agencyAmount: round2((gross * Math.max(0, 100 - splitPercent)) / 100),
  };
}

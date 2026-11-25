export type DealType = 'sale' | 'rental';
export type CommissionStatus = 'pending' | 'invoiced' | 'received';

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
];
export const RENTAL_STAGES = [
  'offer_made',
  'offer_accepted',
  'contract_signed',
  'deposit_paid',
  'ejari_registered',
  'keys_handed_over',
  'completed',
  'fallen_through',
];
export const stagesFor = (t: DealType) => (t === 'sale' ? SALE_STAGES : RENTAL_STAGES);

export const DEAL_STAGE_LABEL: Record<string, string> = {
  offer_made: 'Offer made',
  offer_accepted: 'Offer accepted',
  mou_signed: 'MOU (Form F) signed',
  deposit_paid: 'Deposit paid',
  mortgage_approval: 'Mortgage approval',
  noc_issued: 'NOC issued',
  transfer_booked: 'Transfer booked',
  contract_signed: 'Contract signed',
  ejari_registered: 'Ejari registered',
  keys_handed_over: 'Keys handed over',
  completed: 'Completed',
  fallen_through: 'Fell through',
};

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: 'Not invoiced',
  invoiced: 'Invoiced',
  received: 'Paid',
};

export interface Deal {
  id: string;
  reference: string;
  type: DealType;
  stage: string;
  price: number;
  commissionPercent: number | null;
  commissionAmount: number | null;
  vatPercent: number;
  commissionStatus: CommissionStatus;
  invoiceNumber: string | null;
  invoicedAt: string | null;
  commissionReceivedAt: string | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lead: { id: string; stage: string } | null;
  contact: { id: string; fullName: string; phoneE164: string | null };
  property: {
    id: string;
    reference: string;
    title: string | null;
    community: string | null;
    status: string;
  } | null;
  agent: { id: string; user: { fullName: string } };
  splits: {
    id: string;
    membershipId: string | null;
    partyName: string | null;
    name: string;
    percent: number;
  }[];
  commission: {
    gross: number;
    vat: number;
    total: number;
    splits: {
      membershipId: string | null;
      partyName: string | null;
      percent: number;
      amount: number;
    }[];
    agencyPercent: number;
    agencyAmount: number;
  };
}

export interface DealTask {
  id: string;
  title: string;
  dueDate: string | null;
  doneAt: string | null;
  position: number;
}

export interface DealDetail extends Deal {
  stages: string[];
  tasks: DealTask[];
  history: { id: string; action: string; before: unknown; after: unknown; createdAt: string }[];
}

const aed = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });
export const money = (n: number) => `AED ${aed.format(n)}`;
export const isClosedStage = (s: string) => s === 'completed' || s === 'fallen_through';

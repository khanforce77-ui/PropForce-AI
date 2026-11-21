/**
 * UAE cost calculator: pure maths over fee rules. Every result is an estimate; the rules carry
 * their own source and verification status, which are passed through to the output.
 */
export const calculators = [
  'ready_sale',
  'off_plan_sale',
  'mortgage',
  'rental',
  'commercial_rental',
] as const;
export type Calculator = (typeof calculators)[number];

export const VAT_PCT = 5;

export interface FeeRuleInput {
  code: string;
  label: string;
  calculators: string[];
  payer: string;
  basis: 'price' | 'loan' | 'annual_rent' | string;
  ratePct: number | null;
  amount: number | null;
  vat: boolean;
  refundable: boolean;
  source: string;
  status: string;
  verifiedAt: Date | null;
  isOverride: boolean;
}

export interface EstimateInput {
  calculator: Calculator;
  price?: number | undefined;
  annualRent?: number | undefined;
  downPaymentPct?: number | undefined;
  interestRatePct?: number | undefined;
  years?: number | undefined;
  national?: boolean | undefined;
  /** The broker's share of the agency commission, in percent. */
  brokerSplitPct?: number | undefined;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** UAE Central Bank minimum down payment for a first home (expat 20%/30%, national 15%/25%). */
export function minDownPaymentPct(price: number, national: boolean): number {
  if (national) return price > 5_000_000 ? 25 : 15;
  return price > 5_000_000 ? 30 : 20;
}

export function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  const n = Math.round(years * 12);
  if (principal <= 0 || n <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

export function estimate(input: EstimateInput, rules: FeeRuleInput[]) {
  const isRent = input.calculator === 'rental' || input.calculator === 'commercial_rental';
  const price = isRent ? 0 : (input.price ?? 0);
  const annualRent = isRent ? (input.annualRent ?? 0) : 0;

  let mortgage: null | {
    downPaymentPct: number;
    minDownPaymentPct: number;
    downPayment: number;
    loan: number;
    interestRatePct: number;
    years: number;
    monthlyPayment: number;
  } = null;
  let loan = 0;
  if (input.calculator === 'mortgage') {
    const minPct = minDownPaymentPct(price, input.national ?? false);
    const pct = Math.max(input.downPaymentPct ?? minPct, minPct);
    const rate = input.interestRatePct ?? 4.5;
    const years = Math.min(input.years ?? 25, 25);
    loan = round(price * (1 - pct / 100));
    mortgage = {
      downPaymentPct: pct,
      minDownPaymentPct: minPct,
      downPayment: round(price - loan),
      loan,
      interestRatePct: rate,
      years,
      monthlyPayment: round(monthlyPayment(loan, rate, years)),
    };
  }

  const baseFor = (basis: string) =>
    basis === 'loan' ? loan : basis === 'annual_rent' ? annualRent : price;

  const items = rules
    .filter((r) => r.calculators.includes(input.calculator))
    .map((r) => {
      const fee = round((baseFor(r.basis) * (r.ratePct ?? 0)) / 100 + (r.amount ?? 0));
      const vat = r.vat ? round((fee * VAT_PCT) / 100) : 0;
      return {
        code: r.code,
        label: r.label,
        payer: r.payer,
        fee,
        vat,
        total: round(fee + vat),
        refundable: r.refundable,
        rule: {
          ratePct: r.ratePct,
          amount: r.amount,
          basis: r.basis,
          source: r.source,
          status: r.status,
          verifiedAt: r.verifiedAt,
          isOverride: r.isOverride,
        },
      };
    });

  const sum = (xs: { total: number }[]) => round(xs.reduce((a, x) => a + x.total, 0));
  const fees = sum(items.filter((i) => !i.refundable));
  const refundable = sum(items.filter((i) => i.refundable));
  const commissionFee = round(
    items.filter((i) => i.code.startsWith('agency_commission')).reduce((a, i) => a + i.fee, 0),
  );
  const split = input.brokerSplitPct;

  return {
    label: 'Estimate' as const,
    calculator: input.calculator,
    price: isRent ? null : price,
    annualRent: isRent ? annualRent : null,
    items,
    totals: {
      fees,
      refundable,
      /** What the client needs on the day, besides the price or rent itself. */
      upfront: round(fees + refundable + (mortgage ? mortgage.downPayment : 0)),
    },
    mortgage,
    commission:
      commissionFee > 0
        ? {
            agency: commissionFee,
            ...(split !== undefined
              ? { brokerSplitPct: split, broker: round((commissionFee * split) / 100) }
              : {}),
          }
        : null,
    unverifiedCount: items.filter((i) => i.rule.status !== 'verified').length,
  };
}

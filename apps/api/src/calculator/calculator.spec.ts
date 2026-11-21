import { describe, expect, it } from 'vitest';
import { estimate, minDownPaymentPct, monthlyPayment, type FeeRuleInput } from './calculator';

const rule = (o: Partial<FeeRuleInput>): FeeRuleInput => ({
  code: 'x',
  label: 'X',
  calculators: ['ready_sale', 'mortgage'],
  payer: 'buyer',
  basis: 'price',
  ratePct: null,
  amount: null,
  vat: false,
  refundable: false,
  source: 'sample',
  status: 'unverified_sample',
  verifiedAt: null,
  isOverride: false,
  ...o,
});

const rules = [
  rule({ code: 'dld_transfer', ratePct: 4, amount: 580 }),
  rule({ code: 'agency_commission_sale', ratePct: 2, vat: true, status: 'verified' }),
  rule({
    code: 'mortgage_registration',
    basis: 'loan',
    ratePct: 0.25,
    amount: 290,
    calculators: ['mortgage'],
  }),
  rule({
    code: 'security_deposit',
    basis: 'annual_rent',
    ratePct: 5,
    refundable: true,
    calculators: ['rental'],
  }),
  rule({
    code: 'agency_commission_rent',
    basis: 'annual_rent',
    ratePct: 5,
    vat: true,
    calculators: ['rental'],
  }),
];

describe('cost calculator', () => {
  it('prices a ready sale with VAT and the broker split', () => {
    const r = estimate({ calculator: 'ready_sale', price: 2_000_000, brokerSplitPct: 50 }, rules);
    expect(r.label).toBe('Estimate');
    expect(r.items.map((i) => [i.code, i.total])).toEqual([
      ['dld_transfer', 80_580],
      ['agency_commission_sale', 42_000],
    ]);
    expect(r.totals).toEqual({ fees: 122_580, refundable: 0, upfront: 122_580 });
    expect(r.commission).toEqual({ agency: 40_000, brokerSplitPct: 50, broker: 20_000 });
    expect(r.unverifiedCount).toBe(1);
  });

  it('applies the minimum down payment and loan-based fees for a mortgage', () => {
    const r = estimate(
      {
        calculator: 'mortgage',
        price: 2_000_000,
        downPaymentPct: 10,
        interestRatePct: 4.5,
        years: 25,
      },
      rules,
    );
    expect(r.mortgage).toMatchObject({ downPaymentPct: 20, loan: 1_600_000, downPayment: 400_000 });
    expect(Math.round(r.mortgage!.monthlyPayment)).toBe(8893);
    expect(r.items.find((i) => i.code === 'mortgage_registration')?.total).toBe(4290);
    expect(r.totals.upfront).toBe(r.totals.fees + 400_000);
  });

  it('separates refundable deposits on a rental', () => {
    const r = estimate({ calculator: 'rental', annualRent: 100_000 }, rules);
    expect(r.totals).toEqual({ fees: 5250, refundable: 5000, upfront: 10_250 });
    expect(r.price).toBeNull();
  });

  it('knows the Central Bank limits and amortisation', () => {
    expect(minDownPaymentPct(6_000_000, false)).toBe(30);
    expect(minDownPaymentPct(1_000_000, true)).toBe(15);
    expect(monthlyPayment(1_200_000, 0, 10)).toBe(10_000);
  });
});

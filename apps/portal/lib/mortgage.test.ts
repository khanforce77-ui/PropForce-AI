import { describe, expect, it } from 'vitest';
import { minDownPaymentPct, monthlyPayment, upfrontCosts } from './mortgage';

describe('mortgage', () => {
  it('computes an amortising monthly payment', () => {
    // AED 1.6M over 25 years at 4.5%: about AED 8,893 a month.
    expect(Math.round(monthlyPayment(1_600_000, 4.5, 25))).toBe(8893);
    expect(monthlyPayment(1_200_000, 0, 10)).toBe(10_000);
    expect(monthlyPayment(0, 4, 25)).toBe(0);
  });

  it('applies the Central Bank minimum down payment', () => {
    expect(minDownPaymentPct(2_000_000, false)).toBe(20);
    expect(minDownPaymentPct(6_000_000, false)).toBe(30);
    expect(minDownPaymentPct(2_000_000, true)).toBe(15);
    expect(minDownPaymentPct(6_000_000, true)).toBe(25);
  });

  it('estimates the one-off costs', () => {
    const c = upfrontCosts(2_000_000, 1_600_000);
    expect(c.dldTransfer).toBe(80_580);
    expect(c.mortgageRegistration).toBe(4_290);
    expect(c.agencyFee).toBeCloseTo(42_000);
    expect(Math.round(c.total)).toBe(130_020);
  });
});

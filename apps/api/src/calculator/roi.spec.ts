import { describe, expect, it } from 'vitest';
import { monthlyPayment } from './calculator';
import { affordability, balanceAfter, roi } from './roi';

const base = {
  price: 1_000_000,
  annualRent: 80_000,
  buyingCosts: 60_000,
  serviceChargeYearly: 15_000,
  vacancyPct: 5,
  managementPct: 0,
  maintenanceYearly: 1_000,
  appreciationPct: 0,
  rentGrowthPct: 0,
  years: 10,
};

describe('roi', () => {
  it('computes gross, net and cash-on-cash for a cash purchase', () => {
    const r = roi(base);
    // Costs: vacancy 4,000 + service 15,000 + maintenance 1,000 = 20,000; NOI 60,000.
    expect(r.yearlyCosts.total).toBe(20_000);
    expect(r.yields.grossPct).toBe(8);
    expect(r.yields.netPct).toBe(5.66); // 60,000 / 1,060,000
    expect(r.yields.cashOnCashPct).toBe(5.66);
    expect(r.cashInvested).toBe(1_060_000);
    expect(r.summary!.paybackYear).toBeNull();
    // Equity 1,000,000 + 600,000 cash − 1,060,000 invested.
    expect(r.projection.at(-1)!.totalReturn).toBe(540_000);
    expect(r.summary!.totalReturn).toBe(540_000);
  });

  it('uses the minimum down payment, mortgage payments and the loan balance', () => {
    const r = roi({
      ...base,
      mortgage: { downPaymentPct: 10, interestRatePct: 4.5, years: 25 },
    });
    expect(r.mortgage).toMatchObject({ downPaymentPct: 20, minDownPaymentPct: 20, loan: 800_000 });
    const pay = monthlyPayment(800_000, 4.5, 25);
    expect(r.mortgage!.monthlyPayment).toBeCloseTo(pay, 2);
    expect(r.cashInvested).toBe(260_000);
    expect(r.firstYear.cashFlow).toBeCloseTo(60_000 - pay * 12, 1);
    expect(r.projection[0]!.loanBalance).toBeCloseTo(balanceAfter(800_000, 4.5, 25, 12), 1);
    expect(balanceAfter(800_000, 4.5, 25, 300)).toBeCloseTo(0, 2);
  });

  it('finds the payback year when cash flow covers the cash put in', () => {
    const r = roi({
      ...base,
      price: 500_000,
      buyingCosts: 0,
      serviceChargeYearly: 0,
      maintenanceYearly: 0,
      vacancyPct: 0,
      annualRent: 100_000,
    });
    expect(r.summary!.paybackYear).toBe(5);
  });
});

describe('affordability', () => {
  it('caps the payment at half of income minus debts', () => {
    const a = affordability({
      monthlyIncome: 40_000,
      monthlyDebts: 5_000,
      interestRatePct: 4.5,
      years: 25,
      national: false,
    });
    expect(a.maxMonthlyPayment).toBe(15_000);
    expect(monthlyPayment(a.maxLoan, 4.5, 25)).toBeCloseTo(15_000, 0);
    expect(a.maxPrice).toBeCloseTo(a.maxLoan / 0.8, 0);
  });
  it('uses the stress rate when higher', () => {
    const a = affordability({
      monthlyIncome: 40_000,
      monthlyDebts: 0,
      interestRatePct: 4,
      stressRatePct: 7,
      years: 25,
      national: true,
    });
    expect(a.rateUsedPct).toBe(7);
  });
});

import { minDownPaymentPct, monthlyPayment } from './calculator';

/**
 * Investment return for a buy-to-let in Dubai. Pure maths; every figure is an estimate from the
 * inputs the agent enters (rent, service charge, vacancy…) plus the buying costs from the agency's
 * fee rules (passed in as `buyingCosts`).
 */
export interface RoiInput {
  price: number;
  annualRent: number;
  /** One-off buying costs (DLD fee, agency fee, trustee…), from the cost estimate. */
  buyingCosts: number;
  /** AED per sq ft per year × area, or a yearly amount if `areaSqft` is not given. */
  serviceChargePerSqft?: number | undefined;
  areaSqft?: number | undefined;
  serviceChargeYearly?: number | undefined;
  /** Percent of rent lost to empty months. */
  vacancyPct: number;
  /** Property management fee, percent of rent collected. */
  managementPct: number;
  /** Maintenance and other yearly costs, AED. */
  maintenanceYearly: number;
  /** Yearly change in property value, percent. */
  appreciationPct: number;
  /** Yearly change in rent, percent. */
  rentGrowthPct: number;
  years: number;
  mortgage?:
    | {
        downPaymentPct?: number | undefined;
        interestRatePct: number;
        years: number;
        national?: boolean | undefined;
      }
    | undefined;
}

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => Math.round(n * 100) / 100;

/** Outstanding loan after `months` payments. */
export function balanceAfter(
  principal: number,
  annualRatePct: number,
  years: number,
  months: number,
) {
  const r = annualRatePct / 100 / 12;
  const n = Math.round(years * 12);
  const m = Math.min(months, n);
  if (principal <= 0) return 0;
  if (r === 0) return Math.max(0, principal - (principal / n) * m);
  const pay = monthlyPayment(principal, annualRatePct, years);
  return Math.max(0, principal * (1 + r) ** m - (pay * ((1 + r) ** m - 1)) / r);
}

export function roi(i: RoiInput) {
  const serviceCharge =
    i.serviceChargeYearly ??
    (i.serviceChargePerSqft != null && i.areaSqft != null
      ? i.serviceChargePerSqft * i.areaSqft
      : 0);

  let loan = 0;
  let downPayment = i.price;
  let monthly = 0;
  let mortgage: null | {
    downPaymentPct: number;
    minDownPaymentPct: number;
    loan: number;
    monthlyPayment: number;
    yearlyPayment: number;
    totalInterest: number;
  } = null;
  if (i.mortgage) {
    const minPct = minDownPaymentPct(i.price, i.mortgage.national ?? false);
    const dpPct = Math.max(i.mortgage.downPaymentPct ?? minPct, minPct);
    loan = round(i.price * (1 - dpPct / 100));
    downPayment = round(i.price - loan);
    monthly = monthlyPayment(loan, i.mortgage.interestRatePct, i.mortgage.years);
    mortgage = {
      downPaymentPct: dpPct,
      minDownPaymentPct: minPct,
      loan,
      monthlyPayment: round(monthly),
      yearlyPayment: round(monthly * 12),
      totalInterest: round(monthly * Math.round(i.mortgage.years * 12) - loan),
    };
  }

  const cashInvested = round(downPayment + i.buyingCosts);
  const operating = (rent: number) =>
    (rent * i.vacancyPct) / 100 +
    (rent * (1 - i.vacancyPct / 100) * i.managementPct) / 100 +
    serviceCharge +
    i.maintenanceYearly;

  const rent1 = i.annualRent;
  const costs1 = operating(rent1);
  const noi1 = rent1 - costs1;
  const debt1 = mortgage ? monthly * Math.min(12, Math.round(i.mortgage!.years * 12)) : 0;
  const cashFlow1 = noi1 - debt1;

  const projection = [];
  let cumulativeCash = 0;
  let paybackYear: number | null = null;
  for (let y = 1; y <= i.years; y += 1) {
    const rent = rent1 * (1 + i.rentGrowthPct / 100) ** (y - 1);
    const noi = rent - operating(rent);
    const paidMonths = mortgage
      ? Math.min(12, Math.max(0, Math.round(i.mortgage!.years * 12) - (y - 1) * 12))
      : 0;
    const cashFlow = noi - monthly * paidMonths;
    cumulativeCash += cashFlow;
    const value = i.price * (1 + i.appreciationPct / 100) ** y;
    const balance = mortgage
      ? balanceAfter(loan, i.mortgage!.interestRatePct, i.mortgage!.years, y * 12)
      : 0;
    const equity = value - balance;
    if (paybackYear === null && cumulativeCash >= cashInvested) paybackYear = y;
    projection.push({
      year: y,
      rent: round(rent),
      netIncome: round(noi),
      cashFlow: round(cashFlow),
      propertyValue: round(value),
      loanBalance: round(balance),
      equity: round(equity),
      /** Equity plus all cash received, minus the cash put in. */
      totalReturn: round(equity + cumulativeCash - cashInvested),
    });
  }
  const last = projection.at(-1);

  return {
    label: 'Estimate' as const,
    price: i.price,
    annualRent: rent1,
    cashInvested,
    buyingCosts: round(i.buyingCosts),
    yearlyCosts: {
      serviceCharge: round(serviceCharge),
      vacancy: round((rent1 * i.vacancyPct) / 100),
      management: round((rent1 * (1 - i.vacancyPct / 100) * i.managementPct) / 100),
      maintenance: round(i.maintenanceYearly),
      total: round(costs1),
    },
    mortgage,
    yields: {
      /** Rent ÷ price. */
      grossPct: pct((rent1 / i.price) * 100),
      /** Rent after running costs ÷ (price + buying costs). */
      netPct: pct((noi1 / (i.price + i.buyingCosts)) * 100),
      /** First-year cash flow after mortgage payments ÷ cash put in. */
      cashOnCashPct: pct((cashFlow1 / cashInvested) * 100),
    },
    firstYear: {
      netIncome: round(noi1),
      mortgagePayments: round(debt1),
      cashFlow: round(cashFlow1),
      monthlyCashFlow: round(cashFlow1 / 12),
    },
    projection,
    summary: last
      ? {
          years: i.years,
          totalReturn: last.totalReturn,
          totalReturnPct: pct((last.totalReturn / cashInvested) * 100),
          annualisedPct: pct(
            ((Math.max(0, cashInvested + last.totalReturn) / cashInvested) ** (1 / i.years) - 1) *
              100,
          ),
          paybackYear,
        }
      : null,
  };
}

/**
 * How much a buyer can borrow: UAE Central Bank caps total monthly debt at 50% of income
 * (debt burden ratio), and the loan at 80%/70% (expat) or 85%/75% (national) of the price.
 */
export function affordability(i: {
  monthlyIncome: number;
  monthlyDebts: number;
  interestRatePct: number;
  years: number;
  national: boolean;
  /** Stress rate banks may use instead of the offered rate. */
  stressRatePct?: number | undefined;
}) {
  const maxPayment = Math.max(0, i.monthlyIncome * 0.5 - i.monthlyDebts);
  const rate = Math.max(i.interestRatePct, i.stressRatePct ?? 0);
  const unit = monthlyPayment(1_000_000, rate, i.years) / 1_000_000;
  const maxLoan = unit > 0 ? maxPayment / unit : 0;
  // Price at which the loan is the maximum allowed share of value (≤ 5M band first).
  const lowLtv = 1 - minDownPaymentPct(1, i.national) / 100;
  let maxPrice = maxLoan / lowLtv;
  if (maxPrice > 5_000_000) {
    const highLtv = 1 - minDownPaymentPct(5_000_001, i.national) / 100;
    maxPrice = Math.max(5_000_000, maxLoan / highLtv);
  }
  return {
    label: 'Estimate' as const,
    debtBurdenLimitPct: 50,
    maxMonthlyPayment: round(maxPayment),
    rateUsedPct: rate,
    maxLoan: round(maxLoan),
    maxPrice: round(maxPrice),
    downPaymentNeeded: round(maxPrice - Math.min(maxLoan, maxPrice)),
  };
}

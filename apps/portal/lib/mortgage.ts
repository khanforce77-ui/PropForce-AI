/** Monthly repayment of an amortising loan. */
export function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  const n = Math.round(years * 12);
  if (principal <= 0 || n <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

/**
 * UAE Central Bank minimum down payment for a first home, as a share of the price: 20% for
 * expatriates (30% above AED 5M), 15% for UAE nationals (25% above AED 5M).
 */
export function minDownPaymentPct(price: number, national: boolean): number {
  if (national) return price > 5_000_000 ? 25 : 15;
  return price > 5_000_000 ? 30 : 20;
}

/** Typical one-off costs of buying with a mortgage in Dubai. Estimates only. */
export function upfrontCosts(price: number, loan: number) {
  const dldTransfer = price * 0.04 + 580;
  const mortgageRegistration = loan > 0 ? loan * 0.0025 + 290 : 0;
  const agencyFee = price * 0.02 * 1.05; // 2% + 5% VAT
  const valuation = loan > 0 ? 3_150 : 0;
  return {
    dldTransfer,
    mortgageRegistration,
    agencyFee,
    valuation,
    total: dldTransfer + mortgageRegistration + agencyFee + valuation,
  };
}

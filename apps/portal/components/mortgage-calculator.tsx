'use client';

import { useState } from 'react';
import { minDownPaymentPct, monthlyPayment, upfrontCosts } from '@/lib/mortgage';

const aed = (n: number) =>
  `AED ${new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.max(0, n))}`;

/** Mortgage estimate for UAE buyers. Figures are estimates; banks decide the final terms. */
export function MortgageCalculator({ initialPrice = 2_000_000 }: { initialPrice?: number }) {
  const [price, setPrice] = useState(initialPrice);
  const [downPct, setDownPct] = useState(20);
  const [rate, setRate] = useState(4.5);
  const [years, setYears] = useState(25);
  const [national, setNational] = useState(false);

  const minPct = minDownPaymentPct(price, national);
  // Below the legal minimum, banks lend less: the estimate uses the minimum.
  const pct = Math.max(downPct, minPct);
  const down = (price * pct) / 100;
  const loan = Math.max(0, price - down);
  const monthly = monthlyPayment(loan, rate, years);
  const costs = upfrontCosts(price, loan);
  const input =
    'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-2 focus:outline-primary';
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Number(v) || 0));

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="font-medium">Property price (AED)</span>
          <input
            type="number"
            min={0}
            step={10_000}
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(num(e.target.value, 0, 1_000_000_000))}
            className={input}
          />
        </label>
        <label className="space-y-1">
          <span className="font-medium">
            Down payment: {pct}% ({aed(down)})
          </span>
          <input
            type="range"
            min={minPct}
            max={90}
            value={pct}
            onChange={(e) => setDownPct(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </label>
        <label className="space-y-1">
          <span className="font-medium">Interest rate (% a year)</span>
          <input
            type="number"
            min={0}
            max={20}
            step={0.05}
            value={rate}
            onChange={(e) => setRate(num(e.target.value, 0, 20))}
            className={input}
          />
        </label>
        <label className="space-y-1">
          <span className="font-medium">Loan length: {years} years</span>
          <input
            type="range"
            min={5}
            max={25}
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={national} onChange={(e) => setNational(e.target.checked)} />
        I am a UAE national
      </label>
      <p className="text-xs text-muted-foreground">
        UAE banks need at least {minPct}% down at this price for a first home.
      </p>
      <div className="rounded-xl bg-accent p-4">
        <p className="text-muted-foreground">Estimated monthly payment</p>
        <p className="text-2xl font-bold">{aed(monthly)}</p>
        <p className="mt-1 text-muted-foreground">
          Loan {aed(loan)} over {years} years at {rate}%
        </p>
      </div>
      <details>
        <summary className="cursor-pointer font-medium">
          One-off costs, about {aed(costs.total)}
        </summary>
        <dl className="mt-2 space-y-1">
          {(
            [
              ['DLD transfer fee (4% + AED 580)', costs.dldTransfer],
              ['Mortgage registration (0.25% + AED 290)', costs.mortgageRegistration],
              ['Agency fee (2% + VAT)', costs.agencyFee],
              ['Bank valuation', costs.valuation],
            ] as [string, number][]
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-border py-1">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{aed(v)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="text-xs text-muted-foreground">
        Estimates only, based on Dubai fees and UAE Central Bank limits for a first home. Your bank
        confirms the rate, fees and amount you can borrow.
      </p>
    </div>
  );
}

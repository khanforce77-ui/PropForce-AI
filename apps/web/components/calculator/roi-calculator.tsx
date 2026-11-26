'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const aed = (n: number) =>
  `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

interface RoiResult {
  label: 'Estimate';
  cashInvested: number;
  buyingCosts: number;
  buyingCostItems: { label: string; total: number; status: string }[];
  unverifiedCount: number;
  yearlyCosts: { serviceCharge: number; vacancy: number; management: number; total: number };
  mortgage: { loan: number; monthlyPayment: number } | null;
  yields: { grossPct: number; netPct: number; cashOnCashPct: number };
  firstYear: {
    netIncome: number;
    mortgagePayments: number;
    cashFlow: number;
    monthlyCashFlow: number;
  };
  projection: {
    year: number;
    propertyValue: number;
    rent: number;
    cashFlow: number;
    equity: number;
    totalReturn: number;
  }[];
  summary: {
    years: number;
    totalReturn: number;
    totalReturnPct: number;
    annualisedPct: number;
    paybackYear: number | null;
  } | null;
}

interface AffordResult {
  maxMonthlyPayment: number;
  rateUsedPct: number;
  maxLoan: number;
  maxPrice: number;
  downPaymentNeeded: number;
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function RoiCalculator({ agencyId, emirate }: { agencyId: string; emirate: string }) {
  const { request } = useAuth();
  const [f, setF] = useState({
    price: '',
    annualRent: '',
    serviceChargeYearly: '',
    vacancyPct: '5',
    managementPct: '0',
    appreciationPct: '3',
    rentGrowthPct: '2',
    years: '10',
    financing: 'cash' as 'cash' | 'mortgage',
    downPaymentPct: '',
    interestRatePct: '4.5',
    mortgageYears: '25',
  });
  const [r, setR] = useState<RoiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setR(
        await request<RoiResult>('/calculator/roi', {
          tenantId: agencyId,
          method: 'POST',
          body: {
            emirate,
            price: Number(f.price),
            annualRent: Number(f.annualRent),
            serviceChargeYearly: num(f.serviceChargeYearly),
            vacancyPct: Number(f.vacancyPct),
            managementPct: Number(f.managementPct),
            appreciationPct: Number(f.appreciationPct),
            rentGrowthPct: Number(f.rentGrowthPct),
            years: Number(f.years),
            mortgage:
              f.financing === 'mortgage'
                ? {
                    downPaymentPct: num(f.downPaymentPct),
                    interestRatePct: Number(f.interestRatePct),
                    years: Number(f.mortgageYears),
                  }
                : undefined,
          },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not work out the return.');
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Investment return (ROI)</h2>
        <p className="text-sm text-muted-foreground">
          Buy-to-let yield, cash flow and a {f.years}-year projection. Buying costs come from your
          fee rules below. Growth rates are assumptions, not forecasts.
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-3">
        <Field id="roi-price" label="Purchase price (AED)">
          <Input
            id="roi-price"
            type="number"
            min={1}
            required
            value={f.price}
            onChange={set('price')}
          />
        </Field>
        <Field id="roi-rent" label="Yearly rent (AED)">
          <Input
            id="roi-rent"
            type="number"
            min={1}
            required
            value={f.annualRent}
            onChange={set('annualRent')}
          />
        </Field>
        <Field id="roi-sc" label="Service charge per year (AED)">
          <Input
            id="roi-sc"
            type="number"
            min={0}
            value={f.serviceChargeYearly}
            onChange={set('serviceChargeYearly')}
          />
        </Field>
        <Field id="roi-vac" label="Vacancy %">
          <Input
            id="roi-vac"
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={f.vacancyPct}
            onChange={set('vacancyPct')}
          />
        </Field>
        <Field id="roi-mgmt" label="Management fee %">
          <Input
            id="roi-mgmt"
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={f.managementPct}
            onChange={set('managementPct')}
          />
        </Field>
        <Field id="roi-years" label="Hold period (years)">
          <Input
            id="roi-years"
            type="number"
            min={1}
            max={30}
            value={f.years}
            onChange={set('years')}
          />
        </Field>
        <Field id="roi-app" label="Price growth % a year">
          <Input
            id="roi-app"
            type="number"
            min={-50}
            max={50}
            step="0.1"
            value={f.appreciationPct}
            onChange={set('appreciationPct')}
          />
        </Field>
        <Field id="roi-rg" label="Rent growth % a year">
          <Input
            id="roi-rg"
            type="number"
            min={-50}
            max={50}
            step="0.1"
            value={f.rentGrowthPct}
            onChange={set('rentGrowthPct')}
          />
        </Field>
        <Field id="roi-fin" label="Financing">
          <Select id="roi-fin" value={f.financing} onChange={set('financing')}>
            <option value="cash">Cash</option>
            <option value="mortgage">Mortgage</option>
          </Select>
        </Field>
        {f.financing === 'mortgage' ? (
          <>
            <Field id="roi-dp" label="Down payment % (blank = minimum)">
              <Input
                id="roi-dp"
                type="number"
                min={0}
                max={100}
                value={f.downPaymentPct}
                onChange={set('downPaymentPct')}
              />
            </Field>
            <Field id="roi-rate" label="Interest rate %">
              <Input
                id="roi-rate"
                type="number"
                min={0}
                max={25}
                step="0.01"
                value={f.interestRatePct}
                onChange={set('interestRatePct')}
              />
            </Field>
            <Field id="roi-my" label="Mortgage term (years)">
              <Input
                id="roi-my"
                type="number"
                min={1}
                max={25}
                value={f.mortgageYears}
                onChange={set('mortgageYears')}
              />
            </Field>
          </>
        ) : null}
        {error ? <p className="text-sm text-red-600 sm:col-span-3">{error}</p> : null}
        <div className="sm:col-span-3">
          <Button type="submit">Work out return</Button>
        </div>
      </form>

      {r ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Gross yield" value={`${r.yields.grossPct}%`} />
            <Stat
              label="Net yield"
              value={`${r.yields.netPct}%`}
              hint="after running and buying costs"
            />
            <Stat label="Cash-on-cash" value={`${r.yields.cashOnCashPct}%`} hint="first year" />
            <Stat
              label="Monthly cash flow"
              value={aed(r.firstYear.monthlyCashFlow)}
              hint={r.mortgage ? `after ${aed(r.mortgage.monthlyPayment)} instalment` : undefined}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Cash needed" value={aed(r.cashInvested)} />
            <Stat label="Buying costs" value={aed(r.buyingCosts)} />
            {r.summary ? (
              <Stat
                label={`Total return after ${r.summary.years} years`}
                value={aed(r.summary.totalReturn)}
                hint={`${r.summary.totalReturnPct}% · ${r.summary.annualisedPct}% a year${
                  r.summary.paybackYear ? ` · cash back by year ${r.summary.paybackYear}` : ''
                }`}
              />
            ) : null}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Buying costs and projection</summary>
            <ul className="mt-2">
              {r.buyingCostItems.map((x) => (
                <li key={x.label} className="flex justify-between border-b border-border py-1">
                  <span>
                    {x.label}
                    {x.status !== 'verified' ? (
                      <span className="ml-1 text-xs text-amber-700">(unverified)</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">{aed(x.total)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-right tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left">Year</th>
                    <th>Value</th>
                    <th>Rent</th>
                    <th>Cash flow</th>
                    <th>Equity</th>
                    <th>Total return</th>
                  </tr>
                </thead>
                <tbody>
                  {r.projection.map((p) => (
                    <tr key={p.year} className="border-b border-border">
                      <td className="text-left">{p.year}</td>
                      <td>{aed(p.propertyValue)}</td>
                      <td>{aed(p.rent)}</td>
                      <td>{aed(p.cashFlow)}</td>
                      <td>{aed(p.equity)}</td>
                      <td>{aed(p.totalReturn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="text-xs text-muted-foreground">
            Estimate only, not financial advice.
            {r.unverifiedCount > 0
              ? ` ${r.unverifiedCount} fee rule(s) still use unverified sample values.`
              : ''}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

export function AffordabilityCalculator({ agencyId }: { agencyId: string }) {
  const { request } = useAuth();
  const [f, setF] = useState({
    monthlyIncome: '',
    monthlyDebts: '0',
    interestRatePct: '4.5',
    years: '25',
    national: 'no',
  });
  const [r, setR] = useState<AffordResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setR(
        await request<AffordResult>('/calculator/affordability', {
          tenantId: agencyId,
          method: 'POST',
          body: {
            monthlyIncome: Number(f.monthlyIncome),
            monthlyDebts: Number(f.monthlyDebts || 0),
            interestRatePct: Number(f.interestRatePct),
            years: Number(f.years),
            national: f.national === 'yes',
          },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not work out affordability.');
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">How much can my client borrow?</h2>
        <p className="text-sm text-muted-foreground">
          UAE banks cap all monthly debt payments at 50% of income, and the loan at a share of the
          price (lower for expats and for homes over AED 5M). Banks decide the final amount.
        </p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-3">
        <Field id="aff-inc" label="Monthly income (AED)">
          <Input
            id="aff-inc"
            type="number"
            min={1}
            required
            value={f.monthlyIncome}
            onChange={set('monthlyIncome')}
          />
        </Field>
        <Field id="aff-debt" label="Existing monthly debt payments (AED)">
          <Input
            id="aff-debt"
            type="number"
            min={0}
            value={f.monthlyDebts}
            onChange={set('monthlyDebts')}
          />
        </Field>
        <Field id="aff-nat" label="Buyer">
          <Select id="aff-nat" value={f.national} onChange={set('national')}>
            <option value="no">Expat</option>
            <option value="yes">UAE national</option>
          </Select>
        </Field>
        <Field id="aff-rate" label="Interest rate %">
          <Input
            id="aff-rate"
            type="number"
            min={0}
            max={25}
            step="0.01"
            value={f.interestRatePct}
            onChange={set('interestRatePct')}
          />
        </Field>
        <Field id="aff-years" label="Term (years)">
          <Input
            id="aff-years"
            type="number"
            min={1}
            max={25}
            value={f.years}
            onChange={set('years')}
          />
        </Field>
        <div className="flex items-end">
          <Button type="submit">Check</Button>
        </div>
        {error ? <p className="text-sm text-red-600 sm:col-span-3">{error}</p> : null}
      </form>
      {r ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Max monthly instalment" value={aed(r.maxMonthlyPayment)} />
          <Stat label="Max loan" value={aed(r.maxLoan)} hint={`at ${r.rateUsedPct}%`} />
          <Stat label="Max property price" value={aed(r.maxPrice)} />
          <Stat
            label="Down payment needed"
            value={aed(r.downPaymentNeeded)}
            hint="plus buying costs"
          />
        </div>
      ) : null}
    </Card>
  );
}

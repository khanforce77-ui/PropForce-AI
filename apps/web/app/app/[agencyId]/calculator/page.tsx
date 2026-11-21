'use client';

import { Copy, MessageCircle } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import { getSupportedEmirates } from '@/lib/env';

const EMIRATES = getSupportedEmirates();

const CALCULATORS = [
  { value: 'ready_sale', label: 'Ready property sale' },
  { value: 'off_plan_sale', label: 'Off-plan sale' },
  { value: 'mortgage', label: 'Mortgage purchase' },
  { value: 'rental', label: 'Residential rental' },
  { value: 'commercial_rental', label: 'Commercial rental' },
] as const;
type CalculatorType = (typeof CALCULATORS)[number]['value'];
const isRent = (c: CalculatorType) => c === 'rental' || c === 'commercial_rental';

interface RuleInfo {
  ratePct: number | null;
  amount: number | null;
  basis: string;
  source: string;
  status: string;
  verifiedAt: string | null;
  isOverride: boolean;
}

interface Item {
  code: string;
  label: string;
  payer: string;
  fee: number;
  vat: number;
  total: number;
  refundable: boolean;
  rule: RuleInfo;
}

interface EstimateResult {
  label: 'Estimate';
  emirate: string;
  calculator: CalculatorType;
  price: number | null;
  annualRent: number | null;
  items: Item[];
  totals: { fees: number; refundable: number; upfront: number };
  mortgage: null | {
    downPaymentPct: number;
    minDownPaymentPct: number;
    downPayment: number;
    loan: number;
    interestRatePct: number;
    years: number;
    monthlyPayment: number;
  };
  commission: null | { agency: number; brokerSplitPct?: number; broker?: number };
  unverifiedCount: number;
}

interface FeeRule extends RuleInfo {
  code: string;
  label: string;
  calculators: string[];
  payer: string;
  vat: boolean;
  refundable: boolean;
  template: { ratePct: number | null; amount: number | null };
}

const aed = (n: number) =>
  `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function ruleText(r: { ratePct: number | null; amount: number | null; basis: string }) {
  const basis = r.basis === 'loan' ? 'loan' : r.basis === 'annual_rent' ? 'annual rent' : 'price';
  const parts = [];
  if (r.ratePct !== null) parts.push(`${r.ratePct}% of ${basis}`);
  if (r.amount !== null) parts.push(aed(r.amount));
  return parts.join(' + ') || '—';
}

function StatusBadge({ status }: { status: string }) {
  const verified = status === 'verified';
  return (
    <span
      className={
        verified
          ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
          : 'rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      }
    >
      {verified ? 'Verified' : 'UNVERIFIED – sample'}
    </span>
  );
}

/** Plain-text quote a broker can paste into WhatsApp or email. */
function quoteText(r: EstimateResult, agencyName: string): string {
  const type = CALCULATORS.find((c) => c.value === r.calculator)?.label ?? r.calculator;
  const lines = [
    `ESTIMATE – ${type}, ${r.emirate}`,
    r.price !== null ? `Price: ${aed(r.price)}` : `Annual rent: ${aed(r.annualRent ?? 0)}`,
  ];
  if (r.mortgage) {
    lines.push(
      `Down payment ${r.mortgage.downPaymentPct}%: ${aed(r.mortgage.downPayment)}`,
      `Loan: ${aed(r.mortgage.loan)} at ${r.mortgage.interestRatePct}% for ${r.mortgage.years} years`,
      `Monthly instalment: ${aed(r.mortgage.monthlyPayment)}`,
    );
  }
  lines.push('');
  for (const i of r.items) {
    lines.push(`${i.label}: ${aed(i.total)}${i.refundable ? ' (refundable)' : ''}`);
  }
  lines.push('', `Total fees: ${aed(r.totals.fees)}`);
  if (r.totals.refundable > 0) lines.push(`Refundable deposits: ${aed(r.totals.refundable)}`);
  lines.push(`Needed upfront: ${aed(r.totals.upfront)}`, '');
  lines.push(
    r.unverifiedCount > 0
      ? 'This is an estimate. Some fees are sample values not yet verified; final amounts are set by the authorities, banks and developers.'
      : 'This is an estimate. Final amounts are set by the authorities, banks and developers.',
  );
  lines.push(`– ${agencyName}`);
  return lines.join('\n');
}

function RuleRow({
  rule,
  onSave,
  onReset,
}: {
  rule: FeeRule;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => {
      const v = String(f.get(k) ?? '').trim();
      return v === '' ? null : Number(v);
    };
    setError(null);
    try {
      await onSave({
        code: rule.code,
        ratePct: num('ratePct'),
        amount: num('amount'),
        vat: f.get('vat') === 'on',
        source: String(f.get('source') ?? '').trim(),
        verified: f.get('verified') === 'on',
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the fee.');
    }
  }

  const id = `rule-${rule.code}`;
  return (
    <li className="border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{rule.label}</p>
          <p className="text-xs text-muted-foreground">
            {ruleText(rule)}
            {rule.vat ? ' + 5% VAT' : ''} · paid by {rule.payer}
            {rule.isOverride ? ' · your agency’s value' : ' · PropForce sample'}
          </p>
          <p className="text-xs text-muted-foreground">Source: {rule.source}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={rule.status} />
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
          {rule.isOverride ? (
            <Button size="sm" variant="ghost" onClick={() => void onReset()}>
              Reset to sample
            </Button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-rate`} label="Rate (%)">
            <Input
              id={`${id}-rate`}
              name="ratePct"
              type="number"
              step="0.0001"
              min="0"
              max="100"
              defaultValue={rule.ratePct ?? ''}
            />
          </Field>
          <Field id={`${id}-amount`} label="Fixed amount (AED)">
            <Input
              id={`${id}-amount`}
              name="amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={rule.amount ?? ''}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              id={`${id}-source`}
              label="Source"
              hint="Where this value comes from, e.g. the authority’s fee page or circular and its date."
            >
              <Input
                id={`${id}-source`}
                name="source"
                required
                minLength={3}
                maxLength={500}
                defaultValue={rule.isOverride ? rule.source : ''}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="vat" defaultChecked={rule.vat} /> Add 5% VAT
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="verified" /> I checked this against the official source
          </label>
          {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm">
              Save fee
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

export default function CalculatorPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const canEditRules = membership?.role === 'owner' || membership?.role === 'admin';

  const [calculator, setCalculator] = useState<CalculatorType>('ready_sale');
  const [emirate, setEmirate] = useState(EMIRATES[0] ?? 'Dubai');
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [rules, setRules] = useState<FeeRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    const res = await request<{ data: FeeRule[] }>(
      `/calculator/rules?emirate=${encodeURIComponent(emirate)}`,
      { tenantId: agencyId },
    );
    setRules(res.data);
  }, [agencyId, emirate, request]);

  useEffect(() => {
    void loadRules().catch(() => setError('Could not load the fee rules.'));
  }, [loadRules]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => {
      const v = String(f.get(k) ?? '').trim();
      return v === '' ? undefined : Number(v);
    };
    const body: Record<string, unknown> = { emirate, calculator };
    if (isRent(calculator)) body.annualRent = num('annualRent');
    else body.price = num('price');
    if (calculator === 'mortgage') {
      body.downPaymentPct = num('downPaymentPct');
      body.interestRatePct = num('interestRatePct');
      body.years = num('years');
      body.national = f.get('national') === 'on';
    }
    const split = num('brokerSplitPct');
    if (split !== undefined) body.brokerSplitPct = split;
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    setError(null);
    setNotice(null);
    try {
      setResult(
        await request<EstimateResult>('/calculator/estimate', { tenantId: agencyId, body }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not calculate the estimate.');
    }
  }

  async function saveRule(body: Record<string, unknown>) {
    await request('/calculator/rules', {
      tenantId: agencyId,
      method: 'PUT',
      body: { emirate, ...body },
    });
    await loadRules();
    setResult(null);
    setNotice('Fee saved. Calculate again to use the new value.');
  }

  async function resetRule(code: string) {
    try {
      await request(`/calculator/rules/${encodeURIComponent(emirate)}/${code}`, {
        tenantId: agencyId,
        method: 'DELETE',
      });
      await loadRules();
      setResult(null);
      setNotice('Fee reset to the PropForce sample.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset the fee.');
    }
  }

  const quote = result ? quoteText(result, membership?.agency.name ?? '') : '';

  async function copyQuote() {
    try {
      await navigator.clipboard.writeText(quote);
      setNotice('Quote copied.');
    } catch {
      setError('Could not copy. Select the quote text and copy it by hand.');
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Cost calculator</h1>
        <p className="text-sm text-muted-foreground">
          For your brokers: work out fees, mortgage instalments and commission for a client, then
          share the quote. Every result is an estimate.
        </p>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <Card>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field id="calculator" label="Transaction">
            <Select
              id="calculator"
              value={calculator}
              onChange={(e) => {
                setCalculator(e.target.value as CalculatorType);
                setResult(null);
              }}
            >
              {CALCULATORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="emirate" label="Emirate">
            <Select
              id="emirate"
              value={emirate}
              onChange={(e) => {
                setEmirate(e.target.value);
                setResult(null);
              }}
            >
              {EMIRATES.map((em) => (
                <option key={em} value={em}>
                  {em}
                </option>
              ))}
            </Select>
          </Field>
          {isRent(calculator) ? (
            <Field id="annualRent" label="Annual rent (AED)">
              <Input id="annualRent" name="annualRent" type="number" min="0" required />
            </Field>
          ) : (
            <Field id="price" label="Property price (AED)">
              <Input id="price" name="price" type="number" min="0" required />
            </Field>
          )}
          <Field
            id="brokerSplitPct"
            label="Broker’s share of commission (%)"
            hint="Optional. Shows the broker’s part of the agency commission."
          >
            <Input id="brokerSplitPct" name="brokerSplitPct" type="number" min="0" max="100" />
          </Field>
          {calculator === 'mortgage' ? (
            <>
              <Field
                id="downPaymentPct"
                label="Down payment (%)"
                hint="Raised to the UAE Central Bank minimum if lower."
              >
                <Input
                  id="downPaymentPct"
                  name="downPaymentPct"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                />
              </Field>
              <Field id="interestRatePct" label="Interest rate (% a year)">
                <Input
                  id="interestRatePct"
                  name="interestRatePct"
                  type="number"
                  min="0"
                  max="25"
                  step="0.01"
                  defaultValue="4.5"
                />
              </Field>
              <Field id="years" label="Term (years)">
                <Input id="years" name="years" type="number" min="1" max="25" defaultValue="25" />
              </Field>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name="national" /> Buyer is a UAE national
              </label>
            </>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit">Calculate</Button>
          </div>
        </form>
      </Card>

      {result ? (
        <Card className="flex flex-col gap-4" aria-labelledby="estimate-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="estimate-heading" className="text-lg font-semibold">
              Estimate
            </h2>
            {result.unverifiedCount > 0 ? (
              <span className="text-xs text-amber-800 dark:text-amber-300">
                {result.unverifiedCount} fee{result.unverifiedCount === 1 ? '' : 's'} use unverified
                sample values
              </span>
            ) : null}
          </div>

          {result.mortgage ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Monthly instalment</dt>
                <dd className="text-lg font-semibold">{aed(result.mortgage.monthlyPayment)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Down payment ({result.mortgage.downPaymentPct}%)
                </dt>
                <dd className="font-medium">{aed(result.mortgage.downPayment)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Loan</dt>
                <dd className="font-medium">{aed(result.mortgage.loan)}</dd>
              </div>
            </dl>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Fee</th>
                  <th className="py-2 pr-2 font-medium">Paid by</th>
                  <th className="py-2 pr-2 text-right font-medium">Amount</th>
                  <th className="py-2 pr-2 text-right font-medium">VAT</th>
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((i) => (
                  <tr key={i.code} className="border-b border-border align-top">
                    <td className="py-2 pr-2">
                      <p>
                        {i.label}
                        {i.refundable ? ' (refundable)' : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">{ruleText(i.rule)}</p>
                      <StatusBadge status={i.rule.status} />
                    </td>
                    <td className="py-2 pr-2 capitalize">{i.payer}</td>
                    <td className="py-2 pr-2 text-right">{aed(i.fee)}</td>
                    <td className="py-2 pr-2 text-right">{aed(i.vat)}</td>
                    <td className="py-2 text-right font-medium">{aed(i.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="pt-3 pr-2 text-right">
                    Total fees
                  </td>
                  <td className="pt-3 text-right font-semibold">{aed(result.totals.fees)}</td>
                </tr>
                {result.totals.refundable > 0 ? (
                  <tr>
                    <td colSpan={4} className="pr-2 text-right">
                      Refundable deposits
                    </td>
                    <td className="text-right">{aed(result.totals.refundable)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td colSpan={4} className="pr-2 text-right">
                    Needed upfront
                  </td>
                  <td className="text-right font-semibold">{aed(result.totals.upfront)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {result.commission ? (
            <p className="text-sm">
              Agency commission: <strong>{aed(result.commission.agency)}</strong>
              {result.commission.broker !== undefined
                ? ` · broker share (${result.commission.brokerSplitPct}%): ${aed(result.commission.broker)}`
                : ''}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            This is an estimate, not a binding quote. Final amounts are set by the authorities,
            banks and developers.
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor="quote" className="text-sm font-medium">
              Quote for the client
            </label>
            <textarea
              id="quote"
              readOnly
              value={quote}
              rows={10}
              className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void copyQuote()}>
                <Copy className="mr-2 h-4 w-4" aria-hidden /> Copy quote
              </Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(quote)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm hover:bg-muted"
              >
                <MessageCircle className="mr-2 h-4 w-4" aria-hidden /> Share on WhatsApp
              </a>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className="text-lg font-semibold">Fee rules – {emirate}</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          PropForce ships sample values that are not verified.{' '}
          {canEditRules
            ? 'Check each fee against the official source and save your agency’s value.'
            : 'An owner or admin can check and verify these for your agency.'}
        </p>
        <ul>
          {rules.map((r) =>
            canEditRules ? (
              <RuleRow key={r.code} rule={r} onSave={saveRule} onReset={() => resetRule(r.code)} />
            ) : (
              <li key={r.code} className="border-b border-border py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{r.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {ruleText(r)}
                      {r.vat ? ' + 5% VAT' : ''} · paid by {r.payer}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              </li>
            ),
          )}
        </ul>
      </Card>
    </div>
  );
}

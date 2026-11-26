'use client';

import { Plus, Trash2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ContactSummary, Page } from '@/lib/crm';
import {
  aedText,
  CHANNEL_LABEL,
  dateText,
  generateSchedule,
  type DraftInstallment,
  type PlanDetail,
  type PlanSummary,
  type ReminderChannel,
} from '@/lib/payments';
import { cn } from '@/lib/utils';

const todayDubai = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);

function NewPlan({ agencyId, onCancel }: { agencyId: string; onCancel: () => void }) {
  const { request } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [buyer, setBuyer] = useState({ fullName: '', phone: '', email: '', contactId: '' });
  const [plan, setPlan] = useState({ projectName: '', unitRef: '', totalPrice: '', notes: '' });
  const [gen, setGen] = useState({
    downPercent: '10',
    count: '4',
    everyMonths: '3',
    firstDate: todayDubai(),
  });
  const [rows, setRows] = useState<DraftInstallment[]>([]);
  const [consent, setConsent] = useState<ReminderChannel[]>(['email', 'sms']);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== 'existing') return;
    void request<Page<ContactSummary>>('/contacts?limit=100', { tenantId: agencyId })
      .then((r) => setContacts(r.data))
      .catch(() => setContacts([]));
  }, [mode, agencyId, request]);

  const total = Number(plan.totalPrice) || 0;
  const scheduled = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const generate = () =>
    setRows(
      generateSchedule({
        total,
        downPercent: Number(gen.downPercent) || 0,
        count: Math.max(0, Math.min(120, Number(gen.count) || 0)),
        everyMonths: Math.max(1, Number(gen.everyMonths) || 1),
        firstDate: gen.firstDate,
      }),
    );

  const update = (i: number, patch: Partial<DraftInstallment>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const created = await request<PlanDetail>('/payment-plans', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          ...(mode === 'existing'
            ? { contactId: buyer.contactId || undefined }
            : {
                buyer: {
                  fullName: buyer.fullName,
                  ...(buyer.phone ? { phone: buyer.phone } : {}),
                  ...(buyer.email ? { email: buyer.email } : {}),
                },
              }),
          projectName: plan.projectName,
          ...(plan.unitRef ? { unitRef: plan.unitRef } : {}),
          totalPrice: total,
          ...(plan.notes ? { notes: plan.notes } : {}),
          installments: rows.map((r) => ({
            label: r.label,
            dueDate: r.dueDate,
            amount: Number(r.amount),
          })),
          reminderConsent: consent,
        },
      });
      router.push(`/app/${agencyId}/payment-plans/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(err.message);
      } else setError('Could not save the payment plan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <h2 className="text-lg font-semibold">New payment plan</h2>
        {error ? <Alert>{error}</Alert> : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Buyer</legend>
          <div className="flex gap-2 text-sm">
            {(['new', 'existing'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-lg border px-3 py-1',
                  mode === m ? 'border-primary bg-primary/10' : 'border-border',
                )}
              >
                {m === 'new' ? 'New buyer' : 'Existing contact'}
              </button>
            ))}
          </div>
          {mode === 'new' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                id="fullName"
                label="Full name"
                error={errors['buyer.fullName'] ?? errors.buyer}
              >
                <Input
                  id="fullName"
                  value={buyer.fullName}
                  onChange={(e) => setBuyer({ ...buyer, fullName: e.target.value })}
                  required
                />
              </Field>
              <Field id="phone" label="Mobile" error={errors['buyer.phone']}>
                <Input
                  id="phone"
                  value={buyer.phone}
                  placeholder="050 123 4567"
                  onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
                />
              </Field>
              <Field id="email" label="Email" error={errors['buyer.email']}>
                <Input
                  id="email"
                  type="email"
                  value={buyer.email}
                  onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <Field id="contactId" label="Contact" error={errors.contactId ?? errors.buyer}>
              <Select
                id="contactId"
                value={buyer.contactId}
                onChange={(e) => setBuyer({ ...buyer, contactId: e.target.value })}
              >
                <option value="">Choose a contact…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} {c.phoneE164 ? `· ${c.phoneE164}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="projectName" label="Project" error={errors.projectName}>
            <Input
              id="projectName"
              value={plan.projectName}
              onChange={(e) => setPlan({ ...plan, projectName: e.target.value })}
              required
            />
          </Field>
          <Field id="unitRef" label="Unit" error={errors.unitRef}>
            <Input
              id="unitRef"
              value={plan.unitRef}
              onChange={(e) => setPlan({ ...plan, unitRef: e.target.value })}
            />
          </Field>
          <Field id="totalPrice" label="Total price (AED)" error={errors.totalPrice}>
            <Input
              id="totalPrice"
              inputMode="decimal"
              value={plan.totalPrice}
              onChange={(e) => setPlan({ ...plan, totalPrice: e.target.value })}
              required
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Installments</legend>
          <div className="grid items-end gap-3 sm:grid-cols-5">
            <Field id="down" label="Down payment %">
              <Input
                id="down"
                inputMode="decimal"
                value={gen.downPercent}
                onChange={(e) => setGen({ ...gen, downPercent: e.target.value })}
              />
            </Field>
            <Field id="count" label="Installments">
              <Input
                id="count"
                inputMode="numeric"
                value={gen.count}
                onChange={(e) => setGen({ ...gen, count: e.target.value })}
              />
            </Field>
            <Field id="every" label="Every (months)">
              <Input
                id="every"
                inputMode="numeric"
                value={gen.everyMonths}
                onChange={(e) => setGen({ ...gen, everyMonths: e.target.value })}
              />
            </Field>
            <Field id="first" label="First due date">
              <Input
                id="first"
                type="date"
                value={gen.firstDate}
                onChange={(e) => setGen({ ...gen, firstDate: e.target.value })}
              />
            </Field>
            <Button type="button" variant="outline" onClick={generate} disabled={!total}>
              Fill schedule
            </Button>
          </div>
          {errors.installments ? (
            <p className="text-xs text-red-600">{errors.installments}</p>
          ) : null}
          {rows.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Label</th>
                  <th>Due date</th>
                  <th>Amount (AED)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label="Label"
                        value={r.label}
                        onChange={(e) => update(i, { label: e.target.value })}
                      />
                    </td>
                    <td className="pr-2">
                      <Input
                        aria-label="Due date"
                        type="date"
                        value={r.dueDate}
                        onChange={(e) => update(i, { dueDate: e.target.value })}
                      />
                    </td>
                    <td className="pr-2">
                      <Input
                        aria-label="Amount"
                        inputMode="decimal"
                        value={r.amount}
                        onChange={(e) => update(i, { amount: e.target.value })}
                      />
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove"
                        onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Fill the schedule from the price, or add installments one by one.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows([
                  ...rows,
                  { label: `Installment ${rows.length + 1}`, dueDate: gen.firstDate, amount: '' },
                ])
              }
            >
              <Plus className="h-4 w-4" /> Add installment
            </Button>
            <span
              className={cn(
                total && Math.abs(scheduled - total) > 0.009
                  ? 'text-amber-600'
                  : 'text-muted-foreground',
              )}
            >
              Scheduled {aedText(scheduled)} of {aedText(total)}
            </span>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Buyer agreed to payment reminders by</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {(['email', 'sms', 'ai_call'] as ReminderChannel[]).map((ch) => (
              <label key={ch} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={consent.includes(ch)}
                  onChange={(e) =>
                    setConsent(
                      e.target.checked ? [...consent, ch] : consent.filter((c) => c !== ch),
                    )
                  }
                />
                {CHANNEL_LABEL[ch]}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Tick only what the buyer agreed to (for example in the SPA or booking form). It is saved
            as their consent, with the date and your name. Reminders never go out on a channel
            without it.
          </p>
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save payment plan'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function PaymentPlansPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const [rows, setRows] = useState<PlanSummary[] | null>(null);
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await request<{ data: PlanSummary[] }>('/payment-plans', {
        tenantId: agencyId,
        query: { status: status || undefined, q: q || undefined },
      });
      setRows(r.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load payment plans.');
    }
  }, [agencyId, request, status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const outstanding = rows?.reduce((s, p) => s + p.outstanding, 0) ?? 0;
  const overdue = rows?.filter((p) => p.overdueCount > 0).length ?? 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Wallet className="h-6 w-6" aria-hidden /> Payment plans
          </h1>
          <p className="text-sm text-muted-foreground">
            Buyers&apos; installment plans. Unpaid installments get automatic reminders on the
            schedule in{' '}
            <Link href={`/app/${agencyId}/payment-reminders`} className="text-primary underline">
              Payment reminders
            </Link>
            .
          </p>
        </div>
        {!adding ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New payment plan
          </Button>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {adding ? <NewPlan agencyId={agencyId} onCancel={() => setAdding(false)} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Plans shown</p>
          <p className="text-xl font-semibold">{rows?.length ?? '–'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-xl font-semibold">{aedText(outstanding)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Plans with overdue payments</p>
          <p className={cn('text-xl font-semibold', overdue ? 'text-red-600' : '')}>{overdue}</p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder="Search buyer, project or unit"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          className="max-w-[12rem]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="">All</option>
        </Select>
      </div>

      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No payment plans yet. Add a buyer&apos;s plan to start reminders.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Buyer</th>
                <th>Project / unit</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th className="pr-4">Next due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-muted">
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/${agencyId}/payment-plans/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.contact.fullName}
                    </Link>
                    {p.remindersPaused ? (
                      <span className="ml-2 text-xs text-amber-600">Reminders paused</span>
                    ) : null}
                  </td>
                  <td>
                    {p.projectName}
                    {p.unitRef ? ` · ${p.unitRef}` : ''}
                  </td>
                  <td className="tabular-nums">{aedText(p.paidTotal)}</td>
                  <td className="tabular-nums">{aedText(p.outstanding)}</td>
                  <td className="pr-4">
                    {p.nextDue ? (
                      <span className={cn(p.overdueCount ? 'text-red-600' : '')}>
                        {dateText(p.nextDue.dueDate)} · {aedText(p.nextDue.amount)}
                        {p.overdueCount ? ` (${p.overdueCount} overdue)` : ''}
                      </span>
                    ) : (
                      '–'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

'use client';

import { ArrowLeft, Check, Pause, Play, Plus, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  aedText,
  CHANNEL_LABEL,
  dateText,
  describeOffset,
  DISPATCH_LABEL,
  type Dispatch,
  type PlanDetail,
  type ReminderChannel,
} from '@/lib/payments';
import { cn } from '@/lib/utils';

export default function PaymentPlanPage() {
  const { agencyId, planId } = useParams<{ agencyId: string; planId: string }>();
  const { request } = useAuth();
  const router = useRouter();
  const membership = useAgencyMembership();
  const canDelete = membership?.role === 'owner' || membership?.role === 'admin';
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [log, setLog] = useState<Dispatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState({ label: '', dueDate: '', amount: '' });
  const t = { tenantId: agencyId };

  const load = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        request<PlanDetail>(`/payment-plans/${planId}`, { tenantId: agencyId }),
        request<{ data: Dispatch[] }>('/payment-reminders/log', {
          tenantId: agencyId,
          query: { planId, limit: 200 },
        }),
      ]);
      setPlan(p);
      setLog(l.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the payment plan.');
    }
  }, [agencyId, planId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<PlanDetail | void>) {
    setError(null);
    try {
      const p = await fn();
      if (p) setPlan(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  const setInstallment = (id: string, body: Record<string, unknown>) =>
    act(() =>
      request<PlanDetail>(`/payment-plans/${planId}/installments/${id}`, {
        ...t,
        method: 'PATCH',
        body,
      }),
    );

  const addInstallment = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const p = await request<PlanDetail>(`/payment-plans/${planId}/installments`, {
        ...t,
        method: 'POST',
        body: { label: adding.label, dueDate: adding.dueDate, amount: Number(adding.amount) },
      });
      setAdding({ label: '', dueDate: '', amount: '' });
      return p;
    });
  };

  if (!plan) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href={`/app/${agencyId}/payment-plans`}
        className="flex items-center gap-1 text-sm text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Payment plans
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{plan.contact.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {plan.projectName}
            {plan.unitRef ? ` · Unit ${plan.unitRef}` : ''} · {aedText(plan.totalPrice)} ·{' '}
            {plan.status}
          </p>
          <p className="text-sm text-muted-foreground">
            {plan.contact.phoneE164 ?? 'No phone'} · {plan.contact.email ?? 'No email'} ·{' '}
            <Link
              href={`/app/${agencyId}/contacts/${plan.contact.id}`}
              className="text-primary underline"
            >
              Contact
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void act(() =>
                request<PlanDetail>(`/payment-plans/${planId}`, {
                  ...t,
                  method: 'PATCH',
                  body: { remindersPaused: !plan.remindersPaused },
                }),
              )
            }
          >
            {plan.remindersPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {plan.remindersPaused ? 'Resume reminders' : 'Pause reminders'}
          </Button>
          {plan.status !== 'cancelled' ? (
            <Button
              variant="outline"
              onClick={() =>
                void act(() =>
                  request<PlanDetail>(`/payment-plans/${planId}`, {
                    ...t,
                    method: 'PATCH',
                    body: { status: 'cancelled' },
                  }),
                )
              }
            >
              Cancel plan
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              variant="destructive"
              onClick={() =>
                void act(async () => {
                  if (!window.confirm('Delete this payment plan and its reminder history?')) return;
                  await request(`/payment-plans/${planId}`, { ...t, method: 'DELETE' });
                  router.push(`/app/${agencyId}/payment-plans`);
                })
              }
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {plan.contact.doNotContact ? (
        <Alert>This buyer is marked “do not contact”. No reminders will be sent.</Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Paid</p>
          <p className="text-xl font-semibold">{aedText(plan.paidTotal)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="text-xl font-semibold">{aedText(plan.outstanding)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Overdue installments</p>
          <p className={cn('text-xl font-semibold', plan.overdueCount ? 'text-red-600' : '')}>
            {plan.overdueCount}
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">Reminder consent</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Reminders go only on channels the buyer agreed to. Changes are saved to the buyer&apos;s
          consent history.
        </p>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(CHANNEL_LABEL) as ReminderChannel[]).map((ch) => {
            const granted = plan.contact.reminderConsent[ch] === 'granted';
            return (
              <div
                key={ch}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">{CHANNEL_LABEL[ch]}</span>
                <span className={granted ? 'text-emerald-600' : 'text-muted-foreground'}>
                  {granted
                    ? 'Agreed'
                    : plan.contact.reminderConsent[ch] === 'withdrawn'
                      ? 'Withdrawn'
                      : 'Not recorded'}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void act(() =>
                      request<PlanDetail>(`/payment-plans/${planId}/consent`, {
                        ...t,
                        method: 'POST',
                        body: { channel: ch, status: granted ? 'withdrawn' : 'granted' },
                      }),
                    )
                  }
                >
                  {granted ? 'Withdraw' : 'Buyer agreed'}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2">#</th>
              <th>Installment</th>
              <th>Due</th>
              <th>Amount</th>
              <th>Status</th>
              <th className="pr-4" />
            </tr>
          </thead>
          <tbody>
            {plan.installments.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2 text-muted-foreground">{i.seq}</td>
                <td>{i.label}</td>
                <td className={cn(i.overdue ? 'text-red-600' : '')}>{dateText(i.dueDate)}</td>
                <td className="tabular-nums">{aedText(i.amount)}</td>
                <td>
                  {i.status === 'paid' ? (
                    <span className="text-emerald-600">
                      Paid{i.paidAt ? ` ${dateText(i.paidAt)}` : ''}
                    </span>
                  ) : i.status === 'waived' ? (
                    'Waived'
                  ) : i.overdue ? (
                    <span className="text-red-600">Overdue</span>
                  ) : (
                    'Pending'
                  )}
                </td>
                <td className="py-1 pr-4 text-right">
                  {i.status === 'pending' ? (
                    <Button size="sm" onClick={() => void setInstallment(i.id, { status: 'paid' })}>
                      <Check className="h-4 w-4" /> Mark paid
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void setInstallment(i.id, { status: 'pending' })}
                    >
                      <Undo2 className="h-4 w-4" /> Undo
                    </Button>
                  )}
                  {i.status === 'pending' ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove installment"
                      onClick={() =>
                        void act(() =>
                          request<PlanDetail>(`/payment-plans/${planId}/installments/${i.id}`, {
                            ...t,
                            method: 'DELETE',
                          }),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          onSubmit={addInstallment}
          className="flex flex-wrap items-end gap-2 border-t border-border p-4"
        >
          <Input
            className="max-w-[12rem]"
            aria-label="Label"
            placeholder="Label"
            value={adding.label}
            onChange={(e) => setAdding({ ...adding, label: e.target.value })}
            required
          />
          <Input
            className="max-w-[11rem]"
            aria-label="Due date"
            type="date"
            value={adding.dueDate}
            onChange={(e) => setAdding({ ...adding, dueDate: e.target.value })}
            required
          />
          <Input
            className="max-w-[10rem]"
            aria-label="Amount"
            inputMode="decimal"
            placeholder="Amount (AED)"
            value={adding.amount}
            onChange={(e) => setAdding({ ...adding, amount: e.target.value })}
            required
          />
          <Button type="submit" variant="outline">
            <Plus className="h-4 w-4" /> Add installment
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Reminders sent for this plan</h2>
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {log.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 last:border-b-0"
              >
                <span>
                  <strong>{CHANNEL_LABEL[d.channel]}</strong> · {d.installment.label} ·{' '}
                  {describeOffset(d.offsetDays)}
                </span>
                <span
                  className={cn(
                    d.status === 'sent'
                      ? 'text-emerald-600'
                      : d.status === 'failed'
                        ? 'text-red-600'
                        : 'text-muted-foreground',
                  )}
                >
                  {DISPATCH_LABEL[d.status]} ·{' '}
                  {new Date(d.createdAt).toLocaleString('en-AE', { timeZone: 'Asia/Dubai' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

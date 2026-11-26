'use client';

import { ArrowLeft, BadgeDollarSign } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type PlatformAgency } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  dateText,
  limitText,
  priceText,
  STATUS_LABEL,
  type BillingPlan,
  type PlatformBilling,
  type SubscriptionStatus,
} from '@/lib/billing';

const num = (s: string) => (s.trim() === '' ? null : Number(s));

function PlanRow({
  plan,
  onSave,
}: {
  plan: BillingPlan;
  onSave: (code: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    price: plan.priceMonthlyAed?.toString() ?? '',
    seats: plan.seatLimit?.toString() ?? '',
    listings: plan.listingLimit?.toString() ?? '',
    ai: plan.aiRepliesMonthly?.toString() ?? '',
  });
  if (!editing) {
    return (
      <tr className="border-b border-border">
        <td className="py-2 font-medium">{plan.name}</td>
        <td>{priceText(plan.priceMonthlyAed)}</td>
        <td>{limitText(plan.seatLimit)}</td>
        <td>{limitText(plan.listingLimit)}</td>
        <td>{limitText(plan.aiRepliesMonthly)}</td>
        <td className="text-right">
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </td>
      </tr>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave(plan.code, {
      priceMonthlyAed: num(f.price),
      seatLimit: num(f.seats),
      listingLimit: num(f.listings),
      aiRepliesMonthly: num(f.ai),
    })
      .then(() => setEditing(false))
      .catch(() => undefined);
  };
  const field = (key: keyof typeof f, label: string) => (
    <Field id={`p-${plan.code}-${key}`} label={label}>
      <Input
        id={`p-${plan.code}-${key}`}
        type="number"
        min={0}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <tr className="border-b border-border">
      <td colSpan={6} className="py-3">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-5">
          <p className="self-end pb-2 font-medium">{plan.name}</p>
          {field('price', 'AED / month (blank = on request)')}
          {field('seats', 'Seats (blank = unlimited)')}
          {field('listings', 'Listings')}
          {field('ai', 'AI replies / month')}
          <div className="flex gap-2 sm:col-span-5">
            <Button type="submit">Save</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function SetSubscription({
  agencies,
  plans,
  onSave,
}: {
  agencies: PlatformAgency[];
  plans: BillingPlan[];
  onSave: (agencyId: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [f, setF] = useState({
    agencyId: '',
    planCode: 'starter',
    status: 'active' as SubscriptionStatus,
    periodEnd: '',
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave(f.agencyId, {
      planCode: f.planCode,
      status: f.status,
      // End of the chosen day in Dubai.
      currentPeriodEnd: f.periodEnd ? `${f.periodEnd}T23:59:59+04:00` : null,
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
      <Field id="s-agency" label="Agency">
        <Select
          id="s-agency"
          required
          value={f.agencyId}
          onChange={(e) => setF({ ...f, agencyId: e.target.value })}
        >
          <option value="">Choose…</option>
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="s-plan" label="Plan">
        <Select
          id="s-plan"
          value={f.planCode}
          onChange={(e) => setF({ ...f, planCode: e.target.value })}
        >
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="s-status" label="Status">
        <Select
          id="s-status"
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value as SubscriptionStatus })}
        >
          {(Object.keys(STATUS_LABEL) as SubscriptionStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="s-end" label="Paid until">
        <Input
          id="s-end"
          type="date"
          value={f.periodEnd}
          onChange={(e) => setF({ ...f, periodEnd: e.target.value })}
        />
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-3">
        Also sets the agency&apos;s seat and listing limits to the plan&apos;s.
      </p>
      <div className="sm:text-right">
        <Button type="submit">Set subscription</Button>
      </div>
    </form>
  );
}

export default function PlatformBillingPage() {
  const { me, request } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<PlatformBilling | null>(null);
  const [agencies, setAgencies] = useState<PlatformAgency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = me?.user.isPlatformAdmin === true;

  useEffect(() => {
    if (me && !isAdmin) router.replace('/app');
  }, [me, isAdmin, router]);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        router.replace('/app/security?required=1');
        return;
      }
      setError(err instanceof ApiError ? err.message : fallback);
    },
    [router],
  );

  const load = useCallback(async () => {
    try {
      const [b, a] = await Promise.all([
        request<PlatformBilling>('/platform/billing'),
        request<{ data: PlatformAgency[] }>('/platform/agencies'),
      ]);
      setData(b);
      setAgencies(a.data);
    } catch (err) {
      fail(err, 'Could not load billing.');
    }
  }, [request, fail]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function savePlan(code: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await request(`/platform/billing/plans/${code}`, { method: 'PUT', body });
      setNotice('Plan saved.');
      await load();
    } catch (err) {
      fail(err, 'Could not save the plan.');
      throw err;
    }
  }

  async function setSubscription(agencyId: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await request(`/platform/billing/agencies/${agencyId}/subscription`, {
        method: 'PUT',
        body,
      });
      setNotice('Subscription saved.');
      await load();
    } catch (err) {
      fail(err, 'Could not save the subscription.');
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <Link href="/app/admin" className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Platform admin
      </Link>
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <BadgeDollarSign className="h-6 w-6" aria-hidden /> Plans & billing
      </h1>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {data && !data.provider.configured ? (
        <Alert tone="info">
          No payment provider is connected yet, so agencies cannot pay online. Set subscriptions by
          hand below.
        </Alert>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <p className="text-xs text-muted-foreground">MRR (before VAT)</p>
              <p className="text-xl font-semibold tabular-nums">
                AED {data.metrics.mrrAed.toLocaleString('en-AE')}
              </p>
              {data.metrics.activeUnpriced > 0 ? (
                <p className="text-xs text-amber-700">
                  {data.metrics.activeUnpriced} active on unpriced plans
                </p>
              ) : null}
            </Card>
            <Card>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-xl font-semibold">{data.metrics.byStatus.active}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted-foreground">Trial</p>
              <p className="text-xl font-semibold">
                {data.metrics.byStatus.trialing + data.metrics.withoutSubscription}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted-foreground">Overdue / cancelled</p>
              <p className="text-xl font-semibold">
                {data.metrics.byStatus.past_due} / {data.metrics.byStatus.cancelled}
              </p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-2 font-medium">Plans</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Seats</th>
                  <th>Listings</th>
                  <th>AI replies</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.plans.map((p) => (
                  <PlanRow
                    key={`${p.code}:${p.priceMonthlyAed}:${p.seatLimit}:${p.listingLimit}:${p.aiRepliesMonthly}`}
                    plan={p}
                    onSave={savePlan}
                  />
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="flex flex-col gap-4">
            <h2 className="font-medium">Set an agency&apos;s subscription</h2>
            <SetSubscription agencies={agencies} plans={data.plans} onSave={setSubscription} />
          </Card>

          <Card>
            <h2 className="mb-2 font-medium">Subscriptions</h2>
            {data.subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None yet. Every agency is on its trial.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th>Agency</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Paid until</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscriptions.map((s) => (
                    <tr key={s.tenantId} className="border-b border-border">
                      <td className="py-2">{s.agencyName}</td>
                      <td>{data.plans.find((p) => p.code === s.planCode)?.name ?? s.planCode}</td>
                      <td>{STATUS_LABEL[s.status]}</td>
                      <td>{dateText(s.currentPeriodEnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}

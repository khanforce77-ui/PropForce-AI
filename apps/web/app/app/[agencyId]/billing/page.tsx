'use client';

import { CreditCard } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  dateText,
  limitText,
  priceText,
  STATUS_LABEL,
  VOICE_LABEL,
  type BillingOverview,
  type Meter,
} from '@/lib/billing';
import { cn } from '@/lib/utils';

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used.toLocaleString('en-AE')} / {limitText(limit)}
        </span>
      </div>
      {limit ? (
        <div className="h-2 rounded-full bg-muted" aria-hidden>
          <div
            className={cn('h-2 rounded-full', pct >= 90 ? 'bg-red-500' : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

const METER_LABEL: Record<Meter, string> = {
  ai_replies: 'AI replies',
  whatsapp_messages: 'WhatsApp messages sent',
};

function CapsForm({
  data,
  onSave,
}: {
  data: BillingOverview;
  onSave: (
    caps: { meter: Meter; monthlyLimit: number | null; action: 'warn' | 'block' }[],
  ) => Promise<void>;
}) {
  const init = (m: Meter) => {
    const c = data.caps.find((x) => x.meter === m);
    return { limit: c ? String(c.monthlyLimit) : '', action: c?.action ?? ('warn' as const) };
  };
  const [f, setF] = useState({
    ai_replies: init('ai_replies'),
    whatsapp_messages: init('whatsapp_messages'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave(
      (Object.keys(f) as Meter[]).map((m) => ({
        meter: m,
        monthlyLimit: f[m].limit.trim() === '' ? null : Number(f[m].limit),
        action: f[m].action,
      })),
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {(Object.keys(f) as Meter[]).map((m) => (
        <div key={m} className="grid gap-3 sm:grid-cols-3">
          <p className="self-end pb-2 text-sm font-medium">{METER_LABEL[m]}</p>
          <Field id={`cap-${m}`} label="Monthly limit (blank = none)">
            <Input
              id={`cap-${m}`}
              type="number"
              min={0}
              value={f[m].limit}
              onChange={(e) => setF({ ...f, [m]: { ...f[m], limit: e.target.value } })}
            />
          </Field>
          <Field id={`cap-${m}-a`} label="When reached">
            <Select
              id={`cap-${m}-a`}
              value={f[m].action}
              onChange={(e) =>
                setF({ ...f, [m]: { ...f[m], action: e.target.value as 'warn' | 'block' } })
              }
            >
              <option value="warn">Warn only</option>
              {m === 'ai_replies' ? (
                <option value="block">Stop AI replies (a person takes over)</option>
              ) : null}
            </Select>
          </Field>
        </div>
      ))}
      <div>
        <Button type="submit">Save limits</Button>
      </div>
    </form>
  );
}

export default function BillingPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const isOwner = membership?.role === 'owner';
  const [data, setData] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await request<BillingOverview>('/billing', { tenantId: agencyId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load billing.');
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(planCode: string) {
    setError(null);
    setNotice(null);
    try {
      const r = await request<{ url: string }>('/billing/checkout', {
        tenantId: agencyId,
        method: 'POST',
        body: { planCode },
      });
      window.location.assign(r.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the plan change.');
    }
  }

  async function saveCaps(
    caps: { meter: Meter; monthlyLimit: number | null; action: 'warn' | 'block' }[],
  ) {
    setError(null);
    try {
      await request('/billing/spending-caps', {
        tenantId: agencyId,
        method: 'PUT',
        body: { caps },
      });
      setNotice('Limits saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the limits.');
    }
  }

  if (!data) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }
  const s = data.subscription;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CreditCard className="h-6 w-6" aria-hidden /> Plan & billing
        </h1>
        <p className="text-sm text-muted-foreground">
          Your plan, what you have used this month, and limits on AI and WhatsApp spend.
        </p>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {!data.provider.configured ? (
        <Alert tone="info">
          Online payment is not set up yet. To change plan, contact PropForce and we will switch it
          for you.
        </Alert>
      ) : null}

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <p className="text-xl font-semibold">{data.plan?.name ?? s.planCode}</p>
            <p className="text-sm text-muted-foreground">
              {priceText(data.plan?.priceMonthlyAed ?? null)}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{STATUS_LABEL[s.status]}</p>
            {s.status === 'trialing' && s.trialEndsAt ? (
              <p>Trial ends {dateText(s.trialEndsAt)}</p>
            ) : null}
            {s.currentPeriodEnd ? <p>Renews {dateText(s.currentPeriodEnd)}</p> : null}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Meter
            label="Team members (incl. invitations)"
            used={data.usage.seats.used}
            limit={data.usage.seats.limit}
          />
          <Meter
            label="Listings"
            used={data.usage.listings.used}
            limit={data.usage.listings.limit}
          />
          <Meter
            label="AI replies this month"
            used={data.usage.aiReplies.used}
            limit={data.usage.aiReplies.included}
          />
          <Meter
            label="WhatsApp numbers"
            used={data.usage.whatsappNumbers.used}
            limit={data.usage.whatsappNumbers.limit}
          />
          <Meter
            label="WhatsApp messages sent this month"
            used={data.usage.whatsappMessages.used}
            limit={null}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Month started {dateText(data.periodStart)} (Dubai time).
        </p>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Plans</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.plans
            .filter((p) => p.code !== 'trial')
            .map((p) => {
              const current = p.code === s.planCode;
              return (
                <div
                  key={p.code}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border p-4',
                    current ? 'border-primary' : 'border-border',
                  )}
                >
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-sm">{priceText(p.priceMonthlyAed)}</p>
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <li>{limitText(p.seatLimit)} team members</li>
                    <li>{limitText(p.listingLimit)} listings</li>
                    <li>{limitText(p.aiRepliesMonthly)} AI replies / month</li>
                    <li>{limitText(p.whatsappNumbers)} WhatsApp numbers</li>
                    <li>Lead Booster: {p.leadBooster ? 'Yes' : '–'}</li>
                    <li>Voice agent: {VOICE_LABEL[p.voice]}</li>
                  </ul>
                  {current ? (
                    <p className="mt-auto text-sm font-medium text-primary">Your plan</p>
                  ) : isOwner && data.provider.configured && p.priceMonthlyAed != null ? (
                    <Button className="mt-auto" onClick={() => void choose(p.code)}>
                      Choose {p.name}
                    </Button>
                  ) : null}
                </div>
              );
            })}
        </div>
        <p className="text-xs text-muted-foreground">Prices are before 5% VAT.</p>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">Monthly limits</h2>
          <p className="text-sm text-muted-foreground">
            Set a ceiling on AI replies and WhatsApp messages. With “Stop AI replies”, new chats go
            to your team once the limit is reached.
          </p>
        </div>
        {data.caps.length > 0 ? (
          <ul className="text-sm">
            {data.caps.map((c) => (
              <li key={c.meter} className={cn(c.reached && 'font-medium text-red-600')}>
                {METER_LABEL[c.meter]}: {c.used.toLocaleString('en-AE')} of{' '}
                {c.monthlyLimit.toLocaleString('en-AE')}
                {c.reached ? ' (limit reached)' : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {isOwner ? (
          <CapsForm key={JSON.stringify(data.caps)} data={data} onSave={saveCaps} />
        ) : (
          <p className="text-sm text-muted-foreground">Only the agency owner can change limits.</p>
        )}
      </Card>
    </div>
  );
}

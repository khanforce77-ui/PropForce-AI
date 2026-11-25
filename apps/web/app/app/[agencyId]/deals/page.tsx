'use client';

import { Handshake } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type PropertyList } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { LeadSummary, Page } from '@/lib/crm';
import { DEAL_STAGE_LABEL, money, stagesFor, type Deal, type DealType } from '@/lib/deals';
import { cn } from '@/lib/utils';

function NewDeal({
  agencyId,
  type,
  leadId,
  onDone,
}: {
  agencyId: string;
  type: DealType;
  leadId: string | null;
  onDone: () => void;
}) {
  const { request } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [listings, setListings] = useState<PropertyList['data']>([]);
  const [form, setForm] = useState({
    leadId: leadId ?? '',
    propertyId: '',
    price: '',
    commissionMode: 'percent' as 'percent' | 'amount',
    commission: type === 'sale' ? '2' : '5',
    expectedCloseDate: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = { tenantId: agencyId };
    void request<Page<LeadSummary>>('/leads?open=true&limit=100', t)
      .then((r) => setLeads(r.data))
      .catch(() => setLeads([]));
    void request<PropertyList>(
      `/properties?listingType=${type === 'sale' ? 'sale' : 'rent'}&limit=100`,
      t,
    )
      .then((r) => setListings(r.data.filter((p) => ['active', 'under_offer'].includes(p.status))))
      .catch(() => setListings([]));
  }, [agencyId, request, type]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const c = Number(form.commission);
    try {
      const d = await request<Deal>('/deals', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          type,
          leadId: form.leadId,
          propertyId: form.propertyId || null,
          price: Number(form.price),
          ...(form.commissionMode === 'percent'
            ? { commissionPercent: c }
            : { commissionAmount: c }),
          expectedCloseDate: form.expectedCloseDate || null,
        },
      });
      router.push(`/app/${agencyId}/deals/${d.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the deal.');
    }
  };

  return (
    <Card>
      <h2 className="mb-4 font-medium">New {type} deal</h2>
      <form onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2">
        <Field id="d-lead" label={type === 'sale' ? 'Buyer (lead)' : 'Tenant (lead)'}>
          <Select
            id="d-lead"
            required
            value={form.leadId}
            onChange={(e) => setForm({ ...form, leadId: e.target.value })}
          >
            <option value="">Choose…</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.contact.fullName} · {l.intent}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="d-listing" label="Listing (optional)">
          <Select
            id="d-listing"
            value={form.propertyId}
            onChange={(e) => {
              const p = listings.find((x) => x.id === e.target.value);
              setForm({
                ...form,
                propertyId: e.target.value,
                price: form.price || (p?.price ? String(Number(p.price)) : ''),
              });
            }}
          >
            <option value="">None / off-market</option>
            {listings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.reference} · {p.title ?? p.community ?? p.emirate}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="d-price" label={type === 'sale' ? 'Agreed price (AED)' : 'Yearly rent (AED)'}>
          <Input
            id="d-price"
            type="number"
            min={1}
            required
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </Field>
        <div className="flex gap-2">
          <Field id="d-cmode" label="Commission">
            <Select
              id="d-cmode"
              value={form.commissionMode}
              onChange={(e) =>
                setForm({ ...form, commissionMode: e.target.value as 'percent' | 'amount' })
              }
            >
              <option value="percent">% of price</option>
              <option value="amount">Fixed AED</option>
            </Select>
          </Field>
          <Field id="d-comm" label={form.commissionMode === 'percent' ? 'Percent' : 'Amount'}>
            <Input
              id="d-comm"
              type="number"
              min={0}
              step="0.01"
              required
              value={form.commission}
              onChange={(e) => setForm({ ...form, commission: e.target.value })}
            />
          </Field>
        </div>
        <Field id="d-close" label="Expected close date">
          <Input
            id="d-close"
            type="date"
            value={form.expectedCloseDate}
            onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
          />
        </Field>
        {error ? <p className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit">Create deal</Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Deals() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const params = useSearchParams();
  const { request } = useAuth();
  const [type, setType] = useState<DealType>(params.get('type') === 'rental' ? 'rental' : 'sale');
  const [rows, setRows] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(params.has('leadId'));

  const load = useCallback(async () => {
    try {
      setRows(
        (await request<{ data: Deal[] }>(`/deals?type=${type}`, { tenantId: agencyId })).data,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load deals.');
    }
  }, [agencyId, request, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const stages = stagesFor(type);
  const open = (rows ?? []).filter((d) => d.stage !== 'completed' && d.stage !== 'fallen_through');
  const pipeline = open.reduce((a, d) => a + d.price, 0);
  const pipelineCommission = open.reduce((a, d) => a + d.commission.gross, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Handshake className="h-6 w-6" aria-hidden /> Deals
          </h1>
          <p className="text-sm text-muted-foreground">
            {open.length} open · pipeline {money(pipeline)} · expected commission{' '}
            {money(pipelineCommission)} (before VAT)
          </p>
        </div>
        <div className="flex gap-2">
          {(['sale', 'rental'] as const).map((t) => (
            <Button
              key={t}
              variant={type === t ? 'default' : 'outline'}
              onClick={() => {
                setType(t);
                setRows(null);
              }}
            >
              {t === 'sale' ? 'Sales' : 'Rentals'}
            </Button>
          ))}
          {!creating ? <Button onClick={() => setCreating(true)}>New deal</Button> : null}
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {creating ? (
        <NewDeal
          key={type}
          agencyId={agencyId}
          type={type}
          leadId={params.get('leadId')}
          onDone={() => setCreating(false)}
        />
      ) : null}

      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((s) => {
            const items = rows.filter((d) => d.stage === s);
            return (
              <section
                key={s}
                className={cn(
                  'flex w-64 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2',
                  s === 'fallen_through' && 'opacity-70',
                )}
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-medium">
                  {DEAL_STAGE_LABEL[s] ?? s}
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </h2>
                {items.map((d) => (
                  <Link
                    key={d.id}
                    href={`/app/${agencyId}/deals/${d.id}`}
                    className="rounded-lg border border-border bg-card p-2.5 text-sm hover:border-primary"
                  >
                    <p className="font-medium">{d.contact.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.reference}
                      {d.property ? ` · ${d.property.reference}` : ''}
                    </p>
                    <p className="mt-1 tabular-nums">{money(d.price)}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Commission {money(d.commission.gross)} · {d.agent.user.fullName}
                    </p>
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DealsPage() {
  return (
    <Suspense>
      <Deals />
    </Suspense>
  );
}

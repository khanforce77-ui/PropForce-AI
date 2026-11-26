'use client';

import { BadgeDollarSign } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import { aed, monthLabel, type RevenueReport } from '@/lib/revenue';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </Card>
  );
}

export default function RevenuePage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const router = useRouter();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const allowed = ['owner', 'admin', 'manager'].includes(membership?.role ?? '');
  const [months, setMonths] = useState(12);
  const [r, setR] = useState<RevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (membership && !allowed) router.replace(`/app/${agencyId}`);
  }, [membership, allowed, agencyId, router]);

  useEffect(() => {
    if (!allowed) return;
    request<RevenueReport>('/deals/revenue', { tenantId: agencyId, query: { months } })
      .then(setR)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the report.'),
      );
  }, [agencyId, months, allowed, request]);

  if (!allowed) return null;
  const max = r ? Math.max(1, ...r.series.map((m) => Math.max(m.earned, m.received))) : 1;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BadgeDollarSign className="h-6 w-6" aria-hidden /> Revenue
          </h1>
          <p className="text-sm text-muted-foreground">
            Commission from your{' '}
            <Link href={`/app/${agencyId}/deals`} className="text-primary underline">
              deals
            </Link>
            , in AED before VAT. Months follow Dubai time.
          </p>
        </div>
        <Select
          aria-label="Period"
          className="w-40"
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        >
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
          <option value={24}>Last 24 months</option>
        </Select>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {!r ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Tile
              label="Commission earned"
              value={aed(r.totals.earned)}
              note={`${r.totals.completedDeals} completed deal${r.totals.completedDeals === 1 ? '' : 's'}`}
            />
            <Tile label="Commission received" value={aed(r.totals.received)} />
            <Tile
              label="Still owed to you"
              value={aed(r.outstanding.notInvoiced + r.outstanding.invoicedUnpaid)}
              note={`${aed(r.outstanding.notInvoiced)} not invoiced · ${aed(r.outstanding.invoicedUnpaid)} invoiced`}
            />
            <Tile
              label="Open pipeline"
              value={aed(r.pipeline.sale.commission + r.pipeline.rental.commission)}
              note={`${r.pipeline.sale.deals} sale · ${r.pipeline.rental.deals} rental deals`}
            />
          </div>

          <Card>
            <h2 className="mb-1 font-medium">By month</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Earned counts a deal in the month it completed; received counts the month the
              commission was marked received.
            </p>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Month</th>
                  <th className="text-right">Deals</th>
                  <th className="text-right">Earned</th>
                  <th className="text-right">Invoiced</th>
                  <th className="text-right">Received</th>
                  <th className="hidden w-1/4 sm:table-cell" />
                </tr>
              </thead>
              <tbody>
                {[...r.series].reverse().map((m) => (
                  <tr key={m.month} className="border-b border-border">
                    <td className="py-2">{monthLabel(m.month)}</td>
                    <td className="text-right tabular-nums">{m.completedDeals}</td>
                    <td className="text-right tabular-nums">{aed(m.earned)}</td>
                    <td className="text-right tabular-nums">{aed(m.invoiced)}</td>
                    <td className="text-right tabular-nums">{aed(m.received)}</td>
                    <td className="hidden pl-4 sm:table-cell" aria-hidden>
                      <div className="flex flex-col gap-0.5">
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${(m.earned / max) * 100}%` }}
                        />
                        <div
                          className="h-1.5 rounded-full bg-emerald-500"
                          style={{ width: `${(m.received / max) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-full bg-primary" /> Earned
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-full bg-emerald-500" /> Received
              </span>
            </p>
          </Card>

          <Card>
            <h2 className="mb-1 font-medium">Who earned it</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Commission splits on deals completed in this period.
            </p>
            <table className="w-full text-left text-sm">
              <tbody>
                {r.team.map((p) => (
                  <tr key={p.membershipId} className="border-b border-border">
                    <td className="py-2">{p.name || 'Team member'}</td>
                    <td className="text-right tabular-nums">{aed(p.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b border-border">
                  <td className="py-2">Agency share</td>
                  <td className="text-right tabular-nums">{aed(r.totals.agencyShare)}</td>
                </tr>
                <tr>
                  <td className="py-2">Co-brokers</td>
                  <td className="text-right tabular-nums">{aed(r.totals.coBrokers)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

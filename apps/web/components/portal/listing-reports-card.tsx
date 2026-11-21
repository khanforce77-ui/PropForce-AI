'use client';

import { Flag } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { REPORT_REASON_LABEL } from './report-reasons';

interface ListingReport {
  id: string;
  reason: string;
  details: string | null;
  email: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  property: {
    id: string;
    reference: string;
    title: string | null;
    community: string | null;
    status: string;
    assigned: { id: string; user: { fullName: string } } | null;
  };
}

const STATUSES: ListingReport['status'][] = ['open', 'resolved', 'dismissed'];
const label = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * Visitors' reports about this agency's portal listings ("Report this listing"). Managers see
 * all of them; agents see reports on their own listings.
 */
export function ListingReportsCard({
  agencyId,
  isManager,
}: {
  agencyId: string;
  isManager: boolean;
}) {
  const { request } = useAuth();
  const [reports, setReports] = useState<ListingReport[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(0);
  const [filter, setFilter] = useState<string>('open');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await request<{ data: ListingReport[]; total: number; open: number }>(
        '/portal/reports',
        { tenantId: agencyId, query: { status: filter || undefined } },
      );
      setReports(r.data);
      setTotal(r.total);
      setOpen(r.open);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reports.');
    }
  }, [agencyId, filter, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    try {
      await request(`/portal/reports/${id}/status`, { tenantId: agencyId, body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the report.');
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium">
          <Flag className="h-4 w-4" aria-hidden /> Listing reports{' '}
          {open > 0 ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
              {open} open
            </span>
          ) : null}
        </h2>
        <Select
          aria-label="Filter reports by status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-40"
        >
          <option value="">All{filter ? '' : ` (${total})`}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Select>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Visitors can flag a listing as sold, wrongly priced, wrong photos or a possible scam. Fix
        the listing (or unpublish it), then mark the report resolved. PropForce admins also see
        these reports.
      </p>
      {error ? <Alert className="mt-3">{error}</Alert> : null}
      {reports.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {filter === 'open' ? 'No open reports. Good work.' : 'No reports.'}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {REPORT_REASON_LABEL[r.reason] ?? r.reason}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString('en-AE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  <Link
                    href={`/app/${agencyId}/listings/${r.property.id}`}
                    className="text-primary hover:underline"
                  >
                    {r.property.title ?? r.property.community ?? 'Listing'} · Ref{' '}
                    {r.property.reference}
                  </Link>
                  {isManager && r.property.assigned
                    ? ` · ${r.property.assigned.user.fullName}`
                    : ''}
                  {r.property.status !== 'active' ? ` · now ${r.property.status}` : ''}
                </p>
                {r.details ? <p className="text-sm whitespace-pre-line">{r.details}</p> : null}
                {r.email ? (
                  <a href={`mailto:${r.email}`} className="text-sm text-primary">
                    {r.email}
                  </a>
                ) : null}
              </div>
              <Select
                aria-label={`Status of report on ${r.property.reference}`}
                value={r.status}
                onChange={(e) => void setStatus(r.id, e.target.value)}
                className="w-36 shrink-0"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { REPORT_REASON_LABEL } from '@/components/portal/report-reasons';
import { Alert, Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface PlatformReport {
  id: string;
  reason: string;
  details: string | null;
  email: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  agency: { id: string; name: string };
  property: {
    id: string;
    reference: string;
    title: string | null;
    community: string | null;
    status: string;
  };
}

/** Every agency's listing reports, newest first (read-only; agencies resolve their own). */
export function AdminListingReports() {
  const { request } = useAuth();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<PlatformReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    request<{ data: PlatformReport[] }>('/platform/listing-reports', {
      query: { status: status || undefined },
    })
      .then((r) => live && setRows(r.data))
      .catch(
        (err: unknown) =>
          live && setError(err instanceof ApiError ? err.message : 'Could not load reports.'),
      );
    return () => {
      live = false;
    };
  }, [request, status]);

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-5">
        <p className="text-sm text-muted-foreground">
          Visitor reports from the public portal. The listing&apos;s agency resolves them; open a
          listing to act on it yourself.
        </p>
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-40"
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="">All</option>
        </Select>
      </div>
      {error ? <Alert className="mx-6 mt-3">{error}</Alert> : null}
      {rows === null ? (
        <p className="px-6 py-5 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-5 text-sm text-muted-foreground">No reports.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-6 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Listing</th>
                <th className="px-4 py-3 font-medium">Agency</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Reported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-muted/50">
                  <td className="px-6 py-3">
                    <p className="font-medium">{REPORT_REASON_LABEL[r.reason] ?? r.reason}</p>
                    {r.details ? (
                      <p className="max-w-sm text-xs whitespace-pre-line text-muted-foreground">
                        {r.details}
                      </p>
                    ) : null}
                    {r.email ? <p className="text-xs">{r.email}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/${r.agency.id}/listings/${r.property.id}`}
                      className="hover:underline"
                    >
                      {r.property.title ?? r.property.community ?? r.property.reference}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.property.reference} · {r.property.status}
                    </p>
                  </td>
                  <td className="px-4 py-3">{r.agency.name}</td>
                  <td className="px-4 py-3">{r.status}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleDateString('en-AE', { dateStyle: 'medium' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

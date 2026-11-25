'use client';

import { CheckCircle2, Circle, ExternalLink, FileText } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ApiError, type ListingCheck } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatPrice } from '@/lib/listings';
import { openPrivateFile } from './open-private-file';

interface ReviewRow {
  id: string;
  tenantId: string;
  reference: string;
  title: string | null;
  listingType: 'sale' | 'rent';
  propertyType: string;
  status: string;
  community: string | null;
  building: string | null;
  bedrooms: number | null;
  areaSqft: string | null;
  price: string | null;
  rentPeriod: 'yearly' | 'monthly' | null;
  description: string | null;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  reviewReason: string | null;
  submittedForReviewAt: string | null;
  reviewedAt: string | null;
  agency: { id: string; name: string; orn: string | null };
  assigned: {
    brn: string | null;
    brokerVerifiedUntil: string | null;
    user: { fullName: string };
  } | null;
  permits: {
    id: string;
    authority: string;
    purpose: 'sale' | 'rent' | null;
    permitNumber: string | null;
    validUntil: string;
    verificationUrl: string | null;
    document: { fileName: string } | null;
  }[];
  photoCount: number;
  openReports: number;
  checks: ListingCheck[];
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' });

/** DLD's own page for checking a Trakheesi permit by hand. */
const DLD_CHECK_URL =
  'https://dubailand.gov.ae/en/eservices/validate-real-estate-licenses-and-permits';

function ReviewCard({ row, onDone }: { row: ReviewRow; onDone: (msg: string) => void }) {
  const { request } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject' | 'send_back') {
    if (decision !== 'approve' && reason.trim().length < 3) {
      setError('Write a reason for the agency first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(`/platform/listings/${row.id}/review`, {
        body: { decision, ...(decision === 'approve' ? {} : { reason: reason.trim() }) },
      });
      onDone(
        decision === 'approve'
          ? `${row.reference} approved. It is on the portal now.`
          : decision === 'reject'
            ? `${row.reference} rejected and returned to draft.`
            : `${row.reference} taken off the portal for review.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  }

  const failedRequired = row.checks.some((c) => c.required && !c.ok);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {row.title || [row.building, row.community].filter(Boolean).join(', ') || row.reference}
          </p>
          <p className="text-sm text-muted-foreground">
            {row.reference} · {row.listingType === 'sale' ? 'Sale' : 'Rent'} · {row.propertyType}
            {row.bedrooms != null ? ` · ${row.bedrooms} bed` : ''}
            {row.areaSqft ? ` · ${Number(row.areaSqft).toLocaleString()} sqft` : ''} ·{' '}
            {formatPrice(row)}
          </p>
          <p className="text-sm text-muted-foreground">
            {row.agency.name}
            {row.agency.orn ? ` (ORN ${row.agency.orn})` : ''} · Agent:{' '}
            {row.assigned?.user.fullName ?? 'Unassigned'}
            {row.assigned?.brn ? ` (BRN ${row.assigned.brn})` : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            Sent {when(row.submittedForReviewAt)} · {row.photoCount} photos
            {row.openReports > 0 ? (
              <span className="font-medium text-red-600"> · {row.openReports} open reports</span>
            ) : null}
          </p>
        </div>
        <Link
          href={`/app/${row.agency.id}/listings/${row.id}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Open listing <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {row.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <Circle
                className={`mt-0.5 h-4 w-4 shrink-0 ${c.required ? 'text-red-600' : 'text-amber-500'}`}
                aria-hidden
              />
            )}
            <span>{c.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm">
        <p className="mb-1 font-medium">Permits</p>
        {row.permits.length === 0 ? <p className="text-muted-foreground">None</p> : null}
        <ul className="flex flex-col gap-1">
          {row.permits.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {p.authority} {p.permitNumber ?? '(no number)'}
                {p.purpose ? ` · for ${p.purpose}` : ''} · until {day(p.validUntil)}
              </span>
              {p.verificationUrl ? (
                <a
                  href={p.verificationUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  QR link <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
              {p.document ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={() =>
                    void openPrivateFile(() =>
                      request<Blob>(`/platform/listings/${row.id}/permits/${p.id}/document`, {
                        responseType: 'blob',
                      }),
                    ).catch(() => setError('Could not open the permit document.'))
                  }
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden /> Document
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <a
          href={DLD_CHECK_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Check the permit on DLD <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>

      {row.description ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Description</summary>
          <p className="mt-1 whitespace-pre-wrap">{row.description}</p>
        </details>
      ) : null}

      {row.reviewStatus !== 'pending' && row.reviewReason ? (
        <p className="mt-3 text-sm">Reason given: {row.reviewReason}</p>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Reason for the agency"
          placeholder="Reason for the agency (needed to reject)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-w-64 flex-1"
          maxLength={500}
        />
        {row.reviewStatus === 'pending' ? (
          <>
            <Button
              size="sm"
              disabled={busy || failedRequired}
              title={failedRequired ? 'A required check fails' : undefined}
              onClick={() => void decide('approve')}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void decide('reject')}
            >
              Reject
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void decide('send_back')}
          >
            Take off portal and review again
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Listings waiting for PropForce's review before they reach the public portal. */
export function AdminListingReview() {
  const { request } = useAuth();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await request<{ data: ReviewRow[] }>('/platform/listing-reviews', {
        query: { status },
      });
      setRows(r.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the review queue.');
    }
  }, [request, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          New agencies&apos; listings wait here before they appear on the portal. Check the permit
          on DLD, the photos and the details. Agencies with 10 approved listings skip review
          (Settings → platform.require_listing_review turns it off).
        </p>
        <Select
          aria-label="Filter by review status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="pending">Waiting</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {rows?.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {status === 'pending' ? 'Nothing waiting for review.' : 'No listings here.'}
          </p>
        </Card>
      ) : null}
      {rows?.map((row) => (
        <ReviewCard
          key={row.id}
          row={row}
          onDone={(msg) => {
            setNotice(msg);
            void load();
          }}
        />
      ))}
    </div>
  );
}

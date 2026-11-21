'use client';

import { BadgeCheck, EyeOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ListingForm } from '@/components/listings/listing-form';
import { ListingPhotos } from '@/components/listings/listing-photos';
import { PermitsCard, permitCounts } from '@/components/listings/permits-card';
import { StatusBadge } from '@/components/listings/status-badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError, type PropertyDetail, type PropertyStatus } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import { STATUS_LABEL, formatPrice, nextStatuses } from '@/lib/listings';

const ACTION_LABEL: Record<PropertyStatus, string> = {
  active: 'Publish',
  under_offer: 'Mark under offer',
  sold: 'Mark sold',
  rented: 'Mark rented',
  archived: 'Archive',
  draft: 'Restore to draft',
};

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' }) : '—';

function ListingDetail() {
  const { agencyId, propertyId } = useParams<{ agencyId: string; propertyId: string }>();
  const created = useSearchParams().get('created') === '1';
  const router = useRouter();
  const { request } = useAuth();
  const membership = useAgencyMembership();

  const [p, setP] = useState<PropertyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(created ? 'Draft saved.' : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const path = `/properties/${propertyId}`;
  const load = useCallback(async () => {
    try {
      setP(await request<PropertyDetail>(path, { tenantId: agencyId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the listing.');
    }
  }, [agencyId, path, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, success: string) {
    setError(null);
    setProblems([]);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setProblems((err.problem.errors ?? []).map((e) => `${e.path}: ${e.message}`));
      } else setError('Something went wrong.');
    }
  }

  if (!p)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );

  const canEdit =
    membership &&
    (['owner', 'admin', 'manager'].includes(membership.role) ||
      p.assignedMembershipId === membership.id);
  const isManager = ['owner', 'admin', 'manager'].includes(membership?.role ?? '');
  // Managers can delete any listing; agents only their own drafts.
  const canDelete = canEdit && (isManager || p.status === 'draft');

  // Why a published listing is not on the portal, if it is not.
  const hiddenBecause =
    p.status !== 'active'
      ? null
      : !p.permits.some(permitCounts)
        ? p.permits.length > 0
          ? 'its advertising permit has expired. Renew the permit below to bring it back.'
          : 'it has no valid advertising permit. Add one below.'
        : p.listingExpiresAt && new Date(p.listingExpiresAt) < new Date()
          ? 'nobody has confirmed it is still available. Press "Still available".'
          : null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href={`/app/${agencyId}/listings`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Listings
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {p.title || [p.building, p.community].filter(Boolean).join(', ') || p.reference}
          </h1>
          <StatusBadge status={p.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {p.reference} · {formatPrice(p)} · Agent: {p.assigned?.user.fullName ?? 'Unassigned'}
        </p>
        <p className="text-xs text-muted-foreground">
          Last verified {date(p.verifiedAt)}
          {p.status === 'active' ? ` · Re-check by ${date(p.listingExpiresAt)}` : ''}
        </p>
      </div>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {hiddenBecause ? <Alert>Not showing on the portal: {hiddenBecause}</Alert> : null}
      {error ? (
        <Alert>
          {error}
          {problems.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {problems.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {nextStatuses(p).map((s) => (
            <Button
              key={s}
              variant={s === 'active' ? 'default' : 'outline'}
              title={
                s === 'draft' && ['active', 'under_offer'].includes(p.status)
                  ? 'Take the listing off the portal; you can publish it again later'
                  : undefined
              }
              size="sm"
              onClick={() =>
                void act(
                  () => request(`${path}/status`, { tenantId: agencyId, body: { status: s } }),
                  s === 'draft' && ['active', 'under_offer'].includes(p.status)
                    ? 'Unpublished. The listing is no longer on the portal.'
                    : s === 'active'
                      ? 'Listing is now live.'
                      : `Listing is now ${STATUS_LABEL[s].toLowerCase()}.`,
                )
              }
            >
              {s === 'draft' && ['active', 'under_offer'].includes(p.status) ? (
                <>
                  <EyeOff className="h-4 w-4" aria-hidden /> Unpublish
                </>
              ) : (
                ACTION_LABEL[s]
              )}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void act(
                () => request(`${path}/verify`, { tenantId: agencyId, method: 'POST' }),
                'Marked as still available.',
              )
            }
          >
            <BadgeCheck className="h-4 w-4" aria-hidden /> Still available
          </Button>
          {canDelete ? (
            confirmDelete ? (
              <span className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() =>
                    void act(async () => {
                      await request(path, { tenantId: agencyId, method: 'DELETE' });
                      router.replace(`/app/${agencyId}/listings`);
                    }, 'Deleted.')
                  }
                >
                  Yes, delete this listing
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Delete listing
              </Button>
            )
          ) : null}
        </div>
      ) : null}

      <ListingPhotos agencyId={agencyId} propertyId={p.id} canEdit={Boolean(canEdit)} />

      <PermitsCard
        agencyId={agencyId}
        property={p}
        canEdit={Boolean(canEdit)}
        onChanged={async (message) => {
          setNotice(message);
          await load();
        }}
      />

      {canEdit ? (
        <Card>
          <h2 className="mb-4 font-medium">Details</h2>
          <ListingForm
            key={p.id + p.reference}
            initial={p}
            submitLabel="Save changes"
            onSubmit={async (body) => {
              await request(path, { tenantId: agencyId, method: 'PATCH', body });
              setNotice('Changes saved.');
              await load();
            }}
          />
        </Card>
      ) : null}
    </div>
  );
}

export default function ListingDetailPage() {
  return (
    <Suspense>
      <ListingDetail />
    </Suspense>
  );
}

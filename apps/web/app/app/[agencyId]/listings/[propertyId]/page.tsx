'use client';

import { BadgeCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ListingForm } from '@/components/listings/listing-form';
import { ListingPhotos } from '@/components/listings/listing-photos';
import { StatusBadge } from '@/components/listings/status-badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
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

  function onAddPermit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void act(
      () =>
        request(`${path}/permits`, {
          tenantId: agencyId,
          body: {
            authority: f.get('authority'),
            permitNumber: f.get('permitNumber'),
            validUntil: f.get('validUntil'),
          },
        }),
      'Permit added.',
    ).then(() => form.reset());
  }

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
              size="sm"
              onClick={() =>
                void act(
                  () => request(`${path}/status`, { tenantId: agencyId, body: { status: s } }),
                  `Listing is now ${STATUS_LABEL[s].toLowerCase()}.`,
                )
              }
            >
              {ACTION_LABEL[s]}
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
          {p.status === 'draft' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void act(async () => {
                  await request(path, { tenantId: agencyId, method: 'DELETE' });
                  router.replace(`/app/${agencyId}/listings`);
                }, 'Deleted.')
              }
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete draft
            </Button>
          ) : null}
        </div>
      ) : null}

      <ListingPhotos agencyId={agencyId} propertyId={p.id} canEdit={Boolean(canEdit)} />

      <Card>
        <h2 className="font-medium">Advertising permits</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add the permit issued by the regulator (for example a DLD Trakheesi permit in Dubai). We
          store what you enter; we do not check it with the regulator.
        </p>
        {p.permits.length > 0 ? (
          <ul className="mt-3 divide-y divide-border text-sm">
            {p.permits.map((permit) => {
              const expired = new Date(permit.validUntil) < new Date(new Date().toDateString());
              return (
                <li key={permit.id} className="flex items-center justify-between py-2">
                  <span>
                    {permit.authority} · {permit.permitNumber} ·{' '}
                    <span className={expired ? 'text-red-600' : 'text-muted-foreground'}>
                      {expired ? 'expired' : 'valid until'} {date(permit.validUntil)}
                    </span>
                  </span>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void act(
                          () =>
                            request(`${path}/permits/${permit.id}`, {
                              tenantId: agencyId,
                              method: 'DELETE',
                            }),
                          'Permit removed.',
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {canEdit ? (
          <form
            onSubmit={onAddPermit}
            className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr_10rem_auto] sm:items-end"
          >
            <Field id="authority" label="Authority">
              <Input
                id="authority"
                name="authority"
                defaultValue={p.emirate === 'Abu Dhabi' ? 'ADREC' : 'DLD'}
                required
              />
            </Field>
            <Field id="permitNumber" label="Permit number">
              <Input id="permitNumber" name="permitNumber" required />
            </Field>
            <Field id="validUntil" label="Valid until">
              <Input id="validUntil" name="validUntil" type="date" required />
            </Field>
            <Button type="submit" variant="outline">
              Add permit
            </Button>
          </form>
        ) : null}
      </Card>

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

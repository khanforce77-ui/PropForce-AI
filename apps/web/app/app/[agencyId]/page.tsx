'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/listings/status-badge';
import { Alert, Card } from '@/components/ui/card';
import { ApiError, type DashboardSummary, type PropertyList } from '@/lib/api';
import type { CrmSummary } from '@/lib/crm';
import { useAuth } from '@/lib/auth';
import { formatPrice } from '@/lib/listings';

function Stat({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | undefined;
  href?: string;
  hint?: string;
}) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:bg-muted/50">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value ?? '–'}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function DashboardPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { me, request } = useAuth();
  const m = me?.memberships.find((x) => x.agency.id === agencyId);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recent, setRecent] = useState<PropertyList | null>(null);
  const [crm, setCrm] = useState<CrmSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, r, c] = await Promise.all([
          request<DashboardSummary>('/dashboard/summary', { tenantId: agencyId }),
          request<PropertyList>('/properties', { tenantId: agencyId, query: { limit: 5 } }),
          request<CrmSummary>('/crm/summary', { tenantId: agencyId }),
        ]);
        setSummary(s);
        setRecent(r);
        setCrm(c);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.');
      }
    })();
  }, [agencyId, request]);

  if (!m) return null;
  const base = `/app/${agencyId}`;
  const l = summary?.listings;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome, {me?.user.fullName.split(' ')[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            {m.agency.name} · {m.agency.emirate}
          </p>
        </div>
        <Link
          href={`${base}/listings/new`}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add listing
        </Link>
      </div>

      {m.agency.approvalStatus === 'pending' ? (
        <Alert tone="info">
          Setup is complete and your agency is waiting for PropForce approval. You can add draft
          listings now; publishing and inviting your team open up once you are approved.
        </Alert>
      ) : null}
      {m.agency.status === 'pending' &&
      m.role === 'owner' &&
      m.agency.approvalStatus !== 'pending' ? (
        <Alert tone="info">
          Finish setting up your agency.{' '}
          <Link href={`${base}/onboarding`} className="font-medium underline">
            Continue onboarding
          </Link>
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}

      <section aria-label="Leads at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open leads" value={crm?.open} href={`${base}/leads`} />
        <Stat
          label="Follow-ups due today"
          value={crm?.followUpsDue}
          hint="Including overdue"
          href={`${base}/leads`}
        />
        <Stat label="New leads this week" value={crm?.newThisWeek} href={`${base}/leads`} />
        <Stat label="Contacts" value={crm?.contacts} href={`${base}/contacts`} />
      </section>

      <section aria-label="Listings at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live listings" value={l?.active} href={`${base}/listings`} />
        <Stat label="Drafts" value={l?.draft} href={`${base}/listings`} />
        <Stat label="Under offer" value={l?.underOffer} />
        <Stat
          label="Need re-checking"
          value={l?.needsVerification}
          hint="Live listings due for an availability check within 3 days"
        />
        <Stat label="My listings" value={l?.mine} href={`${base}/listings`} />
        <Stat label="Closed (sold + rented)" value={l ? l.sold + l.rented : undefined} />
        <Stat
          label="Active team"
          value={summary?.team.activeMembers}
          href={`${base}/settings/members`}
        />
        <Stat
          label="Pending invites"
          value={summary?.team.pendingInvitations}
          href={`${base}/settings/members`}
        />
      </section>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Recent listings</h2>
          <Link href={`${base}/listings`} className="text-sm underline">
            View all
          </Link>
        </div>
        {recent && recent.data.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No listings yet.{' '}
            <Link href={`${base}/listings/new`} className="underline">
              Add your first property
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {recent?.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <Link
                  href={`${base}/listings/${p.id}`}
                  className="min-w-0 truncate hover:underline"
                >
                  {p.title || [p.building, p.community].filter(Boolean).join(', ') || p.reference}
                </Link>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-muted-foreground">{formatPrice(p)}</span>
                  <StatusBadge status={p.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

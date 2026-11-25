'use client';

import { Check, Copy, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { StageBadge } from '@/components/crm/stage-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { bedsLabel, budgetLabel, type LeadIntent, type LeadStage } from '@/lib/crm';
import { bedroomsLabel, formatPrice, titleCase } from '@/lib/listings';
import { cn } from '@/lib/utils';

interface MatchBase {
  score: number;
  reasons: string[];
  gaps: string[];
}
interface MatchListing {
  id: string;
  reference: string;
  title: string | null;
  listingType: 'sale' | 'rent';
  propertyType: string;
  emirate: string;
  community: string | null;
  building: string | null;
  bedrooms: number | null;
  areaSqft: number | null;
  price: number | null;
  rentPeriod: 'yearly' | 'monthly' | null;
  agent: { id: string; fullName: string } | null;
}
interface ListingMatch extends MatchBase {
  listing: MatchListing;
  suggested: boolean;
}
interface LeadMatch extends MatchBase {
  lead: {
    id: string;
    intent: LeadIntent;
    stage: LeadStage;
    communities: string[];
    bedroomsMin: number | null;
    bedroomsMax: number | null;
    budgetMin: number | null;
    budgetMax: number | null;
    contact: { id: string; fullName: string };
    agent: { id: string; fullName: string } | null;
  };
}

const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL;

function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 80
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
      : score >= 60
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', tone)}>
      {score}% match
    </span>
  );
}

function Why({ m }: { m: MatchBase }) {
  return (
    <p className="mt-1 text-xs">
      {m.reasons.length ? (
        <span className="text-emerald-700 dark:text-emerald-400">{m.reasons.join(' · ')}</span>
      ) : null}
      {m.reasons.length && m.gaps.length ? ' · ' : null}
      {m.gaps.length ? (
        <span className="text-amber-700 dark:text-amber-400">{m.gaps.join(' · ')}</span>
      ) : null}
    </p>
  );
}

/** Live listings that fit a lead, with a one-tap "suggested" record and a shareable link. */
export function LeadMatches({ agencyId, leadId }: { agencyId: string; leadId: string }) {
  const { request } = useAuth();
  const [rows, setRows] = useState<ListingMatch[] | null>(null);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await request<{ data: ListingMatch[]; total?: number; message?: string }>(
        `/leads/${leadId}/matches?limit=10`,
        { tenantId: agencyId },
      );
      setRows(r.data);
      setTotal(r.total ?? r.data.length);
      setMessage(r.message ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load matching listings.');
    }
  }, [agencyId, leadId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const markSuggested = async (propertyId: string) => {
    setError(null);
    try {
      await request(`/leads/${leadId}/matches/${propertyId}/suggested`, {
        tenantId: agencyId,
        method: 'POST',
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that.');
    }
  };

  const copyLink = async (id: string) => {
    if (!portalUrl) return;
    await navigator.clipboard.writeText(`${portalUrl.replace(/\/$/, '')}/property/${id}`);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Matching listings
        </h2>
        {rows && total > rows.length ? (
          <span className="text-xs text-muted-foreground">
            Top {rows.length} of {total}
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {!rows ? (
        <p className="mt-3 text-sm text-muted-foreground">Finding listings…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {message ??
            'No live listing fits yet. Widen the budget, area or bedrooms, or check back when new listings go live.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((m) => (
            <li
              key={m.listing.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/app/${agencyId}/listings/${m.listing.id}`}
                    className="font-medium hover:underline"
                  >
                    {m.listing.title ??
                      `${titleCase(m.listing.propertyType)} in ${m.listing.community ?? m.listing.emirate}`}
                  </Link>
                  <ScorePill score={m.score} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {[
                    m.listing.reference,
                    formatPrice(m.listing),
                    bedroomsLabel(m.listing.bedrooms),
                    [m.listing.building, m.listing.community].filter(Boolean).join(', '),
                    m.listing.agent ? `Agent: ${m.listing.agent.fullName}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <Why m={m} />
              </div>
              <div className="flex gap-2">
                {portalUrl ? (
                  <Button variant="outline" size="sm" onClick={() => void copyLink(m.listing.id)}>
                    {copied === m.listing.id ? (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {copied === m.listing.id ? 'Copied' : 'Copy link'}
                  </Button>
                ) : null}
                {m.suggested ? (
                  <span className="inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5" aria-hidden /> Suggested
                  </span>
                ) : (
                  <Button size="sm" onClick={() => void markSuggested(m.listing.id)}>
                    Mark as suggested
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Open leads a listing fits (agents see only their own leads). */
export function ListingMatches({ agencyId, propertyId }: { agencyId: string; propertyId: string }) {
  const { request } = useAuth();
  const [rows, setRows] = useState<LeadMatch[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<{ data: LeadMatch[]; total: number }>(`/properties/${propertyId}/matches?limit=10`, {
      tenantId: agencyId,
    })
      .then((r) => {
        setRows(r.data);
        setTotal(r.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load matching leads.'),
      );
  }, [agencyId, propertyId, request]);

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Matching leads
        </h2>
        {rows && total > rows.length ? (
          <span className="text-xs text-muted-foreground">
            Top {rows.length} of {total}
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {!rows ? (
        <p className="mt-3 text-sm text-muted-foreground">Finding leads…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No open lead fits this listing yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((m) => (
            <li key={m.lead.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/app/${agencyId}/leads/${m.lead.id}`}
                    className="font-medium hover:underline"
                  >
                    {m.lead.contact.fullName}
                  </Link>
                  <ScorePill score={m.score} />
                  <StageBadge stage={m.lead.stage} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {[
                    budgetLabel(m.lead),
                    bedsLabel(m.lead),
                    m.lead.communities.join(', ') || null,
                    m.lead.agent ? `Agent: ${m.lead.agent.fullName}` : 'Unassigned',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <Why m={m} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { StageBadge } from '@/components/crm/stage-badge';
import { Alert, Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  bedsLabel,
  budgetLabel,
  INTENT_LABEL,
  OPEN_STAGES,
  STAGE_LABEL,
  STAGES,
  type LeadSummary,
  type Page,
} from '@/lib/crm';

const day = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' });

function LeadCard({ agencyId, lead }: { agencyId: string; lead: LeadSummary }) {
  const overdue = lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now();
  return (
    <li>
      <Link
        href={`/app/${agencyId}/leads/${lead.id}`}
        className="block rounded-lg border border-border bg-background p-3 text-sm shadow-sm hover:border-primary"
      >
        <p className="font-medium">{lead.contact.fullName}</p>
        <p className="text-xs text-muted-foreground">
          {INTENT_LABEL[lead.intent]}
          {lead.communities[0] ? ` · ${lead.communities[0]}` : ''}
        </p>
        <p className="mt-1 text-xs">
          {budgetLabel(lead)}
          {bedsLabel(lead) ? ` · ${bedsLabel(lead)}` : ''}
        </p>
        {lead.nextFollowUpAt ? (
          <p
            className={`mt-1 text-xs ${overdue ? 'font-medium text-red-600' : 'text-muted-foreground'}`}
          >
            Follow up {day(lead.nextFollowUpAt)}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {lead.assigned?.user.fullName ?? 'Unassigned'}
        </p>
      </Link>
    </li>
  );
}

export default function LeadsPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const [rows, setRows] = useState<LeadSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'open' | 'won' | 'lost'>('open');
  const [mine, setMine] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await request<Page<LeadSummary>>('/leads', {
        tenantId: agencyId,
        query: {
          q: q.trim() || undefined,
          open: view === 'open' ? 'true' : undefined,
          stage: view === 'open' ? undefined : view,
          mine: mine ? 'true' : undefined,
          limit: 100,
        },
      });
      setRows(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load leads.');
    } finally {
      setLoaded(true);
    }
  }, [agencyId, request, q, view, mine]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const columns = view === 'open' ? OPEN_STAGES : STAGES.filter((s) => s === view);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {loaded ? `${total} lead${total === 1 ? '' : 's'}` : 'Loading…'}
            {total > rows.length ? ` · showing the latest ${rows.length}` : ''}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          To add a lead, open a{' '}
          <Link href={`/app/${agencyId}/contacts`} className="underline">
            contact
          </Link>
          .
        </p>
      </div>

      <div className="grid max-w-4xl gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-center">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search leads"
            placeholder="Search by contact name, phone or email"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label="Which leads"
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
        >
          <option value="open">Open leads</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
          only
        </label>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {loaded && rows.length === 0 && !error ? (
        <Card className="max-w-4xl text-center">
          <p className="font-medium">No leads here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Leads you create from a contact, or that are assigned to you, show up here.
          </p>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((stage) => {
            const items = rows.filter((l) => l.stage === stage);
            return (
              <section
                key={stage}
                aria-label={STAGE_LABEL[stage]}
                className="flex w-64 shrink-0 flex-col gap-2 rounded-xl bg-muted p-2"
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-medium">
                  <StageBadge stage={stage} />
                  <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {items.map((l) => (
                    <LeadCard key={l.id} agencyId={agencyId} lead={l} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

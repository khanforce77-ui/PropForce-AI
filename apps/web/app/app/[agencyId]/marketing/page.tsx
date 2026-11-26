'use client';

import { Check, Copy, Megaphone, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type PropertyList, type PropertySummary } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  campaignLink,
  PLATFORM_LABEL,
  type Attribution,
  type Caption,
  type CaptionPlatform,
} from '@/lib/marketing';

const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL;
const textarea =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const label = (p: PropertySummary) =>
  `${p.reference} · ${p.title ?? [p.community, p.building].filter(Boolean).join(', ')}`;
const msg = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

function CaptionCard({
  c,
  onChange,
}: {
  c: Caption;
  onChange: (id: string, body: { status?: string; text?: string }) => Promise<void>;
}) {
  const [text, setText] = useState(c.text);
  const [copied, setCopied] = useState(false);
  const dirty = text !== c.text;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{PLATFORM_LABEL[c.platform]}</span>
        <span>· {c.property.reference}</span>
        <span>· {c.language === 'ar' ? 'Arabic' : 'English'}</span>
        <span
          className={
            c.status === 'approved'
              ? 'ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
          }
        >
          {c.status === 'approved' ? 'Approved' : 'Draft, needs review'}
        </span>
      </div>
      <textarea
        aria-label="Caption text"
        rows={Math.min(12, text.split('\n').length + 1)}
        maxLength={3000}
        dir={c.language === 'ar' ? 'rtl' : 'ltr'}
        className={textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        {dirty ? (
          <Button size="sm" onClick={() => void onChange(c.id, { text })}>
            Save edit
          </Button>
        ) : c.status === 'draft' ? (
          <Button size="sm" onClick={() => void onChange(c.id, { status: 'approved' })}>
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Approve
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={c.status !== 'approved' || dirty}
          title={c.status !== 'approved' ? 'Approve the caption before using it' : undefined}
          onClick={() =>
            void navigator.clipboard.writeText(c.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onChange(c.id, { status: 'discarded' })}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Discard
        </Button>
      </div>
    </li>
  );
}

function CampaignLinks({ listings }: { listings: PropertySummary[] }) {
  const [f, setF] = useState({ propertyId: '', source: '', medium: 'social', campaign: '' });
  const [copied, setCopied] = useState(false);
  const active = listings.filter((p) => p.status === 'active');
  const link =
    portalUrl && f.propertyId && f.source.trim() ? campaignLink(portalUrl, f.propertyId, f) : null;
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">Campaign links</h2>
        <p className="text-sm text-muted-foreground">
          Tag a portal link for an ad or post. Enquiries from it show the tags on the lead and in
          the report below.
        </p>
      </div>
      {!portalUrl ? (
        <Alert tone="info">The property portal address is not set for this app yet.</Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field id="cl-listing" label="Live listing">
              <Select
                id="cl-listing"
                value={f.propertyId}
                onChange={(e) => setF({ ...f, propertyId: e.target.value })}
              >
                <option value="">Choose…</option>
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="cl-source" label="Source" hint="e.g. instagram, facebook, google">
              <Input
                id="cl-source"
                maxLength={100}
                value={f.source}
                onChange={(e) => setF({ ...f, source: e.target.value })}
              />
            </Field>
            <Field id="cl-medium" label="Medium" hint="e.g. social, paid, email">
              <Input
                id="cl-medium"
                maxLength={100}
                value={f.medium}
                onChange={(e) => setF({ ...f, medium: e.target.value })}
              />
            </Field>
            <Field id="cl-campaign" label="Campaign" hint="e.g. marina-launch-dec">
              <Input
                id="cl-campaign"
                maxLength={100}
                value={f.campaign}
                onChange={(e) => setF({ ...f, campaign: e.target.value })}
              />
            </Field>
          </div>
          {link ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
                {link}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(link).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                }
              >
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Choose a live listing and a source.</p>
          )}
        </>
      )}
    </Card>
  );
}

function AttributionReport({ agencyId }: { agencyId: string }) {
  const { request } = useAuth();
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Attribution | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    request<Attribution>('/marketing/attribution', { tenantId: agencyId, query: { days } })
      .then(setData)
      .catch((err: unknown) => setError(msg(err, 'Could not load the report.')));
  }, [agencyId, days, request]);
  const table = (
    rows: { key: string; cells: (string | null)[]; leads: number; engaged: number; won: number }[],
    heads: string[],
  ) => (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          {heads.map((h) => (
            <th key={h}>{h}</th>
          ))}
          <th className="text-right">Leads</th>
          <th className="text-right">Qualified+</th>
          <th className="text-right">Won</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-border">
            {r.cells.map((c, i) => (
              <td key={i} className="py-2">
                {c ?? '—'}
              </td>
            ))}
            <td className="text-right tabular-nums">{r.leads}</td>
            <td className="text-right tabular-nums">{r.engaged}</td>
            <td className="text-right tabular-nums">{r.won}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-medium">Where leads come from</h2>
          <p className="text-sm text-muted-foreground">
            New leads by campaign link and by source, and how far they got.
          </p>
        </div>
        <Select
          aria-label="Period"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-36"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </Select>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {data ? (
        <>
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leads from campaign links in this period yet.
            </p>
          ) : (
            table(
              data.campaigns.map((c) => ({
                key: `${c.source}|${c.medium}|${c.campaign}`,
                cells: [c.source, c.medium, c.campaign],
                ...c,
              })),
              ['Source', 'Medium', 'Campaign'],
            )
          )}
          {data.sources.length > 0
            ? table(
                data.sources.map((s) => ({
                  key: s.source,
                  cells: [s.source.replace(/_/g, ' ')],
                  ...s,
                })),
                ['Lead source'],
              )
            : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </Card>
  );
}

export default function MarketingPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const canReport = ['owner', 'admin', 'manager'].includes(membership?.role ?? '');
  const [listings, setListings] = useState<PropertySummary[]>([]);
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const [f, setF] = useState({
    propertyId: '',
    platform: 'instagram' as CaptionPlatform,
    language: 'en',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([
        request<PropertyList>('/properties', { tenantId: agencyId, query: { limit: 100 } }),
        request<{ data: Caption[] }>('/marketing/captions', { tenantId: agencyId }),
      ]);
      setListings(l.data);
      setCaptions(c.data);
    } catch (err) {
      setError(msg(err, 'Could not load marketing.'));
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await request<Caption>('/marketing/captions', {
        tenantId: agencyId,
        method: 'POST',
        body: f,
      });
      setCaptions((cs) => [c, ...(cs ?? [])]);
    } catch (err) {
      setError(msg(err, 'Could not write a caption.'));
    } finally {
      setBusy(false);
    }
  }

  async function change(id: string, body: { status?: string; text?: string }) {
    setError(null);
    try {
      const c = await request<Caption>(`/marketing/captions/${id}`, {
        tenantId: agencyId,
        method: 'PATCH',
        body,
      });
      setCaptions((cs) =>
        c.status === 'discarded'
          ? (cs ?? []).filter((x) => x.id !== id)
          : (cs ?? []).map((x) => (x.id === id ? c : x)),
      );
    } catch (err) {
      setError(msg(err, 'Could not save the caption.'));
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Megaphone className="h-6 w-6" aria-hidden /> Marketing studio
        </h1>
        <p className="text-sm text-muted-foreground">
          AI captions for your listings, tagged campaign links and where your leads come from. For a
          printable brochure, open a listing and choose Brochure.
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium">AI captions</h2>
          <p className="text-sm text-muted-foreground">
            Written only from the listing&apos;s details, with the permit number and ORN added.
            Every caption is a draft until someone approves it. PropForce does not post anywhere.
          </p>
        </div>
        <form onSubmit={generate} className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Field id="cap-listing" label="Listing">
              <Select
                id="cap-listing"
                required
                value={f.propertyId}
                onChange={(e) => setF({ ...f, propertyId: e.target.value })}
              >
                <option value="">Choose…</option>
                {listings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field id="cap-platform" label="For">
            <Select
              id="cap-platform"
              value={f.platform}
              onChange={(e) => setF({ ...f, platform: e.target.value as CaptionPlatform })}
            >
              {(Object.keys(PLATFORM_LABEL) as CaptionPlatform[]).map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cap-lang" label="Language">
            <Select
              id="cap-lang"
              value={f.language}
              onChange={(e) => setF({ ...f, language: e.target.value })}
            >
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </Select>
          </Field>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={busy || !f.propertyId}>
              <Sparkles className="mr-1 h-4 w-4" aria-hidden />
              {busy ? 'Writing…' : 'Write caption'}
            </Button>
          </div>
        </form>
        {captions === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : captions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No captions yet.</p>
        ) : (
          <ul>
            {captions.map((c) => (
              <CaptionCard key={`${c.id}:${c.status}:${c.text.length}`} c={c} onChange={change} />
            ))}
          </ul>
        )}
      </Card>

      <CampaignLinks listings={listings} />
      {canReport ? <AttributionReport agencyId={agencyId} /> : null}
      <p className="text-xs text-muted-foreground">
        Landing pages: each listing&apos;s portal page is its landing page, with the consent form
        built in.{' '}
        <Link href={`/app/${agencyId}/portal`} className="text-primary underline">
          Property portal settings
        </Link>
      </p>
    </div>
  );
}

'use client';

import { Rocket } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Label, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CAMPAIGN_STATUS_LABEL, splitList, type Audience, type Campaign } from '@/lib/campaigns';
import { INTENT_LABEL, STAGE_LABEL, STAGES, type LeadIntent } from '@/lib/crm';

const INTENTS: LeadIntent[] = ['buy', 'rent', 'sell', 'let'];

export default function BoosterPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const router = useRouter();
  const { request } = useAuth();
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [senders, setSenders] = useState<{ id: string; displayPhoneNumber: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    whatsappAccountId: '',
    templateName: '',
    languageCode: 'en',
    params: '{first_name}',
    tags: '',
    communities: '',
    emirate: '',
    dailyLimit: 250,
  });
  const [stages, setStages] = useState<string[]>([]);
  const [intents, setIntents] = useState<string[]>([]);

  useEffect(() => {
    const t = { tenantId: agencyId };
    request<{ data: Campaign[] }>('/campaigns', t)
      .then((r) => setRows(r.data))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load campaigns.'),
      );
    request<{ data: { id: string; displayPhoneNumber: string }[] }>('/campaigns/senders', t)
      .then((r) => {
        setSenders(r.data);
        if (r.data[0])
          setForm((f) => ({ ...f, whatsappAccountId: f.whatsappAccountId || r.data[0]!.id }));
      })
      .catch(() => setSenders([]));
  }, [agencyId, request]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const audience: Audience = {};
    if (form.tags.trim()) audience.tags = splitList(form.tags);
    if (form.communities.trim()) audience.communities = splitList(form.communities);
    if (form.emirate) audience.emirate = form.emirate;
    if (stages.length) audience.stages = stages;
    if (intents.length) audience.intents = intents;
    try {
      const c = await request<Campaign>('/campaigns', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          name: form.name,
          whatsappAccountId: form.whatsappAccountId,
          templateName: form.templateName.trim(),
          languageCode: form.languageCode.trim(),
          bodyParams: form.params
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean),
          audience,
          dailyLimit: form.dailyLimit,
        },
      });
      router.push(`/app/${agencyId}/booster/${c.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the campaign.');
    }
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Rocket className="h-6 w-6" aria-hidden /> Lead Booster
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Send a Meta-approved WhatsApp template to a segment of your own contacts. Only contacts
            who agreed to WhatsApp marketing are messaged, an owner or admin must approve every
            campaign, and consent is checked again for each message.
          </p>
        </div>
        {!creating ? (
          <Button onClick={() => setCreating(true)} disabled={!senders.length}>
            New campaign
          </Button>
        ) : null}
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {!senders.length && rows ? (
        <Alert>
          Connect a WhatsApp number first (Settings → WhatsApp). Campaigns send from your own
          number.
        </Alert>
      ) : null}

      {creating ? (
        <Card>
          <h2 className="mb-4 font-medium">New campaign</h2>
          <form onSubmit={(e) => void create(e)} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="c-name" label="Campaign name">
                <Input
                  id="c-name"
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field id="c-from" label="Send from">
                <Select
                  id="c-from"
                  required
                  value={form.whatsappAccountId}
                  onChange={(e) => setForm({ ...form, whatsappAccountId: e.target.value })}
                >
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayPhoneNumber}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="c-template"
                label="Template name (as approved in Meta)"
                hint="Lowercase with underscores, e.g. new_listing_alert"
              >
                <Input
                  id="c-template"
                  required
                  pattern="[a-z0-9_]+"
                  value={form.templateName}
                  onChange={(e) => setForm({ ...form, templateName: e.target.value })}
                />
              </Field>
              <Field id="c-lang" label="Template language code" hint="en, en_US, ar…">
                <Input
                  id="c-lang"
                  required
                  value={form.languageCode}
                  onChange={(e) => setForm({ ...form, languageCode: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-params">
                Template variables, one per line ({'{{1}}'}, {'{{2}}'}…)
              </Label>
              <textarea
                id="c-params"
                rows={3}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.params}
                onChange={(e) => setForm({ ...form, params: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Use {'{first_name}'}, {'{full_name}'} or {'{agency_name}'} to personalise. The count
                must match the template in Meta.
              </p>
            </div>

            <h3 className="text-sm font-medium">Audience</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="c-tags" label="Contact tags (any of)">
                <Input
                  id="c-tags"
                  placeholder="investor, vip"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                />
              </Field>
              <Field id="c-comm" label="Lead communities (any of)">
                <Input
                  id="c-comm"
                  placeholder="Dubai Marina, JVC"
                  value={form.communities}
                  onChange={(e) => setForm({ ...form, communities: e.target.value })}
                />
              </Field>
              <Field id="c-emirate" label="Lead emirate">
                <Select
                  id="c-emirate"
                  value={form.emirate}
                  onChange={(e) => setForm({ ...form, emirate: e.target.value })}
                >
                  <option value="">Any</option>
                  <option>Dubai</option>
                </Select>
              </Field>
            </div>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-1 text-xs text-muted-foreground">Lead looking to</legend>
              {INTENTS.map((i) => (
                <label key={i} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={intents.includes(i)}
                    onChange={() => toggle(intents, setIntents, i)}
                  />
                  {INTENT_LABEL[i]}
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-1 text-xs text-muted-foreground">Lead stage</legend>
              {STAGES.map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={stages.includes(s)}
                    onChange={() => toggle(stages, setStages, s)}
                  />
                  {STAGE_LABEL[s]}
                </label>
              ))}
            </fieldset>
            <Field
              id="c-limit"
              label="Daily limit"
              hint="Most template messages per 24 hours. Meta's first tier allows 250 new conversations a day."
            >
              <Input
                id="c-limit"
                type="number"
                min={1}
                max={100000}
                className="max-w-40"
                value={form.dailyLimit}
                onChange={(e) => setForm({ ...form, dailyLimit: Number(e.target.value) })}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit">Save draft</Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card>
        <h2 className="font-medium">Campaigns</h2>
        {!rows ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-2">Name</th>
                <th>Status</th>
                <th className="text-right">Sent</th>
                <th className="text-right">Replied</th>
                <th className="text-right">Skipped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="py-2">
                    <Link
                      href={`/app/${agencyId}/booster/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{c.templateName}</p>
                  </td>
                  <td>{CAMPAIGN_STATUS_LABEL[c.status]}</td>
                  <td className="text-right tabular-nums">{c.counts.sent + c.counts.replied}</td>
                  <td className="text-right tabular-nums">{c.counts.replied}</td>
                  <td className="text-right tabular-nums">{c.counts.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

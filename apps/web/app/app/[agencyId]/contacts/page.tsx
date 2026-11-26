'use client';

import { ListPlus, MessageCircle, Phone, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BulkNumbersForm } from '@/components/crm/bulk-numbers';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  CHANNEL_LABEL,
  PURPOSE_LABEL,
  SOURCES,
  type ConsentChannel,
  type ConsentPurpose,
  type ContactSummary,
  type Page,
} from '@/lib/crm';
import { titleCase } from '@/lib/listings';

const CONSENT_OPTIONS: { channel: ConsentChannel; purpose: ConsentPurpose }[] = [
  { channel: 'whatsapp', purpose: 'service' },
  { channel: 'whatsapp', purpose: 'marketing' },
  { channel: 'email', purpose: 'marketing' },
  { channel: 'phone_call', purpose: 'service' },
];
const consentKey = (c: { channel: string; purpose: string }) => `${c.channel}:${c.purpose}`;

function AddContact({ agencyId, onCancel }: { agencyId: string; onCancel: () => void }) {
  const router = useRouter();
  const { request } = useAuth();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', source: 'manual' });
  const [consents, setConsents] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrors({});
    if (consents.size > 0 && method.trim().length === 0) {
      setErrors({ method: 'Say how they agreed, e.g. "asked on the phone"' });
      return;
    }
    setBusy(true);
    try {
      const created = await request<{ id: string }>('/contacts', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          fullName: form.fullName,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          source: form.source,
          consents: CONSENT_OPTIONS.filter((c) => consents.has(consentKey(c))).map((c) => ({
            ...c,
            method: method.trim(),
          })),
        },
      });
      router.push(`/app/${agencyId}/contacts/${created.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setErrors(err.fieldErrors);
      } else setError('Could not save the contact.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="font-medium">Add contact</h2>
      <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id="c-name" label="Full name" error={errors.fullName}>
          <Input
            id="c-name"
            required
            maxLength={120}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field id="c-source" label="Source">
          <Select
            id="c-source"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="c-phone"
          label="Phone"
          hint="UAE numbers like 050 123 4567 are fine"
          error={errors.phone}
        >
          <Input
            id="c-phone"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <Field id="c-email" label="Email" error={errors.email}>
          <Input
            id="c-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium">What did they agree to?</legend>
          <p className="text-xs text-muted-foreground">
            Tick only what the person actually agreed to. Without consent, no messages are sent.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {CONSENT_OPTIONS.map((c) => {
              const key = consentKey(c);
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={consents.has(key)}
                    onChange={(e) => {
                      const next = new Set(consents);
                      if (e.target.checked) next.add(key);
                      else next.delete(key);
                      setConsents(next);
                    }}
                  />
                  {CHANNEL_LABEL[c.channel]}: {PURPOSE_LABEL[c.purpose].toLowerCase()}
                </label>
              );
            })}
          </div>
        </fieldset>
        {consents.size > 0 ? (
          <div className="sm:col-span-2">
            <Field id="c-method" label="How did they agree?" error={errors.method}>
              <Input
                id="c-method"
                maxLength={120}
                placeholder="e.g. asked on the phone, web form, WhatsApp message"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
        {error ? <Alert className="sm:col-span-2">{error}</Alert> : null}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            Save contact
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function ContactsPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const [rows, setRows] = useState<ContactSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(
    async (after?: string) => {
      setError(null);
      try {
        const res = await request<Page<ContactSummary>>('/contacts', {
          tenantId: agencyId,
          query: { q: q.trim() || undefined, cursor: after },
        });
        setRows((prev) => (after ? [...prev, ...res.data] : res.data));
        setTotal(res.total);
        setCursor(res.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load contacts.');
      } finally {
        setLoaded(true);
      }
    },
    [agencyId, request, q],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {loaded ? `${total} contact${total === 1 ? '' : 's'}` : 'Loading…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!bulk ? (
            <Button variant="outline" onClick={() => setBulk(true)}>
              <ListPlus className="h-4 w-4" aria-hidden /> Add numbers in bulk
            </Button>
          ) : null}
          {!adding ? (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add contact
            </Button>
          ) : null}
        </div>
      </div>

      {adding ? <AddContact agencyId={agencyId} onCancel={() => setAdding(false)} /> : null}
      {bulk ? (
        <Card className="flex flex-col gap-3">
          <h2 className="font-medium">Add numbers in bulk</h2>
          <BulkNumbersForm
            agencyId={agencyId}
            channels={['phone_call', 'whatsapp']}
            consentLabel="These people agreed to be contacted by us by phone and WhatsApp about their property enquiry."
            submitLabel="Add numbers"
            onAdded={async () => {
              await load();
              return 'Use the WhatsApp and Call buttons in the list, or AI Calling to call them all.';
            }}
            onCancel={() => setBulk(false)}
          />
        </Card>
      ) : null}

      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label="Search contacts"
          placeholder="Search name, phone, email or tag"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {loaded && rows.length === 0 && !error ? (
        <Card className="text-center">
          <p className="font-medium">No contacts yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add buyers, tenants and landlords you are working with.
          </p>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Leads</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Contact</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/${agencyId}/contacts/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.fullName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {titleCase(c.source)}
                      {c.doNotContact ? ' · do not contact' : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{c.phoneE164 ?? '—'}</td>
                  <td className="px-4 py-3">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{c._count.leads}</td>
                  <td className="px-4 py-3">{c.owner?.user.fullName ?? '—'}</td>
                  <td className="px-4 py-3">
                    {c.phoneE164 && !c.doNotContact ? (
                      <div className="flex gap-1">
                        <a
                          href={`https://wa.me/${c.phoneE164.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`WhatsApp ${c.fullName}`}
                          title="Open in WhatsApp"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-green-600 hover:bg-muted"
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden />
                        </a>
                        <a
                          href={`tel:${c.phoneE164}`}
                          aria-label={`Call ${c.fullName}`}
                          title="Call"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-primary hover:bg-muted"
                        >
                          <Phone className="h-4 w-4" aria-hidden />
                        </a>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {cursor ? (
        <Button variant="outline" onClick={() => void load(cursor)} className="self-start">
          Load more
        </Button>
      ) : null}
    </div>
  );
}

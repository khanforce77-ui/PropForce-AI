'use client';

import { ArrowLeft, MessageCircle, Phone, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LeadForm } from '@/components/crm/lead-form';
import { AiCallCard } from '@/components/voice/ai-call-card';
import { StageBadge } from '@/components/crm/stage-badge';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  budgetLabel,
  canManageCrm,
  CHANNEL_LABEL,
  INTENT_LABEL,
  PURPOSE_LABEL,
  type ConsentState,
  type ContactDetail,
} from '@/lib/crm';
import { titleCase } from '@/lib/listings';
import { cn } from '@/lib/utils';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' });

const CONSENT_TONE = {
  granted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  withdrawn: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  unknown: 'bg-muted text-muted-foreground',
};

function ConsentRow({
  state,
  onRecord,
}: {
  state: ConsentState;
  onRecord: (status: 'granted' | 'withdrawn', method: string) => Promise<void>;
}) {
  const next = state.status === 'granted' ? 'withdrawn' : 'granted';
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `consent-${state.channel}-${state.purpose}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onRecord(next, method.trim());
      setOpen(false);
      setMethod('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          {CHANNEL_LABEL[state.channel]} · {PURPOSE_LABEL[state.purpose]}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              CONSENT_TONE[state.status],
            )}
          >
            {state.status === 'unknown' ? 'Not asked' : titleCase(state.status)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            {next === 'granted' ? 'Record consent' : 'Withdraw'}
          </Button>
        </span>
      </div>
      {open ? (
        <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-wrap items-end gap-2">
          <div className="flex min-w-60 flex-1 flex-col gap-1">
            <Label htmlFor={id}>
              {next === 'granted' ? 'How did they agree?' : 'How did they ask to stop?'}
            </Label>
            <Input
              id={id}
              required
              maxLength={120}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder={next === 'granted' ? 'e.g. asked on the phone' : 'e.g. replied STOP'}
            />
          </div>
          <Button type="submit" size="sm" disabled={busy || method.trim() === ''}>
            Save
          </Button>
        </form>
      ) : null}
    </li>
  );
}

export default function ContactPage() {
  const { agencyId, contactId } = useParams<{ agencyId: string; contactId: string }>();
  const router = useRouter();
  const { request } = useAuth();
  const role = useAgencyMembership()?.role;
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingLead, setAddingLead] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);

  const load = useCallback(async () => {
    try {
      setContact(await request<ContactDetail>(`/contacts/${contactId}`, { tenantId: agencyId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the contact.');
    }
  }, [agencyId, contactId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
    }
  };

  if (!contact) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link
        href={`/app/${agencyId}/contacts`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Contacts
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{contact.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {[contact.phoneE164, contact.email].filter(Boolean).join(' · ')}
        </p>
        <p className="text-xs text-muted-foreground">
          {titleCase(contact.source)} · owner {contact.owner?.user.fullName ?? 'none'}
        </p>
        {contact.phoneE164 && !contact.doNotContact ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`https://wa.me/${contact.phoneE164.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-green-700 hover:bg-muted dark:text-green-400"
            >
              <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp
            </a>
            <a
              href={`tel:${contact.phoneE164}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <Phone className="h-4 w-4" aria-hidden /> Call
            </a>
          </div>
        ) : null}
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Consent</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={contact.doNotContact}
              onChange={(e) =>
                void call(
                  () =>
                    request(`/contacts/${contactId}`, {
                      tenantId: agencyId,
                      method: 'PATCH',
                      body: { doNotContact: e.target.checked },
                    }),
                  e.target.checked ? 'Marked as do not contact.' : 'Do not contact removed.',
                )
              }
            />
            Do not contact
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Messages and calls are only allowed where consent is recorded. Every change is kept as
          history.
        </p>
        {contact.doNotContact ? (
          <Alert className="mt-3">This person must not be contacted on any channel.</Alert>
        ) : null}
        <ul className="mt-2 divide-y divide-border">
          {contact.consentState.map((s) => (
            <ConsentRow
              key={`${s.channel}:${s.purpose}`}
              state={s}
              onRecord={(status, method) =>
                call(
                  () =>
                    request(`/contacts/${contactId}/consents`, {
                      tenantId: agencyId,
                      method: 'POST',
                      body: { channel: s.channel, purpose: s.purpose, status, method },
                    }),
                  status === 'granted' ? 'Consent recorded.' : 'Consent withdrawn.',
                )
              }
            />
          ))}
        </ul>
        {contact.consents.length > 0 ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Consent history</summary>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {contact.consents.map((r) => (
                <li key={r.id}>
                  {when(r.createdAt)} · {CHANNEL_LABEL[r.channel]} {PURPOSE_LABEL[r.purpose]}:{' '}
                  {r.status} ({r.method})
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Leads</h2>
          {!addingLead ? (
            <Button size="sm" onClick={() => setAddingLead(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New lead
            </Button>
          ) : null}
        </div>
        {addingLead ? (
          <div className="mt-4">
            <LeadForm
              agencyId={agencyId}
              contactId={contactId}
              onCancel={() => setAddingLead(false)}
              onCreated={(id) => router.push(`/app/${agencyId}/leads/${id}`)}
            />
          </div>
        ) : null}
        {contact.leads.length === 0 && !addingLead ? (
          <p className="mt-2 text-sm text-muted-foreground">No leads for this contact yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {contact.leads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/app/${agencyId}/leads/${l.id}`} className="text-sm hover:underline">
                  {INTENT_LABEL[l.intent]} · {budgetLabel(l)}
                </Link>
                <StageBadge stage={l.stage} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AiCallCard
        agencyId={agencyId}
        contactId={contactId}
        hasPhone={!!contact.phoneE164}
        consentState={contact.consentState}
        leads={contact.leads.map((l) => ({
          id: l.id,
          label: `${INTENT_LABEL[l.intent]} · ${budgetLabel(l)}`,
        }))}
      />

      {canManageCrm(role) ? (
        <Card className="border-red-200 dark:border-red-900">
          <h2 className="font-medium">Erase contact</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permanently removes this person, their leads and consent history, for example when they
            ask to be forgotten. This cannot be undone.
          </p>
          {confirmErase ? (
            <div className="mt-3 flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  void request(`/contacts/${contactId}`, { tenantId: agencyId, method: 'DELETE' })
                    .then(() => router.replace(`/app/${agencyId}/contacts`))
                    .catch((err: unknown) =>
                      setError(err instanceof ApiError ? err.message : 'Could not erase.'),
                    )
                }
              >
                Yes, erase permanently
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmErase(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setConfirmErase(true)}
            >
              Erase contact
            </Button>
          )}
        </Card>
      ) : null}
    </div>
  );
}

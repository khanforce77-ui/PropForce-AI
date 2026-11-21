'use client';

import { ExternalLink, MessageCircle, Phone } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AgentPhoto } from '@/components/agent-photo';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';

interface PortalAgent {
  id: string;
  name: string;
  role: string;
  brn: string | null;
  publicPhoneE164: string | null;
  whatsappE164: string | null;
  last30Days: { enquiries: number; whatsappClicks: number; callClicks: number };
}

interface Enquiry {
  id: string;
  fullName: string;
  phoneE164: string;
  email: string | null;
  message: string;
  status: 'new' | 'contacted' | 'converted' | 'spam' | 'closed';
  consentMarketing: boolean;
  createdAt: string;
  property: { id: string; reference: string; title: string | null; community: string | null };
  agent: { id: string; user: { fullName: string } };
}

const STATUSES: Enquiry['status'][] = ['new', 'contacted', 'converted', 'closed', 'spam'];
const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL;

/** Remount the form when saved values change, so the inputs show the normalised numbers. */
const formKey = (a: PortalAgent) => [a.id, a.publicPhoneE164, a.whatsappE164, a.brn].join('|');

function ProfileForm({
  agent,
  onSave,
}: {
  agent: PortalAgent;
  onSave: (id: string, body: Record<string, string | null>) => Promise<void>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const val = (k: string) => String(f.get(k) ?? '').trim() || null;
    setErrors({});
    try {
      await onSave(agent.id, {
        publicPhoneE164: val('phone'),
        whatsappE164: val('whatsapp'),
        brn: val('brn'),
      });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      throw err;
    }
  }
  return (
    <form
      onSubmit={(e) => void submit(e).catch(() => {})}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end"
    >
      <Field id={`phone-${agent.id}`} label="Phone for calls" error={errors.publicPhoneE164}>
        <Input
          id={`phone-${agent.id}`}
          name="phone"
          defaultValue={agent.publicPhoneE164 ?? ''}
          placeholder="050 123 4567"
        />
      </Field>
      <Field id={`wa-${agent.id}`} label="WhatsApp" error={errors.whatsappE164}>
        <Input
          id={`wa-${agent.id}`}
          name="whatsapp"
          defaultValue={agent.whatsappE164 ?? ''}
          placeholder="050 123 4567"
        />
      </Field>
      <Field id={`brn-${agent.id}`} label="BRN" error={errors.brn}>
        <Input id={`brn-${agent.id}`} name="brn" defaultValue={agent.brn ?? ''} />
      </Field>
      <Button type="submit">Save</Button>
    </form>
  );
}

export default function PortalPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const isManager = ['owner', 'admin', 'manager'].includes(membership?.role ?? '');

  const [agents, setAgents] = useState<PortalAgent[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, e] = await Promise.all([
        request<{ data: PortalAgent[] }>('/portal/agents', { tenantId: agencyId }),
        request<{ data: Enquiry[]; total: number }>('/portal/enquiries', {
          tenantId: agencyId,
          query: { status: filter || undefined },
        }),
      ]);
      setAgents(a.data);
      setEnquiries(e.data);
      setTotal(e.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load portal data.');
    }
  }, [agencyId, filter, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile(id: string, body: Record<string, string | null>) {
    setError(null);
    setNotice(null);
    try {
      await request(`/portal/agents/${id}`, { tenantId: agencyId, method: 'PATCH', body });
      setNotice('Contact details saved. They now show on your public listings.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
      throw err;
    }
  }

  async function setStatus(id: string, status: string) {
    setError(null);
    try {
      await request(`/portal/enquiries/${id}/status`, { tenantId: agencyId, body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the enquiry.');
    }
  }

  const mine = agents.find((a) => a.id === membership?.id);
  const others = agents.filter((a) => a.id !== membership?.id);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Property portal</h1>
          <p className="text-sm text-muted-foreground">
            Your published listings with a valid permit appear on the public portal under the
            assigned agent. Enquiries, WhatsApp and call clicks arrive here.
          </p>
        </div>
        {portalUrl ? (
          <a
            href={`${portalUrl}/agency/${membership?.agency.slug ?? ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary"
          >
            View on portal <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        ) : null}
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      {mine ? (
        <Card>
          <h2 className="font-medium">Your public profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Visitors reach you on these numbers from your listings. Without a number, only the
            enquiry form is shown.
          </p>
          <div className="mt-4">
            <AgentPhoto agencyId={agencyId} membershipId={mine.id} name={mine.name} />
          </div>
          <div className="mt-4">
            <ProfileForm key={formKey(mine)} agent={mine} onSave={saveProfile} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Last 30 days: {mine.last30Days.enquiries} enquiries, {mine.last30Days.whatsappClicks}{' '}
            WhatsApp and {mine.last30Days.callClicks} call clicks.
          </p>
        </Card>
      ) : null}

      {isManager && others.length > 0 ? (
        <Card>
          <h2 className="font-medium">Team contact details</h2>
          <div className="mt-4 flex flex-col divide-y divide-border">
            {others.map((a) => (
              <div key={a.id} className="py-4 first:pt-0">
                <p className="mb-2 text-sm font-medium">
                  {a.name}{' '}
                  <span className="font-normal text-muted-foreground">
                    · {a.last30Days.enquiries} enquiries, {a.last30Days.whatsappClicks} WhatsApp,{' '}
                    {a.last30Days.callClicks} calls (30 days)
                  </span>
                </p>
                <div className="mb-3">
                  <AgentPhoto agencyId={agencyId} membershipId={a.id} name={a.name} />
                </div>
                <ProfileForm key={formKey(a)} agent={a} onSave={saveProfile} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">
            Enquiries <span className="text-muted-foreground">({total})</span>
          </h2>
          <Select
            aria-label="Filter by status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-44"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        {enquiries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No enquiries yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-border">
            {enquiries.map((q) => (
              <li key={q.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">
                    {q.fullName}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      {new Date(q.createdAt).toLocaleString('en-AE', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {q.property.title ?? q.property.community} · Ref {q.property.reference}
                    {isManager ? ` · ${q.agent.user.fullName}` : ''}
                  </p>
                  <p className="text-sm whitespace-pre-line">{q.message}</p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <a
                      href={`tel:${q.phoneE164}`}
                      className="inline-flex items-center gap-1 text-primary"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden /> {q.phoneE164}
                    </a>
                    <a
                      href={`https://wa.me/${q.phoneE164.replace('+', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary"
                    >
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
                    </a>
                    {q.email ? (
                      <a href={`mailto:${q.email}`} className="text-primary">
                        {q.email}
                      </a>
                    ) : null}
                    {q.consentMarketing ? (
                      <span className="text-xs text-muted-foreground">Agreed to offers</span>
                    ) : null}
                  </div>
                </div>
                <Select
                  aria-label={`Status of enquiry from ${q.fullName}`}
                  value={q.status}
                  onChange={(e) => void setStatus(q.id, e.target.value)}
                  className="w-36 shrink-0"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s[0]!.toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

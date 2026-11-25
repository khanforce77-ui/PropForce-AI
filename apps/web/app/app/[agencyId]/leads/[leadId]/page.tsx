'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LeadMatches } from '@/components/crm/matches';
import { StageBadge } from '@/components/crm/stage-badge';
import { LeadViewings } from '@/components/viewings/lead-viewings';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Label, Select } from '@/components/ui/input';
import { ApiError, type Member } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  bedsLabel,
  budgetLabel,
  canManageCrm,
  INTENT_LABEL,
  STAGE_LABEL,
  STAGES,
  type LeadActivity,
  type LeadDetail,
  type LeadStage,
} from '@/lib/crm';
import { titleCase } from '@/lib/listings';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' });

/** "2026-11-21T10:00" in UAE time, for a datetime-local input. */
const toUaeLocal = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 4 * 3_600_000).toISOString().slice(0, 16) : '';

function activityText(a: LeadActivity) {
  switch (a.type) {
    case 'created':
      return 'Lead created';
    case 'stage_changed':
      return `Stage: ${STAGE_LABEL[a.fromValue as LeadStage] ?? a.fromValue} → ${
        STAGE_LABEL[a.toValue as LeadStage] ?? a.toValue
      }${a.body ? ` (${a.body})` : ''}`;
    case 'assigned':
      return `Assigned to ${a.toValue ?? 'nobody'}`;
    default:
      return a.body ?? '';
  }
}

export default function LeadPage() {
  const { agencyId, leadId } = useParams<{ agencyId: string; leadId: string }>();
  const router = useRouter();
  const { request } = useAuth();
  const role = useAgencyMembership()?.role;
  const manage = canManageCrm(role);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nextStage, setNextStage] = useState<LeadStage | ''>('');
  const [lostReason, setLostReason] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const path = `/leads/${leadId}`;

  const load = useCallback(async () => {
    try {
      const l = await request<LeadDetail>(path, { tenantId: agencyId });
      setLead(l);
      setFollowUp(toUaeLocal(l.nextFollowUpAt));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the lead.');
    }
  }, [agencyId, path, request]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!manage) return;
    void request<{ data: Member[] }>('/members', { tenantId: agencyId })
      .then((r) => setMembers(r.data.filter((m) => m.status === 'active')))
      .catch(() => setMembers([]));
  }, [agencyId, manage, request]);

  const call = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.');
      return false;
    }
  };

  if (!lead) {
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );
  }

  const changeStage = async (e: FormEvent) => {
    e.preventDefault();
    if (!nextStage) return;
    const ok = await call(
      () =>
        request(`${path}/stage`, {
          tenantId: agencyId,
          method: 'POST',
          body: { stage: nextStage, lostReason: nextStage === 'lost' ? lostReason.trim() : null },
        }),
      `Moved to ${STAGE_LABEL[nextStage]}.`,
    );
    if (ok) {
      setNextStage('');
      setLostReason('');
    }
  };

  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await call(
      () => request(`${path}/notes`, { tenantId: agencyId, method: 'POST', body: { body: note } }),
      'Note added.',
    );
    if (ok) setNote('');
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link
        href={`/app/${agencyId}/leads`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Leads
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <Link href={`/app/${agencyId}/contacts/${lead.contact.id}`} className="hover:underline">
              {lead.contact.fullName}
            </Link>
          </h1>
          <p className="text-sm text-muted-foreground">
            {[lead.contact.phoneE164, lead.contact.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StageBadge stage={lead.stage} />
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="font-medium">What they want</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Looking to</dt>
            <dd>{INTENT_LABEL[lead.intent]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Budget</dt>
            <dd>{budgetLabel(lead)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Where</dt>
            <dd>{[lead.communities.join(', '), lead.emirate].filter(Boolean).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Property</dt>
            <dd>
              {[lead.propertyTypes.map(titleCase).join(', '), bedsLabel(lead)]
                .filter(Boolean)
                .join(' · ') || 'Any'}
            </dd>
          </div>
          {lead.property ? (
            <div>
              <dt className="text-muted-foreground">Asked about</dt>
              <dd>
                <Link href={`/app/${agencyId}/listings/${lead.property.id}`} className="underline">
                  {lead.property.title ?? lead.property.reference}
                </Link>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted-foreground">Source</dt>
            <dd>{titleCase(lead.source)}</dd>
          </div>
          {lead.lostReason ? (
            <div>
              <dt className="text-muted-foreground">Lost because</dt>
              <dd>{lead.lostReason}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {lead.stage !== 'won' && lead.stage !== 'lost' ? (
        <LeadMatches agencyId={agencyId} leadId={lead.id} />
      ) : null}

      <Card>
        <h2 className="font-medium">Next step</h2>
        <form onSubmit={(e) => void changeStage(e)} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="stage">Move to stage</Label>
            <Select
              id="stage"
              value={nextStage}
              onChange={(e) => setNextStage(e.target.value as LeadStage)}
            >
              <option value="">Choose…</option>
              {STAGES.filter((s) => s !== lead.stage).map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
          </div>
          {nextStage === 'lost' ? (
            <div className="flex min-w-60 flex-1 flex-col gap-1">
              <Label htmlFor="lost-reason">Why was it lost?</Label>
              <Input
                id="lost-reason"
                required
                maxLength={500}
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
              />
            </div>
          ) : null}
          <Button type="submit" disabled={!nextStage}>
            Update stage
          </Button>
        </form>

        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void call(
              () =>
                request(path, {
                  tenantId: agencyId,
                  method: 'PATCH',
                  body: { nextFollowUpAt: followUp ? `${followUp}:00+04:00` : null },
                }),
              followUp ? 'Follow-up saved.' : 'Follow-up cleared.',
            );
          }}
        >
          <Field id="follow-up" label="Next follow-up (UAE time)">
            <Input
              id="follow-up"
              type="datetime-local"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline">
            Save follow-up
          </Button>
        </form>

        {manage ? (
          <div className="mt-4 flex flex-col gap-1">
            <Label htmlFor="assign">Assigned agent</Label>
            <Select
              id="assign"
              className="max-w-xs"
              value={lead.assigned?.id ?? ''}
              onChange={(e) =>
                void call(
                  () =>
                    request(`${path}/assign`, {
                      tenantId: agencyId,
                      method: 'POST',
                      body: { membershipId: e.target.value || null },
                    }),
                  'Lead reassigned.',
                )
              }
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user.fullName}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Assigned to {lead.assigned?.user.fullName ?? 'nobody'}
          </p>
        )}
      </Card>

      <LeadViewings
        agencyId={agencyId}
        leadId={lead.id}
        propertyId={lead.property?.id ?? null}
        canAssign={manage}
        open={lead.stage !== 'won' && lead.stage !== 'lost'}
        onChanged={async (message) => {
          setNotice(message);
          await load();
        }}
      />

      <Card>
        <h2 className="font-medium">Timeline</h2>
        <form onSubmit={(e) => void addNote(e)} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex min-w-60 flex-1 flex-col gap-1">
            <Label htmlFor="note">Add a note</Label>
            <Input
              id="note"
              maxLength={4000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={note.trim() === ''}>
            Add note
          </Button>
        </form>
        <ul className="mt-4 divide-y divide-border text-sm">
          {lead.activities.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{activityText(a)}</span>
              <span className="text-xs text-muted-foreground">{when(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {manage ? (
        confirmDelete ? (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                void request(path, { tenantId: agencyId, method: 'DELETE' })
                  .then(() => router.replace(`/app/${agencyId}/leads`))
                  .catch((err: unknown) =>
                    setError(err instanceof ApiError ? err.message : 'Could not delete the lead.'),
                  )
              }
            >
              Yes, delete this lead
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-red-600"
            onClick={() => setConfirmDelete(true)}
          >
            Delete lead
          </Button>
        )
      ) : null}
    </div>
  );
}

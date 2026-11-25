'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type Member, type PropertyList } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { LeadSummary, Page } from '@/lib/crm';
import { cn } from '@/lib/utils';
import { addDays, timeLabel, uaeDate } from '@/lib/viewings';

interface Slot {
  start: string;
  end: string;
}

/**
 * Book a viewing: pick the lead (unless fixed), a live listing, the agent (managers), a UAE day
 * and one of the agent's free slots, or type any time.
 */
export function BookViewing({
  agencyId,
  leadId,
  defaultPropertyId,
  canAssign,
  onBooked,
  onCancel,
}: {
  agencyId: string;
  /** Fixed lead (lead page). Without it a lead picker is shown. */
  leadId?: string;
  defaultPropertyId?: string | null;
  canAssign: boolean;
  onBooked: (message: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { request } = useAuth();
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [listings, setListings] = useState<PropertyList['data']>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [lead, setLead] = useState(leadId ?? '');
  const [property, setProperty] = useState(defaultPropertyId ?? '');
  const [agent, setAgent] = useState('');
  const [day, setDay] = useState(uaeDate(new Date(Date.now() + 86_400_000)));
  const [duration, setDuration] = useState(30);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [status, setStatus] = useState<'confirmed' | 'requested'>('confirmed');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = { tenantId: agencyId };
    void request<PropertyList>('/properties?status=active&limit=100', t)
      .then((r) => setListings(r.data))
      .catch(() => setListings([]));
    if (!leadId) {
      void request<Page<LeadSummary>>('/leads?open=true&limit=100', t)
        .then((r) => setLeads(r.data))
        .catch(() => setLeads([]));
    }
    if (canAssign) {
      void request<{ data: Member[] }>('/members', t)
        .then((r) => setMembers(r.data.filter((m) => m.status === 'active')))
        .catch(() => setMembers([]));
    }
  }, [agencyId, canAssign, leadId, request]);

  useEffect(() => {
    setSlots(null);
    setStart('');
    const q = new URLSearchParams({ date: day, durationMinutes: String(duration) });
    if (agent) q.set('agentMembershipId', agent);
    void request<{ slots: Slot[] }>(`/viewings/availability?${q}`, { tenantId: agencyId })
      .then((r) => setSlots(r.slots))
      .catch(() => setSlots([]));
  }, [agencyId, agent, day, duration, request]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const startsAt = manualTime ? `${day}T${manualTime}:00+04:00` : start;
    if (!startsAt) {
      setError('Pick a free time or type one.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request('/viewings', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          leadId: lead,
          propertyId: property,
          startsAt,
          durationMinutes: duration,
          status,
          notes: notes.trim() || null,
          ...(agent ? { agentMembershipId: agent } : {}),
        },
      });
      await onBooked(status === 'confirmed' ? 'Viewing booked.' : 'Time held as requested.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not book the viewing.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {!leadId ? (
          <Field id="bv-lead" label="Client (open lead)">
            <Select id="bv-lead" required value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">Choose…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.contact.fullName} · {l.intent}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="bv-listing" label="Listing">
          <Select
            id="bv-listing"
            required
            value={property}
            onChange={(e) => setProperty(e.target.value)}
          >
            <option value="">Choose…</option>
            {listings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.reference} · {p.title ?? [p.building, p.community].filter(Boolean).join(', ')}
              </option>
            ))}
          </Select>
        </Field>
        {canAssign ? (
          <Field id="bv-agent" label="Agent">
            <Select id="bv-agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">Lead&apos;s agent (or me)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="bv-day" label="Day (UAE)">
          <Input
            id="bv-day"
            type="date"
            required
            min={uaeDate(new Date())}
            max={addDays(uaeDate(new Date()), 90)}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </Field>
        <Field id="bv-duration" label="Length">
          <Select
            id="bv-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {[15, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <p className="text-sm font-medium">Free times</p>
        {slots === null ? (
          <p className="mt-1 text-xs text-muted-foreground">Checking the calendar…</p>
        ) : slots.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No free time in working hours (Mon–Sat, 9 am–7 pm) on this day. Type a time below.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {slots.map((s) => (
              <button
                type="button"
                key={s.start}
                onClick={() => {
                  setStart(s.start);
                  setManualTime('');
                }}
                className={cn(
                  'rounded-md border border-border px-2.5 py-1 text-xs tabular-nums hover:bg-muted',
                  start === s.start && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {timeLabel(s.start)}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">or another time:</span>
          <Input
            type="time"
            aria-label="Other time (UAE)"
            className="h-8 w-32"
            value={manualTime}
            onChange={(e) => {
              setManualTime(e.target.value);
              setStart('');
            }}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bv-status" label="Status">
          <Select
            id="bv-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'confirmed' | 'requested')}
          >
            <option value="confirmed">Confirmed with the client</option>
            <option value="requested">Hold the time (client to confirm)</option>
          </Select>
        </Field>
        <Field id="bv-notes" label="Notes (optional)">
          <Input
            id="bv-notes"
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Keys with security, parking B2…"
          />
        </Field>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !property || !lead}>
          Book viewing
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Close
          </Button>
        ) : null}
      </div>
    </form>
  );
}

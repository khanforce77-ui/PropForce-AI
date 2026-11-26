'use client';

import { PhoneOutgoing } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ConsentState } from '@/lib/crm';
import {
  dubaiInputToIso,
  nextCallingStart,
  notReadyReason,
  when,
  type AiCallingStatus,
  type CallScript,
} from '@/lib/voice';

/** "Call with AI" on a contact: pick one of the agency's scripts and place the call. */
export function AiCallCard({
  agencyId,
  contactId,
  hasPhone,
  consentState,
  leads,
}: {
  agencyId: string;
  contactId: string;
  hasPhone: boolean;
  consentState: ConsentState[];
  leads: { id: string; label: string }[];
}) {
  const { request } = useAuth();
  const [status, setStatus] = useState<AiCallingStatus | null>(null);
  const [scripts, setScripts] = useState<CallScript[] | null>(null);
  const [scriptId, setScriptId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [later, setLater] = useState(false);
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, list] = await Promise.all([
          request<AiCallingStatus>('/ai-calling/status', { tenantId: agencyId }),
          request<{ data: CallScript[] }>('/ai-calling/scripts', { tenantId: agencyId }),
        ]);
        setStatus(s);
        setAt((cur) => cur || nextCallingStart(s.callingHours.from));
        const active = list.data.filter((x) => x.active);
        setScripts(active);
        setScriptId((cur) => cur || active[0]?.id || '');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load AI calling.');
      }
    })();
  }, [agencyId, request]);

  const script = scripts?.find((s) => s.id === scriptId);
  const consent = script
    ? consentState.find((c) => c.channel === 'phone_call' && c.purpose === script.purpose)
    : undefined;
  const blocked = notReadyReason(status);

  async function call() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const scheduledAt = later && at ? dubaiInputToIso(at) : null;
      await request('/ai-calling/calls', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          contactId,
          scriptId,
          ...(leadId ? { leadId } : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
        },
      });
      setNotice(
        scheduledAt
          ? `Call booked for ${when(scheduledAt)} Dubai time. It shows in the call log.`
          : 'Calling now. The result appears in the call log when the call ends.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the call.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-medium">
        <PhoneOutgoing className="h-4 w-4" aria-hidden /> Call with AI
      </h2>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {blocked ? <p className="text-sm text-muted-foreground">{blocked}</p> : null}
      {!hasPhone ? (
        <p className="text-sm text-muted-foreground">Add a phone number to call this contact.</p>
      ) : scripts && scripts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No call scripts yet.{' '}
          <Link href={`/app/${agencyId}/ai-calling`} className="text-primary underline">
            Write one
          </Link>
          .
        </p>
      ) : scripts ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ai-script" label="Script">
            <Select id="ai-script" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          {leads.length ? (
            <Field id="ai-lead" label="About lead (optional)">
              <Select id="ai-lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">None</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="flex flex-col gap-2 sm:col-span-2">
            {consent && consent.status !== 'granted' ? (
              <p className="text-sm text-muted-foreground">
                Needs phone call consent (
                {script?.purpose === 'marketing' ? 'marketing' : 'service'}) recorded above before
                the AI can call.
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <Field id="ai-when" label="When">
                <Select
                  id="ai-when"
                  value={later ? 'later' : 'now'}
                  onChange={(e) => setLater(e.target.value === 'later')}
                >
                  <option value="now">Call now</option>
                  <option value="later">Schedule for later</option>
                </Select>
              </Field>
              {later ? (
                <Field id="ai-at" label="Date and time (Dubai)">
                  <Input
                    id="ai-at"
                    type="datetime-local"
                    value={at}
                    onChange={(e) => setAt(e.target.value)}
                  />
                </Field>
              ) : null}
              <Button
                onClick={() => void call()}
                disabled={
                  busy || !scriptId || !!blocked || consent?.status !== 'granted' || (later && !at)
                }
              >
                {busy ? 'Starting…' : later ? 'Schedule call' : 'Call now'}
              </Button>
            </div>
            {status ? (
              <p className="text-xs text-muted-foreground">
                Calls are placed {status.callingHours.from}:00 to {status.callingHours.to}:00 Dubai
                time, at most {status.limits.perDay} a day and {status.limits.perWeek} a week per
                person. The AI says it is an AI at the start of every call.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </Card>
  );
}

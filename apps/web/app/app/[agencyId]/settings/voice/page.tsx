'use client';

import { Phone } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { TranscriptPolicy, VoiceLine } from '@/lib/voice';

const POLICY: Record<TranscriptPolicy, string> = {
  summary_only: 'Summary only',
  full_transcript: 'Summary and full transcript',
};

export default function VoiceSettingsPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const [lines, setLines] = useState<VoiceLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [f, setF] = useState({
    providerPhoneNumberId: '',
    phoneE164: '',
    label: '',
    transcriptPolicy: 'summary_only' as TranscriptPolicy,
  });

  const load = useCallback(async () => {
    try {
      setLines((await request<{ data: VoiceLine[] }>('/voice/lines', { tenantId: agencyId })).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load voice lines.');
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await request('/voice/lines', {
        tenantId: agencyId,
        method: 'POST',
        body: {
          providerPhoneNumberId: f.providerPhoneNumberId,
          ...(f.phoneE164 ? { phoneE164: f.phoneE164 } : {}),
          ...(f.label ? { label: f.label } : {}),
          transcriptPolicy: f.transcriptPolicy,
        },
      });
      setNotice('Line added.');
      setF({ ...f, providerPhoneNumberId: '', phoneE164: '', label: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the line.');
    }
  }

  async function update(id: string, body: Partial<Pick<VoiceLine, 'transcriptPolicy' | 'active'>>) {
    setError(null);
    try {
      await request(`/voice/lines/${id}`, { tenantId: agencyId, method: 'PATCH', body });
      setNotice('Saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Phone className="h-6 w-6" aria-hidden /> AI voice
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect the phone numbers your Vapi assistant answers. After each call, PropForce saves
          the caller, duration and AI summary, and adds new callers as contacts (without marketing
          consent). Outbound AI calling stays off until PropForce has verified the approvals.
        </p>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <Alert tone="info">
        Your assistant must tell callers they are speaking with an AI, and ask for consent before
        recording. Set this in the assistant&apos;s first message and recording settings in Vapi.
      </Alert>

      <Card className="flex flex-col gap-3">
        <h2 className="font-medium">Lines</h2>
        {!lines ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lines yet.</p>
        ) : (
          <ul>
            {lines.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3 last:border-b-0"
              >
                <div>
                  <p className="font-medium">
                    {l.label ?? l.phoneE164 ?? l.providerPhoneNumberId}
                    {!l.active ? (
                      <span className="ml-2 text-xs text-muted-foreground">(off)</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {l.phoneE164 ?? '–'} · Vapi ID {l.providerPhoneNumberId}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label="Transcript policy"
                    value={l.transcriptPolicy}
                    onChange={(e) =>
                      void update(l.id, { transcriptPolicy: e.target.value as TranscriptPolicy })
                    }
                  >
                    {(Object.keys(POLICY) as TranscriptPolicy[]).map((p) => (
                      <option key={p} value={p}>
                        {POLICY[p]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => void update(l.id, { active: !l.active })}
                  >
                    {l.active ? 'Switch off' : 'Switch on'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">Add a line</h2>
        <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-2">
          <Field id="v-id" label="Vapi phone number ID">
            <Input
              id="v-id"
              required
              value={f.providerPhoneNumberId}
              onChange={(e) => setF({ ...f, providerPhoneNumberId: e.target.value })}
            />
          </Field>
          <Field id="v-phone" label="Phone number (optional)">
            <Input
              id="v-phone"
              placeholder="+9714…"
              value={f.phoneE164}
              onChange={(e) => setF({ ...f, phoneE164: e.target.value })}
            />
          </Field>
          <Field id="v-label" label="Label (optional)">
            <Input
              id="v-label"
              value={f.label}
              onChange={(e) => setF({ ...f, label: e.target.value })}
            />
          </Field>
          <Field id="v-policy" label="Keep">
            <Select
              id="v-policy"
              value={f.transcriptPolicy}
              onChange={(e) => setF({ ...f, transcriptPolicy: e.target.value as TranscriptPolicy })}
            >
              {(Object.keys(POLICY) as TranscriptPolicy[]).map((p) => (
                <option key={p} value={p}>
                  {POLICY[p]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">Add line</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

'use client';

import { Phone } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  duration,
  OUTCOME_LABEL,
  STATUS_LABEL,
  when,
  type CallDetail,
  type CallRow,
} from '@/lib/voice';

export default function CallsPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const canSetUp = membership?.role === 'owner' || membership?.role === 'admin';
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [open, setOpen] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await request<{ data: CallRow[] }>('/calls', { tenantId: agencyId })).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load calls.');
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function show(id: string) {
    if (open?.id === id) return setOpen(null);
    try {
      setOpen(await request<CallDetail>(`/calls/${id}`, { tenantId: agencyId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the call.');
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Phone className="h-6 w-6" aria-hidden /> Call log
        </h1>
        <p className="text-sm text-muted-foreground">
          Calls your AI assistant answered or made, with the AI summary, answers and outcome.
          Recordings are not stored.{' '}
          <Link href={`/app/${agencyId}/ai-calling`} className="text-primary underline">
            Call scripts
          </Link>
          {canSetUp ? (
            <>
              {' · '}
              <Link href={`/app/${agencyId}/settings/voice`} className="text-primary underline">
                Calling numbers
              </Link>
            </>
          ) : null}
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No calls yet. Open a contact and choose Call with AI, or connect a calling number for
            incoming calls.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul>
            {rows.map((c) => (
              <li key={c.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => void show(c.id)}
                  className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left hover:bg-muted"
                  aria-expanded={open?.id === c.id}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.direction === 'outbound' ? '↗ ' : '↘ '}
                      {c.contact?.fullName ?? c.callerE164 ?? 'Unknown caller'}
                      {c.outcome ? (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                          {OUTCOME_LABEL[c.outcome]}
                        </span>
                      ) : c.status !== 'ended' ? (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                          {STATUS_LABEL[c.status]}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.error ?? c.summary ?? 'No summary'}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground tabular-nums">
                    <p>{when(c.startedAt ?? c.createdAt)}</p>
                    <p>
                      {duration(c.durationSec)} ·{' '}
                      {c.script?.name ?? c.line?.label ?? c.line?.phoneE164 ?? 'AI call'}
                    </p>
                  </div>
                </button>
                {open?.id === c.id ? (
                  <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
                    {open.contact ? (
                      <Link
                        href={`/app/${agencyId}/contacts/${open.contact.id}`}
                        className="text-primary underline"
                      >
                        Open contact
                      </Link>
                    ) : null}
                    <p>
                      <span className="text-muted-foreground">Ended: </span>
                      {open.endedReason ?? '–'}
                    </p>
                    {open.summary ? <p>{open.summary}</p> : null}
                    {open.callbackAt ? (
                      <p>
                        <span className="text-muted-foreground">Call back: </span>
                        {open.callbackAt}
                      </p>
                    ) : null}
                    {open.answers && open.script ? (
                      <dl className="grid gap-1 sm:grid-cols-2">
                        {open.script.questions.map((q, i) =>
                          open.answers?.[`q${i + 1}`] ? (
                            <div key={q}>
                              <dt className="text-xs text-muted-foreground">{q}</dt>
                              <dd>{open.answers[`q${i + 1}`]}</dd>
                            </div>
                          ) : null,
                        )}
                      </dl>
                    ) : null}
                    {open.transcript ? (
                      <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                        {open.transcript}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {(
                          open.direction === 'outbound'
                            ? !open.keepTranscript
                            : open.line?.transcriptPolicy !== 'full_transcript'
                        )
                          ? 'Transcripts are not kept for this call (summary only).'
                          : 'No transcript was sent for this call.'}
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

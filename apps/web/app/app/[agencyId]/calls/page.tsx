'use client';

import { Phone } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import { duration, when, type CallDetail, type CallRow } from '@/lib/voice';

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
          <Phone className="h-6 w-6" aria-hidden /> Calls
        </h1>
        <p className="text-sm text-muted-foreground">
          Calls answered by your AI voice assistant, with the AI summary. Recordings are not stored
          in PropForce.
          {canSetUp ? (
            <>
              {' '}
              <Link href={`/app/${agencyId}/settings/voice`} className="text-primary underline">
                Voice settings
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
            No calls yet. Calls appear here after your voice line is connected and a call ends.
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
                      {c.contact?.fullName ?? c.callerE164 ?? 'Unknown caller'}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.summary ?? 'No summary'}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground tabular-nums">
                    <p>{when(c.startedAt)}</p>
                    <p>
                      {duration(c.durationSec)} · {c.line.label ?? c.line.phoneE164 ?? 'Line'}
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
                    {open.transcript ? (
                      <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                        {open.transcript}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {open.line.transcriptPolicy === 'summary_only'
                          ? 'Transcripts are not kept for this line (summary only).'
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

'use client';

import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import {
  CAMPAIGN_STATUS_LABEL,
  RECIPIENT_STATUS_LABEL,
  SKIP_LABEL,
  type Campaign,
  type Recipient,
  type RecipientStatus,
} from '@/lib/campaigns';
import { cn } from '@/lib/utils';

interface Preview {
  matched: number;
  eligible: number;
  skipped: Record<string, number>;
  sample: { fullName: string; params: string[] }[];
}

const TONE: Record<RecipientStatus, string> = {
  queued: 'text-muted-foreground',
  skipped: 'text-muted-foreground',
  sent: 'text-emerald-700 dark:text-emerald-400',
  replied: 'text-sky-700 dark:text-sky-400',
  failed: 'text-red-600',
};

export default function CampaignPage() {
  const { agencyId, campaignId } = useParams<{ agencyId: string; campaignId: string }>();
  const { request } = useAuth();
  const role = useAgencyMembership()?.role;
  const canApprove = role === 'owner' || role === 'admin';
  const [c, setC] = useState<Campaign | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const stop = useRef(false);
  const path = `/campaigns/${campaignId}`;
  const t = { tenantId: agencyId };

  const load = useCallback(async () => {
    try {
      const camp = await request<Campaign>(path, { tenantId: agencyId });
      setC(camp);
      if (camp.status === 'draft') {
        setPreview(await request<Preview>(`${path}/preview`, { tenantId: agencyId }));
        setRecipients([]);
      } else {
        setPreview(null);
        setRecipients(
          (await request<{ data: Recipient[] }>(`${path}/recipients`, { tenantId: agencyId })).data,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the campaign.');
    }
  }, [agencyId, path, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: string, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await request(`${path}/${action}`, { ...t, method: 'POST' });
      setNotice(message);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  };

  /** Sends batch after batch while the page stays open. */
  const send = async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    stop.current = false;
    try {
      for (;;) {
        const r = await request<{
          status: string;
          sentNow: number;
          stopped?: string;
        }>(`${path}/send`, { ...t, method: 'POST' });
        await load();
        if (r.stopped) {
          setError(r.stopped);
          break;
        }
        if (r.status === 'completed') {
          setNotice('All messages sent.');
          break;
        }
        if (stop.current || r.sentNow === 0) break;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sending stopped.');
      await load();
    } finally {
      setSending(false);
    }
  };

  if (!c)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );

  const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
  const done = c.counts.sent + c.counts.replied + c.counts.failed;
  const toSend = c.counts.queued + done;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link
        href={`/app/${agencyId}/booster`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Lead Booster
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="text-sm text-muted-foreground">
            Template <span className="font-mono">{c.templateName}</span> ({c.languageCode}) from{' '}
            {c.account.displayPhoneNumber} · daily limit {c.dailyLimit}
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
          {CAMPAIGN_STATUS_LABEL[c.status]}
        </span>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {c.status === 'draft' && preview ? (
        <Card>
          <h2 className="font-medium">Audience preview</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3">
              <dt className="text-muted-foreground">Matched</dt>
              <dd className="text-xl font-semibold tabular-nums">{preview.matched}</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="text-muted-foreground">Will receive</dt>
              <dd className="text-xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                {preview.eligible}
              </dd>
            </div>
            {Object.entries(preview.skipped).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border p-3">
                <dt className="text-muted-foreground">{SKIP_LABEL[k] ?? k}</dt>
                <dd className="text-xl font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {preview.sample.length ? (
            <div className="mt-4 text-sm">
              <p className="text-xs text-muted-foreground">Variables for the first recipients</p>
              <ul className="mt-1 list-disc pl-5">
                {preview.sample.map((s, i) => (
                  <li key={i}>
                    {s.fullName}:{' '}
                    {s.params.map((p, j) => `{{${j + 1}}} = ${p || '(empty)'}`).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              disabled={!preview.eligible}
              onClick={() => void act('submit', 'Submitted for approval.')}
            >
              Submit for approval
            </Button>
            <Button
              variant="ghost"
              className="text-red-600"
              onClick={() => void act('cancel', 'Campaign cancelled.')}
            >
              Cancel campaign
            </Button>
          </div>
        </Card>
      ) : null}

      {c.status === 'pending_approval' ? (
        <Card>
          <h2 className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Approval
          </h2>
          <p className="mt-1 text-sm">
            {c.counts.queued} contacts with WhatsApp marketing consent will get this template.{' '}
            {canApprove
              ? 'Check the template name and variables, then approve.'
              : 'An owner or admin must approve it before anything is sent.'}
          </p>
          <div className="mt-3 flex gap-2">
            {canApprove ? (
              <Button onClick={() => void act('approve', 'Approved. You can start sending.')}>
                Approve
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void act('return-to-draft', 'Back to draft.')}>
              Back to draft
            </Button>
          </div>
        </Card>
      ) : null}

      {c.status === 'approved' || c.status === 'sending' || c.status === 'completed' ? (
        <Card>
          <h2 className="font-medium">Sending</h2>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${toSend ? Math.round((done / toSend) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-sm tabular-nums">
            {done} of {toSend} sent · {c.counts.replied} replied · {c.counts.failed} failed ·{' '}
            {c.counts.skipped} skipped
            {typeof c.sentLast24h === 'number'
              ? ` · ${c.sentLast24h} sent by the agency in the last 24 h`
              : ''}
          </p>
          {canApprove && c.status !== 'completed' ? (
            <div className="mt-3 flex gap-2">
              {sending ? (
                <Button variant="outline" onClick={() => (stop.current = true)}>
                  Pause after this batch
                </Button>
              ) : (
                <Button onClick={() => void send()}>
                  {c.status === 'approved' ? 'Start sending' : 'Continue sending'}
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-red-600"
                disabled={sending}
                onClick={() => void act('cancel', 'Campaign cancelled. Nothing more will be sent.')}
              >
                Cancel campaign
              </Button>
            </div>
          ) : null}
          {sending ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Keep this page open while sending. Messages go out in small batches.
            </p>
          ) : null}
        </Card>
      ) : null}

      {recipients.length ? (
        <Card>
          <h2 className="font-medium">Recipients ({total})</h2>
          <div className="mt-3 max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="py-2">Contact</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">
                      <Link
                        href={`/app/${agencyId}/contacts/${r.contact.id}`}
                        className="hover:underline"
                      >
                        {r.contact.fullName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{r.contact.phoneE164}</p>
                    </td>
                    <td className={cn('font-medium', TONE[r.status])}>
                      {RECIPIENT_STATUS_LABEL[r.status]}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {r.skipReason
                        ? (SKIP_LABEL[r.skipReason] ?? r.skipReason)
                        : r.errorCode
                          ? `WhatsApp error ${r.errorCode}`
                          : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

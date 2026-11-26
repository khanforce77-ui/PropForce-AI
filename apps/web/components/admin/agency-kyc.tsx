'use client';

import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileText,
  Info,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import {
  ApiError,
  type KycChecklist,
  type KycDocument,
  type KycEmployee,
  type KycOwner,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { openPrivateFile } from './open-private-file';

interface QueueRow {
  id: string;
  name: string;
  emirate: string;
  status: string;
  approvalStatus: string;
  orn: string | null;
  tradeLicenseNo: string | null;
  documents: number;
  oldestUpload: string | null;
  createdAt: string;
}
interface AiReading {
  documentKind: string;
  legible: boolean;
  companyName: string | null;
  personNames: string[];
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuer: string | null;
  activities: string[];
  concerns: string;
}
type AdminDoc = KycDocument & { aiReading: AiReading | null };
interface Finding {
  severity: 'problem' | 'warning' | 'info';
  documentId?: string;
  subject: string;
  message: string;
}
interface Review {
  agency: {
    id: string;
    name: string;
    emirate: string;
    status: string;
    approvalStatus: string;
    statusReason: string | null;
    tradeLicenseNo: string | null;
    orn: string | null;
    website: string | null;
    kycInstructions: string | null;
    kycInstructionsAt: string | null;
    owner: { fullName: string; email: string } | null;
  };
  aiAvailable: boolean;
  owners: KycOwner[];
  employees: KycEmployee[];
  documents: AdminDoc[];
  checklist: KycChecklist;
  findings: Finding[];
  suggestedInstructions: string;
}

const LABELS: Record<string, string> = {
  trade_license: 'Trade licence',
  moa: 'MOA',
  ejari: 'Ejari',
  orn_certificate: 'ORN card',
  owner_passport: 'Passport',
  owner_emirates_id: 'Emirates ID',
  employee_brn_card: 'Broker card (BRN)',
  employee_emirates_id: 'Emirates ID',
  permit: 'Permit',
  employee_list: 'Employee list',
};
const DLD_CHECK_URL =
  'https://dubailand.gov.ae/en/eservices/validate-real-estate-licenses-and-permits';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' });
const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

function SeverityIcon({ s }: { s: Finding['severity'] }) {
  if (s === 'problem')
    return <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-label="Problem" />;
  if (s === 'warning')
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="Check" />;
  return <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Note" />;
}

function DocCard({
  doc,
  subject,
  findings,
  onDone,
  onError,
}: {
  doc: AdminDoc;
  subject: string;
  findings: Finding[];
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const { request } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const r = doc.aiReading;
  const expired = !!doc.expiresAt && new Date(doc.expiresAt) < new Date(new Date().toDateString());

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && reason.trim().length < 3) {
      onError('Write a reason for the agency first.');
      return;
    }
    setBusy(true);
    try {
      await request(`/platform/agency-documents/${doc.id}/decision`, {
        body: { decision, ...(decision === 'reject' ? { reason: reason.trim() } : {}) },
      });
      setReason('');
      await onDone(
        `${LABELS[doc.type]} (${subject}) ${decision === 'approve' ? 'approved' : 'rejected'}.`,
      );
    } catch (err) {
      onError(errorText(err, 'Could not save the decision.'));
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    setBusy(true);
    try {
      await request(`/platform/agency-documents/${doc.id}/check`, { method: 'POST' });
      await onDone('AI read the document again.');
    } catch (err) {
      onError(errorText(err, 'AI check failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        doc.status === 'approved'
          ? 'border-emerald-300 dark:border-emerald-900'
          : doc.status === 'rejected'
            ? 'border-red-300 dark:border-red-900'
            : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {doc.type === 'permit' && doc.label ? doc.label : LABELS[doc.type]}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{subject}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={() =>
                void openPrivateFile(() =>
                  request<Blob>(`/platform/agency-documents/${doc.id}/file`, {
                    responseType: 'blob',
                  }),
                ).catch(() => onError('Could not open the file.'))
              }
            >
              <FileText className="h-3 w-3" aria-hidden /> Open file
            </button>
            {doc.expiresAt ? (
              <>
                {' '}
                · expiry entered{' '}
                <span className={expired ? 'font-medium text-red-600' : ''}>
                  {day(doc.expiresAt)}
                </span>
              </>
            ) : null}{' '}
            · uploaded {day(doc.uploadedAt)} · <span className="capitalize">{doc.status}</span>
          </p>
          {doc.reason ? <p className="text-xs text-red-600">Reason sent: {doc.reason}</p> : null}
        </div>
        {doc.status === 'pending' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Reason for the agency"
              placeholder="Reason (needed to reject)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-8 w-56"
              maxLength={500}
            />
            <Button size="sm" disabled={busy || expired} onClick={() => void decide('approve')}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void decide('reject')}
            >
              Reject
            </Button>
          </div>
        ) : null}
      </div>
      <div className="mt-2 rounded-md bg-muted px-3 py-2 text-xs">
        <p className="flex items-center gap-1 font-medium">
          <Sparkles className="h-3 w-3" aria-hidden /> AI read-out
          {doc.aiStatus === 'checked'
            ? ''
            : doc.aiStatus === 'failed'
              ? ': could not read'
              : ': not read yet'}
          <button
            type="button"
            className="ml-auto text-primary hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => void rerun()}
          >
            {doc.aiStatus === 'not_checked' ? 'Read now' : 'Read again'}
          </button>
        </p>
        {r ? (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground">Looks like</dt>
            <dd>
              {r.documentKind.replace(/_/g, ' ')}
              {r.legible ? '' : ' (hard to read)'}
            </dd>
            {r.companyName ? (
              <>
                <dt className="text-muted-foreground">Company</dt>
                <dd>{r.companyName}</dd>
              </>
            ) : null}
            {r.personNames.length ? (
              <>
                <dt className="text-muted-foreground">Names</dt>
                <dd>{r.personNames.join(', ')}</dd>
              </>
            ) : null}
            {r.documentNumber ? (
              <>
                <dt className="text-muted-foreground">Number</dt>
                <dd>{r.documentNumber}</dd>
              </>
            ) : null}
            {r.expiryDate || r.issueDate ? (
              <>
                <dt className="text-muted-foreground">Dates</dt>
                <dd>
                  {r.issueDate ? `issued ${r.issueDate}` : ''}
                  {r.issueDate && r.expiryDate ? ' · ' : ''}
                  {r.expiryDate ? `expires ${r.expiryDate}` : ''}
                </dd>
              </>
            ) : null}
            {r.issuer ? (
              <>
                <dt className="text-muted-foreground">Issuer</dt>
                <dd>{r.issuer}</dd>
              </>
            ) : null}
            {r.activities.length ? (
              <>
                <dt className="text-muted-foreground">Activities</dt>
                <dd>{r.activities.join('; ')}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {findings.length ? (
          <ul className="mt-2 flex flex-col gap-1">
            {findings.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <SeverityIcon s={f.severity} /> {f.message}
              </li>
            ))}
          </ul>
        ) : doc.aiStatus === 'checked' ? (
          <p className="mt-1 text-emerald-700 dark:text-emerald-400">No problems found.</p>
        ) : null}
      </div>
    </div>
  );
}

function AgencyReview({ agencyId, onBack }: { agencyId: string; onBack: () => void }) {
  const { request } = useAuth();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [instructions, setInstructions] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await request<Review>(`/platform/agencies/${agencyId}/kyc`);
      setReview(r);
      setInstructions((cur) => cur ?? r.agency.kycInstructions ?? r.suggestedInstructions);
    } catch (err) {
      setError(errorText(err, 'Could not load this agency.'));
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      await load();
    } catch (err) {
      setError(errorText(err, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  if (!review)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );

  const a = review.agency;
  const byDoc = (id: string) => review.findings.filter((f) => f.documentId === id);
  const general = review.findings.filter((f) => !f.documentId);
  const problems = review.findings.filter((f) => f.severity === 'problem').length;
  const warnings = review.findings.filter((f) => f.severity === 'warning').length;
  const unread = review.documents.filter((d) => d.aiStatus !== 'checked').length;
  const ownerName = (id: string | null) =>
    review.owners.find((o) => o.id === id)?.fullName ?? 'Owner';
  const empName = (id: string | null) =>
    review.employees.find((e) => e.id === id)?.fullName ?? 'Employee';
  const subjectOf = (d: AdminDoc) =>
    d.ownerId
      ? `Owner · ${ownerName(d.ownerId)}`
      : d.employeeId
        ? `Employee · ${empName(d.employeeId)}`
        : '';
  const groups: [string, AdminDoc[]][] = [
    [
      'Company',
      review.documents.filter(
        (d) => !d.ownerId && !d.employeeId && d.type !== 'permit' && d.type !== 'employee_list',
      ),
    ],
    ['Owners', review.documents.filter((d) => d.ownerId)],
    ['Employees', review.documents.filter((d) => d.employeeId || d.type === 'employee_list')],
    ['Other permits', review.documents.filter((d) => d.type === 'permit')],
  ];

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 self-start text-sm text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All agencies
      </button>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{a.name}</h2>
            <p className="text-sm text-muted-foreground">
              {a.emirate} · licence {a.tradeLicenseNo ?? '–'} · ORN {a.orn ?? '–'}
              {a.website ? (
                <>
                  {' '}
                  ·{' '}
                  <a
                    href={a.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline"
                  >
                    {a.website.replace(/^https?:\/\//, '')}
                  </a>
                </>
              ) : null}
            </p>
            {a.owner ? (
              <p className="text-sm text-muted-foreground">
                Signed up by {a.owner.fullName} ({a.owner.email})
              </p>
            ) : null}
            <p className="mt-1 text-sm">
              Status: <span className="font-medium capitalize">{a.status}</span> · approval{' '}
              <span className="font-medium">{a.approvalStatus.replace('_', ' ')}</span>
            </p>
            <a
              href={DLD_CHECK_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Check ORN / BRN on DLD <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              disabled={busy || a.approvalStatus !== 'pending' || !review.checklist.approved}
              onClick={() =>
                void act(async () => {
                  await request(`/platform/agencies/${agencyId}/approve`, { method: 'POST' });
                  return `${a.name} is approved and live.`;
                })
              }
            >
              Approve agency (go live)
            </Button>
            <p className="max-w-64 text-right text-xs text-muted-foreground">
              {review.checklist.approved
                ? a.approvalStatus === 'pending'
                  ? 'Every required document is approved.'
                  : 'Not waiting for approval.'
                : `Approve every required document first (${review.checklist.items.filter((i) => i.state !== 'approved').length} open).`}
            </p>
          </div>
        </div>
      </Card>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden /> AI check
            </h3>
            <p className="text-sm text-muted-foreground">
              {`${problems} problem${problems === 1 ? '' : 's'}, ${warnings} to check${unread ? `, ${unread} file${unread === 1 ? '' : 's'} not read yet` : ''}. `}
              {review.aiAvailable
                ? ''
                : 'AI reading is not set up on this server, so new files are not read. '}
              AI can make mistakes: open each file before you decide.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {review.aiAvailable ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || unread === 0}
                onClick={() =>
                  void act(async () => {
                    const r = await request<{ checked: number; failed: number; remaining: number }>(
                      `/platform/agencies/${agencyId}/kyc/check`,
                      { body: {} },
                    );
                    return `AI read ${r.checked} file${r.checked === 1 ? '' : 's'}${r.failed ? `, ${r.failed} failed` : ''}${r.remaining ? `. ${r.remaining} left: press again.` : '.'}`;
                  })
                }
              >
                Read unread files
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await request<{ approved: number }>(
                    `/platform/agencies/${agencyId}/kyc/approve-clean`,
                    {
                      method: 'POST',
                    },
                  );
                  return r.approved
                    ? `Approved ${r.approved} document${r.approved === 1 ? '' : 's'} with no AI findings.`
                    : 'No waiting document is free of AI findings.';
                })
              }
            >
              Approve all with no AI findings
            </Button>
          </div>
        </div>
        {general.length ? (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {general.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <SeverityIcon s={f.severity} /> <span className="font-medium">{f.subject}:</span>{' '}
                {f.message}
              </li>
            ))}
          </ul>
        ) : null}
        {review.checklist.missing.length ? (
          <p className="mt-3 text-sm">
            <span className="font-medium">Not uploaded:</span> {review.checklist.missing.join(', ')}
          </p>
        ) : null}
      </Card>

      {groups.map(([title, docs]) =>
        docs.length ? (
          <section key={title} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
            {docs.map((d) => (
              <DocCard
                key={d.id}
                doc={d}
                subject={subjectOf(d)}
                findings={byDoc(d.id)}
                onDone={async (m) => {
                  setNotice(m);
                  setError(null);
                  await load();
                }}
                onError={setError}
              />
            ))}
          </section>
        ) : null,
      )}

      <Card>
        <h3 className="font-medium">Tell the agency what to fix</h3>
        <p className="text-sm text-muted-foreground">
          Filled in from the AI findings, missing files and rejections. Edit it, then send: the
          agency sees it on its Company documents page and its owners get an email.
          {a.kycInstructionsAt ? ` Last sent ${day(a.kycInstructionsAt)}.` : ''}
        </p>
        <textarea
          aria-label="Instructions for the agency"
          className="mt-2 min-h-32 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          value={instructions ?? ''}
          maxLength={4000}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || !(instructions ?? '').trim()}
            onClick={() =>
              void act(async () => {
                const r = await request<{ emailed: number }>(
                  `/platform/agencies/${agencyId}/kyc/instructions`,
                  {
                    body: { text: instructions ?? '' },
                  },
                );
                return `Sent to the agency${r.emailed ? ` and emailed ${r.emailed} owner${r.emailed === 1 ? '' : 's'}` : ''}.`;
              })
            }
          >
            Send to agency
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setInstructions(review.suggestedInstructions)}
          >
            Use AI suggestion
          </Button>
          {a.kycInstructions ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await request(`/platform/agencies/${agencyId}/kyc/instructions`, {
                    body: { text: '' },
                  });
                  setInstructions('');
                  return 'Cleared the message shown to the agency.';
                })
              }
            >
              Clear message
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/** Agencies' registration documents (Dubai KYC), with the AI read-out to speed up the check. */
export function AdminAgencyKyc() {
  const { request } = useAuth();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await request<{ data: QueueRow[] }>('/platform/agency-documents', {
        query: { status },
      });
      setRows(r.data);
    } catch (err) {
      setError(errorText(err, 'Could not load agencies.'));
    }
  }, [request, status]);

  useEffect(() => {
    if (!selected) void load();
  }, [load, selected]);

  if (selected) return <AgencyReview agencyId={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Trade licence, MOA, Ejari, ORN card and owners’ and employees’ IDs. AI reads each file and
          points out problems; you decide.
        </p>
        <Select
          aria-label="Filter by document status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="pending">Waiting for review</option>
          <option value="approved">Has approved documents</option>
          <option value="rejected">Has rejected documents</option>
        </Select>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {rows?.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nothing here.</p>
        </Card>
      ) : null}
      {rows?.map((r) => (
        <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="font-medium">{r.name}</p>
            <p className="text-sm text-muted-foreground">
              {r.documents} document{r.documents === 1 ? '' : 's'}{' '}
              {status === 'pending' ? 'waiting' : status}
              {r.oldestUpload ? ` · oldest ${day(r.oldestUpload)}` : ''} ·{' '}
              {r.approvalStatus === 'pending' ? 'sent for approval' : `status ${r.status}`}
            </p>
          </div>
          <Button size="sm" onClick={() => setSelected(r.id)}>
            Review
          </Button>
        </Card>
      ))}
    </div>
  );
}

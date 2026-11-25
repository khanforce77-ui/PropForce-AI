'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { openPrivateFile } from './open-private-file';

interface VerificationRow {
  id: string;
  brn: string;
  brnExpiresAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  emiratesIdContentType: string | null;
  agency: { id: string; name: string; orn: string | null };
  membership: { id: string; role: string; user: { fullName: string; email: string } };
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' });
const DLD_CHECK_URL =
  'https://dubailand.gov.ae/en/eservices/validate-real-estate-licenses-and-permits';

function Row({ row, onDone }: { row: VerificationRow; onDone: (msg: string) => void }) {
  const { request } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (which: 'card' | 'emirates-id') =>
    void openPrivateFile(() =>
      request<Blob>(`/platform/broker-verifications/${row.id}/${which}`, { responseType: 'blob' }),
    ).catch(() => setError('Could not open the file.'));

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && reason.trim().length < 3) {
      setError('Write a reason for the agent first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(`/platform/broker-verifications/${row.id}/decision`, {
        body: { decision, ...(decision === 'reject' ? { reason: reason.trim() } : {}) },
      });
      onDone(
        decision === 'approve'
          ? `${row.membership.user.fullName} is now a verified agent.`
          : `${row.membership.user.fullName}'s request was rejected.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  }

  const expired = new Date(row.brnExpiresAt) < new Date(new Date().toDateString());
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{row.membership.user.fullName}</p>
          <p className="text-sm text-muted-foreground">
            {row.membership.user.email} · {row.agency.name}
            {row.agency.orn ? ` (ORN ${row.agency.orn})` : ''}
          </p>
          <p className="text-sm">
            BRN <span className="font-medium">{row.brn}</span> · card valid until{' '}
            <span className={expired ? 'font-medium text-red-600' : ''}>
              {day(row.brnExpiresAt)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">Sent {day(row.submittedAt)}</p>
          {row.reason ? <p className="mt-1 text-sm">Reason: {row.reason}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-primary hover:underline"
            onClick={() => open('card')}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden /> Broker card
          </button>
          {row.emiratesIdContentType ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={() => open('emirates-id')}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden /> Emirates ID
            </button>
          ) : null}
          <a
            href={DLD_CHECK_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Check BRN on DLD <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {row.status === 'pending' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            aria-label="Reason for the agent"
            placeholder="Reason (needed to reject)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-w-64 flex-1"
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
    </Card>
  );
}

/** Agents' broker cards waiting for a check; approving gives the "Verified agent" badge. */
export function AdminBrokerVerifications() {
  const { request } = useAuth();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rows, setRows] = useState<VerificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await request<{ data: VerificationRow[] }>('/platform/broker-verifications', {
        query: { status },
      });
      setRows(r.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load requests.');
    }
  }, [request, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Check the name and BRN on the broker card against DLD and the Emirates ID. The Emirates ID
          copy is deleted after you decide.
        </p>
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="pending">Waiting</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {rows?.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nothing here.</p>
        </Card>
      ) : null}
      {rows?.map((row) => (
        <Row
          key={row.id}
          row={row}
          onDone={(msg) => {
            setNotice(msg);
            void load();
          }}
        />
      ))}
    </div>
  );
}

'use client';

import { ArrowLeft, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { ApiError, type Member } from '@/lib/api';
import { useAgencyMembership } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth';
import { canManageCrm } from '@/lib/crm';
import {
  COMMISSION_STATUS_LABEL,
  DEAL_STAGE_LABEL,
  isClosedStage,
  money,
  type CommissionStatus,
  type DealDetail,
} from '@/lib/deals';

interface SplitRow {
  kind: 'member' | 'party';
  membershipId: string;
  partyName: string;
  percent: string;
}

export default function DealPage() {
  const { agencyId, dealId } = useParams<{ agencyId: string; dealId: string }>();
  const { request } = useAuth();
  const membership = useAgencyMembership();
  const manage = canManageCrm(membership?.role);
  const [d, setD] = useState<DealDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [reason, setReason] = useState('');
  const [splits, setSplits] = useState<SplitRow[] | null>(null);
  const [task, setTask] = useState('');
  const [invoice, setInvoice] = useState('');
  const path = `/deals/${dealId}`;
  const t = { tenantId: agencyId };

  const load = useCallback(async () => {
    try {
      const deal = await request<DealDetail>(path, { tenantId: agencyId });
      setD(deal);
      setInvoice(deal.invoiceNumber ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the deal.');
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
      setError(err instanceof ApiError ? err.message : 'That did not work.');
      return false;
    }
  };

  if (!d)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );

  const canEdit = manage || d.agent.id === membership?.id;
  const closed = isClosedStage(d.stage);

  const moveStage = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await call(
      () =>
        request(`${path}/stage`, {
          ...t,
          method: 'POST',
          body: { stage, reason: stage === 'fallen_through' ? reason : null },
        }),
      `Moved to ${DEAL_STAGE_LABEL[stage] ?? stage}.`,
    );
    if (ok) {
      setStage('');
      setReason('');
    }
  };

  const editSplits = () =>
    setSplits(
      d.splits.map((s) => ({
        kind: s.membershipId ? 'member' : 'party',
        membershipId: s.membershipId ?? '',
        partyName: s.partyName ?? '',
        percent: String(s.percent),
      })),
    );

  const saveSplits = async () => {
    if (!splits) return;
    const ok = await call(
      () =>
        request(`${path}/splits`, {
          ...t,
          method: 'POST',
          body: {
            splits: splits.map((s) =>
              s.kind === 'member'
                ? { membershipId: s.membershipId, percent: Number(s.percent) }
                : { partyName: s.partyName, percent: Number(s.percent) },
            ),
          },
        }),
      'Commission split saved.',
    );
    if (ok) setSplits(null);
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Link
        href={`/app/${agencyId}/deals?type=${d.type}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Deals
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {d.reference} · {d.contact.fullName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {d.type === 'sale' ? 'Sale' : 'Rental'} · {money(d.price)}
            {d.type === 'rental' ? ' a year' : ''} · agent {d.agent.user.fullName}
            {d.property ? (
              <>
                {' · '}
                <Link className="underline" href={`/app/${agencyId}/listings/${d.property.id}`}>
                  {d.property.reference}
                </Link>
              </>
            ) : null}
            {d.lead ? (
              <>
                {' · '}
                <Link className="underline" href={`/app/${agencyId}/leads/${d.lead.id}`}>
                  lead
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
          {DEAL_STAGE_LABEL[d.stage] ?? d.stage}
        </span>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {d.lostReason ? <Alert>Fell through: {d.lostReason}</Alert> : null}

      {/* Stage progress */}
      <Card>
        <ol className="flex flex-wrap gap-1.5 text-xs">
          {d.stages
            .filter((s) => s !== 'fallen_through')
            .map((s, i, all) => {
              const reached = all.indexOf(d.stage) >= i || d.stage === 'completed';
              return (
                <li
                  key={s}
                  className={
                    s === d.stage
                      ? 'rounded-full bg-primary px-2.5 py-1 text-primary-foreground'
                      : reached
                        ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'rounded-full bg-muted px-2.5 py-1 text-muted-foreground'
                  }
                >
                  {DEAL_STAGE_LABEL[s] ?? s}
                </li>
              );
            })}
        </ol>
        {canEdit && (!closed || manage) ? (
          <form onSubmit={(e) => void moveStage(e)} className="mt-4 flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="stage">Move to</Label>
              <Select id="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">Choose…</option>
                {d.stages
                  .filter((s) => s !== d.stage)
                  .map((s) => (
                    <option key={s} value={s}>
                      {DEAL_STAGE_LABEL[s] ?? s}
                    </option>
                  ))}
              </Select>
            </div>
            {stage === 'fallen_through' ? (
              <Input
                aria-label="Why did it fall through?"
                placeholder="Why did it fall through?"
                required
                className="min-w-60 flex-1"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            ) : null}
            <Button type="submit" disabled={!stage}>
              Update stage
            </Button>
          </form>
        ) : null}
        {stage === 'completed' ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Completing marks the lead as won and the listing as{' '}
            {d.type === 'sale' ? 'sold' : 'rented'}.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-medium">Commission</h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Gross</dt>
              <dd className="font-semibold tabular-nums">{money(d.commission.gross)}</dd>
              <dd className="text-xs text-muted-foreground">
                {d.commissionAmount != null ? 'fixed' : `${d.commissionPercent ?? 0}% of price`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">VAT {d.vatPercent}%</dt>
              <dd className="font-semibold tabular-nums">{money(d.commission.vat)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Invoice total</dt>
              <dd className="font-semibold tabular-nums">{money(d.commission.total)}</dd>
            </div>
          </dl>

          <h3 className="mt-5 text-sm font-medium">Split</h3>
          {!splits ? (
            <>
              <ul className="mt-2 divide-y divide-border text-sm">
                {d.splits.map((s, i) => (
                  <li key={s.id} className="flex justify-between py-1.5">
                    <span>
                      {s.name}
                      {s.partyName ? ' (outside party)' : ''} · {s.percent}%
                    </span>
                    <span className="tabular-nums">
                      {money(d.commission.splits[i]?.amount ?? 0)}
                    </span>
                  </li>
                ))}
                <li className="flex justify-between py-1.5 text-muted-foreground">
                  <span>Agency · {d.commission.agencyPercent}%</span>
                  <span className="tabular-nums">{money(d.commission.agencyAmount)}</span>
                </li>
              </ul>
              {manage ? (
                <Button size="sm" variant="outline" className="mt-2" onClick={editSplits}>
                  Change split
                </Button>
              ) : null}
            </>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {splits.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label="Who"
                    className="w-32"
                    value={s.kind}
                    onChange={(e) =>
                      setSplits(
                        splits.map((x, j) =>
                          j === i ? { ...x, kind: e.target.value as 'member' | 'party' } : x,
                        ),
                      )
                    }
                  >
                    <option value="member">Team member</option>
                    <option value="party">Outside party</option>
                  </Select>
                  {s.kind === 'member' ? (
                    <Select
                      aria-label="Member"
                      className="flex-1"
                      value={s.membershipId}
                      onChange={(e) =>
                        setSplits(
                          splits.map((x, j) =>
                            j === i ? { ...x, membershipId: e.target.value } : x,
                          ),
                        )
                      }
                    >
                      <option value="">Choose…</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.user.fullName}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      aria-label="Party name"
                      placeholder="Co-broker agency"
                      className="flex-1"
                      value={s.partyName}
                      onChange={(e) =>
                        setSplits(
                          splits.map((x, j) => (j === i ? { ...x, partyName: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                  <Input
                    aria-label="Percent"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    className="w-20"
                    value={s.percent}
                    onChange={(e) =>
                      setSplits(
                        splits.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)),
                      )
                    }
                  />
                  <span className="text-xs">%</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove"
                    onClick={() => setSplits(splits.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Agency keeps{' '}
                {Math.max(0, 100 - splits.reduce((a, s) => a + Number(s.percent || 0), 0))}%.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSplits([
                      ...splits,
                      { kind: 'member', membershipId: '', partyName: '', percent: '' },
                    ])
                  }
                >
                  Add share
                </Button>
                <Button size="sm" onClick={() => void saveSplits()}>
                  Save split
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSplits(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <h3 className="mt-5 text-sm font-medium">Invoice</h3>
          <p className="mt-1 text-sm">
            {COMMISSION_STATUS_LABEL[d.commissionStatus]}
            {d.invoiceNumber ? ` · ${d.invoiceNumber}` : ''}
          </p>
          {manage ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                aria-label="Invoice number"
                placeholder="Invoice number"
                className="w-40"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
              />
              {(['pending', 'invoiced', 'received'] as CommissionStatus[])
                .filter((s) => s !== d.commissionStatus)
                .map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void call(
                        () =>
                          request(`${path}/commission`, {
                            ...t,
                            method: 'POST',
                            body: { status: s, invoiceNumber: invoice.trim() || null },
                          }),
                        `Commission marked ${COMMISSION_STATUS_LABEL[s].toLowerCase()}.`,
                      )
                    }
                  >
                    Mark {COMMISSION_STATUS_LABEL[s].toLowerCase()}
                  </Button>
                ))}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            PropForce records commissions; it does not issue tax invoices or move money.
          </p>
        </Card>

        <Card>
          <h2 className="font-medium">Checklist</h2>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {d.tasks.map((x) => (
              <li key={x.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={x.title}
                  checked={!!x.doneAt}
                  disabled={!canEdit}
                  onChange={(e) =>
                    void call(
                      () =>
                        request(`${path}/tasks/${x.id}`, {
                          ...t,
                          method: 'PATCH',
                          body: { done: e.target.checked },
                        }),
                      e.target.checked ? 'Ticked.' : 'Unticked.',
                    )
                  }
                />
                <span className={x.doneAt ? 'text-muted-foreground line-through' : ''}>
                  {x.title}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove ${x.title}`}
                    className="ml-auto text-muted-foreground hover:text-red-600"
                    onClick={() =>
                      void call(
                        () => request(`${path}/tasks/${x.id}`, { ...t, method: 'DELETE' }),
                        'Removed.',
                      )
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void call(
                  () => request(`${path}/tasks`, { ...t, method: 'POST', body: { title: task } }),
                  'Added.',
                ).then((ok) => ok && setTask(''));
              }}
            >
              <Input
                aria-label="New checklist item"
                placeholder="Add an item"
                value={task}
                maxLength={200}
                onChange={(e) => setTask(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!task.trim()}>
                Add
              </Button>
            </form>
          ) : null}
        </Card>
      </div>

      <Card>
        <h2 className="font-medium">History</h2>
        <ul className="mt-2 divide-y divide-border text-sm">
          {d.history.map((h) => (
            <li key={h.id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{h.action.replace('deal.', '').replaceAll('_', ' ')}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(h.createdAt).toLocaleString('en-AE', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

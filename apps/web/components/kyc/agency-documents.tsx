'use client';

import { CheckCircle2, Circle, Clock, FileText, Trash2, Upload, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AgencyLogo } from '@/components/agency-logo';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import {
  ApiError,
  type AgencyKyc,
  type KycDocType,
  type KycDocument,
  type KycItem,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prepareForUpload } from '@/lib/images';
import { cn } from '@/lib/utils';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
const NEEDS_EXPIRY: ReadonlySet<KycDocType> = new Set([
  'trade_license',
  'ejari',
  'orn_certificate',
  'owner_passport',
  'owner_emirates_id',
  'employee_brn_card',
  'employee_emirates_id',
  'permit',
]);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' });
const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError || err instanceof Error ? err.message : fallback;

async function documentBody(file: File): Promise<Blob> {
  if (file.type === 'application/pdf') {
    if (file.size > 4 * 1024 * 1024) throw new Error('The PDF must be under 4 MB.');
    return file;
  }
  return prepareForUpload(file);
}

function StateBadge({ state }: { state: KycItem['state'] | 'optional' }) {
  const map = {
    missing: ['Missing', 'bg-muted text-muted-foreground', Circle],
    optional: ['Optional', 'bg-muted text-muted-foreground', Circle],
    pending: [
      'In review',
      'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
      Clock,
    ],
    approved: [
      'Approved',
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
      CheckCircle2,
    ],
    rejected: ['Rejected', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200', XCircle],
    expired: ['Expired', 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200', XCircle],
  } as const;
  const [label, tone, Icon] = map[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tone,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

function docState(doc: KycDocument | undefined): KycItem['state'] {
  if (!doc) return 'missing';
  if (doc.expiresAt && new Date(doc.expiresAt) < new Date(new Date().toDateString())) {
    return 'expired';
  }
  return doc.status;
}

/** One document slot: what is on file, and a small form to upload or replace it. */
function DocRow({
  agencyId,
  type,
  title,
  ownerId,
  employeeId,
  doc,
  optional,
  canEdit,
  onSaved,
  aiAvailable,
}: {
  agencyId: string;
  type: KycDocType;
  title: string;
  ownerId?: string;
  employeeId?: string;
  doc?: KycDocument;
  optional?: boolean;
  canEdit: boolean;
  aiAvailable: boolean;
  onSaved: (message: string) => Promise<void>;
}) {
  const { request } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = docState(doc);
  const needsExpiry = NEEDS_EXPIRY.has(type);
  const showForm =
    canEdit && (open || state === 'missing' || state === 'rejected' || state === 'expired');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Choose a PDF or a photo of the document.');
      return;
    }
    const expiresAt = String(f.get('expiresAt') ?? '');
    const label = String(f.get('label') ?? '').trim();
    if (needsExpiry && !expiresAt) {
      setError('Enter the expiry date printed on the document.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = await documentBody(file);
      const saved = await request<KycDocument>('/agency/kyc/documents', {
        tenantId: agencyId,
        method: 'PUT',
        query: {
          type,
          fileName: file.name.slice(0, 200),
          ownerId,
          employeeId,
          expiresAt: expiresAt || undefined,
          label: label || undefined,
        },
        body,
      });
      form.reset();
      setOpen(false);
      await onSaved(`${title} uploaded. PropForce will review it.`);
      // The AI read-out is for PropForce reviewers; run it now so review is faster.
      if (aiAvailable) {
        void request(`/agency/kyc/documents/${saved.id}/check`, {
          tenantId: agencyId,
          method: 'POST',
        }).catch(() => undefined);
      }
    } catch (err) {
      setError(errorText(err, 'Upload failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function openFile() {
    if (!doc) return;
    try {
      const blob = await request<Blob>(`/agency/kyc/documents/${doc.id}/file`, {
        tenantId: agencyId,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(errorText(err, 'Could not open the file.'));
    }
  }

  async function remove() {
    if (!doc) return;
    setBusy(true);
    try {
      await request(`/agency/kyc/documents/${doc.id}`, { tenantId: agencyId, method: 'DELETE' });
      await onSaved(`${title} removed.`);
    } catch (err) {
      setError(errorText(err, 'Could not remove it.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {doc?.label && type === 'permit' ? doc.label : title}
          </p>
          {doc ? (
            <p className="text-xs text-muted-foreground">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => void openFile()}
              >
                <FileText className="mr-1 inline h-3 w-3" aria-hidden />
                {doc.fileName}
              </button>
              {doc.expiresAt ? ` · expires ${day(doc.expiresAt)}` : ''} · uploaded{' '}
              {day(doc.uploadedAt)}
            </p>
          ) : null}
          {doc?.status === 'rejected' && doc.reason ? (
            <p className="text-xs text-red-600">PropForce: {doc.reason}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={!doc && optional ? 'optional' : state} />
          {canEdit && doc && !showForm ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Replace
            </Button>
          ) : null}
          {canEdit && doc && doc.status !== 'approved' ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Remove ${title}`}
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {showForm ? (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2" noValidate>
          {type === 'permit' ? (
            <Input
              name="label"
              aria-label="Which permit"
              placeholder="Which permit (e.g. DLD establishment permit)"
              className="min-w-56 flex-1"
              maxLength={120}
            />
          ) : null}
          <Input
            name="file"
            type="file"
            accept={ACCEPT}
            aria-label={`${title} file`}
            className="min-w-56 flex-1 py-1.5"
          />
          {needsExpiry ? (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Expiry date
              <Input
                name="expiresAt"
                type="date"
                aria-label={`${title} expiry date`}
                className="w-40"
              />
            </label>
          ) : null}
          <Button type="submit" size="sm" disabled={busy}>
            <Upload className="h-3.5 w-3.5" aria-hidden /> {busy ? 'Uploading…' : 'Upload'}
          </Button>
          {open ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          ) : null}
        </form>
      ) : null}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="font-medium">{title}</h2>
      {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

/**
 * Dubai registration documents (KYC): company details, logo, licence documents, owners and staff
 * with their IDs. Every upload saves straight away, so the agency can stop and finish later.
 */
export function AgencyDocuments({
  agencyId,
  onboarding,
  onSubmitted,
}: {
  agencyId: string;
  onboarding?: boolean;
  onSubmitted?: () => Promise<void> | void;
}) {
  const { request } = useAuth();
  const [kyc, setKyc] = useState<AgencyKyc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setKyc(await request<AgencyKyc>('/agency/kyc', { tenantId: agencyId }));
    } catch (err) {
      setError(errorText(err, 'Could not load your documents.'));
    }
  }, [agencyId, request]);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = async (message: string) => {
    setNotice(message);
    setError(null);
    await load();
  };

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await fn();
      await saved(message);
      return true;
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorText(err, 'Something went wrong.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!kyc)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );

  const newest = (type: KycDocType, ids: { ownerId?: string; employeeId?: string } = {}) =>
    kyc.documents.find(
      (d) =>
        d.type === type &&
        (d.ownerId ?? undefined) === ids.ownerId &&
        (d.employeeId ?? undefined) === ids.employeeId,
    );
  const required = kyc.checklist.items;
  const done = required.filter((i) => i.state === 'pending' || i.state === 'approved').length;
  const canEdit = kyc.approvalStatus !== 'rejected';
  const row = (
    type: KycDocType,
    title: string,
    ids: { ownerId?: string; employeeId?: string } = {},
  ) => (
    <DocRow
      key={`${type}:${ids.ownerId ?? ids.employeeId ?? ''}`}
      agencyId={agencyId}
      type={type}
      title={title}
      {...ids}
      doc={newest(type, ids)}
      canEdit={canEdit}
      aiAvailable={kyc.aiAvailable}
      onSaved={saved}
    />
  );

  function onDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => {
      const s = String(f.get(k) ?? '').trim();
      return s === '' ? null : s;
    };
    void act(
      () =>
        request('/agency', {
          method: 'PATCH',
          tenantId: agencyId,
          body: { tradeLicenseNo: v('tradeLicenseNo'), orn: v('orn'), website: v('website') },
        }),
      'Company details saved.',
    );
  }

  function onAddOwner(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const share = String(f.get('sharePercent') ?? '').trim();
    void act(
      () =>
        request('/agency/kyc/owners', {
          tenantId: agencyId,
          body: {
            fullName: String(f.get('fullName') ?? '').trim(),
            nationality: String(f.get('nationality') ?? '').trim() || null,
            sharePercent: share ? Number(share) : null,
            uaeResident: f.get('uaeResident') === 'on',
          },
        }),
      'Owner added. Upload their passport and Emirates ID below.',
    ).then((ok) => ok && form.reset());
  }

  function onAddEmployee(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const isBroker = f.get('isBroker') === 'on';
    void act(
      () =>
        request('/agency/kyc/employees', {
          tenantId: agencyId,
          body: {
            fullName: String(f.get('fullName') ?? '').trim(),
            designation: String(f.get('designation') ?? '').trim() || null,
            isBroker,
            brn: isBroker ? String(f.get('brn') ?? '').trim() || null : null,
            email: String(f.get('email') ?? '').trim() || null,
          },
        }),
      'Employee added. Upload their documents below.',
    ).then((ok) => ok && form.reset());
  }

  async function submit() {
    const ok = await act(
      () => request('/agency/onboarding/complete', { method: 'POST', tenantId: agencyId }),
      'Sent to PropForce for review.',
    );
    if (ok) await onSubmitted?.();
  }

  // Submitting is the last onboarding step; once sent, uploads still go straight to review.
  const showSubmit =
    (onboarding ?? true) && kyc.status === 'pending' && kyc.approvalStatus !== 'pending';
  const permits = kyc.documents.filter((d) => d.type === 'permit');
  const lists = kyc.documents.filter((d) => d.type === 'employee_list');

  return (
    <div className="flex flex-col gap-4">
      {kyc.instructions ? (
        <Alert tone="info" className="whitespace-pre-line">
          <strong>PropForce asked you to fix:</strong>
          {'\n'}
          {kyc.instructions}
        </Alert>
      ) : null}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">
              {done} of {required.length} done
            </p>
            <p className="text-sm text-muted-foreground">
              Every upload is saved at once, so you can stop and finish later. Your agency goes live
              after PropForce approves every required document.
            </p>
          </div>
          {kyc.checklist.approved ? <StateBadge state="approved" /> : null}
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.round((done / Math.max(required.length, 1)) * 100)}%` }}
          />
        </div>
        {kyc.checklist.missing.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Still needed: {kyc.checklist.missing.join(', ')}
          </p>
        ) : null}
      </Card>

      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <Section title="Company details" hint="As printed on your trade licence and DLD office card.">
        <form onSubmit={onDetails} className="grid gap-3 sm:grid-cols-3" noValidate>
          <Field id="kycTradeLicenseNo" label="Trade licence number" error={errors.tradeLicenseNo}>
            <Input
              id="kycTradeLicenseNo"
              name="tradeLicenseNo"
              defaultValue={kyc.agency.tradeLicenseNo ?? ''}
              disabled={!canEdit}
            />
          </Field>
          <Field id="kycOrn" label="ORN (office registration number)" error={errors.orn}>
            <Input id="kycOrn" name="orn" defaultValue={kyc.agency.orn ?? ''} disabled={!canEdit} />
          </Field>
          <Field id="kycWebsite" label="Website" error={errors.website}>
            <Input
              id="kycWebsite"
              name="website"
              placeholder="www.youragency.ae"
              defaultValue={kyc.agency.website ?? ''}
              disabled={!canEdit}
            />
          </Field>
          {canEdit ? (
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" disabled={busy}>
                Save details
              </Button>
            </div>
          ) : null}
        </form>
      </Section>

      <AgencyLogo agencyId={agencyId} canEdit={canEdit} />

      <Section
        title="Company documents"
        hint="PDF or a clear photo of each page. Enter the expiry date shown on the document."
      >
        {row('trade_license', 'Trade licence')}
        {row('moa', 'Memorandum of association (MOA)')}
        {row('ejari', 'Office Ejari')}
        {row('orn_certificate', 'DLD / RERA office card (ORN)')}
      </Section>

      <Section
        title="Owners"
        hint="Every owner or partner on the trade licence / MOA: passport, and Emirates ID for UAE residents."
      >
        {kyc.owners.map((o) => (
          <div key={o.id} className="mb-3 rounded-lg border border-border px-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="font-medium">
                {o.fullName}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {[
                    o.nationality,
                    o.sharePercent != null ? `${o.sharePercent}%` : null,
                    o.uaeResident ? null : 'non-resident',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        request(`/agency/kyc/owners/${o.id}`, {
                          tenantId: agencyId,
                          method: 'DELETE',
                        }),
                      `${o.fullName} removed.`,
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                </Button>
              ) : null}
            </div>
            {row('owner_passport', 'Passport', { ownerId: o.id })}
            {o.uaeResident ? row('owner_emirates_id', 'Emirates ID', { ownerId: o.id }) : null}
          </div>
        ))}
        {canEdit ? (
          <form onSubmit={onAddOwner} className="grid gap-2 sm:grid-cols-4" noValidate>
            <Input
              name="fullName"
              aria-label="Owner full name"
              placeholder="Full name as on passport"
              required
              className="sm:col-span-2"
            />
            <Input name="nationality" aria-label="Nationality" placeholder="Nationality" />
            <Input
              name="sharePercent"
              aria-label="Share %"
              placeholder="Share %"
              type="number"
              min={0}
              max={100}
            />
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="uaeResident" defaultChecked /> Lives in the UAE (has an
              Emirates ID)
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              Add owner
            </Button>
          </form>
        ) : null}
      </Section>

      <Section
        title="Employees"
        hint="Everyone working at the agency. Brokers need their BRN and DLD broker card; everyone needs an Emirates ID."
      >
        {kyc.employees.map((e) => (
          <div key={e.id} className="mb-3 rounded-lg border border-border px-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="font-medium">
                {e.fullName}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {[
                    e.designation,
                    e.isBroker ? `Broker${e.brn ? ` · BRN ${e.brn}` : ' · BRN missing'}` : 'Staff',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </p>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        request(`/agency/kyc/employees/${e.id}`, {
                          tenantId: agencyId,
                          method: 'DELETE',
                        }),
                      `${e.fullName} removed.`,
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                </Button>
              ) : null}
            </div>
            {row('employee_emirates_id', 'Emirates ID', { employeeId: e.id })}
            {e.isBroker
              ? row('employee_brn_card', 'DLD broker card (BRN)', { employeeId: e.id })
              : null}
          </div>
        ))}
        {canEdit ? (
          <form onSubmit={onAddEmployee} className="grid gap-2 sm:grid-cols-4" noValidate>
            <Input
              name="fullName"
              aria-label="Employee full name"
              placeholder="Full name"
              required
            />
            <Input name="designation" aria-label="Designation" placeholder="Designation" />
            <Input name="brn" aria-label="BRN" placeholder="BRN (brokers)" />
            <Input name="email" aria-label="Email" placeholder="Email (optional)" type="email" />
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" name="isBroker" defaultChecked /> Registered broker (has a DLD
              broker card)
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              Add employee
            </Button>
          </form>
        ) : null}
        <div className="mt-4">
          <p className="text-sm font-medium">Staff list file (optional)</p>
          {lists.map((d) => (
            <DocRow
              key={d.id}
              agencyId={agencyId}
              type="employee_list"
              title="Employee list"
              doc={d}
              canEdit={canEdit}
              aiAvailable={kyc.aiAvailable}
              onSaved={saved}
            />
          ))}
          {lists.length === 0 ? (
            <DocRow
              agencyId={agencyId}
              type="employee_list"
              title="Employee list (e.g. MOHRE list)"
              optional
              canEdit={canEdit}
              aiAvailable={kyc.aiAvailable}
              onSaved={saved}
            />
          ) : null}
        </div>
      </Section>

      <Section
        title="Other permits (optional)"
        hint="Any other permit your office holds. Advertising permits for each listing are added on the listing itself."
      >
        {permits.map((d) => (
          <DocRow
            key={d.id}
            agencyId={agencyId}
            type="permit"
            title={d.label ?? 'Permit'}
            doc={d}
            canEdit={canEdit}
            aiAvailable={kyc.aiAvailable}
            onSaved={saved}
          />
        ))}
        <DocRow
          key={`new-permit-${permits.length}`}
          agencyId={agencyId}
          type="permit"
          title="Add a permit"
          optional
          canEdit={canEdit}
          aiAvailable={kyc.aiAvailable}
          onSaved={saved}
        />
      </Section>

      {kyc.approvalStatus === 'pending' ? (
        <Alert tone="info">
          Sent to PropForce. We check each document and tell you here if anything needs fixing.
        </Alert>
      ) : null}
      {showSubmit ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {kyc.checklist.complete
              ? 'Everything is uploaded. Send it to PropForce for review.'
              : 'Upload everything above to send it for review. You can leave now and come back later.'}
          </p>
          <Button disabled={busy || !kyc.checklist.complete} onClick={() => void submit()}>
            Send for review
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

'use client';

import { FileText, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type Permit, type PropertyDetail } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prepareForUpload } from '@/lib/images';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' });
const today = () => new Date(new Date().toDateString());
export const permitExpired = (p: Permit) => new Date(p.validUntil) < today();
/** A permit counts once its number or its document is on file and it has not expired. */
export const permitCounts = (p: Permit) =>
  !permitExpired(p) && (Boolean(p.permitNumber) || Boolean(p.document));

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

/** PDFs go as they are; photos of the paper are shrunk in the browser if they are large. */
async function documentBody(file: File): Promise<Blob> {
  if (file.type === 'application/pdf') {
    if (file.size > 4 * 1024 * 1024) throw new Error('The PDF must be under 4 MB.');
    return file;
  }
  return prepareForUpload(file);
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError || err instanceof Error ? err.message : fallback;

/**
 * Advertising permits: number and/or the permit document, with an expiry date. A listing shows on
 * the portal only while one of them is valid; renewing an expired one brings it back.
 */
export function PermitsCard({
  agencyId,
  property,
  canEdit,
  onChanged,
}: {
  agencyId: string;
  property: PropertyDetail;
  canEdit: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  const { request } = useAuth();
  const path = `/properties/${property.id}/permits`;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renewing, setRenewing] = useState<string | null>(null);

  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged(message);
      return true;
    } catch (err) {
      setError(errorText(err, 'Something went wrong.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const upload = async (permitId: string, file: File) => {
    const body = await documentBody(file);
    await request(`${path}/${permitId}/document`, {
      tenantId: agencyId,
      method: 'PUT',
      query: { fileName: file.name.slice(0, 200) },
      body,
    });
  };

  async function openDocument(permit: Permit) {
    setError(null);
    try {
      const blob = await request<Blob>(`${path}/${permit.id}/document`, {
        tenantId: agencyId,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(errorText(err, 'Could not open the document.'));
    }
  }

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const number = String(f.get('permitNumber') ?? '').trim();
    const file = f.get('document');
    const doc = file instanceof File && file.size > 0 ? file : null;
    if (!number && !doc) {
      setError('Enter the permit number or upload the permit document.');
      return;
    }
    void run(async () => {
      const permit = await request<Permit>(path, {
        tenantId: agencyId,
        body: {
          authority: f.get('authority'),
          purpose: f.get('purpose'),
          permitNumber: number || null,
          validUntil: f.get('validUntil'),
          verificationUrl: String(f.get('verificationUrl') ?? '').trim() || null,
        },
      });
      if (doc) await upload(permit.id, doc);
      form.reset();
    }, 'Permit added.');
  }

  function onRenew(e: FormEvent<HTMLFormElement>, permit: Permit) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const number = String(f.get('permitNumber') ?? '').trim();
    const qr = String(f.get('verificationUrl') ?? '').trim() || null;
    const file = f.get('document');
    const doc = file instanceof File && file.size > 0 ? file : null;
    const changes = {
      ...(f.get('validUntil') ? { validUntil: f.get('validUntil') } : {}),
      ...(number && number !== permit.permitNumber ? { permitNumber: number } : {}),
      ...(qr !== (permit.verificationUrl ?? null) ? { verificationUrl: qr } : {}),
    };
    if (Object.keys(changes).length === 0 && !doc) {
      setError('Nothing to save: change the date, number, QR link or document.');
      return;
    }
    void run(async () => {
      if (Object.keys(changes).length > 0) {
        await request(`${path}/${permit.id}`, {
          tenantId: agencyId,
          method: 'PATCH',
          body: changes,
        });
      }
      if (doc) await upload(permit.id, doc);
    }, 'Permit updated.').then((ok) => ok && setRenewing(null));
  }

  return (
    <Card>
      <h2 className="font-medium">Advertising permits</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload the permit issued by the regulator (for example a DLD Trakheesi permit in Dubai) as a
        PDF or a photo, and its expiry date. The number is optional if you upload the document. The
        document stays private to your agency. When the permit expires the listing is taken off the
        portal automatically until you renew it. We store what you upload; we do not check it with
        the regulator. Paste the link from the permit&apos;s QR code and the portal shows the QR on
        the listing, so buyers can check the permit themselves.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {property.permits.length > 0 ? (
        <ul className="mt-3 divide-y divide-border text-sm">
          {property.permits.map((permit) => {
            const expired = permitExpired(permit);
            return (
              <li key={permit.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {permit.authority} · {permit.permitNumber ?? 'No number'} ·{' '}
                    {permit.purpose ? (
                      <span
                        className={
                          permit.purpose !== property.listingType ? 'font-medium text-red-600' : ''
                        }
                        title={
                          permit.purpose !== property.listingType
                            ? 'This permit is for a different purpose than the listing'
                            : undefined
                        }
                      >
                        for {permit.purpose} ·{' '}
                      </span>
                    ) : null}
                    <span
                      className={expired ? 'font-medium text-red-600' : 'text-muted-foreground'}
                    >
                      {expired ? 'expired' : 'valid until'} {date(permit.validUntil)}
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {permit.document ? (
                      <Button variant="ghost" size="sm" onClick={() => void openDocument(permit)}>
                        <FileText className="h-4 w-4" aria-hidden /> View document
                      </Button>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">No document</span>
                    )}
                    {canEdit ? (
                      <>
                        <Button
                          variant={expired ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => setRenewing(renewing === permit.id ? null : permit.id)}
                        >
                          <RefreshCw className="h-4 w-4" aria-hidden />{' '}
                          {expired ? 'Renew' : 'Update'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove permit ${permit.permitNumber ?? permit.authority}`}
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                request(`${path}/${permit.id}`, {
                                  tenantId: agencyId,
                                  method: 'DELETE',
                                }),
                              'Permit removed.',
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden /> Remove
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {renewing === permit.id ? (
                  <form
                    onSubmit={(e) => onRenew(e, permit)}
                    className="mt-2 grid gap-3 rounded-lg bg-muted p-3 sm:grid-cols-2 sm:items-end"
                  >
                    <Field id={`renew-number-${permit.id}`} label="Permit number (optional)">
                      <Input
                        id={`renew-number-${permit.id}`}
                        name="permitNumber"
                        defaultValue={permit.permitNumber ?? ''}
                      />
                    </Field>
                    <Field
                      id={`renew-until-${permit.id}`}
                      label={expired ? 'New expiry date' : 'New expiry date (empty keeps it)'}
                    >
                      <Input
                        id={`renew-until-${permit.id}`}
                        name="validUntil"
                        type="date"
                        required={expired}
                      />
                    </Field>
                    <Field id={`renew-qr-${permit.id}`} label="QR code link (optional)">
                      <Input
                        id={`renew-qr-${permit.id}`}
                        name="verificationUrl"
                        type="url"
                        placeholder="https://…gov.ae/…"
                        defaultValue={permit.verificationUrl ?? ''}
                      />
                    </Field>
                    <Field id={`renew-doc-${permit.id}`} label="New permit document (optional)">
                      <Input
                        id={`renew-doc-${permit.id}`}
                        name="document"
                        type="file"
                        accept={ACCEPT}
                      />
                    </Field>
                    <Button type="submit" disabled={busy}>
                      Save
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canEdit ? (
        <form
          onSubmit={onAdd}
          className="mt-4 grid gap-3 sm:grid-cols-[7rem_7rem_1fr_10rem] sm:items-end"
        >
          <Field id="authority" label="Authority">
            <Input id="authority" name="authority" defaultValue="DLD" required />
          </Field>
          <Field id="purpose" label="Permit for">
            <Select id="purpose" name="purpose" defaultValue={property.listingType} required>
              <option value="sale">Sale</option>
              <option value="rent">Rent</option>
            </Select>
          </Field>
          <Field id="permitNumber" label="Permit number (optional)">
            <Input id="permitNumber" name="permitNumber" />
          </Field>
          <Field id="validUntil" label="Expiry date">
            <Input id="validUntil" name="validUntil" type="date" required />
          </Field>
          <div className="sm:col-span-4">
            <Field id="verificationUrl" label="QR code link (optional)">
              <Input
                id="verificationUrl"
                name="verificationUrl"
                type="url"
                placeholder="https://…gov.ae/… (scan the permit QR code with your phone and paste the link)"
              />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field id="permitDocument" label="Permit document (PDF or photo)">
              <Input id="permitDocument" name="document" type="file" accept={ACCEPT} />
            </Field>
          </div>
          <Button type="submit" variant="outline" disabled={busy}>
            {busy ? 'Saving…' : 'Add permit'}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

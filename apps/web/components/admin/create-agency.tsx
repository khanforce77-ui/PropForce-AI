'use client';

import { Building2, Copy, Mail, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, type PlatformAgency } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getSupportedEmirates } from '@/lib/env';

const EMIRATES = getSupportedEmirates();
const limit = (v: string) => (v.trim() === '' ? null : Number(v));

type FieldErrors = Record<string, string>;

const fieldErrors = (err: unknown): FieldErrors => (err instanceof ApiError ? err.fieldErrors : {});

/** "Add agency" form: creates a live agency and, optionally, emails its owner an invitation. */
export function CreateAgencyCard({
  onCreated,
  onCancel,
}: {
  onCreated: (message: string, inviteUrl?: string) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const body = {
      name: s('name'),
      emirate: s('emirate'),
      ...(s('orn') ? { orn: s('orn') } : {}),
      ...(s('tradeLicenseNo') ? { tradeLicenseNo: s('tradeLicenseNo') } : {}),
      plan: s('plan') || 'trial',
      seatLimit: limit(s('seatLimit')),
      listingLimit: limit(s('listingLimit')),
      ...(s('ownerEmail') ? { ownerEmail: s('ownerEmail') } : {}),
    };
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const res = await request<{
        agencyId: string;
        invitation: { email: string; emailed: boolean; inviteUrl: string } | null;
      }>('/platform/agencies', { method: 'POST', body });
      onCreated(
        res.invitation
          ? res.invitation.emailed
            ? `${body.name} created. Invitation emailed to ${res.invitation.email}.`
            : `${body.name} created, but the invitation email could not be sent. Copy the link below and send it on WhatsApp.`
          : `${body.name} created. Open it to add listings and team members.`,
        res.invitation?.inviteUrl,
      );
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : 'Could not create the agency.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/30 shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h3 className="font-semibold">Add an agency</h3>
            <p className="text-sm text-muted-foreground">
              It goes live straight away. The owner gets an email to set their password.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {error ? <Alert className="mt-4">{error}</Alert> : null}
      <form onSubmit={(e) => void submit(e)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field id="ca-name" label="Agency name" error={errors.name}>
          <Input id="ca-name" name="name" required minLength={2} maxLength={120} />
        </Field>
        <Field id="ca-emirate" label="Emirate" error={errors.emirate}>
          <Select id="ca-emirate" name="emirate" defaultValue={EMIRATES[0] ?? 'Dubai'}>
            {EMIRATES.map((em) => (
              <option key={em}>{em}</option>
            ))}
          </Select>
        </Field>
        <Field id="ca-orn" label="ORN (RERA office number)" error={errors.orn}>
          <Input id="ca-orn" name="orn" maxLength={40} />
        </Field>
        <Field id="ca-tl" label="Trade licence number" error={errors.tradeLicenseNo}>
          <Input id="ca-tl" name="tradeLicenseNo" maxLength={60} />
        </Field>
        <Field id="ca-plan" label="Plan" error={errors.plan}>
          <Input id="ca-plan" name="plan" defaultValue="trial" maxLength={40} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="ca-seats" label="Seat limit" error={errors.seatLimit}>
            <Input id="ca-seats" name="seatLimit" type="number" min={1} placeholder="No limit" />
          </Field>
          <Field id="ca-listings" label="Listing limit" error={errors.listingLimit}>
            <Input
              id="ca-listings"
              name="listingLimit"
              type="number"
              min={0}
              placeholder="No limit"
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field
            id="ca-owner"
            label="Owner's email (optional)"
            hint="They get an invitation to become the owner. Leave empty to set it up yourself first."
            error={errors.ownerEmail}
          >
            <Input id="ca-owner" name="ownerEmail" type="email" maxLength={254} />
          </Field>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create agency'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Inline editor for an agency's name, emirate, ORN and trade licence. */
export function AgencyDetailsForm({
  agency,
  onSaved,
  onCancel,
}: {
  agency: PlatformAgency;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      await request(`/platform/agencies/${agency.id}/details`, {
        method: 'PATCH',
        body: {
          name: s('name'),
          emirate: s('emirate'),
          orn: s('orn') || null,
          tradeLicenseNo: s('tradeLicenseNo') || null,
        },
      });
      onSaved(`Details saved for ${s('name')}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const id = `det-${agency.id}`;
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-2 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-4"
    >
      {error ? <Alert className="sm:col-span-4">{error}</Alert> : null}
      <Field id={`${id}-name`} label="Name">
        <Input
          id={`${id}-name`}
          name="name"
          defaultValue={agency.name}
          required
          minLength={2}
          maxLength={120}
        />
      </Field>
      <Field id={`${id}-em`} label="Emirate">
        <Select id={`${id}-em`} name="emirate" defaultValue={agency.emirate}>
          {[...new Set([agency.emirate, ...EMIRATES])].map((em) => (
            <option key={em}>{em}</option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-orn`} label="ORN">
        <Input id={`${id}-orn`} name="orn" defaultValue={agency.orn ?? ''} maxLength={40} />
      </Field>
      <Field id={`${id}-tl`} label="Trade licence">
        <Input
          id={`${id}-tl`}
          name="tradeLicenseNo"
          defaultValue={agency.tradeLicenseNo ?? ''}
          maxLength={60}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-4">
        <Button type="submit" size="sm" disabled={busy}>
          Save details
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Emails someone an invitation to own or manage an agency. */
export function InviteToAgencyForm({
  agency,
  onSent,
  onCancel,
}: {
  agency: PlatformAgency;
  onSent: (message: string, inviteUrl?: string) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const role = String(f.get('role') ?? 'owner');
    setBusy(true);
    setError(null);
    try {
      const res = await request<{ emailed: boolean; inviteUrl: string }>(
        `/platform/agencies/${agency.id}/invitations`,
        { method: 'POST', body: { email, role } },
      );
      onSent(
        res.emailed
          ? `Invitation emailed to ${email} (${role} of ${agency.name}).`
          : `Invitation created for ${email}, but the email could not be sent. Copy the link below and send it on WhatsApp.`,
        res.inviteUrl,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  };
  const id = `inv-${agency.id}`;
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
    >
      {error ? <Alert className="w-full">{error}</Alert> : null}
      <div className="min-w-60 flex-1">
        <Field id={`${id}-email`} label="Email">
          <Input id={`${id}-email`} name="email" type="email" required maxLength={254} />
        </Field>
      </div>
      <Field id={`${id}-role`} label="Role">
        <Select id={`${id}-role`} name="role" defaultValue={agency.owner ? 'admin' : 'owner'}>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <Button type="submit" size="sm" disabled={busy}>
        <Mail className="h-4 w-4" aria-hidden /> Send invitation
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** Shows an invitation link with a copy button, for sharing on WhatsApp when email fails. */
export function InviteLinkBox({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-background p-4 shadow-sm">
      <p className="text-sm font-medium">Invitation link (valid 7 days, works once)</p>
      <p className="text-xs text-muted-foreground">
        Send it only to the person invited, for example on WhatsApp. They sign up with the invited
        email address.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          readOnly
          value={url}
          aria-label="Invitation link"
          className="min-w-60 flex-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button type="button" onClick={() => void copy()}>
          <Copy className="h-4 w-4" aria-hidden /> {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} aria-label="Hide link">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

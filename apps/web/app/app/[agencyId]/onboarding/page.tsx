'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { AgencyDocuments } from '@/components/kyc/agency-documents';
import { ApiError, type Agency, type AgencyKyc } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Owner onboarding: confirm the agency's legal details, then activate the agency. When PropForce
 * requires registration documents (Dubai KYC), the owner uploads them here and sends them for
 * review instead; the agency goes live once PropForce approves them.
 */
export default function OnboardingPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const router = useRouter();
  const { request, refreshMe } = useAuth();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kycRequired, setKycRequired] = useState<boolean | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => {
    request<Agency>('/agency', { tenantId: agencyId })
      .then(setAgency)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the agency.'),
      );
    request<AgencyKyc>('/agency/kyc', { tenantId: agencyId })
      .then((k) => setKycRequired(k.required))
      .catch(() => setKycRequired(false));
  }, [agencyId, request]);

  async function onSaveName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setErrors({});
    setNameSaved(false);
    try {
      await request('/agency', {
        method: 'PATCH',
        tenantId: agencyId,
        body: { name: f.get('name') },
      });
      await refreshMe();
      setNameSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(err.message);
      } else setError('Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const optional = (k: string) => {
      const v = String(f.get(k) ?? '').trim();
      return v === '' ? null : v;
    };
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await request('/agency', {
        method: 'PATCH',
        tenantId: agencyId,
        body: {
          name: f.get('name'),
          tradeLicenseNo: optional('tradeLicenseNo'),
          orn: optional('orn'),
        },
      });
      const done = await request<{ approvalStatus?: string }>('/agency/onboarding/complete', {
        method: 'POST',
        tenantId: agencyId,
      });
      await refreshMe();
      router.replace(
        done.approvalStatus === 'pending'
          ? `/app/${agencyId}`
          : `/app/${agencyId}/settings/members?welcome=1`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(err.message);
      } else setError('Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!agency || kycRequired === null)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );

  if (kycRequired) {
    return (
      <div className="flex max-w-4xl flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Set up your agency</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            PropForce checks every Dubai agency before it goes live. Upload your company documents
            and your owners’ and team’s IDs. You can save and come back any time.
          </p>
        </div>
        <Card>
          <form onSubmit={onSaveName} className="flex flex-wrap items-end gap-3" noValidate>
            <div className="min-w-64 flex-1">
              <Field id="name" label="Agency name (as on the trade licence)" error={errors.name}>
                <Input id="name" name="name" defaultValue={agency.name} required />
              </Field>
            </div>
            <Button type="submit" variant="outline" disabled={busy}>
              {nameSaved ? 'Saved' : 'Save name'}
            </Button>
          </form>
          {error ? <Alert className="mt-3">{error}</Alert> : null}
        </Card>
        <AgencyDocuments
          agencyId={agencyId}
          onboarding
          onSubmitted={async () => {
            await refreshMe();
            router.replace(`/app/${agencyId}`);
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your agency</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        These details appear on listings and documents. You can change them later in settings.
      </p>
      <Card className="mt-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error ? <Alert>{error}</Alert> : null}
          <Field id="name" label="Agency name" error={errors.name}>
            <Input id="name" name="name" defaultValue={agency.name} required />
          </Field>
          <Field
            id="tradeLicenseNo"
            label="Trade licence number"
            error={errors.tradeLicenseNo}
            hint="Optional"
          >
            <Input
              id="tradeLicenseNo"
              name="tradeLicenseNo"
              defaultValue={agency.tradeLicenseNo ?? ''}
            />
          </Field>
          <Field
            id="orn"
            label="Office registration number (ORN)"
            error={errors.orn}
            hint="Optional. Issued by the Dubai Land Department / RERA for Dubai brokerages."
          >
            <Input id="orn" name="orn" defaultValue={agency.orn ?? ''} />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Finish setup'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

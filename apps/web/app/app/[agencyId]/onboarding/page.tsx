'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError, type Agency } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Owner onboarding: confirm the agency's legal details, then activate the agency. */
export default function OnboardingPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const router = useRouter();
  const { request, refreshMe } = useAuth();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<Agency>('/agency', { tenantId: agencyId })
      .then(setAgency)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the agency.'),
      );
  }, [agencyId, request]);

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

  if (!agency)
    return error ? (
      <Alert>{error}</Alert>
    ) : (
      <p className="text-sm text-muted-foreground">Loading…</p>
    );

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

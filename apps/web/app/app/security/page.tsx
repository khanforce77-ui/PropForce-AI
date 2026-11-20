'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { landingPath, useAuth } from '@/lib/auth';

function Security() {
  const required = useSearchParams().get('required') === '1';
  const router = useRouter();
  const { me, request, refreshMe } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const res = await request<{ secret: string; otpauthUri: string }>('/me/mfa/totp/setup', {
        method: 'POST',
      });
      setSetup({
        secret: res.secret,
        qr: await QRCode.toDataURL(res.otpauthUri, { margin: 1, width: 200 }),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start setup.');
    }
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      const res = await request<{ recoveryCodes: string[] }>('/me/mfa/totp/confirm', {
        body: { code: String(new FormData(e.currentTarget).get('code') ?? '').trim() },
      });
      setCodes(res.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify the code.');
    }
  }

  async function continueOn() {
    const fresh = await refreshMe();
    if (fresh) router.replace(landingPath(fresh));
  }

  if (codes) {
    return (
      <AuthShell
        title="Save your recovery codes"
        subtitle="Each code works once if you lose your phone. They will not be shown again."
      >
        <ul
          className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm"
          data-testid="recovery-codes"
        >
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button className="mt-6 w-full" onClick={() => void continueOn()}>
          I saved them, continue
        </Button>
      </AuthShell>
    );
  }

  if (me?.user.mfaEnabled) {
    return (
      <AuthShell title="Two-factor authentication">
        <Alert tone="success">Two-factor authentication is on for your account.</Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Turn on two-factor authentication"
      subtitle={
        required ? 'Agency owners and admins must use an authenticator app to sign in.' : undefined
      }
    >
      {error ? <Alert className="mb-4">{error}</Alert> : null}
      {!setup ? (
        <Button className="w-full" onClick={() => void start()}>
          Set up authenticator app
        </Button>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <p className="text-sm">
            Scan this QR code with Google Authenticator, Microsoft Authenticator or 1Password.
          </p>
          <img
            src={setup.qr}
            alt="QR code for your authenticator app"
            width={200}
            height={200}
            className="self-center rounded-lg bg-white p-2"
          />
          <p className="text-xs text-muted-foreground">
            Or enter this key manually:{' '}
            <code data-testid="totp-secret" className="break-all">
              {setup.secret}
            </code>
          </p>
          <Field id="code" label="6-digit code from the app">
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </Field>
          <Button type="submit">Turn on</Button>
        </form>
      )}
    </AuthShell>
  );
}

export default function SecurityPage() {
  return (
    <Suspense>
      <Security />
    </Suspense>
  );
}

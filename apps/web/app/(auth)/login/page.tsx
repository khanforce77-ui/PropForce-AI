'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError, apiRequest, type LoginResponse, type TokenResponse } from '@/lib/api';
import { landingPath, useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const { setSession } = useAuth();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish(token: TokenResponse) {
    const me = await setSession(token);
    router.replace(landingPath(me));
  }

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<LoginResponse>('/auth/login', {
        body: { email: form.get('email'), password: form.get('password') },
      });
      if ('mfaRequired' in res) setMfaToken(res.mfaToken);
      else await finish(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<TokenResponse>('/auth/mfa/verify', {
        body: { mfaToken, ...(useRecovery ? { recoveryCode: value } : { code: value }) },
      });
      await finish(res);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_MFA_CHALLENGE_INVALID') setMfaToken(null);
      setError(err instanceof ApiError ? err.message : 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  }

  if (mfaToken) {
    return (
      <AuthShell
        title="Two-factor authentication"
        subtitle={
          useRecovery
            ? 'Enter one of your recovery codes.'
            : 'Enter the 6-digit code from your authenticator app.'
        }
      >
        <form onSubmit={onCode} className="flex flex-col gap-4" noValidate>
          {error ? <Alert>{error}</Alert> : null}
          <Field id="code" label={useRecovery ? 'Recovery code' : 'Authentication code'}>
            <Input
              id="code"
              name="code"
              autoFocus
              autoComplete="one-time-code"
              inputMode={useRecovery ? 'text' : 'numeric'}
              required
            />
          </Field>
          <Button type="submit" disabled={busy}>
            Verify
          </Button>
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => setUseRecovery((v) => !v)}
          >
            {useRecovery ? 'Use authenticator app instead' : 'Use a recovery code'}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back to PropForce AI.">
      <form onSubmit={onPassword} className="flex flex-col gap-4">
        {error ? <Alert>{error}</Alert> : null}
        <Field id="email" label="Email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field id="password" label="Password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <div className="flex justify-between text-sm">
          <Link href="/forgot-password" className="text-primary hover:underline">
            Forgot password?
          </Link>
          <Link href="/register" className="text-primary hover:underline">
            Create an agency
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function Accept() {
  const token = useSearchParams().get('token') ?? '';
  const { status, request, refreshMe } = useAuth();
  const [done, setDone] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function submit(body: Record<string, unknown>) {
    setError(null);
    setErrors({});
    try {
      await request('/invitations/accept', { body: { token, ...body } });
      if (status === 'signed-in') await refreshMe();
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVITATION_SIGN_IN_REQUIRED')
        setNeedsSignIn(true);
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(err.message);
      } else setError('Something went wrong.');
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void submit({ fullName: f.get('fullName'), password: f.get('password') });
  }

  if (done) {
    return (
      <AuthShell title="You're in">
        <Alert tone="success">Invitation accepted.</Alert>
        <Link
          href={status === 'signed-in' ? '/app' : '/login'}
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          {status === 'signed-in' ? 'Open PropForce' : 'Sign in'}
        </Link>
      </AuthShell>
    );
  }

  if (status === 'signed-in' && !needsSignIn) {
    return (
      <AuthShell title="Join agency" subtitle="Accept this invitation with your current account.">
        {error ? <Alert className="mb-4">{error}</Alert> : null}
        <Button onClick={() => void submit({})} className="w-full">
          Accept invitation
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Join your agency"
      subtitle="Create your PropForce account to accept the invitation."
    >
      {needsSignIn ? (
        <Alert className="mb-4">
          This email already has an account.{' '}
          <Link href="/login" className="underline">
            Sign in
          </Link>
          , then open the invitation link again.
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && !needsSignIn ? <Alert>{error}</Alert> : null}
        <Field id="fullName" label="Your full name" error={errors.fullName}>
          <Input id="fullName" name="fullName" autoComplete="name" required />
        </Field>
        <Field
          id="password"
          label="Choose a password"
          error={errors.password}
          hint="At least 12 characters."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>
        <Button type="submit">Accept invitation</Button>
      </form>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}

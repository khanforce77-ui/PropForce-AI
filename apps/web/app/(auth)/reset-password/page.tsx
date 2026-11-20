'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError, apiRequest } from '@/lib/api';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/auth/password/reset', {
        body: { token, newPassword: new FormData(e.currentTarget).get('password') },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldError(err.fieldErrors.newPassword);
        setError(err.message);
      } else setError('Something went wrong.');
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="You will be signed out of all devices.">
      {done ? (
        <Alert tone="success">Your password was changed. Sign in with your new password.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error ? <Alert>{error}</Alert> : null}
          <Field
            id="password"
            label="New password"
            error={fieldError}
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
          <Button type="submit">Change password</Button>
        </form>
      )}
      <Link href="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
        Go to sign in
      </Link>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}

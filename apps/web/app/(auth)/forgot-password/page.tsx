'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { ApiError, apiRequest } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/auth/password/forgot', {
        body: { email: new FormData(e.currentTarget).get('email') },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  return (
    <AuthShell title="Reset your password">
      {sent ? (
        <Alert tone="success">
          If an account exists for that email, a reset link is on its way.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error ? <Alert>{error}</Alert> : null}
          <Field id="email" label="Email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Button type="submit">Send reset link</Button>
        </form>
      )}
      <Link href="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
        Back to sign in
      </Link>
    </AuthShell>
  );
}

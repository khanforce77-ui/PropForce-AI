'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { ApiError, apiRequest } from '@/lib/api';
import { getSupportedEmirates } from '@/lib/env';

const EMIRATES = getSupportedEmirates();

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const developer = useSearchParams().get('type') === 'developer';
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await apiRequest('/auth/register', {
        body: {
          fullName: f.get('fullName'),
          email: f.get('email'),
          password: f.get('password'),
          agency: { name: f.get('agencyName'), emirate: developer ? 'Dubai' : f.get('emirate') },
          acceptTerms: f.get('acceptTerms') === 'on',
          accountType: developer ? 'developer' : 'agency',
        },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(err.message);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell title="Check your email">
        <Alert tone="success">
          We sent a verification link to your inbox. Open it to activate your account, then sign in.
        </Alert>
        <Link href="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={developer ? 'Register as a developer' : 'Create your agency'}
      subtitle={
        developer
          ? 'For Dubai property developers: buyer payment plans with automatic reminders by email, SMS and AI call.'
          : 'Set up PropForce AI for your brokerage.'
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert>{error}</Alert> : null}
        <Field id="fullName" label="Your full name" error={errors.fullName}>
          <Input id="fullName" name="fullName" autoComplete="name" required />
        </Field>
        <Field id="email" label="Work email" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password}
          hint="At least 12 characters. A passphrase works well."
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>
        <Field
          id="agencyName"
          label={developer ? 'Developer company name' : 'Agency name'}
          error={errors['agency.name']}
        >
          <Input id="agencyName" name="agencyName" autoComplete="organization" required />
        </Field>
        {developer ? (
          <p className="text-xs text-muted-foreground">
            Developer accounts are for Dubai.{' '}
            {errors['agency.emirate'] ? (
              <span className="text-red-600">{errors['agency.emirate']}</span>
            ) : null}
          </p>
        ) : (
          <Field id="emirate" label="Emirate" error={errors['agency.emirate']}>
            <Select id="emirate" name="emirate" defaultValue="Dubai">
              {EMIRATES.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </Select>
          </Field>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="acceptTerms" className="mt-0.5" required />
          <span>I accept the terms of service and privacy policy.</span>
        </label>
        {errors.acceptTerms ? <p className="text-xs text-red-600">{errors.acceptTerms}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : developer ? 'Create developer account' : 'Create agency'}
        </Button>
        <p className="text-sm text-muted-foreground">
          {developer ? (
            <>
              Are you a brokerage?{' '}
              <Link href="/register" className="text-primary hover:underline">
                Register an agency
              </Link>
            </>
          ) : (
            <>
              Are you a property developer?{' '}
              <Link href="/register?type=developer" className="text-primary hover:underline">
                Register as a developer
              </Link>
            </>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

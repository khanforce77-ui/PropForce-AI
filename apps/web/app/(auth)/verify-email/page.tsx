'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui/card';
import { ApiError, apiRequest } from '@/lib/api';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // tokens are single use; never submit twice
    started.current = true;
    if (!token) {
      setState('error');
      setMessage('This link is missing its token.');
      return;
    }
    apiRequest('/auth/verify-email', { body: { token } })
      .then(() => setState('ok'))
      .catch((err: unknown) => {
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'Verification failed.');
      });
  }, [token]);

  return (
    <AuthShell title="Verify your email">
      {state === 'working' ? <Alert tone="info">Verifying…</Alert> : null}
      {state === 'ok' ? (
        <Alert tone="success">Your email is verified. You can sign in now.</Alert>
      ) : null}
      {state === 'error' ? <Alert>{message}</Alert> : null}
      <Link href="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
        Go to sign in
      </Link>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}

'use client';

import Link from 'next/link';
import { AuthShell } from '@/components/auth-shell';
import { Alert } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

/** Agency picker for people who belong to more than one agency. */
export default function AgencyPickerPage() {
  const { me } = useAuth();
  const memberships = me?.memberships ?? [];
  return (
    <AuthShell title="Choose an agency">
      {me?.user.isPlatformAdmin ? (
        <Link
          href="/app/admin"
          className="mb-4 flex items-center justify-between rounded-lg border border-primary px-4 py-3 hover:bg-muted"
        >
          <span className="font-medium">Platform admin dashboard</span>
          <span className="text-xs text-muted-foreground">All agencies</span>
        </Link>
      ) : null}
      {memberships.length === 0 ? (
        <Alert tone="info">
          You are not a member of any agency yet. Ask your agency admin for an invitation.
        </Alert>
      ) : (
        <ul className="flex flex-col gap-2">
          {memberships.map((m) => (
            <li key={m.id}>
              <Link
                href={`/app/${m.agency.id}`}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3 hover:bg-muted"
              >
                <span className="font-medium">{m.agency.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AuthShell>
  );
}

'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert, Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

export default function DashboardPage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const { me } = useAuth();
  const m = me?.memberships.find((x) => x.agency.id === agencyId);
  if (!m) return null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {me?.user.fullName.split(' ')[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {m.agency.name} · {m.agency.emirate}
        </p>
      </div>
      {m.agency.status === 'pending' && m.role === 'owner' ? (
        <Alert tone="info">
          Finish setting up your agency.{' '}
          <Link href={`/app/${agencyId}/onboarding`} className="font-medium underline">
            Continue onboarding
          </Link>
        </Alert>
      ) : null}
      <Card>
        <h2 className="font-medium">Coming next</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Property inventory, CRM and property matching are the next Phase 1 milestones.
        </p>
      </Card>
    </div>
  );
}

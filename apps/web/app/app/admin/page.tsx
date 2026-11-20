'use client';

import { LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ApiError, type PlatformAgency, type PlatformSummary, type PlatformUser } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' }) : '—';

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  cancelled: 'bg-muted text-muted-foreground',
};

function Stat({ label, value, hint }: { label: string; value?: number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value ?? '–'}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export default function PlatformAdminPage() {
  const router = useRouter();
  const { me, request, signOut } = useAuth();
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [agencies, setAgencies] = useState<PlatformAgency[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me?.user.isPlatformAdmin === true;

  useEffect(() => {
    if (me && !isAdmin) router.replace('/app');
  }, [me, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      try {
        const [s, a, u] = await Promise.all([
          request<PlatformSummary>('/platform/summary'),
          request<{ data: PlatformAgency[] }>('/platform/agencies'),
          request<{ data: PlatformUser[] }>('/platform/users'),
        ]);
        setSummary(s);
        setAgencies(a.data);
        setUsers(u.data);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
          router.replace('/app/security?required=1');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Could not load the platform dashboard.');
      }
    })();
  }, [isAdmin, request, router]);

  if (!isAdmin) return null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:px-10 md:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Platform admin</h1>
            <p className="text-sm text-muted-foreground">PropForce AI · all agencies</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {me.memberships.length > 0 ? (
            <Link href="/app" className="text-sm underline">
              My agency dashboard
            </Link>
          ) : null}
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut().then(() => router.replace('/login'))}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </Button>
        </div>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <section aria-label="Platform at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Agencies"
          value={summary?.agencies.total}
          hint={summary ? `${summary.agencies.newThisWeek} new this week` : undefined}
        />
        <Stat
          label="Still onboarding"
          value={summary?.agencies.pending}
          hint="Signed up, setup not finished"
        />
        <Stat
          label="Users"
          value={summary?.users.total}
          hint={summary ? `${summary.users.newThisWeek} new this week` : undefined}
        />
        <Stat
          label="Live listings"
          value={summary?.listings.live}
          hint={summary ? `${summary.listings.total} listings in total` : undefined}
        />
      </section>

      <Card className="p-0">
        <h2 className="px-6 pt-5 font-medium">Agencies</h2>
        {agencies.length === 0 ? (
          <p className="px-6 pt-2 pb-5 text-sm text-muted-foreground">No agencies yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-6 py-3 font-medium">Agency</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium">Listings</th>
                  <th className="px-4 py-3 font-medium">Signed up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {agencies.map((a) => (
                  <tr key={a.id}>
                    <td className="px-6 py-3">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.emirate}
                        {a.orn ? ` · ORN ${a.orn}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {a.owner ? (
                        <>
                          <p>{a.owner.fullName}</p>
                          <p className="text-xs text-muted-foreground">{a.owner.email}</p>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                          STATUS_TONE[a.status] ?? STATUS_TONE.cancelled,
                        )}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{a.members}</td>
                    <td className="px-4 py-3 tabular-nums">{a.listings}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{date(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-medium">Recent sign-ups</h2>
        <ul className="mt-3 divide-y divide-border text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{u.fullName}</span>{' '}
                <span className="text-muted-foreground">{u.email}</span>
                {!u.emailVerifiedAt ? (
                  <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
                    email not verified
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {u.memberships.map((m) => `${m.agency.name} (${m.role})`).join(', ') || 'No agency'}{' '}
                · joined {date(u.createdAt)} · last sign-in {date(u.lastLoginAt)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

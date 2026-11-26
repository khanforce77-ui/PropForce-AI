'use client';

import {
  Building2,
  Calculator,
  CreditCard,
  CalendarDays,
  Contact,
  FileUp,
  Handshake,
  Globe,
  Home,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Rocket,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { AppNoticeBar } from '@/components/app-notice';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { AgencyContext, type AgencyMembership } from '@/lib/agency-context';
import type { Membership } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

export default function AgencyLayout({ children }: { children: ReactNode }) {
  const { agencyId } = useParams<{ agencyId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const { me, request, signOut } = useAuth();
  const own = me?.memberships.find((m) => m.agency.id === agencyId);
  const isPlatformAdmin = me?.user.isPlatformAdmin === true;
  const [platformView, setPlatformView] = useState<AgencyMembership | null>(null);

  // A platform admin may open any agency; the API grants admin rights and audits every change.
  useEffect(() => {
    if (!me || own || !isPlatformAdmin) return;
    let cancelled = false;
    void request<Membership['agency']>('/agency', { tenantId: agencyId })
      .then((agency) => {
        if (!cancelled) setPlatformView({ id: '', role: 'admin', agency, platform: true });
      })
      .catch(() => router.replace('/app/admin'));
    return () => {
      cancelled = true;
    };
  }, [me, own, isPlatformAdmin, agencyId, request, router]);

  const membership: AgencyMembership | null = own ? { ...own, platform: false } : platformView;

  useEffect(() => {
    if (me && !own && !isPlatformAdmin) router.replace('/app');
    else if (
      me?.mfaRequired &&
      !me.user.mfaEnabled &&
      own &&
      ['owner', 'admin'].includes(own.role)
    ) {
      router.replace('/app/security?required=1');
    }
  }, [me, own, isPlatformAdmin, router]);

  if (!membership) return null;
  // Platform admins still see a suspended or closed agency's data.
  const closed =
    !membership.platform && ['suspended', 'cancelled'].includes(membership.agency.status);
  const base = `/app/${agencyId}`;
  const isActive = (href: string) =>
    href === base ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
  const nav = [
    { href: base, label: 'Dashboard', icon: LayoutDashboard },
    { href: `${base}/listings`, label: 'Listings', icon: Home },
    { href: `${base}/inbox`, label: 'Inbox', icon: Inbox },
    { href: `${base}/leads`, label: 'Leads', icon: KanbanSquare },
    { href: `${base}/calendar`, label: 'Calendar', icon: CalendarDays },
    { href: `${base}/deals`, label: 'Deals', icon: Handshake },
    { href: `${base}/contacts`, label: 'Contacts', icon: Contact },
    { href: `${base}/import`, label: 'Bulk import', icon: FileUp },
    ...(['owner', 'admin', 'manager'].includes(membership.role)
      ? [{ href: `${base}/booster`, label: 'Lead Booster', icon: Rocket }]
      : []),
    { href: `${base}/portal`, label: 'Property portal', icon: Globe },
    { href: `${base}/calculator`, label: 'Cost calculator', icon: Calculator },
    { href: `${base}/settings/members`, label: 'Team members', icon: Users },
    ...(membership.role === 'owner' || membership.role === 'admin'
      ? [{ href: `${base}/billing`, label: 'Plan & billing', icon: CreditCard }]
      : []),
    ...(membership.role === 'owner' || membership.role === 'admin'
      ? [{ href: `${base}/settings/whatsapp`, label: 'WhatsApp', icon: MessageCircle }]
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-muted md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4">
          <Building2 className="h-5 w-5 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{membership.agency.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {membership.platform ? 'Platform admin view' : membership.role}
            </p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col" aria-label="Main">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap hover:bg-background',
                isActive(href) && 'bg-background font-medium',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden items-center justify-between px-4 py-4 md:flex">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut().then(() => router.replace('/login'))}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-10 md:py-10">
        <AppNoticeBar />
        {isPlatformAdmin ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
            <span>
              {membership.platform
                ? `You are viewing ${membership.agency.name} as platform admin. You can change anything here, and every change is logged.`
                : `You are in ${membership.agency.name}.`}
              {membership.platform && membership.agency.status !== 'active'
                ? ` Status: ${membership.agency.status}.`
                : ''}
            </span>
            <Link href="/app/admin" className="font-medium underline">
              Back to platform admin
            </Link>
          </div>
        ) : null}
        {closed ? (
          <div className="max-w-xl rounded-xl border border-red-300 bg-red-50 p-6 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            <h1 className="text-lg font-semibold">
              {membership.agency.approvalStatus === 'rejected'
                ? 'Your agency was not approved'
                : membership.agency.status === 'suspended'
                  ? 'Your agency is suspended'
                  : 'Your agency is closed'}
            </h1>
            {membership.agency.statusReason ? (
              <p className="mt-2 text-sm">Reason: {membership.agency.statusReason}</p>
            ) : null}
            <p className="mt-2 text-sm">
              Contact PropForce support if you think this is a mistake.
            </p>
          </div>
        ) : (
          <AgencyContext.Provider value={membership}>{children}</AgencyContext.Provider>
        )}
      </main>
    </div>
  );
}

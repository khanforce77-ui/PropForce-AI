'use client';

import {
  Activity,
  BadgeCheck,
  BadgeDollarSign,
  Crown,
  Bot,
  Building2,
  Calculator,
  CalendarDays,
  CreditCard,
  FileUp,
  Globe,
  Handshake,
  Home,
  Images,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  Phone,
  Plus,
  Rocket,
  Settings,
  ShieldCheck,
  Shuffle,
  Users,
  type LucideIcon,
  Flag,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { DailyBarChart } from '@/components/admin/bar-chart';
import { AdminBrokerVerifications } from '@/components/admin/broker-verifications';
import {
  AgencyDetailsForm,
  CreateAgencyCard,
  InviteToAgencyForm,
} from '@/components/admin/create-agency';
import { AdminListingReports } from '@/components/admin/listing-reports';
import { AdminListingReview } from '@/components/admin/listing-review';
import { PlatformSettingsCard } from '@/components/admin/platform-settings';
import { WebsiteContent } from '@/components/admin/website-content';
import { StatusBadge } from '@/components/listings/status-badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import {
  ApiError,
  type PlatformAgency,
  type PlatformListing,
  type PlatformAuditEntry,
  type PlatformDashboard,
  type PlatformSetting,
  type PlatformSummary,
  type PlatformUser,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatPrice, titleCase } from '@/lib/listings';
import { cn } from '@/lib/utils';

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-AE', { dateStyle: 'medium' }) : '—';
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' });

const TONE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  cancelled: 'bg-muted text-muted-foreground',
};

function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize',
        TONE[value] ?? TONE.cancelled,
      )}
    >
      {label ?? value.replace(/_/g, ' ')}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value?: number | undefined;
  hint?: string | undefined;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', accent)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span
          className={cn(
            'grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br text-white shadow-sm',
            accent,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value ?? '–'}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

/** Inline "reason" form used for reject / suspend, so no browser dialogs are needed. */
function ReasonForm({
  id,
  action,
  onSubmit,
  onCancel,
}: {
  id: string;
  action: string;
  onSubmit: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(reason.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-wrap items-end gap-2">
      <div className="flex min-w-60 flex-1 flex-col gap-1">
        <Label htmlFor={id}>Reason (the agency or user will see this)</Label>
        <Input
          id={id}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={3}
          maxLength={500}
          required
          autoFocus
        />
      </div>
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={busy || reason.trim().length < 3}
      >
        Confirm {action}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function PlanForm({
  agency,
  onSave,
  onCancel,
}: {
  agency: PlatformAgency;
  onSave: (body: {
    plan: string;
    seatLimit: number | null;
    listingLimit: number | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState(agency.plan);
  const [seats, setSeats] = useState(agency.seatLimit?.toString() ?? '');
  const [listings, setListings] = useState(agency.listingLimit?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const toLimit = (v: string) => (v.trim() === '' ? null : Number(v));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({
        plan: plan.trim(),
        seatLimit: toLimit(seats),
        listingLimit: toLimit(listings),
      });
    } finally {
      setBusy(false);
    }
  };
  const pid = `plan-${agency.id}`;
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 grid gap-2 sm:grid-cols-4 sm:items-end">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${pid}-name`}>Plan</Label>
        <Input
          id={`${pid}-name`}
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          maxLength={40}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${pid}-seats`}>Seat limit</Label>
        <Input
          id={`${pid}-seats`}
          type="number"
          min={1}
          placeholder="No limit"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${pid}-listings`}>Listing limit</Label>
        <Input
          id={`${pid}-listings`}
          type="number"
          min={0}
          placeholder="No limit"
          value={listings}
          onChange={(e) => setListings(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save plan
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const TABS = [
  ['overview', 'Overview'],
  ['agencies', 'Agencies'],
  ['listings', 'All listings'],
  ['review', 'Listing review'],
  ['reports', 'Listing reports'],
  ['brokers', 'Agent verification'],
  ['users', 'Users'],
  ['website', 'Website'],
  ['settings', 'Settings'],
  ['activity', 'Activity'],
] as const;
type Tab = (typeof TABS)[number][0];

const TAB_SUBTITLES: Record<Tab, string> = {
  overview: 'Everything happening on PropForce, at a glance.',
  agencies: 'Add agencies, approve, suspend, and set plans and limits.',
  listings: 'Every listing from every agency.',
  review: 'New agencies’ listings waiting for PropForce’s check before going on the portal.',
  brokers: 'Agents’ broker cards (BRN) waiting for the Verified agent badge.',
  reports: 'What visitors reported about public listings.',
  users: 'Find anyone and suspend or reactivate them.',
  website: 'Banners, adverts and text on the public website.',
  settings: 'Platform rules, defaults for new agencies and the notice to all agencies.',
  activity: 'Every platform admin action, newest first.',
};

const TAB_ICONS: Record<Tab, LucideIcon> = {
  overview: LayoutDashboard,
  agencies: Building2,
  listings: Home,
  review: ShieldCheck,
  reports: Flag,
  brokers: BadgeCheck,
  users: Users,
  website: Globe,
  settings: Settings,
  activity: Activity,
};

type RoadmapStatus = 'live' | 'setup' | 'soon';
interface RoadmapItem {
  label: string;
  icon: LucideIcon;
  status: RoadmapStatus;
  note: string;
  href?: string | undefined;
}

/**
 * Everything planned across the four phases. Items turn live here as each phase ships; until
 * then they are labelled honestly and show no data.
 */
const ROADMAP: { title: string; items: RoadmapItem[] }[] = [
  {
    title: 'Live',
    items: [
      {
        label: 'Property portal',
        icon: Globe,
        status: 'live',
        note: "Public site with every agency's live listings",
        href: process.env.NEXT_PUBLIC_PORTAL_URL || undefined,
      },
      {
        label: 'Listing photos',
        icon: Images,
        status: 'live',
        note: "Watermarked with the agency's logo; originals stay private",
      },
      {
        label: 'AI assistant',
        icon: Bot,
        status: 'live',
        note: 'Writes replies to WhatsApp clients (OpenAI connected)',
      },
    ],
  },
  {
    title: 'Needs setup',
    items: [
      {
        label: 'WhatsApp',
        icon: MessageCircle,
        status: 'setup',
        note: 'Numbers connect and client messages arrive; replies wait on Meta lifting the account hold. Other agencies wait on Meta App Review',
      },
    ],
  },
  {
    title: 'Phase 1 · coming soon',
    items: [
      {
        label: 'Lead matching',
        icon: Shuffle,
        status: 'live',
        note: 'Scored listing suggestions on every lead, matching leads on every listing',
      },
      {
        label: 'Bulk import',
        icon: FileUp,
        status: 'live',
        note: 'CSV import of contacts, leads and draft listings with a preview',
      },
    ],
  },
  {
    title: 'Phase 2 · coming soon',
    items: [
      {
        label: 'Calendar & viewings',
        icon: CalendarDays,
        status: 'live',
        note: 'Viewings calendar with free slots; Google Calendar sync needs a Google sign-in client',
      },
    ],
  },
  {
    title: 'Phase 3 · coming soon',
    items: [
      {
        label: 'Lead booster',
        icon: Rocket,
        status: 'live',
        note: 'WhatsApp template campaigns to consented contacts, with owner approval',
      },
      {
        label: 'Deals & commissions',
        icon: Handshake,
        status: 'live',
        note: 'Sale and rental pipelines, checklists, commission splits and invoice status',
      },
      {
        label: 'Mortgage & ROI calculator',
        icon: Calculator,
        status: 'live',
        note: 'Fees, instalments, buy-to-let yield and projection, borrowing limit',
      },
      {
        label: 'Billing & plans',
        icon: CreditCard,
        status: 'live',
        href: '/app/admin/billing',
        note: 'Plans, usage, spending caps; online payment pending a provider',
      },
    ],
  },
  {
    title: 'Phase 4 · coming soon',
    items: [
      {
        label: 'AI voice calls',
        icon: Phone,
        status: 'setup',
        note: 'Inbound log + outbound AI Calling with agency scripts via Vapi; needs VAPI_API_KEY, VAPI_WEBHOOK_SECRET, VAPI_DEFAULT_PHONE_NUMBER_ID and the voice.outbound_calls flag',
      },
      {
        label: 'Marketing studio',
        icon: Megaphone,
        status: 'live',
        note: 'Printable branded brochures, AI captions reviewed before use, tagged campaign links and lead attribution',
      },
      {
        label: 'Revenue reports',
        icon: BadgeDollarSign,
        status: 'live',
        href: '/app/admin/billing',
        note: 'Platform revenue and per-agency AI, WhatsApp and voice usage; agencies see commission revenue',
      },
    ],
  },
];

/** "platform.agency_suspended" -> "Agency suspended"; "agency_data.contact.created" -> "In an agency: contact created". */
function activityLabel(action: string) {
  const inAgency = action.startsWith('agency_data.');
  const text = action
    .replace(/^(platform|agency_data)\./, '')
    .replace(/[._]/g, ' ')
    .trim();
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return inAgency ? `In an agency: ${text}` : sentence;
}

function RoadmapBadge({ status }: { status: RoadmapStatus }) {
  const label = { live: 'Live', setup: 'Setup', soon: 'Soon' }[status];
  return (
    <span
      className={cn(
        'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        status === 'live'
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
          : status === 'setup'
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
            : 'bg-background text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}

const SETTING_LABELS: Record<string, string> = {
  'platform.require_agency_approval': 'New agencies need my approval before going live',
  'platform.allow_signups': 'Allow new sign-ups',
  'voice.outbound_calls': 'Outbound AI voice calls (keep off until compliance sign-off)',
};

export default function PlatformAdminPage() {
  const router = useRouter();
  const { me, request, signOut, refreshMe } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [agencies, setAgencies] = useState<PlatformAgency[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [activity, setActivity] = useState<PlatformAuditEntry[]>([]);
  const [listings, setListings] = useState<PlatformListing[]>([]);
  const [listingQuery, setListingQuery] = useState('');
  const [dash, setDash] = useState<PlatformDashboard | null>(null);
  const [days, setDays] = useState(30);
  const [userQuery, setUserQuery] = useState('');
  // Read by load() without re-running it on every keystroke.
  const userQueryRef = useRef('');
  userQueryRef.current = userQuery;
  const [open, setOpen] = useState<string | null>(null); // "<action>:<id>"
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = me?.user.isPlatformAdmin === true;

  useEffect(() => {
    if (me && !isAdmin) router.replace('/app');
  }, [me, isAdmin, router]);

  const handle = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        router.replace('/app/security?required=1');
        return;
      }
      setError(err instanceof ApiError ? err.message : fallback);
    },
    [router],
  );

  const mfaRequired = useCallback(() => router.replace('/app/security?required=1'), [router]);

  const loadUsers = useCallback(
    async (q: string) => {
      const u = await request<{ data: PlatformUser[] }>('/platform/users', {
        query: { q: q.trim() || undefined },
      });
      setUsers(u.data);
    },
    [request],
  );

  const load = useCallback(async () => {
    try {
      const [s, a, st, log] = await Promise.all([
        request<PlatformSummary>('/platform/summary'),
        request<{ data: PlatformAgency[] }>('/platform/agencies'),
        request<{ data: PlatformSetting[] }>('/platform/settings'),
        request<{ data: PlatformAuditEntry[] }>('/platform/audit-log'),
      ]);
      setSummary(s);
      setAgencies(a.data);
      setSettings(st.data);
      setActivity(log.data);
      await loadUsers(userQueryRef.current);
    } catch (err) {
      handle(err, 'Could not load the platform dashboard.');
    }
  }, [request, handle, loadUsers]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  useEffect(() => {
    if (!isAdmin || tab !== 'listings') return;
    const t = setTimeout(() => {
      void request<{ data: PlatformListing[] }>('/platform/listings', {
        query: { q: listingQuery.trim() || undefined },
      })
        .then((r) => setListings(r.data))
        .catch((err: unknown) => handle(err, 'Could not load listings.'));
    }, 250);
    return () => clearTimeout(t);
  }, [isAdmin, tab, listingQuery, request, handle]);

  useEffect(() => {
    if (!isAdmin) return;
    void request<PlatformDashboard>('/platform/dashboard', { query: { days } })
      .then(setDash)
      .catch((err: unknown) => handle(err, 'Could not load trends.'));
  }, [isAdmin, days, request, handle]);

  /** Opens PropForce Direct (created on first use), optionally at a sub-page. */
  const openDirect = async (subPath: string) => {
    try {
      const { agencyId } = await request<{ agencyId: string }>('/platform/direct', {
        method: 'POST',
      });
      await refreshMe();
      router.push(`/app/${agencyId}${subPath}`);
    } catch (err) {
      handle(err, 'Could not open PropForce Direct.');
    }
  };

  const act = async (
    path: string,
    message: string,
    method: 'POST' | 'PATCH' = 'POST',
    body?: unknown,
  ) => {
    setError(null);
    setNotice(null);
    try {
      await request(path, { method, body });
      setOpen(null);
      setNotice(message);
      await load();
    } catch (err) {
      handle(err, 'That action failed. Please try again.');
    }
  };

  /** After a child form saved something: show its message and refresh. */
  const done = async (message: string) => {
    setOpen(null);
    setError(null);
    setNotice(message);
    await load();
  };

  if (!isAdmin) return null;

  const queue = agencies.filter((a) => a.approvalStatus === 'pending');
  const approvalOn = settings.find((s) => s.key === 'platform.require_agency_approval')?.enabled;

  const agencyActions = (a: PlatformAgency) => {
    const key = (action: string) => `${action}:${a.id}`;
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {a.approvalStatus === 'pending' ? (
            <>
              <Button
                size="sm"
                onClick={() =>
                  void act(`/platform/agencies/${a.id}/approve`, `${a.name} approved.`)
                }
              >
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(key('reject'))}>
                Reject
              </Button>
            </>
          ) : null}
          {a.status === 'active' || a.status === 'pending' ? (
            <Button size="sm" variant="outline" onClick={() => setOpen(key('suspend'))}>
              Suspend
            </Button>
          ) : null}
          {a.status === 'suspended' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void act(`/platform/agencies/${a.id}/reactivate`, `${a.name} reactivated.`)
              }
            >
              Reactivate
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setOpen(key('plan'))}>
            Plan &amp; limits
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(key('details'))}>
            Edit details
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(key('invite'))}>
            Invite {a.owner ? 'admin' : 'owner'}
          </Button>
          <Link
            href={`/app/${a.id}`}
            className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-primary hover:bg-muted"
          >
            Open agency (view &amp; edit) →
          </Link>
        </div>
        {open === key('reject') ? (
          <ReasonForm
            id={`reject-${a.id}`}
            action="rejection"
            onCancel={() => setOpen(null)}
            onSubmit={(reason) =>
              act(`/platform/agencies/${a.id}/reject`, `${a.name} rejected.`, 'POST', { reason })
            }
          />
        ) : null}
        {open === key('suspend') ? (
          <ReasonForm
            id={`suspend-${a.id}`}
            action="suspension"
            onCancel={() => setOpen(null)}
            onSubmit={(reason) =>
              act(`/platform/agencies/${a.id}/suspend`, `${a.name} suspended.`, 'POST', { reason })
            }
          />
        ) : null}
        {open === key('details') ? (
          <AgencyDetailsForm
            agency={a}
            onCancel={() => setOpen(null)}
            onSaved={(m) => void done(m)}
          />
        ) : null}
        {open === key('invite') ? (
          <InviteToAgencyForm
            agency={a}
            onCancel={() => setOpen(null)}
            onSent={(m) => void done(m)}
          />
        ) : null}
        {open === key('plan') ? (
          <PlanForm
            agency={a}
            onCancel={() => setOpen(null)}
            onSave={(body) =>
              act(`/platform/agencies/${a.id}`, `Plan updated for ${a.name}.`, 'PATCH', body)
            }
          />
        ) : null}
      </div>
    );
  };

  // Admin actions and new sign-ups, newest first.
  const recentFeed = [
    ...activity.slice(0, 10).map((e) => ({
      key: `a-${e.id}`,
      at: e.createdAt,
      text: `${activityLabel(e.action)}${
        typeof e.after?.target === 'string' ? ` · ${e.after.target}` : ''
      }`,
    })),
    ...users.slice(0, 10).map((u) => ({
      key: `u-${u.id}`,
      at: u.createdAt,
      text: `New sign-up · ${u.fullName}${u.memberships[0] ? ` (${u.memberships[0].agency.name})` : ''}`,
    })),
  ]
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, 8);

  const agencyHeading = (a: PlatformAgency) => (
    <div>
      <p className="font-medium">
        {a.name}
        {a.isPlatformOwned ? (
          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            PropForce's own
          </span>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">
        {a.emirate}
        {a.orn ? ` · ORN ${a.orn}` : ''} · signed up {date(a.createdAt)}
      </p>
      {a.owner ? (
        <p className="text-xs text-muted-foreground">
          Owner: {a.owner.fullName} · {a.owner.email}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 md:sticky md:top-0 md:h-screen md:w-72">
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/20">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white">PropForce Control</h1>
            <p className="flex items-center gap-1 text-xs text-amber-300">
              <Crown className="h-3 w-3" aria-hidden /> Super admin
            </p>
          </div>
        </div>
        <nav
          aria-label="Admin sections"
          className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-y-auto"
        >
          {TABS.map(([value, label]) => {
            const Icon = TAB_ICONS[value];
            return (
              <button
                key={value}
                type="button"
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => {
                  setTab(value);
                  setOpen(null);
                }}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap text-slate-300 transition-colors hover:bg-white/5 hover:text-white',
                  tab === value &&
                    'bg-gradient-to-r from-amber-400/15 to-transparent font-medium text-white ring-1 ring-amber-400/30',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
                {value === 'overview' && queue.length > 0 ? (
                  <span
                    aria-hidden
                    className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs text-white"
                  >
                    {queue.length}
                  </span>
                ) : null}
              </button>
            );
          })}
          {ROADMAP.map((group) => (
            <div key={group.title} className="hidden md:block">
              <p className="mt-4 px-3 pb-1 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
                {group.title}
              </p>
              {group.items.map((item) =>
                item.href ? (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
                  >
                    <item.icon className="h-4 w-4" aria-hidden />
                    {item.label}
                    <RoadmapBadge status={item.status} />
                  </a>
                ) : (
                  <span
                    key={item.label}
                    aria-disabled="true"
                    title={item.note}
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500"
                  >
                    <item.icon className="h-4 w-4" aria-hidden />
                    {item.label}
                    <RoadmapBadge status={item.status} />
                  </span>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="mt-auto hidden items-center justify-between border-t border-white/10 px-4 py-3 md:flex">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={() => void signOut().then(() => router.replace('/login'))}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-6 bg-muted/30 px-4 py-6 md:px-10 md:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {TABS.find(([value]) => value === tab)?.[1]}
            </h2>
            <p className="text-sm text-muted-foreground">{TAB_SUBTITLES[tab]}</p>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-border bg-background py-1 pr-4 pl-1 shadow-sm">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600 text-sm font-semibold text-slate-950">
              {me.user.fullName.charAt(0).toUpperCase()}
            </span>
            <span className="text-sm leading-tight">
              <span className="block font-medium">{me.user.fullName}</span>
              <span className="block text-xs text-muted-foreground">Super admin</span>
            </span>
          </div>
        </header>
        {error ? <Alert>{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        {tab === 'overview' ? (
          <>
            <section aria-label="Quick actions" className="flex flex-wrap gap-2">
              <Button onClick={() => void openDirect('/listings/new')}>
                <Plus className="h-4 w-4" aria-hidden /> Add listing
              </Button>
              <Button variant="outline" onClick={() => void openDirect('')}>
                Open PropForce Direct
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTab('agencies');
                  setOpen('create-agency');
                }}
              >
                <Building2 className="h-4 w-4" aria-hidden /> Add agency
              </Button>
              <Button variant="outline" onClick={() => setTab('website')}>
                <Globe className="h-4 w-4" aria-hidden /> Website & banners
              </Button>
              <Button variant="outline" onClick={() => setTab('users')}>
                Find a user
              </Button>
              {queue.length > 0 ? (
                <a
                  href="#approval-queue"
                  className="inline-flex h-10 items-center rounded-lg bg-amber-500 px-4 text-sm font-medium text-white"
                >
                  Review {queue.length} approval{queue.length === 1 ? '' : 's'}
                </a>
              ) : null}
            </section>

            <section
              aria-label="Platform at a glance"
              className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
            >
              <Stat
                icon={Building2}
                accent="from-indigo-500 to-violet-500"
                label="Agencies"
                value={summary?.agencies.total}
                hint={summary ? `${summary.agencies.newThisWeek} new this week` : undefined}
              />
              <Stat
                icon={Activity}
                accent="from-amber-400 to-orange-500"
                label="Not live yet"
                value={summary?.agencies.pending}
                hint="Onboarding or awaiting approval"
              />
              <Stat
                icon={Users}
                accent="from-sky-500 to-cyan-500"
                label="Users"
                value={summary?.users.total}
                hint={summary ? `${summary.users.newThisWeek} new this week` : undefined}
              />
              <Stat
                icon={Home}
                accent="from-emerald-500 to-teal-500"
                label="Live listings"
                value={summary?.listings.live}
                hint={summary ? `${summary.listings.total} listings in total` : undefined}
              />
              <Stat
                icon={Handshake}
                accent="from-rose-500 to-pink-500"
                label="Open leads"
                value={dash?.totals.openLeads}
                hint={dash ? `${dash.totals.leads} leads in total` : undefined}
              />
              <Stat
                icon={MessageCircle}
                accent="from-fuchsia-500 to-purple-500"
                label="New portal enquiries"
                value={dash?.totals.newEnquiries}
                hint={dash ? `${dash.totals.enquiries} enquiries in total` : undefined}
              />
            </section>

            <section aria-label="Trends" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Growth</h3>
                <div role="group" aria-label="Time range" className="flex gap-1">
                  {[7, 30, 90].map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant={days === d ? 'default' : 'outline'}
                      aria-pressed={days === d}
                      onClick={() => setDays(d)}
                    >
                      {d} days
                    </Button>
                  ))}
                </div>
              </div>
              {dash ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <DailyBarChart
                    title="New agencies"
                    dates={dash.dates}
                    values={dash.series.agencies}
                  />
                  <DailyBarChart title="New users" dates={dash.dates} values={dash.series.users} />
                  <DailyBarChart
                    title="New listings"
                    dates={dash.dates}
                    values={dash.series.listings}
                  />
                  <DailyBarChart title="New leads" dates={dash.dates} values={dash.series.leads} />
                  <DailyBarChart
                    title="Portal enquiries"
                    dates={dash.dates}
                    values={dash.series.enquiries}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading trends…</p>
              )}
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="p-0">
                <h3 className="px-5 pt-4 font-medium">Most active agencies</h3>
                {dash && dash.topAgencies.length > 0 ? (
                  <table className="mt-2 w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2 font-medium">Agency</th>
                        <th className="px-3 py-2 text-right font-medium">Listings</th>
                        <th className="px-3 py-2 text-right font-medium">Leads</th>
                        <th className="px-3 py-2 text-right font-medium">Team</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {dash.topAgencies.map((a) => (
                        <tr key={a.id}>
                          <td className="px-5 py-2">
                            <Link href={`/app/${a.id}`} className="font-medium hover:underline">
                              {a.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{a.listings}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{a.leads}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{a.members}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-5 py-4 text-sm text-muted-foreground">No agency activity yet.</p>
                )}
              </Card>
              <Card className="p-0">
                <div className="flex items-center justify-between px-5 pt-4">
                  <h3 className="font-medium">Recent activity</h3>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => setTab('activity')}
                  >
                    See all
                  </button>
                </div>
                <ul className="mt-2 divide-y divide-border text-sm">
                  {recentFeed.length === 0 ? (
                    <li className="px-5 py-4 text-muted-foreground">Nothing yet.</li>
                  ) : (
                    recentFeed.map((e) => (
                      <li key={e.key} className="flex justify-between gap-3 px-5 py-2">
                        <span className="min-w-0 truncate">{e.text}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {dateTime(e.at)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            </div>

            <Card id="approval-queue" role="region" aria-label="Approval queue">
              <h3 className="font-medium">Approval queue</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {approvalOn
                  ? 'New agencies wait here after setup until you approve them.'
                  : 'Approval is off, so new agencies go live straight after setup. Turn it on under Settings.'}
              </p>
              {queue.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nothing waiting for approval.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {queue.map((a) => (
                    <li key={a.id} className="flex flex-col gap-2 py-3">
                      {agencyHeading(a)}
                      {agencyActions(a)}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        ) : null}

        {tab === 'agencies' && open === 'create-agency' ? (
          <CreateAgencyCard onCancel={() => setOpen(null)} onCreated={(m) => void done(m)} />
        ) : null}

        {tab === 'agencies' ? (
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-5">
              <h2 className="font-medium">
                All agencies <span className="text-muted-foreground">({agencies.length})</span>
              </h2>
              {open !== 'create-agency' ? (
                <Button size="sm" onClick={() => setOpen('create-agency')}>
                  <Plus className="h-4 w-4" aria-hidden /> Add agency
                </Button>
              ) : null}
            </div>
            {agencies.length === 0 ? (
              <p className="px-6 pt-2 pb-5 text-sm text-muted-foreground">No agencies yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {agencies.map((a) => (
                  <li key={a.id} className="flex flex-col gap-2 px-6 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      {agencyHeading(a)}
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge value={a.status} />
                        {a.approvalStatus !== 'not_required' ? (
                          <Badge value={a.approvalStatus} label={`approval: ${a.approvalStatus}`} />
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Plan <span className="font-medium text-foreground">{a.plan}</span> · team{' '}
                      {a.members}
                      {a.seatLimit != null ? ` / ${a.seatLimit}` : ''} · listings {a.listings}
                      {a.listingLimit != null ? ` / ${a.listingLimit}` : ''}
                    </p>
                    {a.statusReason ? (
                      <p className="text-xs text-muted-foreground">Reason: {a.statusReason}</p>
                    ) : null}
                    {agencyActions(a)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {tab === 'listings' ? (
          <Card className="p-0">
            <div className="flex flex-wrap items-end gap-2 px-6 pt-5">
              <div className="flex min-w-60 flex-1 flex-col gap-1">
                <Label htmlFor="listing-search">Search all listings</Label>
                <Input
                  id="listing-search"
                  placeholder="Reference, community, building or agency"
                  value={listingQuery}
                  onChange={(e) => setListingQuery(e.target.value)}
                  maxLength={80}
                />
              </div>
              <Button onClick={() => void openDirect('/listings/new')}>
                <Plus className="h-4 w-4" aria-hidden /> Add listing
              </Button>
            </div>
            {listings.length === 0 ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">No listings found.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-6 py-3 font-medium">Listing</th>
                      <th className="px-4 py-3 font-medium">Agency</th>
                      <th className="px-4 py-3 font-medium">Agent</th>
                      <th className="px-4 py-3 font-medium">Price</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {listings.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/50">
                        <td className="px-6 py-3">
                          <Link
                            href={`/app/${p.agency.id}/listings/${p.id}`}
                            className="font-medium hover:underline"
                          >
                            {p.title ||
                              [p.building, p.community].filter(Boolean).join(', ') ||
                              p.reference}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {p.reference} · {titleCase(p.listingType)} · {titleCase(p.propertyType)}
                          </p>
                        </td>
                        <td className="px-4 py-3">{p.agency.name}</td>
                        <td className="px-4 py-3">{p.assigned?.user.fullName ?? '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatPrice(p)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={p.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}

        {tab === 'review' ? <AdminListingReview /> : null}

        {tab === 'reports' ? <AdminListingReports /> : null}

        {tab === 'brokers' ? <AdminBrokerVerifications /> : null}

        {tab === 'users' ? (
          <Card>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void loadUsers(userQuery).catch((err: unknown) => handle(err, 'Search failed.'));
              }}
            >
              <div className="flex min-w-60 flex-1 flex-col gap-1">
                <Label htmlFor="user-search">Search users by name or email</Label>
                <Input
                  id="user-search"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  maxLength={80}
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            <ul className="mt-4 divide-y divide-border text-sm">
              {users.map((u) => (
                <li key={u.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{u.fullName}</span>{' '}
                      <span className="text-muted-foreground">{u.email}</span>
                      {u.isPlatformAdmin ? (
                        <span className="ml-2 text-xs text-primary">platform admin</span>
                      ) : null}
                      {!u.emailVerifiedAt ? (
                        <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
                          email not verified
                        </span>
                      ) : null}
                      {u.suspendedAt ? (
                        <span className="ml-2">
                          <Badge value="suspended" />
                        </span>
                      ) : null}
                    </span>
                    {u.id !== me.user.id ? (
                      u.suspendedAt ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void act(
                              `/platform/users/${u.id}/reactivate`,
                              `${u.email} reactivated.`,
                            )
                          }
                        >
                          Reactivate
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setOpen(`user:${u.id}`)}>
                          Suspend
                        </Button>
                      )
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {u.memberships.map((m) => `${m.agency.name} (${m.role})`).join(', ') ||
                      'No agency'}{' '}
                    · joined {date(u.createdAt)} · last sign-in {date(u.lastLoginAt)}
                  </span>
                  {u.suspendedReason ? (
                    <span className="text-xs text-muted-foreground">
                      Suspended: {u.suspendedReason}
                    </span>
                  ) : null}
                  {open === `user:${u.id}` ? (
                    <ReasonForm
                      id={`suspend-user-${u.id}`}
                      action="suspension"
                      onCancel={() => setOpen(null)}
                      onSubmit={(reason) =>
                        act(`/platform/users/${u.id}/suspend`, `${u.email} suspended.`, 'POST', {
                          reason,
                        })
                      }
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {tab === 'website' ? <WebsiteContent onMfaRequired={mfaRequired} /> : null}

        {tab === 'settings' ? <PlatformSettingsCard onMfaRequired={mfaRequired} /> : null}

        {tab === 'settings' ? (
          <Card>
            <h2 className="font-medium">Rules</h2>
            <ul className="mt-3 divide-y divide-border">
              {settings.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{SETTING_LABELS[s.key] ?? s.key}</p>
                    {s.description ? (
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    ) : null}
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      role="switch"
                      className="h-5 w-5 accent-[var(--color-primary)]"
                      checked={s.enabled}
                      aria-label={SETTING_LABELS[s.key] ?? s.key}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        // Show the new position straight away; load() re-syncs with the server.
                        setSettings((all) =>
                          all.map((x) => (x.key === s.key ? { ...x, enabled } : x)),
                        );
                        void act(
                          `/platform/settings/${s.key}`,
                          `Setting saved: ${SETTING_LABELS[s.key] ?? s.key} is ${enabled ? 'on' : 'off'}.`,
                          'PATCH',
                          { enabled },
                        );
                      }}
                    />
                    {s.enabled ? 'On' : 'Off'}
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {tab === 'activity' ? (
          <Card>
            <h2 className="font-medium">Admin activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every platform admin action, newest first.
            </p>
            {activity.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No admin actions yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border text-sm">
                {activity.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{e.action}</span>{' '}
                      <span className="text-muted-foreground">
                        {typeof e.after?.target === 'string' ? e.after.target : (e.targetId ?? '')}
                        {typeof e.after?.reason === 'string'
                          ? ` · “${e.after.reason}”`
                          : typeof e.after?.statusReason === 'string'
                            ? ` · “${e.after.statusReason}”`
                            : ''}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {typeof e.after?.by === 'string' ? `${e.after.by} · ` : ''}
                      {dateTime(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </main>
    </div>
  );
}

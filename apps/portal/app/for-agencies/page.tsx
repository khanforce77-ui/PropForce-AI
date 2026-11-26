import {
  BadgeCheck,
  BarChart3,
  Bot,
  Calculator,
  CalendarDays,
  CheckCircle2,
  FileUp,
  Handshake,
  Images,
  type LucideIcon,
  Megaphone,
  MessageCircle,
  Phone,
  Rocket,
  ShieldCheck,
  Shuffle,
  Users,
  Lock,
} from 'lucide-react';
import type { Metadata } from 'next';
import { AGENCY_APP_URL } from '@/lib/config';

export const metadata: Metadata = {
  title: 'For agencies: list on PropForce and run your brokerage',
  description:
    'Register your Dubai agency, publish permitted listings on PropForce and manage leads, viewings, deals and marketing in one CRM.',
  alternates: { canonical: '/for-agencies' },
};

type Status = 'live' | 'rolling_out' | 'soon';

interface Feature {
  icon: LucideIcon;
  title: string;
  text: string;
  status: Status;
}

/**
 * Keep in step with the roadmap in the agency app's admin page: only features that work today are
 * "Available"; anything waiting on a third party or still being built says so.
 */
const GROUPS: { title: string; features: Feature[] }[] = [
  {
    title: 'Listings and the PropForce portal',
    features: [
      {
        icon: ShieldCheck,
        title: 'Permit-checked listings',
        text: 'Add the DLD advertising permit to each listing. Listings go live on the portal only with a valid permit and come down when it expires.',
        status: 'live',
      },
      {
        icon: Images,
        title: 'Watermarked photos',
        text: 'Upload photos once; the portal shows them with your agency logo as a watermark.',
        status: 'live',
      },
      {
        icon: BadgeCheck,
        title: 'Verified agent badge',
        text: 'Agents whose DLD broker card we have checked get a Verified badge on every listing.',
        status: 'live',
      },
      {
        icon: MessageCircle,
        title: 'Enquiries straight to your agents',
        text: 'Buyers WhatsApp, call or email the listing agent; every enquiry becomes a lead in your CRM.',
        status: 'live',
      },
    ],
  },
  {
    title: 'CRM and leads',
    features: [
      {
        icon: Users,
        title: 'Contacts and leads',
        text: 'One place for every client and lead, with contact consent recorded before anyone is messaged.',
        status: 'live',
      },
      {
        icon: Shuffle,
        title: 'Lead matching',
        text: 'Scored listing suggestions on every lead, and matching leads on every listing.',
        status: 'live',
      },
      {
        icon: FileUp,
        title: 'Bulk import',
        text: 'Import contacts, leads and draft listings from CSV with a preview first.',
        status: 'live',
      },
      {
        icon: CalendarDays,
        title: 'Calendar and viewings',
        text: 'Book viewings into free slots with working hours and buffers.',
        status: 'live',
      },
      {
        icon: CalendarDays,
        title: 'Google Calendar sync',
        text: 'Two-way sync of viewings with your agents’ Google calendars.',
        status: 'soon',
      },
    ],
  },
  {
    title: 'AI and messaging',
    features: [
      {
        icon: Bot,
        title: 'AI WhatsApp replies',
        text: 'Connect your WhatsApp Business number; the AI assistant answers clients using only your verified listings.',
        status: 'rolling_out',
      },
      {
        icon: Rocket,
        title: 'Lead booster',
        text: 'WhatsApp template campaigns to contacts who agreed to hear from you, approved by the owner before sending.',
        status: 'rolling_out',
      },
      {
        icon: Phone,
        title: 'AI calling',
        text: 'An AI assistant that answers your calls, follows your own call script and books viewings.',
        status: 'soon',
      },
    ],
  },
  {
    title: 'Deals, marketing and reports',
    features: [
      {
        icon: Handshake,
        title: 'Deals and commissions',
        text: 'Sale and rental pipelines with checklists, commission splits and invoice status.',
        status: 'live',
      },
      {
        icon: Calculator,
        title: 'Cost and mortgage calculator',
        text: 'Work out fees, instalments, rental yield and borrowing limits for your clients.',
        status: 'live',
      },
      {
        icon: Megaphone,
        title: 'Marketing studio',
        text: 'Branded brochures, AI captions you review before use, and tracked campaign links.',
        status: 'live',
      },
      {
        icon: BarChart3,
        title: 'Revenue reports',
        text: 'Monthly commission revenue from your completed deals.',
        status: 'live',
      },
      {
        icon: Lock,
        title: 'Team roles and secure sign-in',
        text: 'Owner, admin, manager and agent roles, with two-factor sign-in.',
        status: 'live',
      },
    ],
  },
];

const STATUS: Record<Status, { label: string; className: string }> = {
  live: { label: 'Available', className: 'bg-emerald-100 text-emerald-800' },
  rolling_out: { label: 'Rolling out', className: 'bg-sky-100 text-sky-800' },
  soon: { label: 'Coming soon', className: 'bg-amber-100 text-amber-800' },
};

export default function ForAgenciesPage() {
  const register = `${AGENCY_APP_URL}/register`;
  return (
    <div>
      <section className="bg-gradient-to-br from-[oklch(0.25_0.04_220)] to-primary text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
            For real estate agencies in Dubai
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
            List on PropForce and run your whole brokerage in one place
          </h1>
          <p className="mt-4 max-w-2xl text-white/85">
            Publish permit-checked listings to buyers on PropForce, and manage leads, viewings,
            deals and marketing in the PropForce CRM.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={register}
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-primary hover:bg-white/90"
            >
              Register your agency
            </a>
            <a
              href={`${AGENCY_APP_URL}/login`}
              className="rounded-lg border border-white/40 px-5 py-2.5 text-sm font-semibold hover:bg-white/10"
            >
              Agent sign in
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-12">
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ['Register', 'Create your agency account in a couple of minutes.'],
            ['Add your team and listings', 'Invite agents, add listings with their DLD permits.'],
            ['Get enquiries', 'Live listings appear on PropForce; enquiries land in your CRM.'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-2xl border border-border p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {i + 1}
              </span>
              <p className="mt-3 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>

        {GROUPS.map((g) => (
          <section key={g.title} className="mt-12">
            <h2 className="text-2xl font-bold tracking-tight">{g.title}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.features.map(({ icon: Icon, title, text, status }) => (
                <div key={title} className="rounded-2xl border border-border bg-background p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[status].className}`}
                    >
                      {STATUS[status].label}
                    </span>
                  </div>
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="mt-14 rounded-3xl bg-muted p-8 text-center">
          <h2 className="text-2xl font-bold">Ready to join?</h2>
          <ul className="mx-auto mt-4 flex max-w-xl flex-col gap-2 text-left text-sm sm:items-center">
            {[
              'Dubai-licensed agencies only',
              'Listings need a valid DLD advertising permit',
              'New agencies’ first listings are reviewed before they go live',
            ].map((x) => (
              <li key={x} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden /> {x}
              </li>
            ))}
          </ul>
          <a
            href={register}
            className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Register your agency
          </a>
        </section>
      </div>
    </div>
  );
}

import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarCheck,
  FileText,
  Heart,
  Hotel,
  House,
  KeyRound,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { Facets } from '@/lib/api';
import { areaPath } from '@/lib/format';

/** Home page sections written for buyers and tenants. All links go to real searches. */

const TILES: {
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  type?: string;
  accent: string;
}[] = [
  {
    label: 'Apartments for sale',
    hint: 'Studios to 4 beds',
    href: areaPath('sale', { type: 'apartment' }),
    icon: Building2,
    type: 'apartment',
    accent: 'from-teal-500 to-emerald-600',
  },
  {
    label: 'Villas & townhouses',
    hint: 'Room for the family',
    href: areaPath('sale', { type: 'villa' }),
    icon: House,
    type: 'villa',
    accent: 'from-amber-400 to-orange-500',
  },
  {
    label: 'Homes for rent',
    hint: 'Yearly and flexible',
    href: '/for-rent',
    icon: KeyRound,
    accent: 'from-sky-500 to-indigo-600',
  },
  {
    label: 'New projects',
    hint: 'Off-plan from developers',
    href: '/new-projects',
    icon: Sparkles,
    accent: 'from-fuchsia-500 to-rose-500',
  },
];

export function BrowseTiles({ facets }: { facets: Facets | null }) {
  const count = (type?: string) =>
    type ? facets?.types.find((t) => t.type === type)?.count : undefined;
  return (
    <section aria-label="Browse homes" className="mx-auto max-w-6xl px-4 pt-10">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES.map((t) => {
          const n = count(t.type);
          return (
            <Link
              key={t.label}
              href={t.href}
              className="group relative overflow-hidden rounded-2xl border border-border bg-background p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:p-5"
            >
              <span
                className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br text-white shadow ${t.accent}`}
              >
                <t.icon className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-3 font-semibold leading-tight">{t.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {n ? `${n} listed · ` : ''}
                {t.hint}
              </p>
              <ArrowRight
                className="absolute top-4 right-4 h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden
              />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const PROMISES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Permit on every listing',
    text: 'Each ad shows its advertising permit, so you know it is allowed to be marketed.',
  },
  {
    icon: BadgeCheck,
    title: 'Licensed agents',
    text: "See the agent's BRN and the agency's ORN before you call.",
  },
  {
    icon: MessageCircle,
    title: 'Talk to the agent directly',
    text: 'Call or WhatsApp the listing agent in one tap. No middlemen, no forms to wait on.',
  },
  {
    icon: Wallet,
    title: 'Free for buyers and tenants',
    text: 'Search, save and enquire as much as you like. PropForce never charges you.',
  },
];

export function TrustPromises() {
  return (
    <section aria-labelledby="why-title" className="mx-auto max-w-6xl px-4 pt-14">
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 p-6 text-white sm:p-10">
        <p className="text-xs font-semibold tracking-widest text-amber-300 uppercase">
          Why search here
        </p>
        <h2 id="why-title" className="mt-2 max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
          Real homes, real agents, no surprises
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PROMISES.map((p) => (
            <div key={p.title}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-amber-300">
                <p.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-white/75">{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const COMMUNITY_TONES = [
  'from-teal-600 to-emerald-700',
  'from-sky-600 to-indigo-700',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-fuchsia-600',
  'from-slate-700 to-slate-900',
  'from-cyan-600 to-teal-700',
];

export function CommunityCards({ communities }: { communities: Facets['communities'] }) {
  return (
    <section aria-labelledby="areas-title" className="mx-auto max-w-6xl px-4 pt-14">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="areas-title" className="text-xl font-semibold sm:text-2xl">
            Explore popular areas
          </h2>
          <p className="text-sm text-muted-foreground">Where people are looking right now.</p>
        </div>
        <Link href="/for-sale" className="shrink-0 text-sm font-medium text-primary">
          All areas
        </Link>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {communities.map((c, i) => (
          <Link
            key={`${c.emirate}-${c.community}`}
            href={areaPath('sale', { emirate: c.emirate, community: c.community })}
            className={`group relative flex min-h-28 flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-sm transition hover:shadow-lg ${
              COMMUNITY_TONES[i % COMMUNITY_TONES.length]
            } ${i === 0 ? 'col-span-2 min-h-36 sm:row-span-2 sm:min-h-full' : ''}`}
          >
            <MapPin
              className="absolute -top-3 -right-3 h-24 w-24 text-white/10 transition group-hover:scale-110"
              aria-hidden
            />
            <p className={`font-semibold leading-tight ${i === 0 ? 'text-xl' : ''}`}>
              {c.community}
            </p>
            <p className="text-xs text-white/80">
              {c.count} {c.count === 1 ? 'home' : 'homes'} · {c.emirate}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Search,
    title: 'Search and shortlist',
    text: 'Filter by area, budget and bedrooms, and save the homes you like.',
  },
  {
    icon: CalendarCheck,
    title: 'Book a viewing',
    text: 'Message the agent on WhatsApp and visit the home in person.',
  },
  {
    icon: FileText,
    title: 'Agree and sign',
    text: 'Agree the price and sign the MOU (Form F) or the tenancy contract with your agent.',
  },
  {
    icon: Hotel,
    title: 'Move in',
    text: 'Transfer at the Dubai Land Department, or register your Ejari, and collect the keys.',
  },
];

export function BuyingSteps() {
  return (
    <section aria-labelledby="steps-title" className="mx-auto max-w-6xl px-4 pt-14">
      <h2 id="steps-title" className="text-xl font-semibold sm:text-2xl">
        From search to keys in four steps
      </h2>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative rounded-2xl border border-border bg-background p-5">
            <span className="absolute top-4 right-4 text-3xl font-bold text-muted-foreground/20 tabular-nums">
              {i + 1}
            </span>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <s.icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="mt-3 font-semibold">{s.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SavedCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <div className="flex flex-col items-start gap-4 rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/10 via-background to-amber-100/60 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8 dark:to-amber-950/30">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-500 text-white shadow">
            <Heart className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Keep a shortlist</h2>
            <p className="text-sm text-muted-foreground">
              Tap the heart on any home to save it on this device and compare later. No account
              needed.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/for-sale"
            className="inline-flex h-10 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start browsing
          </Link>
          <Link
            href="/saved"
            className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-5 text-sm font-semibold hover:border-primary hover:text-primary"
          >
            My saved homes
          </Link>
        </div>
      </div>
    </section>
  );
}

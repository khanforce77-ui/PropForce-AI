import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Building,
  Building2,
  CalendarDays,
  Castle,
  Crown,
  Flag,
  Home,
  KeyRound,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  Sofa,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import type { Facets, PriceInsight } from '@/lib/api';
import { communityCount, communityHref, type DubaiCommunity } from '@/lib/dubai';
import { formatPrice } from '@/lib/format';
import { GUIDES } from '@/lib/guides';
import type { ProjectGroup } from '@/lib/projects';
import { photoUrl } from '@/lib/photos';
import { AGENCY_APP_URL } from '@/lib/config';

export function SectionHeading({
  title,
  subtitle,
  href,
  linkLabel = 'View all',
}: {
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          {linkLabel} <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

/** Popular one-click searches under the hero search box. */
export function QuickSearches({ onDark }: { onDark: boolean }) {
  const links = [
    {
      label: 'Apartments in Dubai Marina',
      href: '/for-sale?type=apartment&community=Dubai+Marina',
    },
    { label: 'Villas for sale', href: '/for-sale/villas' },
    { label: 'Off-plan', href: '/new-projects' },
    { label: 'Ready to move in', href: '/for-sale?completion=ready' },
    { label: 'Furnished rentals', href: '/for-rent?furnished=furnished' },
  ];
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <span className={onDark ? 'text-white/75' : 'text-muted-foreground'}>Popular:</span>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={
            onDark
              ? 'rounded-full border border-white/30 bg-white/10 px-3 py-1 text-white backdrop-blur hover:bg-white/20'
              : 'rounded-full border border-border bg-background px-3 py-1 hover:border-primary hover:text-primary'
          }
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/** What the site actually checks; each line matches a rule enforced by the API. */
export function TrustStrip() {
  const items = [
    {
      icon: ShieldCheck,
      title: 'Valid permit on every listing',
      text: 'Listings come down automatically when the permit expires.',
    },
    {
      icon: BadgeCheck,
      title: 'Verified agents',
      text: 'The badge means we checked the agent’s DLD broker card.',
    },
    {
      icon: MessageCircle,
      title: 'Talk to the agent directly',
      text: 'WhatsApp, call or email the listing agent. No sign-up needed.',
    },
    {
      icon: Flag,
      title: 'Report anything wrong',
      text: 'Every listing has a report button that our team reviews.',
    },
  ];
  return (
    <section aria-label="Why buyers trust us" className="border-b border-border bg-background">
      <ul className="mx-auto grid max-w-6xl gap-4 px-4 py-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="text-xs text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Browse by property type, with live counts. */
export function BrowseByType({ facets }: { facets: Facets | null }) {
  const count = (t: string) => facets?.types.find((x) => x.type === t)?.count ?? 0;
  const tiles = [
    { label: 'Apartments', icon: Building2, href: '/for-sale/apartments', n: count('apartment') },
    { label: 'Villas', icon: Castle, href: '/for-sale/villas', n: count('villa') },
    { label: 'Townhouses', icon: Home, href: '/for-sale/townhouses', n: count('townhouse') },
    { label: 'Penthouses', icon: Crown, href: '/for-sale/penthouses', n: count('penthouse') },
    { label: 'Off-plan projects', icon: Building, href: '/new-projects', n: null },
    { label: 'Homes for rent', icon: KeyRound, href: '/for-rent', n: null },
    { label: 'Furnished', icon: Sofa, href: '/for-rent?furnished=furnished', n: null },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12">
      <SectionHeading title="What are you looking for?" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map(({ label, icon: Icon, href, n }) => (
          <Link
            key={label}
            href={href}
            className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-background p-4 text-center transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <span className="text-sm font-medium">{label}</span>
            {n ? <span className="text-xs text-muted-foreground">{n} listed</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Illustrated skyline background, so cards look good before real area photos exist. */
function Skyline({ tone }: { tone: [string, string] }) {
  return (
    <svg
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={`g-${tone[0]}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={tone[0]} />
          <stop offset="1" stopColor={tone[1]} />
        </linearGradient>
      </defs>
      <rect width="400" height="220" fill={`url(#g-${tone[0]})`} />
      <circle cx="320" cy="55" r="26" fill="#fff" opacity="0.18" />
      <g fill="#fff" opacity="0.14">
        <rect x="20" y="120" width="34" height="100" />
        <rect x="60" y="90" width="26" height="130" />
        <rect x="92" y="135" width="40" height="85" />
        <rect x="140" y="60" width="22" height="160" />
        <polygon points="151,30 145,60 157,60" />
        <rect x="170" y="110" width="36" height="110" />
        <rect x="214" y="80" width="28" height="140" />
        <rect x="250" y="125" width="44" height="95" />
        <rect x="300" y="100" width="30" height="120" />
        <rect x="338" y="140" width="46" height="80" />
      </g>
    </svg>
  );
}

export function CommunityGrid({
  communities,
  facets,
}: {
  communities: DubaiCommunity[];
  facets: Facets | null;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12">
      <SectionHeading
        title="Explore Dubai communities"
        subtitle="Find the neighbourhood that fits your life."
        href="/for-sale"
        linkLabel="All properties"
      />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {communities.map((c) => {
          const n = communityCount(c.name, facets);
          return (
            <Link
              key={c.name}
              href={communityHref('sale', c.name, facets)}
              className="group relative flex h-52 flex-col justify-end overflow-hidden rounded-2xl p-4 text-white shadow-sm transition hover:shadow-lg"
            >
              <Skyline tone={c.tone} />
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="relative">
                {c.tags.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium backdrop-blur"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
                <h3 className="text-lg font-semibold">{c.name}</h3>
                <p className="line-clamp-2 text-xs text-white/85">{c.tagline}</p>
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold">
                  {n > 0 ? `${n} ${n === 1 ? 'property' : 'properties'}` : 'See properties'}
                  <ArrowRight
                    className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const quarter = (iso: string) => `Q${Math.ceil(Number(iso.slice(5, 7)) / 3)} ${iso.slice(0, 4)}`;

export function FeaturedProjects({ projects }: { projects: ProjectGroup[] }) {
  if (projects.length === 0) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12">
      <SectionHeading
        title="New projects in Dubai"
        subtitle="Off-plan homes with starting prices and expected handover."
        href="/new-projects"
      />
      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.slice(0, 3).map((p) => {
          const cover = p.units.find((u) => u.photos?.[0])?.photos[0];
          const first = p.units[0]!;
          const all = new URLSearchParams({ completion: 'off_plan' });
          if (first.project) all.set('project', first.project);
          else if (p.community) all.set('community', p.community);
          return (
            <Link
              key={p.key}
              href={`/for-sale?${all}`}
              className="group overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition hover:shadow-md"
            >
              <div className="relative h-44">
                {cover ? (
                  <img
                    src={photoUrl(cover, 'thumb')}
                    alt={p.name}
                    width={480}
                    height={320}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Skyline tone={['#0f4c5c', '#e9c46a']} />
                )}
                <span className="absolute left-3 top-3 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-black">
                  Off-plan
                </span>
              </div>
              <div className="space-y-1.5 p-4">
                <h3 className="text-lg font-semibold group-hover:text-primary">{p.name}</h3>
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {[p.community, p.emirate].filter(Boolean).join(', ')}
                </p>
                <div className="flex items-center justify-between pt-1 text-sm">
                  <span>
                    <span className="text-muted-foreground">From </span>
                    <span className="font-bold">{formatPrice(p.fromPrice)}</span>
                  </span>
                  {p.handover ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {quarter(p.handover)}
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const aedShort = (n: number) =>
  n >= 1_000_000
    ? `AED ${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`
    : `AED ${Math.round(n / 1000)}K`;

/**
 * Median asking prices per community, from live listings on this site. Labelled as asking prices
 * (not sold prices) and only shown for communities with enough listings.
 */
export function PriceInsights({
  insights,
  minListings,
  facets,
}: {
  insights: PriceInsight[];
  minListings: number;
  facets: Facets | null;
}) {
  const dubai = insights.filter((i) => i.emirate.toLowerCase() === 'dubai');
  const sale = dubai.filter((i) => i.purpose === 'sale').slice(0, 6);
  const rent = dubai.filter((i) => i.purpose === 'rent').slice(0, 6);
  if (sale.length === 0 && rent.length === 0) return null;
  const table = (title: string, rows: PriceInsight[], purpose: 'sale' | 'rent') =>
    rows.length === 0 ? null : (
      <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
        <h3 className="font-semibold">{title}</h3>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Community</th>
              <th className="pb-2 text-right font-medium">
                {purpose === 'sale' ? 'Median price' : 'Median rent / year'}
              </th>
              <th className="hidden pb-2 text-right font-medium sm:table-cell">Per sqft</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.community} className="border-t border-border">
                <td className="py-2.5">
                  <Link
                    href={communityHref(purpose, r.community, facets)}
                    className="font-medium hover:text-primary"
                  >
                    {r.community}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{r.listings} listings</span>
                </td>
                <td className="py-2.5 text-right font-semibold">
                  {r.medianPrice != null ? aedShort(r.medianPrice) : '–'}
                </td>
                <td className="hidden py-2.5 text-right text-muted-foreground sm:table-cell">
                  {r.medianPricePerSqft != null
                    ? `AED ${r.medianPricePerSqft.toLocaleString('en-AE')}`
                    : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <section className="mx-auto max-w-6xl px-4 pt-12">
      <SectionHeading
        title="Dubai price insights"
        subtitle="What sellers and landlords are asking right now, by community."
      />
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {table('Buying', sale, 'sale')}
        {table('Renting', rent, 'rent')}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Median asking prices of live listings on this site, for communities with at least{' '}
        {minListings} listings. These are not sold prices; check Dubai Land Department for
        transaction data.
      </p>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    {
      icon: Search,
      title: 'Search',
      text: 'Filter by community, budget, bedrooms and more. Save the homes you like.',
    },
    {
      icon: ShieldCheck,
      title: 'Check',
      text: 'See the permit, the agent’s BRN and the Verified badge on every listing.',
    },
    {
      icon: MessageCircle,
      title: 'Talk to the agent',
      text: 'WhatsApp or call the agent directly to book a viewing.',
    },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <div className="rounded-3xl bg-gradient-to-br from-primary to-[oklch(0.35_0.08_200)] p-8 text-primary-foreground sm:p-10">
        <h2 className="text-2xl font-bold tracking-tight">Find a home in three simple steps</h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="font-semibold">
                  {i + 1}. {title}
                </p>
                <p className="mt-1 text-sm text-white/80">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link
          href="/for-sale"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-primary hover:bg-white/90"
        >
          Start searching <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export function GuidesTeaser() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <SectionHeading
        title="Guides for buyers and tenants"
        subtitle="Plain-English help with buying and renting in Dubai."
        href="/guides"
        linkLabel="All guides"
      />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GUIDES.map((g) => (
          <Link
            key={g.slug}
            href={`/guides/${g.slug}`}
            className="group flex flex-col rounded-2xl border border-border bg-background p-5 transition hover:border-primary hover:shadow-md"
          >
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-primary">
              <BookOpen className="h-3 w-3" aria-hidden /> {g.audience}
            </span>
            <h3 className="mt-3 font-semibold group-hover:text-primary">{g.title}</h3>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{g.summary}</p>
            <p className="mt-3 text-xs text-muted-foreground">{g.minutes} min read</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Small band at the very bottom; the homepage stays about buyers. */
export function AgencyCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-border bg-muted p-6 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            For agencies and developers
          </p>
          <h2 className="mt-1 text-lg font-semibold">List your properties on PropForce</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Register your Dubai agency, publish permitted listings here and manage every lead in the
            PropForce CRM.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/for-agencies"
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:border-primary"
          >
            See features
          </Link>
          <Link
            href="/developers"
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:border-primary"
          >
            Register as developer
          </Link>
          <a
            href={`${AGENCY_APP_URL}/register`}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Register your agency
          </a>
        </div>
      </div>
    </section>
  );
}

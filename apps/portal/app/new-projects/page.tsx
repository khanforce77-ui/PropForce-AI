import { Building2, CalendarDays, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { searchListings } from '@/lib/api';
import { groupProjects } from '@/lib/projects';
import { formatPrice, listingPath } from '@/lib/format';
import { photoUrl } from '@/lib/photos';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'New off-plan projects in Dubai',
  description:
    'Off-plan projects in Dubai from licensed agencies: starting prices, handover dates and payment plans.',
  alternates: { canonical: '/new-projects' },
};

const quarter = (iso: string) => `Q${Math.ceil(Number(iso.slice(5, 7)) / 3)} ${iso.slice(0, 4)}`;

export default async function NewProjectsPage() {
  const result = await searchListings(
    new URLSearchParams({
      purpose: 'sale',
      completion: 'off_plan',
      sort: 'handover',
      pageSize: '48',
    }),
  ).catch(() => null);
  const projects = groupProjects(result?.data ?? []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">New projects</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Off-plan homes from licensed agencies, with their starting price and expected handover.
      </p>
      {!result ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          Projects are temporarily unavailable. Please try again shortly.
        </p>
      ) : projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
          No off-plan projects are listed right now.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const cover = p.units.find((u) => u.photos?.[0])?.photos[0];
            const first = p.units[0]!;
            const all = new URLSearchParams({ completion: 'off_plan' });
            if (first.project) all.set('project', first.project);
            else if (p.community) all.set('community', p.community);
            return (
              <article
                key={p.key}
                className="overflow-hidden rounded-xl border border-border shadow-sm"
              >
                {cover ? (
                  <img
                    src={photoUrl(cover, 'thumb')}
                    alt={p.name}
                    width={480}
                    height={320}
                    loading="lazy"
                    className="h-44 w-full bg-accent object-cover"
                  />
                ) : (
                  <div className="flex h-44 items-center justify-center bg-accent text-primary/60">
                    <Building2 className="h-12 w-12" aria-hidden />
                  </div>
                )}
                <div className="space-y-2 p-4">
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {[p.community, p.emirate].filter(Boolean).join(', ')}
                  </p>
                  <p className="text-sm">
                    <span className="text-muted-foreground">Starting from </span>
                    <span className="font-bold">{formatPrice(p.fromPrice)}</span>
                  </p>
                  {p.handover ? (
                    <p className="flex items-center gap-1 text-sm">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Handover{' '}
                      {quarter(p.handover)}
                    </p>
                  ) : null}
                  <div className="flex gap-2 pt-2">
                    <Link
                      href={`/for-sale?${all}`}
                      className="flex-1 rounded-lg border border-border py-2 text-center text-sm font-medium hover:border-primary"
                    >
                      {p.units.length} {p.units.length === 1 ? 'unit' : 'units'}
                    </Link>
                    <Link
                      href={`${listingPath(first)}#enquiry`}
                      className="flex-1 rounded-lg bg-primary py-2 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
                    >
                      Register interest
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

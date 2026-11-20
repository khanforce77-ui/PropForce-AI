import Link from 'next/link';
import { ListingCard } from '@/components/listing-card';
import { SearchForm } from '@/components/search-form';
import { getFacets, searchListings, type Facets, type SearchResult } from '@/lib/api';
import { SITE_NAME } from '@/lib/config';

// Rendered per request (API responses are still cached for a minute), so an API hiccup at
// build time is never frozen into the page.
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [facets, latest] = await Promise.all([
    safe<Facets>(getFacets()),
    safe<SearchResult>(searchListings(new URLSearchParams({ pageSize: '6' }))),
  ]);
  const popular = [...(facets?.communities ?? [])].sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <>
      <section className="bg-gradient-to-b from-accent to-background">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
            Find your next home in the UAE
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Verified listings from licensed agencies on {SITE_NAME}. Talk to the agent directly on
            WhatsApp or phone.
          </p>
          <div className="mt-8 rounded-2xl border border-border bg-background p-4 shadow-sm">
            <SearchForm facets={facets} compact />
          </div>
        </div>
      </section>

      {popular.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 pt-10">
          <h2 className="text-xl font-semibold">Popular communities</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {popular.map((c) => (
              <Link
                key={`${c.emirate}-${c.community}`}
                href={`/for-sale?community=${encodeURIComponent(c.community)}`}
                className="rounded-full border border-border px-4 py-1.5 text-sm hover:border-primary hover:text-primary"
              >
                {c.community} <span className="text-muted-foreground">({c.count})</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-6xl px-4 pt-10">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-semibold">Latest properties</h2>
          <Link href="/for-sale" className="text-sm font-medium text-primary">
            View all
          </Link>
        </div>
        {latest && latest.data.length > 0 ? (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {latest.data.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            {latest
              ? 'New listings are on their way. Please check back soon.'
              : 'Listings are temporarily unavailable. Please try again shortly.'}
          </p>
        )}
      </section>
    </>
  );
}

import Link from 'next/link';
import { BannerCard } from '@/components/banners';
import { HeroCarousel } from '@/components/hero-carousel';
import {
  BrowseTiles,
  BuyingSteps,
  CommunityCards,
  SavedCta,
  TrustPromises,
} from '@/components/home-sections';
import { ListingCard } from '@/components/listing-card';
import { SearchForm } from '@/components/search-form';
import { getFacets, getSite, searchListings, type Facets, type SearchResult } from '@/lib/api';

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
  const [facets, latest, site] = await Promise.all([
    safe<Facets>(getFacets()),
    safe<SearchResult>(searchListings(new URLSearchParams({ pageSize: '6' }))),
    getSite(),
  ]);
  const { content, banners } = site;
  const hero = banners.home_hero;
  const strip = banners.home_strip;
  const popular = [...(facets?.communities ?? [])].sort((a, b) => b.count - a.count).slice(0, 7);

  return (
    <>
      <HeroCarousel banners={hero}>
        <div
          className={
            hero.length > 0
              ? 'mx-auto max-w-6xl px-4 pt-16 pb-8 sm:pt-24'
              : 'mx-auto max-w-6xl px-4 py-14 sm:py-20'
          }
        >
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
            {content.hero.title}
          </h1>
          {content.hero.subtitle ? (
            <p
              className={
                hero.length > 0
                  ? 'mt-3 max-w-xl text-white/85'
                  : 'mt-3 max-w-xl text-muted-foreground'
              }
            >
              {content.hero.subtitle}
            </p>
          ) : null}
          <div className="mt-8 rounded-2xl border border-border bg-background p-4 text-foreground shadow-lg">
            <SearchForm facets={facets} compact />
          </div>
        </div>
      </HeroCarousel>

      <BrowseTiles facets={facets} />

      {strip.length > 0 ? (
        <section aria-label="Offers" className="mx-auto max-w-6xl px-4 pt-10">
          <div
            className={
              strip.length === 1
                ? 'grid gap-5'
                : strip.length === 2
                  ? 'grid gap-5 sm:grid-cols-2'
                  : 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3'
            }
          >
            {strip.slice(0, 6).map((b) => (
              <BannerCard key={b.id} banner={b} />
            ))}
          </div>
        </section>
      ) : null}

      {content.sections.latestListings ? (
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
      ) : null}

      {content.sections.popularCommunities && popular.length > 0 ? (
        <CommunityCards communities={popular} />
      ) : null}

      <TrustPromises />
      <BuyingSteps />
      <SavedCta />
      <div className="pb-6" />
    </>
  );
}

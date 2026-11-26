import { BannerCard } from '@/components/banners';
import { HeroCarousel } from '@/components/hero-carousel';
import { ListingCard } from '@/components/listing-card';
import {
  AgencyCta,
  BrowseByType,
  CommunityGrid,
  FeaturedProjects,
  GuidesTeaser,
  HowItWorks,
  PriceInsights,
  QuickSearches,
  SectionHeading,
  TrustStrip,
} from '@/components/home-sections';
import { SearchForm } from '@/components/search-form';
import {
  getFacets,
  getInsights,
  getSite,
  searchListings,
  type Facets,
  type SearchResult,
} from '@/lib/api';
import { homepageCommunities } from '@/lib/dubai';
import { groupProjects } from '@/lib/projects';

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
  // The portal serves the Dubai market only.
  const [facets, latest, offPlan, insights, site] = await Promise.all([
    safe<Facets>(getFacets()),
    safe<SearchResult>(searchListings(new URLSearchParams({ emirate: 'Dubai', pageSize: '6' }))),
    safe<SearchResult>(
      searchListings(
        new URLSearchParams({
          emirate: 'Dubai',
          purpose: 'sale',
          completion: 'off_plan',
          sort: 'handover',
          pageSize: '24',
        }),
      ),
    ),
    getInsights(),
    getSite(),
  ]);
  const { content, banners } = site;
  const hero = banners.home_hero;
  const strip = banners.home_strip;
  const communities = homepageCommunities(facets);
  const projects = groupProjects(offPlan?.data ?? []);

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
          <QuickSearches onDark={hero.length > 0} />
        </div>
      </HeroCarousel>

      <TrustStrip />

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

      <BrowseByType facets={facets} />

      {content.sections.popularCommunities ? (
        <CommunityGrid communities={communities} facets={facets} />
      ) : null}

      {content.sections.latestListings ? (
        <section className="mx-auto max-w-6xl px-4 pt-12">
          <SectionHeading
            title="Latest properties"
            subtitle="Fresh listings from licensed Dubai agencies."
            href="/for-sale"
          />
          {latest && latest.data.length > 0 ? (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {latest.data.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
              {latest
                ? 'New listings are on their way. Please check back soon.'
                : 'Listings are temporarily unavailable. Please try again shortly.'}
            </p>
          )}
        </section>
      ) : null}

      <FeaturedProjects projects={projects} />

      <PriceInsights insights={insights.data} minListings={insights.minListings} facets={facets} />

      <HowItWorks />

      <GuidesTeaser />

      <AgencyCta />
    </>
  );
}

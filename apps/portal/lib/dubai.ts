import type { Facets } from './api';
import { areaPath, slugify, type Purpose } from './format';

/**
 * Well-known Dubai communities shown on the homepage, with a one-line, non-numeric description.
 * Listing counts come live from the API; prices are never hard-coded here.
 */
export interface DubaiCommunity {
  name: string;
  tagline: string;
  /** What buyers usually look for there, shown as small tags. */
  tags: string[];
  /** Two CSS colours for the card's illustrated background. */
  tone: [string, string];
}

export const DUBAI_COMMUNITIES: DubaiCommunity[] = [
  {
    name: 'Dubai Marina',
    tagline: 'Waterfront towers, the Marina Walk and beach close by',
    tags: ['Apartments', 'Waterfront'],
    tone: ['#0f4c5c', '#2a9d8f'],
  },
  {
    name: 'Downtown Dubai',
    tagline: 'Burj Khalifa, Dubai Mall and the Boulevard on your doorstep',
    tags: ['Apartments', 'City living'],
    tone: ['#1d3557', '#457b9d'],
  },
  {
    name: 'Palm Jumeirah',
    tagline: 'Island living with beachfront villas and apartments',
    tags: ['Villas', 'Beachfront'],
    tone: ['#005f73', '#94d2bd'],
  },
  {
    name: 'Dubai Hills Estate',
    tagline: 'Green, family-friendly community around a park and golf course',
    tags: ['Villas', 'Family'],
    tone: ['#2d6a4f', '#74c69d'],
  },
  {
    name: 'Jumeirah Village Circle',
    tagline: 'Popular, good-value apartments and townhouses',
    tags: ['Apartments', 'Value'],
    tone: ['#6d597a', '#b56576'],
  },
  {
    name: 'Business Bay',
    tagline: 'Canal-side towers next to Downtown',
    tags: ['Apartments', 'Canal views'],
    tone: ['#264653', '#e9c46a'],
  },
  {
    name: 'Arabian Ranches',
    tagline: 'Established villa community with schools and golf',
    tags: ['Villas', 'Family'],
    tone: ['#7f5539', '#ddb892'],
  },
  {
    name: 'Jumeirah Lake Towers',
    tagline: 'Lakeside towers with metro access',
    tags: ['Apartments', 'Metro'],
    tone: ['#003049', '#669bbc'],
  },
];

/**
 * Link for a community: the clean area page when it has live listings in Dubai (that page 404s
 * otherwise), else a plain search that shows an empty-results message.
 */
export function communityHref(
  purpose: Purpose,
  name: string,
  facets: Pick<Facets, 'communities'> | null,
): string {
  const known = facets?.communities.find(
    (c) => slugify(c.community) === slugify(name) && c.emirate.toLowerCase() === 'dubai',
  );
  if (known) return areaPath(purpose, { emirate: known.emirate, community: known.community });
  return `/${purpose === 'rent' ? 'for-rent' : 'for-sale'}?${new URLSearchParams({ community: name })}`;
}

/** Live listings in a community (all purposes), or 0. */
export function communityCount(name: string, facets: Pick<Facets, 'communities'> | null): number {
  return (facets?.communities ?? [])
    .filter((c) => slugify(c.community) === slugify(name) && c.emirate.toLowerCase() === 'dubai')
    .reduce((n, c) => n + c.count, 0);
}

/** Curated communities first, then any other Dubai community with listings, up to `limit`. */
export function homepageCommunities(
  facets: Pick<Facets, 'communities'> | null,
  limit = 8,
): DubaiCommunity[] {
  const out = DUBAI_COMMUNITIES;
  const known = new Set(out.map((c) => slugify(c.name)));
  const extra = [...(facets?.communities ?? [])]
    .filter((c) => c.emirate.toLowerCase() === 'dubai' && !known.has(slugify(c.community)))
    .sort((a, b) => b.count - a.count);
  const withListings = out.filter((c) => communityCount(c.name, facets) > 0);
  const rest = out.filter((c) => communityCount(c.name, facets) === 0);
  const extras: DubaiCommunity[] = extra.map((c) => ({
    name: c.community,
    tagline: 'Homes listed by licensed Dubai agencies',
    tags: [],
    tone: ['#264653', '#2a9d8f'],
  }));
  return [...withListings, ...extras, ...rest].slice(0, limit);
}

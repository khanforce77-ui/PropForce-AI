export type Purpose = 'sale' | 'rent';

export const PURPOSE_PATH: Record<Purpose, string> = { sale: 'for-sale', rent: 'for-rent' };
export const PATH_PURPOSE: Record<string, Purpose> = { 'for-sale': 'sale', 'for-rent': 'rent' };

export const TYPE_LABEL: Record<string, string> = {
  apartment: 'Apartment',
  villa: 'Villa',
  townhouse: 'Townhouse',
  penthouse: 'Penthouse',
  office: 'Office',
  retail: 'Retail',
  commercial: 'Commercial',
  land: 'Land',
  other: 'Property',
};

export const FURNISHING_LABEL: Record<string, string> = {
  unfurnished: 'Unfurnished',
  semi_furnished: 'Semi-furnished',
  furnished: 'Furnished',
};

export function formatPrice(price: number | null, rentPeriod?: string | null): string {
  if (price == null) return 'Price on request';
  const amount = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(price);
  const suffix = rentPeriod === 'monthly' ? ' / month' : rentPeriod === 'yearly' ? ' / year' : '';
  return `AED ${amount}${suffix}`;
}

export function bedsLabel(bedrooms: number | null): string | null {
  if (bedrooms == null) return null;
  if (bedrooms === 0) return 'Studio';
  return `${bedrooms} ${bedrooms === 1 ? 'Bed' : 'Beds'}`;
}

export function formatArea(sqft: number | null): string | null {
  if (sqft == null) return null;
  return `${new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(sqft)} sqft`;
}

/** Human-readable fallback title, e.g. "2 Bed Apartment for sale in Dubai Marina". */
export function listingTitle(l: {
  title: string | null;
  bedrooms: number | null;
  type: string;
  purpose: Purpose;
  community: string | null;
  emirate: string;
}): string {
  if (l.title) return l.title;
  const beds = l.bedrooms === 0 ? 'Studio' : l.bedrooms != null ? `${l.bedrooms} Bed` : '';
  const what = [beds, TYPE_LABEL[l.type] ?? 'Property'].filter(Boolean).join(' ');
  return `${what} for ${l.purpose === 'rent' ? 'rent' : 'sale'} in ${l.community ?? l.emirate}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 80)
    .replace(/-+$/, '');
}

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** SEO path for a listing: the readable part is decoration, the trailing id is what counts. */
export function listingPath(l: Parameters<typeof listingTitle>[0] & { id: string }): string {
  const slug = slugify(listingTitle(l));
  return `/property/${slug ? `${slug}-` : ''}${l.id}`;
}

export function idFromSlug(slug: string): string | null {
  return UUID.exec(slug)?.[1]?.toLowerCase() ?? null;
}

/** Turns the search page's URL parameters into a clean API query (unknown keys dropped). */
const SEARCH_KEYS = [
  'emirate',
  'community',
  'type',
  'completion',
  'minPrice',
  'maxPrice',
  'beds',
  'baths',
  'minArea',
  'maxArea',
  'amenity',
  'furnished',
  'q',
  'agency',
  'agent',
  'project',
  'sort',
  'page',
] as const;

export function searchParamsToQuery(
  purpose: Purpose | undefined,
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const out = new URLSearchParams();
  if (purpose) out.set('purpose', purpose);
  for (const key of SEARCH_KEYS) {
    const raw = params[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!value) continue;
    if (
      ['minPrice', 'maxPrice', 'beds', 'baths', 'minArea', 'maxArea', 'page'].includes(key) &&
      !/^\d{1,13}$/.test(value)
    )
      continue;
    out.set(key, value.slice(0, 120));
  }
  return out;
}

// ───── SEO area pages, e.g. /for-sale/apartments/dubai/dubai-marina ─────

/** URL segment for each property type, in the plural as people search for them. */
export const TYPE_SEGMENT: Record<string, string> = {
  apartment: 'apartments',
  villa: 'villas',
  townhouse: 'townhouses',
  penthouse: 'penthouses',
  office: 'offices',
  retail: 'retail',
  commercial: 'commercial',
  land: 'land',
};
const SEGMENT_TYPE = Object.fromEntries(Object.entries(TYPE_SEGMENT).map(([t, s]) => [s, t]));

export interface AreaFilter {
  type?: string;
  emirate?: string;
  community?: string;
}

/** Clean path for a purpose + type + emirate + community combination. */
export function areaPath(purpose: Purpose, f: AreaFilter): string {
  const parts = [PURPOSE_PATH[purpose]];
  if (f.type && TYPE_SEGMENT[f.type]) parts.push(TYPE_SEGMENT[f.type]!);
  if (f.emirate) {
    parts.push(slugify(f.emirate));
    if (f.community) parts.push(slugify(f.community));
  }
  return `/${parts.join('/')}`;
}

/**
 * Reads [type]/[emirate]/[community] path segments back into filters, using the known emirates
 * and communities. Returns null for anything that does not exist, so it can 404.
 */
export function parseAreaSegments(
  segments: string[],
  known: { emirates: string[]; communities: { emirate: string; community: string }[] },
): AreaFilter | null {
  const rest = [...segments];
  const out: AreaFilter = {};
  if (rest[0] && SEGMENT_TYPE[rest[0]]) out.type = SEGMENT_TYPE[rest.shift()!];
  if (rest.length > 2) return null;
  if (rest[0]) {
    const emirate = known.emirates.find((e) => slugify(e) === rest[0]);
    if (!emirate) return null;
    out.emirate = emirate;
  }
  if (rest[1]) {
    const c = known.communities.find(
      (x) => x.emirate === out.emirate && slugify(x.community) === rest[1],
    );
    if (!c) return null;
    out.community = c.community;
  }
  if (!out.type && !out.emirate) return null;
  return out;
}

/** "Apartments for sale in Dubai Marina" style heading. */
export function areaHeading(purpose: Purpose, f: AreaFilter): string {
  const what = f.type ? (TYPE_LABEL[f.type] ?? 'Property') : 'Property';
  const plural = what === 'Property' ? 'Properties' : `${what}s`.replace(/ys$/, 'ies');
  const where = f.community ?? f.emirate ?? 'the UAE';
  return `${plural} for ${purpose === 'rent' ? 'rent' : 'sale'} in ${where}`;
}

/** Path for an agent's public profile; the trailing id is what counts. */
export function agentPath(a: { id: string; name: string }): string {
  const slug = slugify(a.name);
  return `/agent/${slug ? `${slug}-` : ''}${a.id}`;
}

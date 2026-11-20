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
  'furnished',
  'q',
  'agency',
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
    if (['minPrice', 'maxPrice', 'beds', 'page'].includes(key) && !/^\d{1,13}$/.test(value))
      continue;
    out.set(key, value.slice(0, 120));
  }
  return out;
}

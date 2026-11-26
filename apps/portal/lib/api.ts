import 'server-only';
import { headers } from 'next/headers';
import { apiUrl } from './config';
import type { Purpose } from './format';

export interface PublicAgent {
  id: string;
  name: string;
  brn: string | null;
  canCall: boolean;
  canWhatsapp: boolean;
  /** Changes whenever the agent's photo changes; null when the agent has no photo. */
  photoVersion: string | null;
}

export interface ListingPhoto {
  id: string;
  /** Changes when the photo or the agency logo watermark changes; keep it in the URL. */
  version: string;
  width: number;
  height: number;
}

export interface ListingCard {
  id: string;
  reference: string;
  title: string | null;
  purpose: Purpose;
  type: string;
  completion: 'ready' | 'off_plan';
  emirate: string;
  community: string | null;
  subCommunity: string | null;
  building: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  price: number | null;
  rentPeriod: 'yearly' | 'monthly' | null;
  furnishing: string | null;
  verifiedAt: string | null;
  listedAt: string;
  /** Off-plan project name and expected handover (YYYY-MM-DD), when set. */
  project?: string | null;
  handoverDate?: string | null;
  /** number is null when the agency uploaded the permit document instead of typing it. */
  permit: {
    authority: string;
    number: string | null;
    validUntil: string | null;
    /** The link inside the regulator's QR code (https, .gov.ae); the portal draws the QR. */
    verificationUrl?: string | null;
  } | null;
  agent: PublicAgent | null;
  /** Cover only on cards; all photos, in order, on the listing detail. */
  photos: ListingPhoto[];
  photoCount?: number;
  agency: { name: string; slug: string; orn: string | null; emirate: string };
}

export interface ListingDetail extends ListingCard {
  amenities: string[];
  parking: number | null;
  view: string | null;
  developer: string | null;
  paymentPlan: { milestone: string; percent: number }[] | null;
  serviceChargePerSqft: number | null;
  description: string | null;
  updatedAt: string;
  /** Rounded on purpose (about 150 m, or 1 km for villas); null when the agency set no pin. */
  location?: { lat: number; lng: number; radiusM: number } | null;
}

export interface AgentProfile extends PublicAgent {
  agency: ListingCard['agency'];
  listings: { sale: number; rent: number; total: number };
  communities: string[];
}

export interface SearchResult {
  data: ListingCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Facets {
  emirates: string[];
  communities: { emirate: string; community: string; count: number }[];
  types: { type: string; count: number }[];
  amenities?: { name: string; count: number }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: {
      code?: string;
      message?: string;
      errors?: { path: string; message: string }[];
    },
  ) {
    super(body.message ?? `API error ${status}`);
  }
}

async function call<T>(path: string, init?: RequestInit & { revalidate?: number }): Promise<T> {
  const res = await fetch(`${apiUrl()}/v1/public${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    ...(init?.method && init.method !== 'GET'
      ? { cache: 'no-store' as const }
      : { next: { revalidate: init?.revalidate ?? 60 } }),
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) throw new ApiError(res.status, body as ApiError['body']);
  return body as T;
}

export const searchListings = (query: URLSearchParams) =>
  call<SearchResult>(`/listings?${query.toString()}`);

export async function getListing(id: string): Promise<ListingDetail | null> {
  try {
    return await call<ListingDetail>(`/listings/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

export async function getSimilar(id: string): Promise<ListingCard[]> {
  try {
    return (await call<{ data: ListingCard[] }>(`/listings/${encodeURIComponent(id)}/similar`))
      .data;
  } catch {
    return [];
  }
}

export async function getAgent(id: string): Promise<AgentProfile | null> {
  try {
    return await call<AgentProfile>(`/agents/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

export const getFacets = () => call<Facets>('/facets', { revalidate: 300 });

export const getSitemap = () =>
  call<{
    data: {
      id: string;
      title: string | null;
      listingType: Purpose;
      bedrooms: number | null;
      propertyType: string;
      emirate: string;
      community: string | null;
      updatedAt: string;
    }[];
  }>('/sitemap', { revalidate: 600 });

/**
 * Forwards a visitor action to the API with the visitor's IP and browser, which the API trusts
 * only together with the shared portal key (used for rate limiting and spam control).
 */
async function visitorHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const ip = h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const key = process.env.PORTAL_API_KEY;
  return {
    'content-type': 'application/json',
    ...(key ? { 'x-portal-key': key, 'x-portal-client-ip': ip } : {}),
    ...(key && h.get('user-agent') ? { 'x-portal-user-agent': h.get('user-agent')! } : {}),
  };
}

export async function recordContact(id: string, channel: 'whatsapp' | 'call') {
  return call<{ channel: string; href: string; phone: string }>(
    `/listings/${encodeURIComponent(id)}/contact`,
    { method: 'POST', headers: await visitorHeaders(), body: JSON.stringify({ channel }) },
  );
}

export async function sendEnquiry(id: string, body: unknown) {
  return call<{ status: 'received' }>(`/listings/${encodeURIComponent(id)}/enquiries`, {
    method: 'POST',
    headers: await visitorHeaders(),
    body: JSON.stringify(body),
  });
}

export async function sendReport(id: string, body: unknown) {
  return call<{ status: 'received' }>(`/listings/${encodeURIComponent(id)}/reports`, {
    method: 'POST',
    headers: await visitorHeaders(),
    body: JSON.stringify(body),
  });
}

// ───── Website content managed in PropForce admin ─────

export type BannerPlacement = 'home_hero' | 'home_strip' | 'search_top' | 'listing_sidebar';

export interface SiteBanner {
  id: string;
  kind: 'banner' | 'ad';
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  /** The destination stays on the server; links go through /go/banner/:id, which counts clicks. */
  hasLink: boolean;
  advertiser: string | null;
  image: { version: string; width: number; height: number };
}

export interface SiteContent {
  siteName?: string;
  hero: { title: string; subtitle: string };
  announcement: { enabled: boolean; text: string; linkUrl?: string; linkLabel?: string };
  sections: { popularCommunities: boolean; latestListings: boolean };
  about: string;
  contact: { email?: string; phone?: string; whatsapp?: string; address?: string };
  social: Partial<
    Record<'instagram' | 'facebook' | 'linkedin' | 'x' | 'youtube' | 'tiktok', string>
  >;
  seo: { title?: string; description?: string };
}

export interface Site {
  content: SiteContent;
  banners: Record<BannerPlacement, SiteBanner[]>;
}

/** Used when the API cannot be reached, so the site still renders. */
export const FALLBACK_SITE: Site = {
  content: {
    hero: {
      title: 'Find your next home in the UAE',
      subtitle:
        'Listings with advertising permits from licensed agencies. Talk to the agent directly on WhatsApp or phone.',
    },
    announcement: { enabled: false, text: '' },
    sections: { popularCommunities: true, latestListings: true },
    about:
      "Listings are published by licensed agencies. Every listing shows its advertising permit, the agent's BRN and the agency's ORN where provided.",
    contact: {},
    social: {},
    seo: {},
  },
  banners: { home_hero: [], home_strip: [], search_top: [], listing_sidebar: [] },
};

/** Website text and live banners; never throws (falls back to the defaults). */
export async function getSite(): Promise<Site> {
  try {
    return await call<Site>('/site', { revalidate: 60 });
  } catch {
    return FALLBACK_SITE;
  }
}

/** Counts a banner click and returns where it goes. */
export const clickBanner = (id: string) =>
  call<{ url: string }>(`/site/banners/${encodeURIComponent(id)}/click`, { method: 'POST' });

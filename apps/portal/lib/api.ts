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
  permit: { authority: string; number: string; validUntil: string | null } | null;
  agent: PublicAgent | null;
  agency: { name: string; slug: string; orn: string | null; emirate: string };
}

export interface ListingDetail extends ListingCard {
  amenities: string[];
  parking: number | null;
  view: string | null;
  developer: string | null;
  project: string | null;
  handoverDate: string | null;
  paymentPlan: { milestone: string; percent: number }[] | null;
  serviceChargePerSqft: number | null;
  description: string | null;
  updatedAt: string;
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

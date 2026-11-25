import type { ProblemDetails } from '@propforce/contracts';
import { getPublicApiUrl } from './env';

/** An API error carrying the server's RFC 9457 problem details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Partial<ProblemDetails>,
  ) {
    super(problem.detail ?? problem.title ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.problem.code;
  }

  /** Field errors keyed by path, for showing next to form inputs. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  tenantId?: string | null;
  query?: Record<string, string | number | undefined>;
  /** Adds the CSRF header required by cookie-authenticated endpoints. */
  csrf?: boolean;
  /** 'blob' returns the response body as a Blob (file downloads). */
  responseType?: 'json' | 'blob';
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`/v1${path}`, getPublicApiUrl());
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  // A Blob (an image upload) is sent as raw bytes with its own type; anything else as JSON.
  const raw = typeof Blob !== 'undefined' && options.body instanceof Blob ? options.body : null;
  if (raw) headers['Content-Type'] = raw.type || 'application/octet-stream';
  else if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  if (options.tenantId) headers['X-Tenant-Id'] = options.tenantId;
  if (options.csrf) headers['X-PropForce-CSRF'] = '1';

  const res = await fetch(url, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    credentials: 'include', // refresh cookie
    body: raw ?? (options.body === undefined ? null : JSON.stringify(options.body)),
  });
  if (res.status === 204) return undefined as T;
  if (res.ok && options.responseType === 'blob') return (await res.blob()) as T;
  if (res.status === 413) {
    throw new ApiError(413, { detail: 'This file is too large to upload. Try a smaller photo.' });
  }
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data as Partial<ProblemDetails>);
  return data as T;
}

// ───── response types used by the web app ─────

export type Role = 'owner' | 'admin' | 'manager' | 'agent';

export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
export type LoginResponse = TokenResponse | { mfaRequired: true; mfaToken: string };

export interface Membership {
  id: string;
  role: Role;
  agency: {
    id: string;
    name: string;
    slug: string;
    emirate: string;
    status: string;
    approvalStatus?: 'not_required' | 'pending' | 'approved' | 'rejected';
    statusReason?: string | null;
  };
}
export interface MeResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    mfaEnabled: boolean;
    isPlatformAdmin?: boolean;
  };
  mfaRequired: boolean;
  memberships: Membership[];
}
export interface Member {
  id: string;
  role: Role;
  status: 'active' | 'suspended';
  teamId: string | null;
  user: { id: string; fullName: string; email: string };
}
export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}
export interface Agency {
  id: string;
  name: string;
  emirate: string;
  status: string;
  tradeLicenseNo: string | null;
  orn: string | null;
}

// ───── inventory ─────

export type ListingType = 'sale' | 'rent';
export type PropertyStatus = 'draft' | 'active' | 'under_offer' | 'sold' | 'rented' | 'archived';

export interface PropertySummary {
  id: string;
  reference: string;
  title: string | null;
  listingType: ListingType;
  propertyType: string;
  completion: 'ready' | 'off_plan';
  status: PropertyStatus;
  emirate: string;
  community: string | null;
  building: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Decimal values arrive as strings. */
  areaSqft: string | null;
  price: string | null;
  rentPeriod: 'yearly' | 'monthly' | null;
  listingExpiresAt: string | null;
  verifiedAt: string | null;
  /** PropForce's review before the listing reaches the public portal. */
  reviewStatus: ListingReviewStatus;
  createdAt: string;
  assigned: { id: string; user: { fullName: string } } | null;
}

export type ListingReviewStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface ListingCheck {
  key: string;
  label: string;
  ok: boolean;
  /** Required checks block publishing; the others are what PropForce's reviewers look for. */
  required: boolean;
}

export interface Permit {
  id: string;
  authority: string;
  /** Sale or rent, as printed on the permit. */
  purpose: ListingType | null;
  permitNumber: string | null;
  /** The uploaded permit document (private to the agency), if any. */
  document: { contentType: string; fileName: string; updatedAt: string } | null;
  validUntil: string;
  /** The link inside the permit's QR code (https, .gov.ae); the portal shows it as a QR code. */
  verificationUrl: string | null;
}

export interface PropertyDetail extends PropertySummary {
  assignedMembershipId: string | null;
  subCommunity: string | null;
  unitNo: string | null;
  furnishing: string | null;
  parking: number | null;
  floor: number | null;
  view: string | null;
  description: string | null;
  permits: Permit[];
  reviewReason: string | null;
  submittedForReviewAt: string | null;
  qualityChecks: ListingCheck[];
}

export interface PropertyList {
  data: PropertySummary[];
  total: number;
  nextCursor: string | null;
}

export interface DashboardSummary {
  listings: {
    draft: number;
    active: number;
    underOffer: number;
    sold: number;
    rented: number;
    archived: number;
    mine: number;
    needsVerification: number;
  };
  team: { activeMembers: number; pendingInvitations: number };
}

// ───── platform admin ─────

export interface PlatformSummary {
  agencies: {
    total: number;
    active: number;
    pending: number;
    suspended: number;
    newThisWeek: number;
  };
  users: { total: number; verified: number; newThisWeek: number };
  listings: { total: number; live: number; draft: number };
}

export interface PlatformAgency {
  id: string;
  name: string;
  emirate: string;
  status: string;
  orn: string | null;
  createdAt: string;
  onboardedAt: string | null;
  owner: { fullName: string; email: string } | null;
  members: number;
  listings: number;
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  statusReason: string | null;
  plan: string;
  seatLimit: number | null;
  listingLimit: number | null;
  isPlatformOwned?: boolean;
}

export interface PlatformUser {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  isPlatformAdmin: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  memberships: { role: Role; agency: { id: string; name: string } }[];
}

export interface PlatformSetting {
  key: string;
  description: string | null;
  enabled: boolean;
  updatedAt: string;
}

export interface PlatformAuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface PlatformListing {
  id: string;
  reference: string;
  title: string | null;
  listingType: string;
  propertyType: string;
  status: PropertyStatus;
  emirate: string;
  community: string | null;
  building: string | null;
  bedrooms: number | null;
  price: string | null;
  rentPeriod: 'yearly' | 'monthly' | null;
  createdAt: string;
  agency: { id: string; name: string; isPlatformOwned: boolean };
  assigned: { user: { fullName: string } } | null;
}

export interface PlatformDashboard {
  dates: string[];
  series: {
    agencies: number[];
    users: number[];
    listings: number[];
    leads: number[];
    enquiries: number[];
  };
  totals: { leads: number; openLeads: number; enquiries: number; newEnquiries: number };
  topAgencies: {
    id: string;
    name: string;
    isPlatformOwned: boolean;
    listings: number;
    leads: number;
    members: number;
  }[];
}

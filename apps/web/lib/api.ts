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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  tenantId?: string | null;
  query?: Record<string, string | number | undefined>;
  /** Adds the CSRF header required by cookie-authenticated endpoints. */
  csrf?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`/v1${path}`, getPublicApiUrl());
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  if (options.tenantId) headers['X-Tenant-Id'] = options.tenantId;
  if (options.csrf) headers['X-PropForce-CSRF'] = '1';

  const res = await fetch(url, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    credentials: 'include', // refresh cookie
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });
  if (res.status === 204) return undefined as T;
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
  agency: { id: string; name: string; slug: string; emirate: string; status: string };
}
export interface MeResponse {
  user: { id: string; email: string; fullName: string; mfaEnabled: boolean };
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

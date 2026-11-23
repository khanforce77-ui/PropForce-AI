/** Brand shown to visitors. The portal is PropForce's own public website, not an agency site. */
export const SITE_NAME = process.env.NEXT_PUBLIC_PORTAL_NAME ?? 'PropForce Homes';

/** Absolute URL of this website, for canonical links, sitemaps and share text. */
export function siteUrl(): string {
  const raw =
    process.env.PORTAL_PUBLIC_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3100');
  return raw.replace(/\/$/, '');
}

/**
 * Server-only: where the PropForce API lives. The browser never calls the API directly; the
 * portal's server does, so the API address and the shared key stay private.
 */
export function apiUrl(): string {
  const raw = process.env.PORTAL_API_URL ?? 'http://localhost:4000';
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`PORTAL_API_URL must be http(s), got ${url.protocol}`);
  }
  return url.origin;
}

/** Where people send privacy, data deletion and terms questions. The mailbox must exist. */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'privacy@propforce.io';

import { parseEmirateList } from '@propforce/contracts';

/**
 * Public (browser-visible) configuration. Only NEXT_PUBLIC_* values may appear here;
 * secrets must never be read in web code.
 */
export function getPublicApiUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`NEXT_PUBLIC_API_URL must be http(s), got ${url.protocol}`);
  }
  return url.origin;
}

/** Emirates offered at sign-up. Must match the API's SUPPORTED_EMIRATES. */
export function getSupportedEmirates(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPPORTED_EMIRATES ?? 'Dubai,Abu Dhabi';
  return parseEmirateList(raw);
}

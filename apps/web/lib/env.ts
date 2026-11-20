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

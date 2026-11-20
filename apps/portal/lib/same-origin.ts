/**
 * The portal's own API routes accept only requests from its own pages: a browser always sends
 * Origin on POST, so a cross-site form or script is refused.
 */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

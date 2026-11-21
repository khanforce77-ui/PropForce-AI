const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type CaptchaResult = 'ok' | 'failed' | 'not_configured';

/**
 * Checks a Cloudflare Turnstile token. Without a secret (keys still pending) it reports
 * not_configured and callers rely on the honeypot and rate limits alone. A network error fails
 * closed: the visitor is asked to try again rather than letting unchecked traffic through.
 */
export async function verifyCaptcha(
  secret: string | undefined,
  token: string | undefined,
  ip: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptchaResult> {
  if (!secret) return 'not_configured';
  if (!token) return 'failed';
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 'failed';
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

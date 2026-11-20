import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Google OAuth for agent calendars (FR-H): authorization code flow with PKCE, a signed and
 * expiring `state` bound to the agent and agency, offline access, minimal scopes.
 */

/** Minimal scopes: read free/busy and manage events the app creates. No full calendar read. */
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

export const createPkce = (): Pkce => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export interface StatePayload {
  readonly tenantId: string;
  readonly userId: string;
  /** Random value also stored server-side with the PKCE verifier (single use). */
  readonly nonce: string;
  /** Expiry, epoch seconds. */
  readonly exp: number;
}

const STATE_TTL_SECONDS = 600;

/** HMAC-signed state: `<base64url(json)>.<base64url(hmac)>`. */
export const signState = (
  p: Omit<StatePayload, 'exp' | 'nonce'>,
  secret: string,
  nowMs: number = Date.now(),
): { state: string; nonce: string } => {
  if (secret.length < 32) throw new Error('OAuth state secret must be at least 32 characters');
  const nonce = randomBytes(16).toString('base64url');
  const payload: StatePayload = { ...p, nonce, exp: Math.floor(nowMs / 1000) + STATE_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return { state: `${body}.${mac}`, nonce };
};

/** Returns the payload when the signature is valid and not expired, else null. */
export const verifyState = (
  state: string,
  secret: string,
  nowMs: number = Date.now(),
): StatePayload | null => {
  if (typeof state !== 'string' || state.length > 2048) return null;
  const [body, mac, extra] = state.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (typeof p.exp !== 'number' || p.exp * 1000 <= nowMs) return null;
    if (
      typeof p.tenantId !== 'string' ||
      typeof p.userId !== 'string' ||
      typeof p.nonce !== 'string'
    ) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
};

export interface AuthUrlInput {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly loginHint?: string;
}

export const buildGoogleAuthUrl = (i: AuthUrlInput): string => {
  if (!/^https:\/\//.test(i.redirectUri) && !/^http:\/\/localhost(:\d+)?\//.test(i.redirectUri)) {
    throw new Error('Redirect URI must be https (or localhost in development)');
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: i.clientId,
    redirect_uri: i.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    // Force the consent screen so Google returns a refresh token on reconnect.
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: i.state,
    code_challenge: i.codeChallenge,
    code_challenge_method: 'S256',
    ...(i.loginHint ? { login_hint: i.loginHint } : {}),
  }).toString();
  return url.toString();
};

/** Scopes Google actually granted must include everything we need (users can untick boxes). */
export const hasRequiredScopes = (grantedScope: string | undefined): boolean => {
  const granted = new Set((grantedScope ?? '').split(/\s+/));
  return GOOGLE_CALENDAR_SCOPES.filter((s) => s.startsWith('https://')).every((s) =>
    granted.has(s),
  );
};

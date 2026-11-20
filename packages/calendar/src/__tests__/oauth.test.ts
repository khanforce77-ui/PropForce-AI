import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildGoogleAuthUrl,
  createPkce,
  hasRequiredScopes,
  signState,
  verifyState,
} from '../oauth';

const SECRET = 'x'.repeat(32);
const who = { tenantId: 't-1', userId: 'u-1' };

describe('PKCE', () => {
  it('creates an S256 challenge of the verifier', () => {
    const p = createPkce();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'));
  });
});

describe('OAuth state', () => {
  it('round-trips and binds tenant and user', () => {
    const { state, nonce } = signState(who, SECRET, 0);
    expect(verifyState(state, SECRET, 1000)).toMatchObject({ ...who, nonce });
  });
  it('rejects tampering, wrong secret, expiry and junk', () => {
    const { state } = signState(who, SECRET, 0);
    const [body, mac] = state.split('.');
    const forged = Buffer.from(
      JSON.stringify({ tenantId: 't-2', userId: 'u-1', nonce: 'n', exp: 9e9 }),
    ).toString('base64url');
    expect(verifyState(`${forged}.${mac}`, SECRET, 1000)).toBeNull();
    expect(verifyState(state, 'y'.repeat(32), 1000)).toBeNull();
    expect(verifyState(state, SECRET, 601_000)).toBeNull();
    expect(verifyState(`${body}`, SECRET, 1000)).toBeNull();
    expect(verifyState(`${state}.x`, SECRET, 1000)).toBeNull();
  });
  it('refuses short secrets', () => expect(() => signState(who, 'short')).toThrow());
});

describe('auth URL', () => {
  it('requests offline access, PKCE and minimal scopes', () => {
    const u = new URL(
      buildGoogleAuthUrl({
        clientId: 'cid',
        redirectUri: 'https://app.example/v1/calendar/google/callback',
        state: 's',
        codeChallenge: 'c',
      }),
    );
    expect(u.origin).toBe('https://accounts.google.com');
    const q = u.searchParams;
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('scope')).not.toMatch(/auth\/calendar(\s|$)/); // no full calendar scope
    expect(q.get('scope')).toContain('calendar.freebusy');
  });
  it('rejects non-https redirects except localhost', () => {
    expect(() =>
      buildGoogleAuthUrl({
        clientId: 'c',
        redirectUri: 'http://evil.example/cb',
        state: 's',
        codeChallenge: 'c',
      }),
    ).toThrow();
    expect(() =>
      buildGoogleAuthUrl({
        clientId: 'c',
        redirectUri: 'http://localhost:4000/cb',
        state: 's',
        codeChallenge: 'c',
      }),
    ).not.toThrow();
  });
  it('checks the granted scopes', () => {
    expect(
      hasRequiredScopes(
        'openid https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events',
      ),
    ).toBe(true);
    expect(hasRequiredScopes('openid https://www.googleapis.com/auth/calendar.freebusy')).toBe(
      false,
    );
    expect(hasRequiredScopes(undefined)).toBe(false);
  });
});

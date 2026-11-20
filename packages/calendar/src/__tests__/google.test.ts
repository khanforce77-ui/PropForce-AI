import { describe, expect, it } from 'vitest';
import {
  CalendarProviderError,
  FakeCalendarProvider,
  GoogleCalendarProvider,
  googleEventId,
} from '../google';

const VIEWING = '0197a000-0000-7000-8000-0000000000e1';
const ev = {
  start: new Date('2026-11-23T07:00:00Z'),
  end: new Date('2026-11-23T07:30:00Z'),
  summary: 'Viewing MH-S-00412 (Sara)',
  viewingId: VIEWING,
};

const provider = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  new GoogleCalendarProvider({
    clientId: 'cid',
    clientSecret: 'csecret',
    redirectUri: 'https://app.example/cb',
    fetch: async (u, i) => handler(String(u), i),
    now: () => 0,
  });

describe('GoogleCalendarProvider (offline checks only; live API not yet verified)', () => {
  it('requires a configured client', () => {
    expect(
      () => new GoogleCalendarProvider({ clientId: '', clientSecret: '', redirectUri: 'x' }),
    ).toThrow();
  });

  it('exchanges the code with the PKCE verifier and computes expiry', async () => {
    let body = '';
    const p = provider((_u, i) => {
      body = String(i?.body);
      return Response.json({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: 's',
      });
    });
    const t = await p.exchangeCode('code123', 'verifier456');
    expect(body).toContain('code_verifier=verifier456');
    expect(body).toContain('grant_type=authorization_code');
    expect(t).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: new Date(3_540_000),
      scope: 's',
    });
  });

  it('flags revoked grants as reconnect-required', async () => {
    const p = provider(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(p.refresh('rt')).rejects.toMatchObject({
      reconnectRequired: true,
      retryable: false,
    });
  });

  it('parses free/busy and fails closed on calendar errors', async () => {
    const ok = provider(() =>
      Response.json({
        calendars: {
          primary: { busy: [{ start: '2026-11-23T06:00:00Z', end: '2026-11-23T07:00:00Z' }] },
        },
      }),
    );
    expect(await ok.freeBusy('at', { start: new Date(0), end: new Date(1) })).toEqual([
      { start: new Date('2026-11-23T06:00:00Z'), end: new Date('2026-11-23T07:00:00Z') },
    ]);
    const bad = provider(() =>
      Response.json({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }),
    );
    await expect(
      bad.freeBusy('at', { start: new Date(0), end: new Date(1) }),
    ).rejects.toBeInstanceOf(CalendarProviderError);
  });

  it('creates events idempotently with a deterministic id', async () => {
    const seen: unknown[] = [];
    const p = provider((_u, i) => {
      seen.push(JSON.parse(String(i?.body)));
      return seen.length === 1
        ? Response.json({ id: 'x' })
        : Response.json({ error: {} }, { status: 409 });
    });
    const a = await p.createEvent('at', ev);
    const b = await p.createEvent('at', ev); // retry
    expect(a).toEqual(b);
    expect(a.eventId).toBe(googleEventId(VIEWING));
    expect(seen[0]).toMatchObject({
      extendedProperties: { private: { propforceViewingId: VIEWING } },
    });
  });

  it('treats deleting a missing event as success and validates ids', async () => {
    const p = provider(() => Response.json({}, { status: 410 }));
    await expect(p.deleteEvent('at', googleEventId(VIEWING))).resolves.toBeUndefined();
    await expect(p.deleteEvent('at', '../../users/me')).rejects.toThrow();
  });

  it('maps network failures to retryable errors', async () => {
    const p = provider(() => {
      throw new Error('ECONNRESET');
    });
    await expect(p.freeBusy('at', { start: new Date(0), end: new Date(1) })).rejects.toMatchObject({
      retryable: true,
    });
  });
});

describe('googleEventId', () => {
  it('maps UUIDs to valid base32hex ids', () => {
    expect(googleEventId(VIEWING)).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});

describe('FakeCalendarProvider', () => {
  it('reports created events as busy', async () => {
    const f = new FakeCalendarProvider();
    await f.createEvent('at', ev);
    expect(
      await f.freeBusy('at', {
        start: new Date('2026-11-23T00:00:00Z'),
        end: new Date('2026-11-24T00:00:00Z'),
      }),
    ).toHaveLength(1);
  });
});

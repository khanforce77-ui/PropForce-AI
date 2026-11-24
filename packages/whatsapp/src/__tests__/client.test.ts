import { describe, expect, it } from 'vitest';
import { CloudApiClient, FakeWhatsAppClient, mapGraphError } from '../client';
import { FakeEmbeddedSignup, MetaEmbeddedSignup } from '../embedded-signup';

const creds = { phoneNumberId: '106540352242922', accessToken: 'tenant-token' };

describe('CloudApiClient (offline checks only; live API not yet verified)', () => {
  it('builds text requests with link previews off', () => {
    const c = new CloudApiClient({ graphVersion: 'v21.0' });
    expect(c.buildRequest(creds, { type: 'text', to: '971501234567', body: 'Hello' })).toEqual({
      url: 'https://graph.facebook.com/v21.0/106540352242922/messages',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '971501234567',
        type: 'text',
        text: { body: 'Hello', preview_url: false },
      },
    });
  });

  it('builds template requests', () => {
    const c = new CloudApiClient({ graphVersion: 'v21.0' });
    const { body } = c.buildRequest(creds, {
      type: 'template',
      to: '971501234567',
      templateName: 'viewing_reminder',
      languageCode: 'en',
      bodyParams: ['Sara', 'Fri 10:00'],
    });
    expect(body.template).toEqual({
      name: 'viewing_reminder',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Sara' },
            { type: 'text', text: 'Fri 10:00' },
          ],
        },
      ],
    });
  });

  it('rejects path injection and bad recipients', () => {
    const c = new CloudApiClient({ graphVersion: 'v21.0' });
    expect(() =>
      c.buildRequest(
        { ...creds, phoneNumberId: '1/../../me' },
        { type: 'text', to: '971501234567', body: 'x' },
      ),
    ).toThrow();
    expect(() => c.buildRequest(creds, { type: 'text', to: '+971501234567', body: 'x' })).toThrow();
    expect(() => c.buildRequest(creds, { type: 'text', to: '971501234567', body: '' })).toThrow();
    expect(() => new CloudApiClient({ graphVersion: 'latest' })).toThrow();
  });

  it('sends with the tenant token and returns the wamid', async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const c = new CloudApiClient({
      graphVersion: 'v21.0',
      fetch: async (url, init) => {
        seen = { url: String(url), auth: new Headers(init?.headers).get('authorization') };
        return Response.json({ messages: [{ id: 'wamid.1' }] });
      },
    });
    expect(await c.send(creds, { type: 'text', to: '971501234567', body: 'Hi' })).toEqual({
      ok: true,
      wamid: 'wamid.1',
    });
    expect(seen?.auth).toBe('Bearer tenant-token');
  });

  it('maps Graph errors and network failures', async () => {
    const c = (status: number, body: unknown) =>
      new CloudApiClient({
        graphVersion: 'v21.0',
        fetch: async () => Response.json(body, { status }),
      });
    expect(
      await c(400, { error: { code: 131047 } }).send(creds, {
        type: 'text',
        to: '971501234567',
        body: 'x',
      }),
    ).toMatchObject({ code: 'WINDOW_CLOSED', retryable: false });
    expect(
      await c(429, { error: { code: 130429 } }).send(creds, {
        type: 'text',
        to: '971501234567',
        body: 'x',
      }),
    ).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    const down = new CloudApiClient({
      graphVersion: 'v21.0',
      fetch: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(await down.send(creds, { type: 'text', to: '971501234567', body: 'x' })).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
    expect(mapGraphError(401, 190)).toMatchObject({ code: 'TOKEN_INVALID' });
    expect(mapGraphError(400, 132001)).toMatchObject({ code: 'TEMPLATE_ERROR' });
    expect(mapGraphError(503, undefined)).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
  });

  it('fake client records sends or fails as scripted', async () => {
    const ok = new FakeWhatsAppClient();
    expect(await ok.send(creds, { type: 'text', to: '971501234567', body: 'x' })).toMatchObject({
      ok: true,
    });
    expect(ok.sent).toHaveLength(1);
    const bad = new FakeWhatsAppClient({ ok: false, retryable: false, code: 'WINDOW_CLOSED' });
    expect((await bad.send(creds, { type: 'text', to: '971501234567', body: 'x' })).ok).toBe(false);
  });
});

describe('Embedded Signup (offline checks only)', () => {
  it('exchanges the code server-side without putting the secret in the URL', async () => {
    let url = '';
    let body = '';
    const es = new MetaEmbeddedSignup({
      appId: '123',
      appSecret: 's3cret',
      graphVersion: 'v21.0',
      fetch: async (u, init) => {
        url = String(u);
        body = String(init?.body);
        return Response.json({ access_token: 'biz-token' });
      },
    });
    expect(await es.exchangeCode('AQD-valid-code-123')).toEqual({ accessToken: 'biz-token' });
    expect(url).not.toContain('s3cret');
    expect(body).toContain('client_secret=s3cret');
  });

  it('fails on bad responses and invalid ids', async () => {
    const es = new MetaEmbeddedSignup({
      appId: '1',
      appSecret: 's',
      graphVersion: 'v21.0',
      fetch: async () => Response.json({ error: {} }, { status: 400 }),
    });
    await expect(es.exchangeCode('AQD-valid-code-123')).rejects.toThrow(/HTTP 400/);
    await expect(es.subscribeApp('../me', 't')).rejects.toThrow();
    expect(
      () => new MetaEmbeddedSignup({ appId: '', appSecret: '', graphVersion: 'v21.0' }),
    ).toThrow();
  });

  it('looks up the display number with the business token', async () => {
    let auth: string | null = null;
    const es = new MetaEmbeddedSignup({
      appId: '1',
      appSecret: 's',
      graphVersion: 'v21.0',
      fetch: async (_u, init) => {
        auth = new Headers(init?.headers).get('authorization');
        return Response.json({ display_phone_number: '+971 4 123 4567' });
      },
    });
    expect(await es.getDisplayPhoneNumber('106540352242922', 'biz')).toBe('+971 4 123 4567');
    expect(auth).toBe('Bearer biz');
    await expect(es.getDisplayPhoneNumber('../x', 'biz')).rejects.toThrow();
  });

  it('reads token expiry from debug_token with the app token in a header, not the URL', async () => {
    let url = '';
    let auth: string | null = null;
    let expiresAt: unknown = 1_800_000_000;
    const es = new MetaEmbeddedSignup({
      appId: '1',
      appSecret: 's3cret',
      graphVersion: 'v21.0',
      fetch: async (u, init) => {
        url = String(u);
        auth = new Headers(init?.headers).get('authorization');
        return Response.json({ data: { is_valid: true, expires_at: expiresAt } });
      },
    });
    expect(await es.tokenExpiry('biz')).toEqual(new Date(1_800_000_000_000));
    expect(url).toContain('/v21.0/debug_token?input_token=biz');
    expect(url).not.toContain('s3cret');
    expect(auth).toBe('Bearer 1|s3cret');
    expiresAt = 0;
    expect(await es.tokenExpiry('biz')).toBeNull();
    expiresAt = 'soon';
    await expect(es.tokenExpiry('biz')).rejects.toThrow();
  });

  it('takes expiry from the code exchange when Meta sends expires_in', async () => {
    const es = new MetaEmbeddedSignup({
      appId: '1',
      appSecret: 's',
      graphVersion: 'v21.0',
      now: () => 1_000_000,
      fetch: async () => Response.json({ access_token: 'biz', expires_in: 5_184_000 }),
    });
    expect(await es.exchangeCode('AQD-valid-code-123')).toEqual({
      accessToken: 'biz',
      expiresAt: new Date(1_000_000 + 5_184_000_000),
    });
  });

  it('registers the number with the PIN in the body, not the URL', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const es = new MetaEmbeddedSignup({
      appId: '1',
      appSecret: 's',
      graphVersion: 'v21.0',
      fetch: async (u, i) => {
        url = String(u);
        init = i;
        return Response.json({ success: true });
      },
    });
    await es.registerPhone('106540352242922', 'biz-token', '123456');
    expect(url).toBe('https://graph.facebook.com/v21.0/106540352242922/register');
    expect(url).not.toContain('123456');
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: 'whatsapp',
      pin: '123456',
    });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer biz-token');
    await expect(es.registerPhone('../x', 't', '123456')).rejects.toThrow();
    await expect(es.registerPhone('1', 't', '12ab')).rejects.toThrow();
  });

  it('reports Meta error codes when registration fails', async () => {
    const es = new MetaEmbeddedSignup({
      appId: '1',
      appSecret: 's',
      graphVersion: 'v21.0',
      fetch: async () =>
        Response.json({ error: { code: 133005, message: 'PIN mismatch' } }, { status: 400 }),
    });
    await expect(es.registerPhone('1', 't', '123456')).rejects.toThrow(/133005.*PIN mismatch/);
  });

  it('fake records subscriptions', async () => {
    const f = new FakeEmbeddedSignup();
    await f.subscribeApp('102290129340398');
    expect(f.subscribed).toEqual(['102290129340398']);
  });
});

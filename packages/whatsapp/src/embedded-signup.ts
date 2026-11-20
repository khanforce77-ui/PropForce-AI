/**
 * Meta Embedded Signup: lets each agency connect its own WhatsApp Business number to PropForce
 * (PropForce acts as a Meta Tech Provider).
 *
 * Flow: the agency admin completes Meta's signup popup in the web app, which returns a short-lived
 * `code` plus the WABA id and phone number id. The API exchanges the code for a business token
 * server-side (the app secret never reaches the browser), subscribes our app to the WABA's
 * webhooks, and stores the token encrypted per tenant.
 *
 * STATUS: PENDING. Needs Meta Business verification, a Meta app with WhatsApp product, and Tech
 * Provider access. Only checked offline.
 */

export interface MetaAppConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly graphVersion: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface ConnectResult {
  readonly accessToken: string;
}

export interface EmbeddedSignupPort {
  exchangeCode(code: string): Promise<ConnectResult>;
  subscribeApp(wabaId: string, accessToken: string): Promise<void>;
}

const ID = /^\d{1,32}$/;

export class MetaEmbeddedSignup implements EmbeddedSignupPort {
  constructor(private readonly cfg: MetaAppConfig) {
    if (!cfg.appId || !cfg.appSecret) throw new Error('Meta app credentials are not configured');
    if (!/^v\d+\.\d+$/.test(cfg.graphVersion)) throw new Error('Invalid Graph API version');
  }

  private get base() {
    return `${this.cfg.baseUrl ?? 'https://graph.facebook.com'}/${this.cfg.graphVersion}`;
  }

  async exchangeCode(code: string): Promise<ConnectResult> {
    if (!/^[\w.-]{10,1024}$/.test(code)) throw new Error('Invalid signup code');
    // POST with a form body so the secret and code are not in a URL that proxies might log.
    const res = await (this.cfg.fetch ?? fetch)(`${this.base}/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.appId,
        client_secret: this.cfg.appSecret,
        code,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!res.ok || typeof json.access_token !== 'string' || json.access_token.length === 0) {
      throw new Error(`Meta code exchange failed with HTTP ${res.status}`);
    }
    return { accessToken: json.access_token };
  }

  async subscribeApp(wabaId: string, accessToken: string): Promise<void> {
    if (!ID.test(wabaId)) throw new Error('Invalid WABA id');
    const res = await (this.cfg.fetch ?? fetch)(`${this.base}/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Meta webhook subscription failed with HTTP ${res.status}`);
  }
}

export class FakeEmbeddedSignup implements EmbeddedSignupPort {
  readonly subscribed: string[] = [];
  async exchangeCode(code: string): Promise<ConnectResult> {
    if (code === 'bad-code-0000') throw new Error('Meta code exchange failed with HTTP 400');
    return { accessToken: `fake-token-for-${code.slice(0, 8)}` };
  }
  async subscribeApp(wabaId: string): Promise<void> {
    this.subscribed.push(wabaId);
  }
}

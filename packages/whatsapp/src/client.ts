/**
 * Outbound WhatsApp port with a fake (tests/dev) and a Meta Cloud API adapter.
 *
 * Every agency connects its own number (Embedded Signup), so credentials are per call: the caller
 * loads and decrypts the tenant's phone_number_id and access token, then passes them here.
 * Callers must run {@link checkOutboundSend} before calling `send`.
 */

export interface SenderCredentials {
  readonly phoneNumberId: string;
  /** Decrypted per-tenant access token. Never logged. */
  readonly accessToken: string;
}

export type OutboundMessage =
  | { readonly type: 'text'; readonly to: string; readonly body: string }
  | {
      readonly type: 'template';
      readonly to: string;
      readonly templateName: string;
      readonly languageCode: string;
      /** Body parameters in order ({{1}}, {{2}}, ...). */
      readonly bodyParams: readonly string[];
    };

export type SendResult =
  | { readonly ok: true; readonly wamid: string }
  | {
      readonly ok: false;
      /** Whether retrying later may succeed (rate limits, 5xx, timeouts). */
      readonly retryable: boolean;
      readonly code: WhatsAppErrorCode;
      readonly providerCode?: number;
    };

export type WhatsAppErrorCode =
  | 'WINDOW_CLOSED'
  | 'RATE_LIMITED'
  | 'TOKEN_INVALID'
  | 'RECIPIENT_INVALID'
  | 'TEMPLATE_ERROR'
  | 'PROVIDER_ERROR';

export interface WhatsAppClient {
  send(creds: SenderCredentials, msg: OutboundMessage): Promise<SendResult>;
}

/** Records sends; can be scripted to fail. */
export class FakeWhatsAppClient implements WhatsAppClient {
  readonly sent: { creds: SenderCredentials; msg: OutboundMessage; wamid: string }[] = [];
  private n = 0;
  constructor(private readonly failWith?: Extract<SendResult, { ok: false }>) {}
  async send(creds: SenderCredentials, msg: OutboundMessage): Promise<SendResult> {
    if (this.failWith) return this.failWith;
    const wamid = `wamid.fake.${++this.n}`;
    this.sent.push({ creds, msg, wamid });
    return { ok: true, wamid };
  }
}

export const MAX_TEXT_LENGTH = 4096;

/** Maps Meta Graph error codes to our codes. Unknown codes are non-retryable provider errors. */
export const mapGraphError = (
  status: number,
  code: number | undefined,
): Extract<SendResult, { ok: false }> => {
  const base = code !== undefined ? { providerCode: code } : {};
  if (code === 131047) return { ok: false, retryable: false, code: 'WINDOW_CLOSED', ...base };
  if (code === 130429 || code === 131056 || code === 80007 || code === 4 || status === 429) {
    return { ok: false, retryable: true, code: 'RATE_LIMITED', ...base };
  }
  if (code === 190 || status === 401)
    return { ok: false, retryable: false, code: 'TOKEN_INVALID', ...base };
  if (code === 131026 || code === 131009 || code === 100) {
    return { ok: false, retryable: false, code: 'RECIPIENT_INVALID', ...base };
  }
  if (code !== undefined && code >= 132000 && code < 133000) {
    return { ok: false, retryable: false, code: 'TEMPLATE_ERROR', ...base };
  }
  return { ok: false, retryable: status >= 500, code: 'PROVIDER_ERROR', ...base };
};

export interface CloudApiConfig {
  /** Graph API version, e.g. "v21.0". Pin it; bump deliberately. */
  readonly graphVersion: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/**
 * Meta WhatsApp Cloud API adapter.
 *
 * STATUS: PENDING. No WhatsApp Business Account or test number exists yet, so this has only been
 * checked offline (request shape, error mapping). Verify against a Meta test number before use.
 */
export class CloudApiClient implements WhatsAppClient {
  constructor(private readonly cfg: CloudApiConfig) {
    if (!/^v\d+\.\d+$/.test(cfg.graphVersion)) throw new Error('Invalid Graph API version');
  }

  buildRequest(
    creds: SenderCredentials,
    msg: OutboundMessage,
  ): { url: string; body: Record<string, unknown> } {
    if (!/^\d{1,32}$/.test(creds.phoneNumberId)) throw new Error('Invalid phone number id');
    if (!/^[1-9]\d{6,14}$/.test(msg.to)) throw new Error('Invalid recipient');
    const url = `${this.cfg.baseUrl ?? 'https://graph.facebook.com'}/${this.cfg.graphVersion}/${creds.phoneNumberId}/messages`;
    const common = { messaging_product: 'whatsapp', recipient_type: 'individual', to: msg.to };
    if (msg.type === 'text') {
      if (msg.body.length === 0 || msg.body.length > MAX_TEXT_LENGTH)
        throw new Error('Invalid text length');
      // Link previews off: the AI must not cause fetches of arbitrary URLs on the client device.
      return {
        url,
        body: { ...common, type: 'text', text: { body: msg.body, preview_url: false } },
      };
    }
    return {
      url,
      body: {
        ...common,
        type: 'template',
        template: {
          name: msg.templateName,
          language: { code: msg.languageCode },
          ...(msg.bodyParams.length > 0
            ? {
                components: [
                  {
                    type: 'body',
                    parameters: msg.bodyParams.map((text) => ({ type: 'text', text })),
                  },
                ],
              }
            : {}),
        },
      },
    };
  }

  async send(creds: SenderCredentials, msg: OutboundMessage): Promise<SendResult> {
    const { url, body } = this.buildRequest(creds, msg);
    let res: Response;
    try {
      res = await (this.cfg.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${creds.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch {
      return { ok: false, retryable: true, code: 'PROVIDER_ERROR' };
    }
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { code?: number };
    };
    const wamid = json.messages?.[0]?.id;
    if (res.ok && wamid) return { ok: true, wamid };
    return mapGraphError(res.status, json.error?.code);
  }
}

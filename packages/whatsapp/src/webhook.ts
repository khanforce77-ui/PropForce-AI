import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Max webhook body size accepted (API spec §9). */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

/**
 * Verifies `X-Hub-Signature-256` (HMAC-SHA256 of the exact raw body with the Meta app secret)
 * in constant time. Must run on the raw bytes, before any JSON parsing.
 */
export const verifyWebhookSignature = (
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean => {
  if (!appSecret || !signatureHeader || rawBody.length > MAX_WEBHOOK_BYTES) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1]!, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/**
 * GET verification handshake. Returns the challenge to echo, or null to answer 403.
 * The verify token is compared in constant time.
 */
export const verifySubscription = (
  query: Record<string, unknown>,
  verifyToken: string,
): string | null => {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string')
    return null;
  if (!verifyToken || !/^[\w-]{1,128}$/.test(challenge)) return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
};

// Payload schemas: permissive for fields we don't use (Meta adds fields over time), strict on
// the fields we rely on.
const media = z.object({
  id: z.string().max(128),
  mime_type: z.string().max(100).optional(),
  sha256: z.string().max(128).optional(),
  caption: z.string().max(4096).optional(),
  filename: z.string().max(255).optional(),
});

const inboundMessage = z.object({
  from: z.string().regex(/^\d{6,15}$/),
  id: z.string().min(1).max(256),
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string().max(32),
  text: z.object({ body: z.string().max(4096) }).optional(),
  image: media.optional(),
  document: media.optional(),
  audio: media.optional(),
  video: media.optional(),
  button: z
    .object({ text: z.string().max(256), payload: z.string().max(256).optional() })
    .optional(),
  interactive: z
    .object({
      type: z.string().max(32),
      button_reply: z.object({ id: z.string().max(256), title: z.string().max(256) }).optional(),
      list_reply: z.object({ id: z.string().max(256), title: z.string().max(256) }).optional(),
    })
    .optional(),
  location: z
    .object({ latitude: z.number(), longitude: z.number(), name: z.string().max(256).optional() })
    .optional(),
});

const statusUpdate = z.object({
  id: z.string().min(1).max(256),
  status: z.enum(['sent', 'delivered', 'read', 'failed', 'deleted']),
  timestamp: z.string().regex(/^\d{1,12}$/),
  recipient_id: z.string().max(32),
  errors: z
    .array(
      z.object({
        code: z.number(),
        title: z.string().max(512).optional(),
        message: z.string().max(1024).optional(),
        error_data: z.object({ details: z.string().max(2048).optional() }).optional(),
      }),
    )
    .max(5)
    .optional(),
});

const changeValue = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string().max(32),
    phone_number_id: z.string().max(64),
  }),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().max(32),
        profile: z.object({ name: z.string().max(256) }).optional(),
      }),
    )
    .max(50)
    .optional(),
  messages: z.array(inboundMessage).max(100).optional(),
  statuses: z.array(statusUpdate).max(100).optional(),
});

export const webhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        id: z.string().max(64),
        changes: z.array(z.object({ field: z.string().max(64), value: z.unknown() })).max(100),
      }),
    )
    .max(100),
});

export type InboundKind = 'text' | 'media' | 'button' | 'location' | 'unsupported';

/** Normalized inbound message: one per Meta message id (`wamid`), the idempotency key. */
export interface InboundEvent {
  readonly kind: 'message';
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly wamid: string;
  readonly fromWaId: string;
  readonly profileName?: string;
  readonly sentAt: Date;
  readonly messageType: InboundKind;
  /** Client-visible text: text body, caption, button/list title. Untrusted. */
  readonly text?: string;
  readonly media?: {
    readonly mediaId: string;
    readonly mimeType?: string;
    readonly sha256?: string;
  };
}

export interface StatusEvent {
  readonly kind: 'status';
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly wamid: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';
  readonly at: Date;
  readonly errorCodes: readonly number[];
  /** Meta's human-readable reason for a failure (title and details), for operator logs. */
  readonly errorDetail?: string;
}

export type WebhookEvent = InboundEvent | StatusEvent;

export interface ParseResult {
  readonly events: readonly WebhookEvent[];
  /** Count of changes/items skipped as malformed or unsupported (logged, never fatal). */
  readonly skipped: number;
}

/**
 * Parses a verified webhook body into normalized events. Malformed items are skipped and counted
 * rather than failing the whole batch, so one bad item cannot block a tenant's other messages.
 * Throws only if the envelope itself is not a WhatsApp webhook.
 */
export const parseWebhook = (body: unknown): ParseResult => {
  const env = webhookPayloadSchema.parse(body);
  const events: WebhookEvent[] = [];
  let skipped = 0;
  for (const entry of env.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') {
        skipped++;
        continue;
      }
      const v = changeValue.safeParse(change.value);
      if (!v.success) {
        skipped++;
        continue;
      }
      const { metadata, contacts, messages, statuses } = v.data;
      const names = new Map((contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of messages ?? []) {
        events.push(toInbound(entry.id, metadata.phone_number_id, m, names.get(m.from)));
      }
      for (const s of statuses ?? []) {
        events.push({
          kind: 'status',
          wabaId: entry.id,
          phoneNumberId: metadata.phone_number_id,
          wamid: s.id,
          status: s.status,
          at: new Date(Number(s.timestamp) * 1000),
          errorCodes: (s.errors ?? []).map((e) => e.code),
          ...(s.errors?.[0]
            ? {
                errorDetail: [s.errors[0].title, s.errors[0].error_data?.details]
                  .filter(Boolean)
                  .join(': '),
              }
            : {}),
        });
      }
    }
  }
  return { events, skipped };
};

const toInbound = (
  wabaId: string,
  phoneNumberId: string,
  m: z.infer<typeof inboundMessage>,
  profileName: string | undefined,
): InboundEvent => {
  const base = {
    kind: 'message' as const,
    wabaId,
    phoneNumberId,
    wamid: m.id,
    fromWaId: m.from,
    sentAt: new Date(Number(m.timestamp) * 1000),
    ...(profileName ? { profileName } : {}),
  };
  const mediaPart = m.image ?? m.document ?? m.audio ?? m.video;
  if (m.type === 'text' && m.text) return { ...base, messageType: 'text', text: m.text.body };
  if (['image', 'document', 'audio', 'video'].includes(m.type) && mediaPart) {
    return {
      ...base,
      messageType: 'media',
      ...(mediaPart.caption ? { text: mediaPart.caption } : {}),
      media: {
        mediaId: mediaPart.id,
        ...(mediaPart.mime_type ? { mimeType: mediaPart.mime_type } : {}),
        ...(mediaPart.sha256 ? { sha256: mediaPart.sha256 } : {}),
      },
    };
  }
  if (m.type === 'button' && m.button)
    return { ...base, messageType: 'button', text: m.button.text };
  if (m.type === 'interactive' && m.interactive) {
    const title = m.interactive.button_reply?.title ?? m.interactive.list_reply?.title;
    return { ...base, messageType: 'button', ...(title ? { text: title } : {}) };
  }
  if (m.type === 'location' && m.location) {
    return {
      ...base,
      messageType: 'location',
      ...(m.location.name ? { text: m.location.name } : {}),
    };
  }
  return { ...base, messageType: 'unsupported' };
};

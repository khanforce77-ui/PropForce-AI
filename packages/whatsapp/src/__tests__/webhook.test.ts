import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_WEBHOOK_BYTES,
  parseWebhook,
  verifySubscription,
  verifyWebhookSignature,
} from '../webhook';

const SECRET = 'test-app-secret';
const sign = (body: Buffer, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const payload = (value: unknown, field = 'messages') => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '102290129340398', changes: [{ field, value }] }],
});
const meta = { display_phone_number: '971500000000', phone_number_id: '106540352242922' };

describe('verifyWebhookSignature', () => {
  const body = Buffer.from(JSON.stringify(payload({})));
  it('accepts a correct signature', () =>
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true));
  it('rejects wrong secret, tampered body, missing or malformed header', () => {
    expect(verifyWebhookSignature(body, sign(body, 'other'), SECRET)).toBe(false);
    expect(
      verifyWebhookSignature(Buffer.concat([body, Buffer.from(' ')]), sign(body), SECRET),
    ).toBe(false);
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body).slice(0, -2), SECRET)).toBe(false);
  });
  it('fails closed without a configured secret', () =>
    expect(verifyWebhookSignature(body, sign(body, ''), '')).toBe(false));
  it('rejects oversized bodies', () => {
    const big = Buffer.alloc(MAX_WEBHOOK_BYTES + 1);
    expect(verifyWebhookSignature(big, sign(big), SECRET)).toBe(false);
  });
});

describe('verifySubscription', () => {
  const q = {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'tok-123',
    'hub.challenge': '1158201444',
  };
  it('echoes the challenge for the right token', () =>
    expect(verifySubscription(q, 'tok-123')).toBe('1158201444'));
  it('refuses wrong token, mode, or an unsafe challenge', () => {
    expect(verifySubscription({ ...q, 'hub.verify_token': 'nope' }, 'tok-123')).toBeNull();
    expect(verifySubscription({ ...q, 'hub.mode': 'unsubscribe' }, 'tok-123')).toBeNull();
    expect(verifySubscription({ ...q, 'hub.challenge': '<script>' }, 'tok-123')).toBeNull();
    expect(verifySubscription(q, '')).toBeNull();
  });
});

describe('parseWebhook', () => {
  it('normalizes text, media, button and status events', () => {
    const { events, skipped } = parseWebhook(
      payload({
        messaging_product: 'whatsapp',
        metadata: meta,
        contacts: [{ wa_id: '971501234567', profile: { name: 'Sara' } }],
        messages: [
          {
            from: '971501234567',
            id: 'wamid.A',
            timestamp: '1763668800',
            type: 'text',
            text: { body: 'Hi' },
          },
          {
            from: '971501234567',
            id: 'wamid.B',
            timestamp: '1763668801',
            type: 'image',
            image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'like this' },
          },
          {
            from: '971501234567',
            id: 'wamid.C',
            timestamp: '1763668802',
            type: 'button',
            button: { text: 'STOP' },
          },
          { from: '971501234567', id: 'wamid.D', timestamp: '1763668803', type: 'sticker' },
        ],
        statuses: [
          {
            id: 'wamid.OUT',
            status: 'failed',
            timestamp: '1763668804',
            recipient_id: '971501234567',
            errors: [{ code: 131047 }],
          },
        ],
      }),
    );
    expect(skipped).toBe(0);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'message',
        wamid: 'wamid.A',
        messageType: 'text',
        text: 'Hi',
        profileName: 'Sara',
        phoneNumberId: meta.phone_number_id,
        wabaId: '102290129340398',
      }),
      expect.objectContaining({
        wamid: 'wamid.B',
        messageType: 'media',
        text: 'like this',
        media: { mediaId: 'media-1', mimeType: 'image/jpeg' },
      }),
      expect.objectContaining({ wamid: 'wamid.C', messageType: 'button', text: 'STOP' }),
      expect.objectContaining({ wamid: 'wamid.D', messageType: 'unsupported' }),
      expect.objectContaining({
        kind: 'status',
        wamid: 'wamid.OUT',
        status: 'failed',
        errorCodes: [131047],
      }),
    ]);
    expect((events[0] as { sentAt: Date }).sentAt.toISOString()).toBe('2025-11-20T20:00:00.000Z');
  });

  it('skips malformed changes without failing the batch', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: meta,
                messages: [{ from: 'not-a-number', id: 'x', timestamp: '1', type: 'text' }],
              },
            },
          ],
        },
        { id: '2', changes: [{ field: 'account_update', value: {} }] },
        {
          id: '3',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: meta,
                messages: [
                  {
                    from: '971501234567',
                    id: 'wamid.ok',
                    timestamp: '1',
                    type: 'text',
                    text: { body: 'ok' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const r = parseWebhook(body);
    expect(r.skipped).toBe(2);
    expect(r.events.map((e) => e.wamid)).toEqual(['wamid.ok']);
  });

  it('rejects non-WhatsApp envelopes', () => {
    expect(() => parseWebhook({ object: 'page', entry: [] })).toThrow();
  });
});

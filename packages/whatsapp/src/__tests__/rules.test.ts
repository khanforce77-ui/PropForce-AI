import { describe, expect, it } from 'vitest';
import {
  checkOutboundSend,
  isOptInMessage,
  isOptOutMessage,
  isWithinServiceWindow,
  toWaId,
} from '../rules';

const now = new Date('2026-11-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('opt-out keywords', () => {
  it.each([
    'STOP',
    'stop.',
    ' Stop! ',
    'unsubscribe',
    'إلغاء',
    'الغاء',
    'إيقاف',
    'توقف',
    'إلغاء الاشتراك',
  ])('detects %s', (t) => expect(isOptOutMessage(t)).toBe(true));
  it.each([
    'which metro stop is closest?',
    'don’t stop sending listings',
    'cancel my viewing on Friday',
    '',
    undefined,
  ])('ignores %s', (t) => expect(isOptOutMessage(t)).toBe(false));
  it('detects opt-in', () => {
    expect(isOptInMessage('START')).toBe(true);
    expect(isOptInMessage('start looking')).toBe(false);
  });
});

describe('service window', () => {
  it('is open for 24 hours after the last inbound message', () => {
    expect(isWithinServiceWindow(hoursAgo(23.9), now)).toBe(true);
    expect(isWithinServiceWindow(hoursAgo(24), now)).toBe(false);
    expect(isWithinServiceWindow(null, now)).toBe(false);
  });
});

describe('checkOutboundSend', () => {
  it('blocks everything for opted-out contacts', () => {
    expect(
      checkOutboundSend({ kind: 'text', lastInboundAt: hoursAgo(1), optedOut: true, now }),
    ).toEqual({ allowed: false, code: 'OPTED_OUT' });
    expect(
      checkOutboundSend({
        kind: 'template',
        lastInboundAt: null,
        optedOut: true,
        templateApproved: true,
        hasConsent: true,
        now,
      }).allowed,
    ).toBe(false);
  });
  it('allows free text only inside the window', () => {
    expect(
      checkOutboundSend({ kind: 'text', lastInboundAt: hoursAgo(2), optedOut: false, now }),
    ).toEqual({ allowed: true });
    expect(
      checkOutboundSend({ kind: 'text', lastInboundAt: hoursAgo(25), optedOut: false, now }),
    ).toEqual({ allowed: false, code: 'WA_WINDOW_CLOSED' });
  });
  it('requires approved templates, and consent outside the window', () => {
    const base = { kind: 'template' as const, optedOut: false, now };
    expect(
      checkOutboundSend({
        ...base,
        lastInboundAt: null,
        templateApproved: false,
        hasConsent: true,
      }),
    ).toEqual({ allowed: false, code: 'TEMPLATE_NOT_APPROVED' });
    expect(checkOutboundSend({ ...base, lastInboundAt: null, templateApproved: true })).toEqual({
      allowed: false,
      code: 'CONSENT_MISSING',
    });
    expect(
      checkOutboundSend({ ...base, lastInboundAt: null, templateApproved: true, hasConsent: true }),
    ).toEqual({ allowed: true });
    expect(
      checkOutboundSend({ ...base, lastInboundAt: hoursAgo(1), templateApproved: true }),
    ).toEqual({ allowed: true });
  });
});

describe('toWaId', () => {
  it('normalizes E.164 numbers', () => {
    expect(toWaId('+971 50 123 4567')).toBe('971501234567');
    expect(toWaId('00971501234567')).toBe('971501234567');
    expect(toWaId('050-123')).toBeNull();
    expect(toWaId('+0123456789')).toBeNull();
  });
});

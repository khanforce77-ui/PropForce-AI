/**
 * WhatsApp messaging rules (FR-D): opt-out keywords, the 24-hour customer service window, and the
 * single decision function every outbound send must pass.
 */

/** Customer service window: free-form messages allowed for 24h after the client's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const normalizeKeyword = (text: string): string =>
  text
    .normalize('NFKC')
    // Arabic diacritics and tatweel.
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[\s.!?,،؟'"`*_~-]+/g, ' ')
    .trim()
    .toLowerCase();

const OPT_OUT = new Set(
  [
    'stop',
    'stop all',
    'unsubscribe',
    'opt out',
    'optout',
    'cancel',
    'end',
    'quit',
    'remove me',
    'do not contact',
    "don't contact me",
    'إلغاء',
    'الغاء',
    'إيقاف',
    'ايقاف',
    'توقف',
    'قف',
    'إلغاء الاشتراك',
    'الغاء الاشتراك',
  ].map(normalizeKeyword),
);

const OPT_IN = new Set(
  ['start', 'subscribe', 'unstop', 'ابدأ', 'ابدا', 'اشتراك'].map(normalizeKeyword),
);

/**
 * Detects an opt-out request. Matches when the whole message is a keyword, so that sentences
 * that merely contain "stop" ("which stop is near the metro?") are not treated as opt-outs.
 */
export const isOptOutMessage = (text: string | undefined): boolean =>
  text !== undefined && OPT_OUT.has(normalizeKeyword(text));

export const isOptInMessage = (text: string | undefined): boolean =>
  text !== undefined && OPT_IN.has(normalizeKeyword(text));

export const isWithinServiceWindow = (lastInboundAt: Date | null, now: Date): boolean =>
  lastInboundAt !== null &&
  now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS &&
  lastInboundAt.getTime() <= now.getTime() + 60_000;

export interface SendCheckInput {
  readonly kind: 'text' | 'template';
  readonly lastInboundAt: Date | null;
  /** Contact has opted out of WhatsApp (any purpose) or is on the suppression list. */
  readonly optedOut: boolean;
  /** Template approved by Meta and enabled by the agency. Required for `kind: 'template'`. */
  readonly templateApproved?: boolean;
  /** For business-initiated (template) sends: valid consent for this purpose exists. */
  readonly hasConsent?: boolean;
  readonly now: Date;
}

export type SendDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: 'OPTED_OUT' | 'WA_WINDOW_CLOSED' | 'TEMPLATE_NOT_APPROVED' | 'CONSENT_MISSING';
    };

/** Fail-closed gate for every outbound message. */
export const checkOutboundSend = (i: SendCheckInput): SendDecision => {
  if (i.optedOut) return { allowed: false, code: 'OPTED_OUT' };
  if (i.kind === 'text') {
    return isWithinServiceWindow(i.lastInboundAt, i.now)
      ? { allowed: true }
      : { allowed: false, code: 'WA_WINDOW_CLOSED' };
  }
  if (i.templateApproved !== true) return { allowed: false, code: 'TEMPLATE_NOT_APPROVED' };
  // Inside the window a template is a reply; outside it is business-initiated and needs consent.
  if (!isWithinServiceWindow(i.lastInboundAt, i.now) && i.hasConsent !== true) {
    return { allowed: false, code: 'CONSENT_MISSING' };
  }
  return { allowed: true };
};

/** E.164 without "+", as WhatsApp uses for `wa_id` and `to`. */
export const toWaId = (e164: string): string | null => {
  const digits = e164
    .replace(/[\s()-]/g, '')
    .replace(/^\+/, '')
    .replace(/^00/, '');
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null;
};

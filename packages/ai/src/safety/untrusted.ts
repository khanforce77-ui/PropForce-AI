import { randomBytes } from 'node:crypto';

/**
 * Prompt-injection defenses for untrusted text (client messages, file contents, brochure text).
 *
 * Primary defense is structural and does not depend on detection: untrusted text never enters
 * the system/developer instructions, it is placed in a user-role message inside a delimited block
 * whose boundary carries a random per-run nonce, and tools are allowlisted and re-validated
 * server-side regardless of what the text says. Detection below only flags attempts for audit
 * and for an earlier human handover; it is not relied on to block anything.
 */

const MAX_UNTRUSTED_CHARS = 4000;

/** Zero-width chars, bidi overrides/isolates, word joiners, BOM and Unicode tag characters. */
const INVISIBLE = new RegExp(
  String.raw`[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]`,
  'gu',
);

/** Remove characters that can hide text from humans or fake structure for the model. */
export const sanitizeUntrusted = (text: string): string =>
  text
    .normalize('NFKC')
    // C0/C1 controls except tab and newline.
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '')
    // Zero-width chars, bidi overrides/isolates, BOM, tag characters.
    .replace(INVISIBLE, '')
    .slice(0, MAX_UNTRUSTED_CHARS);

export interface UntrustedBlock {
  readonly nonce: string;
  readonly text: string;
}

export const newNonce = (): string => randomBytes(9).toString('base64url');

/**
 * Wraps untrusted items in a nonce-delimited block. Any attempt to forge the boundary is
 * neutralized because the nonce is unknown to the author and literal tags are defanged.
 */
export const wrapUntrusted = (
  label: string,
  items: readonly { readonly role: 'client' | 'agent' | 'ai'; readonly text: string }[],
  nonce: string = newNonce(),
): UntrustedBlock => {
  const body = items.map((m) => `[${m.role}] ${defangTags(sanitizeUntrusted(m.text))}`).join('\n');
  return {
    nonce,
    text: `<untrusted_${label} id="${nonce}">\n${body}\n</untrusted_${label} id="${nonce}">`,
  };
};

const defangTags = (s: string): string =>
  s.replace(/<(\/?)(untrusted|system|developer|instructions?|tool)/gi, '‹$1$2');

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|all|your|system)\b.{0,30}\b(instructions?|rules|prompt|guidelines)/i,
  /\b(you are now|act as|pretend to be|from now on you)\b/i,
  /\b(system prompt|developer message|hidden instructions?)\b/i,
  /\b(reveal|print|show|repeat)\b.{0,30}\b(prompt|instructions|rules|tools?)\b/i,
  /\btenant_?id\b|\bagency_?id\b/i,
  /<\/?\s*(system|developer|tool|instructions?)\b/i,
  /(تجاهل|انسَ|انس).{0,30}(التعليمات|الأوامر|القواعد)/u,
];

/** Heuristic flag only. Used for audit and to lower the handover threshold. */
export const looksLikeInjection = (text: string): boolean => {
  const t = sanitizeUntrusted(text);
  return INJECTION_PATTERNS.some((re) => re.test(t));
};

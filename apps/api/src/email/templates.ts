/**
 * Branded transactional emails. Every email has the same layout (logo, heading, text, an
 * optional button and details table, footer) as table-based HTML that renders in Gmail, Outlook
 * and Apple Mail, plus a plain-text version with the same content and full links.
 *
 * Everything that can come from a user (names, messages, agency names) is HTML-escaped here, so
 * callers pass plain strings only.
 */

export interface EmailContent {
  /** Short hidden summary shown by inboxes next to the subject. */
  preheader: string;
  heading: string;
  /** Plain-text paragraphs. Newlines inside a paragraph become line breaks. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Label/value rows, e.g. an enquiry's name and phone. */
  details?: [string, string][];
  /** A quoted block, e.g. a visitor's message. */
  quote?: string;
  /** Small print under the button, e.g. "This link expires in 24 hours." */
  footnote?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const BRAND = '#0f766e';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const lines = (value: string) => escapeHtml(value).replace(/\r?\n/g, '<br>');

/** Only http(s) links go into buttons; anything else is dropped. */
function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * @param appUrl Base URL of the web app (APP_WEB_URL); the logo is served from it.
 */
export function renderEmail(content: EmailContent, appUrl: string): RenderedEmail {
  const base = appUrl.replace(/\/$/, '');
  const logo = `${base}/brand/propforce-email-logo.png`;
  const button = content.button ? safeUrl(content.button.url) : null;
  const year = new Date().getUTCFullYear();

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${INK};">${lines(p)}</p>`,
    )
    .join('');

  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border:1px solid ${LINE};border-radius:10px;border-collapse:separate;">${content.details
        .map(
          ([label, value], i) =>
            `<tr><td style="padding:10px 14px;font-size:13px;color:${MUTED};width:110px;${
              i ? `border-top:1px solid ${LINE};` : ''
            }">${escapeHtml(label)}</td><td style="padding:10px 14px;font-size:14px;color:${INK};${
              i ? `border-top:1px solid ${LINE};` : ''
            }">${lines(value)}</td></tr>`,
        )
        .join('')}</table>`
    : '';

  const quote = content.quote
    ? `<div style="margin:0 0 20px;padding:14px 16px;background:#f8fafc;border-left:4px solid ${BRAND};border-radius:6px;font-size:14px;line-height:22px;color:${INK};">${lines(content.quote)}</div>`
    : '';

  const cta = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="border-radius:10px;background:${BRAND};"><a href="${escapeHtml(button)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(content.button!.label)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:12px;line-height:18px;color:${MUTED};">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(button)}" style="color:${BRAND};word-break:break-all;">${escapeHtml(button)}</a></p>`
    : '';

  const footnote = content.footnote
    ? `<p style="margin:0;font-size:13px;line-height:20px;color:${MUTED};">${lines(content.footnote)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td><img src="${escapeHtml(logo)}" width="36" height="36" alt="PropForce" style="display:block;border-radius:8px;"></td>
<td style="padding-left:10px;font-size:18px;font-weight:700;color:${INK};font-family:${FONT};">PropForce</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border-radius:16px;border:1px solid ${LINE};overflow:hidden;">
<div style="height:4px;background:${BRAND};background-image:linear-gradient(90deg,${BRAND},#14b8a6,#f59e0b);"></div>
<div style="padding:32px 32px 28px;font-family:${FONT};">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${INK};">${escapeHtml(content.heading)}</h1>
${paragraphs}${details}${quote}${cta}${footnote}
</div>
</td></tr>
<tr><td style="padding:20px 8px;text-align:center;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
PropForce · Real estate CRM and property portal for the UAE<br>
You received this email because of activity on your PropForce account.<br>
© ${year} PropForce
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.details?.length ? [...content.details.map(([l, v]) => `${l}: ${v}`), ''] : []),
    ...(content.quote ? [content.quote, ''] : []),
    ...(button ? [`${content.button!.label}: ${button}`, ''] : []),
    ...(content.footnote ? [content.footnote, ''] : []),
    '—',
    'PropForce',
  ].join('\n');

  return { html, text };
}

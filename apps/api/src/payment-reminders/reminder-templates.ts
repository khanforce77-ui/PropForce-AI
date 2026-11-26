/**
 * Ready-made payment-reminder templates for each channel and stage, the placeholders they may use,
 * and rendering. Developers can edit any template; a missing edit falls back to the default here.
 */

export const REMINDER_CHANNELS = ['email', 'sms', 'ai_call'] as const;
export type ReminderChannelName = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_STAGES = ['before', 'due', 'overdue'] as const;
export type ReminderStage = (typeof REMINDER_STAGES)[number];

export type TemplateKey = `${ReminderChannelName}.${ReminderStage}`;

/**
 * email: subject + HTML body. sms: body only (subject unused). ai_call: subject is the first
 * sentence the AI says when the buyer answers; body is the call script (instructions to the AI).
 */
export interface ReminderTemplate {
  subject: string;
  body: string;
}

export const PLACEHOLDERS = {
  buyer_name: "Buyer's full name",
  developer_name: 'Your company name',
  project: 'Project name',
  unit: 'Unit number (empty if not set)',
  installment: 'Installment label, e.g. "Installment 3"',
  amount: 'Amount due, e.g. "AED 125,000"',
  due_date: 'Due date, e.g. "10 Dec 2026"',
  days: 'Days before the due date (or days overdue)',
  payment_instructions: 'Your bank or payment instructions (set in Reminder settings)',
  contact_phone: 'Your contact phone (set in Reminder settings)',
  reply_email: 'Your reply-to email (set in Reminder settings)',
} as const;
export type PlaceholderName = keyof typeof PLACEHOLDERS;
export type TemplateValues = Record<PlaceholderName, string>;

export const SMS_MAX_LENGTH = 480;

export const stageForOffset = (offsetDays: number): ReminderStage =>
  offsetDays < 0 ? 'before' : offsetDays === 0 ? 'due' : 'overdue';

const emailLayout = (
  heading: string,
  intro: string,
  closing: string,
) => `<p>Dear {{buyer_name}},</p>
<p>${intro}</p>
<table role="presentation" cellpadding="6" style="border-collapse:collapse;margin:16px 0">
  <tr><td style="color:#555">Project</td><td><strong>{{project}}</strong></td></tr>
  <tr><td style="color:#555">Unit</td><td><strong>{{unit}}</strong></td></tr>
  <tr><td style="color:#555">Installment</td><td><strong>{{installment}}</strong></td></tr>
  <tr><td style="color:#555">Amount</td><td><strong>{{amount}}</strong></td></tr>
  <tr><td style="color:#555">Due date</td><td><strong>{{due_date}}</strong></td></tr>
</table>
<p><strong>How to pay</strong><br>{{payment_instructions}}</p>
<p>${closing}</p>
<p>If you have already paid, please ignore this message, or reply with your payment receipt so we can update our records.</p>
<p>Questions? Call us on {{contact_phone}} or reply to {{reply_email}}.</p>
<p>Kind regards,<br>${heading}</p>`;

const callRules = `Rules you must always follow:
- At the start, say you are an AI assistant calling on behalf of {{developer_name}}.
- Speak politely and briefly. Never threaten, pressure or shame the buyer.
- Never ask for or accept card numbers, bank passwords or one-time codes on this call.
- If the buyer says they already paid, thank them and ask them to send the receipt to {{reply_email}}.
- If the buyer asks to stop calls or says this is a bad time, apologise and end the call.
- If the buyer has a question you cannot answer, say a team member will call back on {{contact_phone}}.
- Use only the facts below. Do not invent amounts, dates, penalties or offers.

Facts: project {{project}}, unit {{unit}}, {{installment}} of {{amount}}, due {{due_date}}.
Payment instructions: {{payment_instructions}}`;

export const DEFAULT_TEMPLATES: Record<TemplateKey, ReminderTemplate> = {
  'email.before': {
    subject: 'Payment reminder: {{installment}} due on {{due_date}} – {{project}}',
    body: emailLayout(
      '{{developer_name}}',
      'This is a friendly reminder that your next payment for {{project}} is due in {{days}} days.',
      'Paying on time keeps your payment plan on track.',
    ),
  },
  'email.due': {
    subject: 'Your payment for {{project}} is due today',
    body: emailLayout(
      '{{developer_name}}',
      'Your installment for {{project}} is due <strong>today</strong>.',
      'Please make the payment today to stay on schedule.',
    ),
  },
  'email.overdue': {
    subject: 'Overdue payment: {{installment}} for {{project}}',
    body: emailLayout(
      '{{developer_name}}',
      'Our records show that your installment for {{project}} is now {{days}} days overdue.',
      'Please make the payment as soon as possible, or contact us if you need help.',
    ),
  },
  'sms.before': {
    subject: '',
    body: 'Dear {{buyer_name}}, reminder: {{installment}} of {{amount}} for {{project}} {{unit}} is due on {{due_date}}. Questions: {{contact_phone}}. {{developer_name}}',
  },
  'sms.due': {
    subject: '',
    body: 'Dear {{buyer_name}}, your {{installment}} of {{amount}} for {{project}} {{unit}} is due today. If already paid, please ignore. {{contact_phone}}. {{developer_name}}',
  },
  'sms.overdue': {
    subject: '',
    body: 'Dear {{buyer_name}}, your {{installment}} of {{amount}} for {{project}} {{unit}} is {{days}} days overdue. Please pay or call {{contact_phone}}. {{developer_name}}',
  },
  'ai_call.before': {
    subject:
      'Hello {{buyer_name}}, this is an AI assistant calling on behalf of {{developer_name}} with a quick reminder about your payment plan. Is this a good time?',
    body: `You are calling {{buyer_name}} to remind them that {{installment}} of {{amount}} for {{project}} is due on {{due_date}}, in {{days}} days.
Confirm they are aware of the date, offer to repeat the payment instructions, and ask if they have any questions.

${callRules}`,
  },
  'ai_call.due': {
    subject:
      'Hello {{buyer_name}}, this is an AI assistant calling on behalf of {{developer_name}} about your payment that is due today. Is this a good time?',
    body: `You are calling {{buyer_name}} because {{installment}} of {{amount}} for {{project}} is due today ({{due_date}}).
Ask politely whether the payment has been made or when they plan to pay today. Offer to repeat the payment instructions.

${callRules}`,
  },
  'ai_call.overdue': {
    subject:
      'Hello {{buyer_name}}, this is an AI assistant calling on behalf of {{developer_name}} about your payment plan. Is this a good time?',
    body: `You are calling {{buyer_name}} because {{installment}} of {{amount}} for {{project}} was due on {{due_date}} and is now {{days}} days overdue.
Ask politely whether there is a problem, when they expect to pay, and whether they would like a team member to call them back.

${callRules}`,
  },
};

export const templateKey = (channel: ReminderChannelName, stage: ReminderStage): TemplateKey =>
  `${channel}.${stage}`;

/** The developer's edited template, or the default. */
export function resolveTemplate(
  edits: Partial<Record<string, ReminderTemplate>>,
  key: TemplateKey,
): ReminderTemplate & { edited: boolean } {
  const edit = edits[key];
  return edit ? { ...edit, edited: true } : { ...DEFAULT_TEMPLATES[key], edited: false };
}

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Placeholders used in a text that are not known. */
export function unknownPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)]
    .map((m) => m[1]!)
    .filter((name) => !(name in PLACEHOLDERS));
}

/** Fills placeholders. In HTML, values are escaped so buyer or project names cannot inject markup. */
export function fill(text: string, values: TemplateValues, mode: 'text' | 'html'): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (!(name in values)) return whole;
    const v = values[name as PlaceholderName];
    return mode === 'html' ? escapeHtml(v).replaceAll('\n', '<br>') : v;
  });
}

/**
 * Removes active content from a developer's HTML: scripts, frames, forms, event handlers and
 * javascript: links. Email clients block most of it anyway; this keeps our own sends clean.
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<\s*(script|style|iframe|object|form|button|textarea|select)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
      '',
    )
    .replace(
      /<\s*\/?\s*(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base)\b[^>]*>/gi,
      '',
    )
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')?\s*(javascript|vbscript|data):[^"'\s>]*("|')?/gi, '$1="#"');
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|tr|h[1-6]|div|li)\s*>/gi, '\n')
    .replace(/<\s*\/\s*td\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Email wrapped in a plain layout with a footer saying who sent it and why. */
export function renderEmail(t: ReminderTemplate, values: TemplateValues): RenderedEmail {
  const subject = fill(t.subject, values, 'text')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 200);
  const inner = fill(sanitizeEmailHtml(t.body), values, 'html');
  const footer = `You are receiving this because you have a payment plan with ${escapeHtml(
    values.developer_name,
  )}. Sent by PropForce on their behalf.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f5"><div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${inner}<hr style="border:none;border-top:1px solid #ddd;margin:24px 0"><p style="font-size:12px;color:#777">${footer}</p></div></body></html>`;
  return { subject, html, text: `${htmlToText(inner)}\n\n--\n${htmlToText(footer)}` };
}

export function renderSms(t: ReminderTemplate, values: TemplateValues): string {
  return fill(t.body, values, 'text').replace(/\s+/g, ' ').trim().slice(0, SMS_MAX_LENGTH);
}

export function renderCall(
  t: ReminderTemplate,
  values: TemplateValues,
): { firstMessage: string; instructions: string } {
  return {
    firstMessage: fill(t.subject, values, 'text').replace(/\s+/g, ' ').trim(),
    instructions: fill(t.body, values, 'text').trim(),
  };
}

export const SAMPLE_VALUES: TemplateValues = {
  buyer_name: 'Ahmed Khan',
  developer_name: 'Your Company',
  project: 'Marina Heights',
  unit: 'Unit 1204',
  installment: 'Installment 3',
  amount: 'AED 125,000',
  due_date: '10 Dec 2026',
  days: '7',
  payment_instructions: 'Bank transfer to the escrow account shown in your SPA.',
  contact_phone: '+971 4 000 0000',
  reply_email: 'accounts@example.ae',
};

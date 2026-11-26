import { Global, Logger, Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { EmailSender, type EmailMessage } from './email.sender';

/** Used when SMTP_URL is not set (local development). Logs the recipient and subject only. */
export class LogEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');
  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      `Email is not configured; email to ${message.to} ("${message.subject}") was not sent`,
    );
  }
}

export class SmtpEmailSender extends EmailSender {
  private readonly transport;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(smtpUrl);
  }
  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/**
 * Sends through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Errors are thrown with Resend's message (never the key), so callers can fall back, e.g. to
 * showing an invitation link.
 */
export class ResendEmailSender extends EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }
  async send(message: EmailMessage): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { message?: string; name?: string };
        detail = body.message ?? body.name ?? '';
      } catch {
        // not JSON
      }
      throw new Error(`Resend rejected the email (${res.status})${detail ? `: ${detail}` : ''}`);
    }
  }
}

/** Resend when its key is set, otherwise SMTP (e.g. AWS SES), otherwise log only. */
export function createEmailSender(config: AppConfig['email']): EmailSender {
  if (config.resendApiKey) return new ResendEmailSender(config.resendApiKey, config.from);
  if (config.smtpUrl) return new SmtpEmailSender(config.smtpUrl, config.from);
  return new LogEmailSender();
}

@Global()
@Module({
  providers: [
    {
      provide: EmailSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailSender => createEmailSender(config.email),
    },
  ],
  exports: [EmailSender],
})
export class EmailModule {}

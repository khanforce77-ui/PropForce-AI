import { Global, Logger, Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { EmailSender, type EmailMessage } from './email.sender';

/** Used when SMTP_URL is not set (local development). Logs the recipient and subject only. */
export class LogEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');
  async send(message: EmailMessage): Promise<void> {
    this.logger.warn(
      `SMTP_URL not configured; email to ${message.to} ("${message.subject}") was not sent`,
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

@Global()
@Module({
  providers: [
    {
      provide: EmailSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmailSender =>
        config.email.smtpUrl
          ? new SmtpEmailSender(config.email.smtpUrl, config.email.from)
          : new LogEmailSender(),
    },
  ],
  exports: [EmailSender],
})
export class EmailModule {}

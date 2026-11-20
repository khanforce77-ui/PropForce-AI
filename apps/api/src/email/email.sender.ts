export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Transport-agnostic email port. Real providers are adapters behind it. */
export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<void>;
}

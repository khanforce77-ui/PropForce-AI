/**
 * Outbound channel ports for payment reminders. Email uses the platform EmailSender (AWS SES in
 * production). SMS and AI calls are adapters behind these ports; until a provider is connected
 * the pending implementations report `configured = false` and nothing is sent.
 */

export interface SmsSender {
  /** Short provider name for admins, or null while pending. */
  readonly name: string | null;
  readonly configured: boolean;
  send(input: { toE164: string; text: string; tenantId: string }): Promise<{ messageId: string }>;
}
export const SMS_SENDER = Symbol('SMS_SENDER');

export class ChannelNotConfiguredError extends Error {
  constructor(channel: string) {
    super(`No ${channel} provider is connected yet.`);
  }
}

/** No SMS provider has been chosen or given credentials yet. */
export class PendingSmsSender implements SmsSender {
  readonly name = null;
  readonly configured = false;
  send(): Promise<{ messageId: string }> {
    return Promise.reject(new ChannelNotConfiguredError('SMS'));
  }
}

export interface ReminderCallInput {
  tenantId: string;
  toE164: string;
  customerName: string;
  /** The first sentence the AI says. */
  firstMessage: string;
  /** The call script: full instructions for the AI. */
  instructions: string;
  metadata: Record<string, string>;
}

export interface ReminderCaller {
  readonly configured: boolean;
  placeCall(input: ReminderCallInput): Promise<{ providerCallId: string }>;
}
export const REMINDER_CALLER = Symbol('REMINDER_CALLER');

/** Used until the outbound AI calling adapter is connected. */
export class PendingReminderCaller implements ReminderCaller {
  readonly configured = false;
  placeCall(): Promise<{ providerCallId: string }> {
    return Promise.reject(new ChannelNotConfiguredError('AI calling'));
  }
}

import type { VoiceDialer } from '../voice/voice-dialer';

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
  /** The developer's own voice line, if any; otherwise the platform's default number. */
  fromPhoneNumberId: string | null;
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

/** Questions the AI answers after each reminder call (shown with the call summary). */
export const REMINDER_CALL_QUESTIONS = [
  'Did the buyer say the payment was already made?',
  'When did the buyer say they will pay?',
  'Did the buyer ask for a call-back from the team, and when?',
];

/** Places reminder calls through the platform's outbound AI calling adapter. */
export class VoiceDialerReminderCaller implements ReminderCaller {
  constructor(private readonly dialer: VoiceDialer) {}
  get configured(): boolean {
    return this.dialer.configured;
  }
  placeCall(input: ReminderCallInput): Promise<{ providerCallId: string }> {
    return this.dialer.startCall({
      fromPhoneNumberId: input.fromPhoneNumberId,
      toE164: input.toE164,
      customerName: input.customerName,
      firstMessage: input.firstMessage,
      instructions: input.instructions,
      questions: REMINDER_CALL_QUESTIONS,
      language: 'en',
      metadata: input.metadata,
      maxDurationSec: 300,
    });
  }
}

/** Not bound by default: kept for tests and for running without the voice module. */
export class PendingReminderCaller implements ReminderCaller {
  readonly configured = false;
  placeCall(): Promise<{ providerCallId: string }> {
    return Promise.reject(new ChannelNotConfiguredError('AI calling'));
  }
}

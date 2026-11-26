import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { CALL_OUTCOMES } from './call-outcomes';

/** What the AI should do on one outbound call. Provider-neutral: no provider names leak out. */
export interface DialInput {
  /** Provider number to ring from. Falls back to the platform's default number. */
  fromPhoneNumberId?: string | null;
  toE164: string;
  customerName?: string | null;
  firstMessage: string;
  /** Full system instructions for the call, guardrails included. */
  instructions: string;
  /** Questions whose answers the provider should extract after the call. */
  questions: string[];
  language: 'en' | 'ar';
  /** Returned unchanged in webhooks. Keep values short strings. */
  metadata: Record<string, string>;
  maxDurationSec?: number;
}

/**
 * Starts outbound AI calls on PropForce's voice provider account (Vapi). Adapter only: it has
 * not been run against the live provider yet, and it refuses to dial until VAPI_API_KEY is set.
 */
@Injectable()
export class VoiceDialer {
  private readonly log = new Logger(VoiceDialer.name);
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** True when calls can be placed and their results can come back. */
  get configured(): boolean {
    const v = this.config.voice;
    return !!v.apiKey && !!v.webhookSecret;
  }

  /** Builds the provider request body. Exposed for tests. */
  buildRequest(input: DialInput): Record<string, unknown> {
    const v = this.config.voice;
    const phoneNumberId = input.fromPhoneNumberId ?? v.defaultPhoneNumberId;
    if (!phoneNumberId) {
      throw new AppError(
        409,
        'INTEGRATION_NOT_CONFIGURED',
        'No calling number is set up for this agency yet.',
      );
    }
    const answers = Object.fromEntries(
      input.questions.map((q, i) => [`q${i + 1}`, { type: 'string', description: q }]),
    );
    const settings = {
      firstMessage: input.firstMessage,
      firstMessageMode: 'assistant-speaks-first',
      model: {
        provider: 'openai',
        model: this.config.ai.model,
        temperature: 0.3,
        messages: [{ role: 'system', content: input.instructions }],
      },
      endCallFunctionEnabled: true,
      maxDurationSeconds: input.maxDurationSec ?? 600,
      // Recordings are not kept: only the summary, outcome and (by policy) the transcript.
      artifactPlan: { recordingEnabled: false },
      analysisPlan: {
        summaryPlan: { enabled: true },
        structuredDataPlan: {
          enabled: true,
          schema: {
            type: 'object',
            properties: {
              outcome: { type: 'string', enum: [...CALL_OUTCOMES] },
              callbackAt: {
                type: 'string',
                description: 'When the person asked to be called back, as they said it.',
              },
              answers: { type: 'object', properties: answers },
            },
            required: ['outcome'],
          },
        },
      },
      server: {
        url: v.webhookUrl,
        headers: { 'X-Vapi-Secret': v.webhookSecret ?? '' },
      },
      serverMessages: ['end-of-call-report', 'status-update'],
      ...(input.language === 'ar'
        ? { transcriber: { provider: 'deepgram', model: 'nova-2', language: 'ar' } }
        : {}),
    };
    return {
      phoneNumberId,
      customer: {
        number: input.toE164,
        ...(input.customerName ? { name: input.customerName.slice(0, 40) } : {}),
      },
      ...(v.assistantId
        ? { assistantId: v.assistantId, assistantOverrides: settings }
        : { assistant: { name: 'PropForce AI Calling', ...settings } }),
      metadata: input.metadata,
    };
  }

  async startCall(input: DialInput): Promise<{ providerCallId: string }> {
    const v = this.config.voice;
    if (!v.apiKey || !v.webhookSecret) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'AI calling is not set up yet.');
    }
    const res = await fetch(`${v.apiUrl}/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${v.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildRequest(input)),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
    if (!res.ok || typeof body?.id !== 'string') {
      // Provider errors can echo request details; log the status, not the body.
      this.log.warn({ status: res.status }, 'Voice provider refused the call');
      throw new AppError(502, 'PROVIDER_ERROR', 'The call could not be started. Try again later.');
    }
    return { providerCallId: body.id };
  }
}

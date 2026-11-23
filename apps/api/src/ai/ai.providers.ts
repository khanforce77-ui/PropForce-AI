import type { Provider } from '@nestjs/common';
import {
  AiOrchestrator,
  OpenAiResponsesProvider,
  ToolGateway,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '@propforce/ai';
import type { PrismaClient } from '@propforce/db';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PRISMA } from '../database/database.module';
import { AI_ORCHESTRATOR } from './ai-reply.service';
import { PrismaAuditSink, PrismaRateLimiter, PrismaRunSink, PrismaSpendGuard } from './ai-sinks';
import { createToolHandlers } from './ai-tools';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

type Step = LlmResponse | ((req: LlmRequest) => LlmResponse | Promise<LlmResponse>);

/**
 * Model stand-in for development and tests. Tests queue the steps a model would take; with an
 * empty queue it hands the conversation to a person, which is the safe default.
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly requests: LlmRequest[] = [];
  private readonly steps: Step[] = [];
  script(...steps: Step[]): void {
    this.steps.push(...steps);
  }
  reset(): void {
    this.steps.length = 0;
    this.requests.length = 0;
  }
  async next(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const step = this.steps.shift();
    if (step) return typeof step === 'function' ? step(req) : step;
    return {
      kind: 'final',
      text: JSON.stringify({
        reply: 'Thank you for your message. One of our agents will reply shortly.',
        language: 'en',
        citedPropertyIds: [],
        claims: [],
        requestHandover: true,
      }),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'scripted',
    };
  }
}

/** `null` when AI replies are off; conversations then wait for an agent. */
export const aiProviders: Provider[] = [
  {
    provide: LLM_PROVIDER,
    inject: [APP_CONFIG],
    useFactory: (c: AppConfig): LlmProvider | null =>
      c.ai.provider === 'fake'
        ? new ScriptedLlmProvider()
        : c.ai.provider === 'openai'
          ? new OpenAiResponsesProvider({ apiKey: c.ai.openaiApiKey!, model: c.ai.model })
          : null,
  },
  {
    provide: AI_ORCHESTRATOR,
    inject: [APP_CONFIG, PRISMA, LLM_PROVIDER],
    useFactory: (c: AppConfig, prisma: PrismaClient, provider: LlmProvider | null) => {
      if (!provider) return null;
      const spend = new PrismaSpendGuard(prisma, c.ai.monthlyTokenCap);
      const gateway = new ToolGateway({
        handlers: createToolHandlers(prisma),
        audit: new PrismaAuditSink(prisma),
        rateLimiter: new PrismaRateLimiter(prisma),
        spend,
      });
      return new AiOrchestrator({ provider, gateway, spend, runs: new PrismaRunSink(prisma) });
    },
  },
];

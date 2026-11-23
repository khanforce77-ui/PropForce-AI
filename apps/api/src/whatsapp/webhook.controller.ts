import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { parseWebhook, verifySubscription, verifyWebhookSignature } from '@propforce/whatsapp';
import type { Request } from 'express';
import { AiDispatcher } from '../ai/ai-dispatcher';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { InboundService } from './inbound.service';

/**
 * Meta WhatsApp webhook (public; authenticated by the X-Hub-Signature-256 HMAC over the raw body).
 * Storage is inline (so a failure makes Meta retry); the AI reply runs after the response.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly log = new Logger(WhatsAppWebhookController.name);
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly inbound: InboundService,
    private readonly ai: AiDispatcher,
  ) {}

  @Get()
  @Header('content-type', 'text/plain')
  verify(@Query() query: Record<string, unknown>): string {
    const challenge = verifySubscription(query, this.config.whatsapp.verifyToken ?? '');
    if (challenge === null) throw new AppError(403, 'FORBIDDEN', 'Verification failed.');
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const secret = this.config.whatsapp.appSecret;
    if (!secret) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'WhatsApp is not configured.');
    }
    const raw = req.rawBody;
    if (!raw || !verifyWebhookSignature(raw, req.header('x-hub-signature-256'), secret)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    }
    let parsed;
    try {
      parsed = parseWebhook(req.body);
    } catch {
      // Signed by Meta but not a WhatsApp payload we handle: acknowledge so it is not retried.
      return { received: true };
    }
    if (parsed.skipped > 0) this.log.warn({ skipped: parsed.skipped }, 'Skipped webhook items');
    // Errors propagate as 5xx so that Meta retries; storage is idempotent by message id.
    const toAnswer = new Map<string, string>();
    for (const ev of parsed.events) {
      if (ev.kind === 'message') {
        const out = await this.inbound.handleMessage(ev);
        if (out.kind === 'stored' && out.mode === 'ai' && !out.optedOut) {
          toAnswer.set(out.conversationId, out.tenantId);
        }
      } else {
        await this.inbound.handleStatus(ev);
      }
    }
    // One AI turn per conversation, even when a delivery carries several messages.
    for (const [conversationId, tenantId] of toAnswer) this.ai.dispatch(tenantId, conversationId);
    return { received: true };
  }
}

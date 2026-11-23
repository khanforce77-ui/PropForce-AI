import { Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { AiReplyService } from './ai-reply.service';

/**
 * Runs AI turns after the webhook has answered Meta, so a slow model never delays the 200 that
 * stops Meta from retrying. On Vercel, `waitUntil` keeps the function alive until the turn ends;
 * elsewhere the promise simply runs on.
 *
 * STATUS: PENDING live check on Vercel with a real number.
 */
@Injectable()
export class AiDispatcher {
  private readonly log = new Logger(AiDispatcher.name);
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly replies: AiReplyService) {}

  dispatch(tenantId: string, conversationId: string): void {
    if (!this.replies.enabled) return;
    const p = this.replies.respond(tenantId, conversationId).catch((e: unknown) => {
      this.log.error({ err: (e as Error).message, conversationId }, 'AI reply failed');
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
    waitUntil(p);
  }

  /** Resolves when every dispatched turn has finished (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
}

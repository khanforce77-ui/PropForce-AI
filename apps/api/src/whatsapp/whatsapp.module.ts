import { Module } from '@nestjs/common';
import { AiDispatcher } from '../ai/ai-dispatcher';
import { AiReplyService } from '../ai/ai-reply.service';
import { aiProviders } from '../ai/ai.providers';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from '../platform/platform.guard';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { InboundService } from './inbound.service';
import { WhatsAppWebhookController } from './webhook.controller';
import { WHATSAPP_CLIENT, whatsappProviders } from './whatsapp.providers';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [WhatsAppWebhookController, ConversationsController],
  // AI replies live here: they need the WhatsApp client and the webhook needs them.
  providers: [
    ...whatsappProviders,
    ...aiProviders,
    InboundService,
    ConversationsService,
    AiReplyService,
    AiDispatcher,
    PlatformAdminGuard,
  ],
  exports: [InboundService, ConversationsService, WHATSAPP_CLIENT],
})
export class WhatsAppModule {}

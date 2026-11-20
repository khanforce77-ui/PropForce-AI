import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { InboundService } from './inbound.service';
import { WhatsAppWebhookController } from './webhook.controller';
import { whatsappProviders } from './whatsapp.providers';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [WhatsAppWebhookController, ConversationsController],
  providers: [...whatsappProviders, InboundService, ConversationsService],
  exports: [InboundService, ConversationsService],
})
export class WhatsAppModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { VoiceController, VoiceWebhookController } from './voice.controller';
import { AiCallingService } from './ai-calling.service';
import { VoiceDialer } from './voice-dialer';
import { VoiceService } from './voice.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [VoiceWebhookController, VoiceController],
  providers: [VoiceService, AiCallingService, VoiceDialer],
  exports: [VoiceDialer],
})
export class VoiceModule {}

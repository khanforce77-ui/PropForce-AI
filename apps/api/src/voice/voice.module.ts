import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { VoiceController, VoiceWebhookController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [VoiceWebhookController, VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

@Module({
  // The model client lives with WhatsApp AI replies; captions share it (and its spend).
  imports: [AuthModule, TenancyModule, WhatsAppModule],
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}

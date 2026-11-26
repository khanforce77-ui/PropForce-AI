import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { SecurityModule } from './security/security.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { InventoryModule } from './inventory/inventory.module';
import { CrmModule } from './crm/crm.module';
import { PlatformModule } from './platform/platform.module';
import { VoiceModule } from './voice/voice.module';
import { MarketingModule } from './marketing/marketing.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { PortalModule } from './portal/portal.module';
import { MediaModule } from './media/media.module';
import { BillingModule } from './billing/billing.module';
import { CalculatorModule } from './calculator/calculator.module';
import { MatchingModule } from './matching/matching.module';
import { ImportModule } from './import/import.module';
import { ViewingsModule } from './viewings/viewings.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { DealsModule } from './deals/deals.module';
import { PaymentRemindersModule } from './payment-reminders/payment-reminders.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id =
                typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },
          },
        }),
        DatabaseModule,
        EmailModule,
        SecurityModule,
        HealthModule,
        AuthModule,
        TenancyModule,
        InventoryModule,
        CrmModule,
        MatchingModule,
        ImportModule,
        ViewingsModule,
        CampaignsModule,
        DealsModule,
        PaymentRemindersModule,
        CalculatorModule,
        BillingModule,
        VoiceModule,
        MarketingModule,
        PlatformModule,
        WhatsAppModule,
        PortalModule,
        MediaModule,
      ],
    };
  }
}

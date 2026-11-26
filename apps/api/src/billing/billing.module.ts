import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from '../platform/platform.guard';
import { TenancyModule } from '../tenancy/tenancy.module';
import { BILLING_PROVIDER, PendingBillingProvider } from './billing-provider';
import { BillingController, PlatformBillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [BillingController, PlatformBillingController],
  providers: [
    BillingService,
    PlatformAdminGuard,
    // Pending until a payment provider is chosen (PRD Q2) and its keys are in the environment.
    { provide: BILLING_PROVIDER, useClass: PendingBillingProvider },
  ],
})
export class BillingModule {}

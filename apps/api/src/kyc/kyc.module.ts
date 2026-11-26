import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from '../platform/platform.guard';
import { kycReaderProvider } from './kyc-reader';
import { KycController, PlatformKycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [AuthModule],
  controllers: [KycController, PlatformKycController],
  providers: [KycService, kycReaderProvider, PlatformAdminGuard],
})
export class KycModule {}

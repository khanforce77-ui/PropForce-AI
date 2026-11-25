import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformAdminGuard } from './platform.guard';
import { PlatformService } from './platform.service';
import { TrustController } from './trust.controller';
import { TrustService } from './trust.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformController, TrustController],
  providers: [PlatformService, TrustService, PlatformAdminGuard],
})
export class PlatformModule {}

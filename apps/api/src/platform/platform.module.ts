import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformAdminGuard } from './platform.guard';
import { PlatformService } from './platform.service';
import {
  AppNoticeController,
  PlatformSiteController,
  PublicSiteController,
} from './site-content.controller';
import { SiteContentService } from './site-content.service';
import { TrustController } from './trust.controller';
import { TrustService } from './trust.service';

@Module({
  imports: [AuthModule],
  controllers: [
    PlatformController,
    PlatformSiteController,
    PublicSiteController,
    AppNoticeController,
    TrustController,
  ],
  providers: [PlatformService, PlatformAdminGuard, SiteContentService, TrustService],
  exports: [SiteContentService],
})
export class PlatformModule {}

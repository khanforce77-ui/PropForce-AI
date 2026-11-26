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

@Module({
  imports: [AuthModule],
  controllers: [
    PlatformController,
    PlatformSiteController,
    PublicSiteController,
    AppNoticeController,
  ],
  providers: [PlatformService, PlatformAdminGuard, SiteContentService],
  exports: [SiteContentService],
})
export class PlatformModule {}

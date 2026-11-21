import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import {
  AgencyLogoController,
  PhotosController,
  PublicListingPhotosController,
} from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [PhotosController, AgencyLogoController, PublicListingPhotosController],
  providers: [PhotosService],
})
export class MediaModule {}

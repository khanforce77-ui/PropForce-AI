import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ViewingsController } from './viewings.controller';
import { ViewingsService } from './viewings.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [ViewingsController],
  providers: [ViewingsService],
  exports: [ViewingsService],
})
export class ViewingsModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationService } from './invitation.service';
import { InvitationAcceptController, TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';
import { TenantGuard } from './tenant.guard';

@Module({
  imports: [AuthModule],
  controllers: [TenancyController, InvitationAcceptController],
  providers: [TenancyService, InvitationService, TenantGuard],
  exports: [TenantGuard, TenancyService],
})
export class TenancyModule {}

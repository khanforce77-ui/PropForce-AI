import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AgencyPortalController } from './agency-portal.controller';
import { AgencyPortalService } from './agency-portal.service';
import { PublicPortalController } from './public-portal.controller';
import { PublicPortalService } from './public-portal.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [PublicPortalController, AgencyPortalController],
  providers: [PublicPortalService, AgencyPortalService],
})
export class PortalModule {}

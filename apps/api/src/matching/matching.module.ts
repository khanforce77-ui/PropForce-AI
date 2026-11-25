import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [MatchingController],
  providers: [MatchingService],
})
export class MatchingModule {}

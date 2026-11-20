import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { PlatformAdminGuard } from './platform.guard';
import { PlatformService } from './platform.service';

@Controller('platform')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('summary')
  summary(@Req() req: AuthenticatedRequest) {
    return this.platform.summary(req.auth.userId);
  }

  @Get('agencies')
  async agencies(@Req() req: AuthenticatedRequest) {
    return { data: await this.platform.agencies(req.auth.userId) };
  }

  @Get('users')
  async users(@Req() req: AuthenticatedRequest) {
    return { data: await this.platform.recentUsers(req.auth.userId) };
  }
}

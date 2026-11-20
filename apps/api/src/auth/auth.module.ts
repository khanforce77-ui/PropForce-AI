import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { AuthController, MeController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { JwtService } from './jwt.service';
import { MfaService } from './mfa.service';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [
        // In-memory per process for now; moves to Redis storage when the API runs multiple replicas.
        { name: 'default', ttl: 60_000, limit: config.authRateLimitPerMinute },
      ],
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, JwtService, MfaService, AuthGuard],
  exports: [AuthService, AuthGuard, MfaService],
})
export class AuthModule {}

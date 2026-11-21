import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CalculatorController } from './calculator.controller';
import { CalculatorService } from './calculator.service';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [CalculatorController],
  providers: [CalculatorService],
})
export class CalculatorModule {}

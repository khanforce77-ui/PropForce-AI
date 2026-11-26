import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PaymentPlansService } from './payment-plans.service';
import {
  CronController,
  PaymentPlansController,
  PaymentRemindersController,
} from './payment-reminders.controller';
import { PaymentRemindersService } from './payment-reminders.service';
import {
  PendingReminderCaller,
  PendingSmsSender,
  REMINDER_CALLER,
  SMS_SENDER,
} from './reminder-channels';

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [PaymentPlansController, PaymentRemindersController, CronController],
  providers: [
    PaymentPlansService,
    PaymentRemindersService,
    // Pending until an SMS provider is chosen and given credentials.
    { provide: SMS_SENDER, useClass: PendingSmsSender },
    // Pending until the outbound AI calling adapter is connected.
    { provide: REMINDER_CALLER, useClass: PendingReminderCaller },
  ],
})
export class PaymentRemindersModule {}

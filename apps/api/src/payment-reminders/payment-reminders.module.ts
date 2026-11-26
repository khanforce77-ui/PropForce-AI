import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { VoiceDialer } from '../voice/voice-dialer';
import { VoiceModule } from '../voice/voice.module';
import { PaymentPlansService } from './payment-plans.service';
import {
  CronController,
  PaymentPlansController,
  PaymentRemindersController,
} from './payment-reminders.controller';
import { PaymentRemindersService } from './payment-reminders.service';
import {
  PendingSmsSender,
  REMINDER_CALLER,
  SMS_SENDER,
  VoiceDialerReminderCaller,
} from './reminder-channels';

@Module({
  imports: [AuthModule, TenancyModule, VoiceModule],
  controllers: [PaymentPlansController, PaymentRemindersController, CronController],
  providers: [
    PaymentPlansService,
    PaymentRemindersService,
    // Pending until an SMS provider is chosen and given credentials.
    { provide: SMS_SENDER, useClass: PendingSmsSender },
    // Outbound AI calls; refuses to dial until the voice provider keys are set.
    {
      provide: REMINDER_CALLER,
      inject: [VoiceDialer],
      useFactory: (dialer: VoiceDialer) => new VoiceDialerReminderCaller(dialer),
    },
  ],
})
export class PaymentRemindersModule {}

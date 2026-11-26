import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  type LucideIcon,
  Mail,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { Metadata } from 'next';
import { AGENCY_APP_URL } from '@/lib/config';

export const metadata: Metadata = {
  title: 'For developers: payment reminders for your buyers',
  description:
    'Register as a Dubai property developer and send buyers automatic installment reminders by email, SMS and AI call, with ready-made templates you can edit.',
  alternates: { canonical: '/developers' },
};

type Status = 'live' | 'rolling_out' | 'soon';
const STATUS: Record<Status, { label: string; className: string }> = {
  live: { label: 'Available', className: 'bg-emerald-100 text-emerald-800' },
  rolling_out: { label: 'Rolling out', className: 'bg-sky-100 text-sky-800' },
  soon: { label: 'Coming soon', className: 'bg-amber-100 text-amber-800' },
};

interface Channel {
  icon: LucideIcon;
  title: string;
  status: Status;
  how: string[];
  sample: { label: string; text: string };
}

/**
 * Keep in step with the app: email works today; AI calls switch on per developer once outbound
 * calling is approved; SMS waits for an SMS provider (sender ID registration in the UAE).
 */
const CHANNELS: Channel[] = [
  {
    icon: Mail,
    title: 'Automatic email',
    status: 'live',
    how: [
      'A clear email with the project, unit, installment, amount and due date.',
      'Your payment instructions (for example the escrow account) are included.',
      'Sent from PropForce on your behalf; buyer replies go to your own email.',
    ],
    sample: {
      label: 'Ready-made subject',
      text: 'Payment reminder: Installment 3 due on 10 Dec 2026 – Marina Heights',
    },
  },
  {
    icon: MessageSquare,
    title: 'SMS',
    status: 'soon',
    how: [
      'A short text to the buyer’s mobile: amount, due date and your contact number.',
      'Ready-made texts fit in one or two messages; you can change the wording.',
      'Goes live once the SMS sender ID for PropForce is registered in the UAE.',
    ],
    sample: {
      label: 'Ready-made SMS',
      text: 'Dear Ahmed, reminder: Installment 3 of AED 125,000 for Marina Heights Unit 1204 is due on 10 Dec 2026. Questions: +971 4 000 0000. Your Company',
    },
  },
  {
    icon: PhoneCall,
    title: 'AI call',
    status: 'rolling_out',
    how: [
      'Our AI voice assistant calls the buyer between 9 AM and 6 PM Dubai time.',
      'It says it is an AI calling for your company, reminds politely and answers simple questions from your script.',
      'It never asks for card details, and offers a call-back from your team for anything else.',
    ],
    sample: {
      label: 'Ready-made opening line',
      text: 'Hello Ahmed, this is an AI assistant calling on behalf of Your Company with a quick reminder about your payment plan. Is this a good time?',
    },
  },
];

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ClipboardList,
    title: '1. Register as a developer',
    text: 'Create your developer account and add your team. Dubai developers only.',
  },
  {
    icon: Wallet,
    title: '2. Add payment plans',
    text: 'Add each buyer with their unit and installments, or fill a schedule from the price, down payment and frequency.',
  },
  {
    icon: ShieldCheck,
    title: '3. Record consent',
    text: 'Tick the channels the buyer agreed to (for example in the SPA). Reminders never go on a channel without it.',
  },
  {
    icon: CalendarClock,
    title: '4. Choose the schedule',
    text: 'Ready-made: 7 days before (email + SMS), on the due date (email + SMS), and 3 days overdue (email, SMS and AI call). Change it any time.',
  },
  {
    icon: FileText,
    title: '5. Edit the templates',
    text: 'Ready-made templates for every channel and stage. Edit the wording, preview it with a sample buyer and send yourself a test email.',
  },
  {
    icon: BellRing,
    title: '6. PropForce does the rest',
    text: 'Every morning unpaid installments are checked. Each reminder goes once, paid installments stop, and every send is logged.',
  },
];

export default function DevelopersPage() {
  const register = `${AGENCY_APP_URL}/register?type=developer`;
  return (
    <div>
      <section className="bg-gradient-to-br from-[oklch(0.25_0.04_220)] to-primary text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
            For property developers in Dubai
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
            Payment reminders for your buyers, on autopilot
          </h1>
          <p className="mt-4 max-w-2xl text-white/85">
            Keep off-plan installment plans on schedule. PropForce reminds each buyer before the due
            date, on the day and when a payment is late, by email, SMS and AI call.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={register}
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-primary hover:bg-white/90"
            >
              Register as developer
            </a>
            <a
              href={`${AGENCY_APP_URL}/login`}
              className="rounded-lg border border-white/40 px-5 py-2.5 text-sm font-semibold hover:bg-white/10"
            >
              Sign in
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-12">
        <section>
          <h2 className="text-2xl font-bold tracking-tight">How the 3 channels work</h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {CHANNELS.map(({ icon: Icon, title, status, how, sample }) => (
              <div
                key={title}
                className="flex flex-col rounded-2xl border border-border bg-background p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[status].className}`}
                  >
                    {STATUS[status].label}
                  </span>
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm text-muted-foreground">
                  {how.map((h) => (
                    <li key={h} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />{' '}
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 rounded-xl bg-muted p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">{sample.label}</p>
                  <p className="mt-1">{sample.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-2xl font-bold tracking-tight">How it is handled</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-border bg-background p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 rounded-3xl bg-muted p-8 text-center">
          <h2 className="text-2xl font-bold">Start with your next installment</h2>
          <ul className="mx-auto mt-4 flex max-w-xl flex-col gap-2 text-left text-sm sm:items-center">
            {[
              'Dubai property developers only',
              'Reminders only go to buyers who agreed to them',
              'Mark a payment as received and its reminders stop',
            ].map((x) => (
              <li key={x} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden /> {x}
              </li>
            ))}
          </ul>
          <a
            href={register}
            className="mt-6 inline-block rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Register as developer
          </a>
        </section>
      </div>
    </div>
  );
}

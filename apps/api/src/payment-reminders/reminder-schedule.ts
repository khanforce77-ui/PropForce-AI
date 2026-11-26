import { randomUUID } from 'node:crypto';
import type { ReminderChannelName } from './reminder-templates';

/** Dubai is UTC+4 all year (no daylight saving). */
const DUBAI_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * If a daily run is missed (outage, deploy), a reminder can still go out this many days late.
 * Older reminders are skipped rather than sent with stale wording.
 */
export const CATCH_UP_DAYS = 2;

export interface ReminderRule {
  id: string;
  /** Negative = days before the due date, 0 = on the due date, positive = days overdue. */
  offsetDays: number;
  channels: ReminderChannelName[];
  active: boolean;
}

/** Recommended schedule for a new developer. */
export function defaultRules(): ReminderRule[] {
  return [
    { id: randomUUID(), offsetDays: -7, channels: ['email', 'sms'], active: true },
    { id: randomUUID(), offsetDays: 0, channels: ['email', 'sms'], active: true },
    { id: randomUUID(), offsetDays: 3, channels: ['email', 'sms', 'ai_call'], active: true },
  ];
}

/** Today's date in Dubai, as a Date at 00:00 UTC (how Postgres DATE values arrive). */
export function dubaiToday(now: Date): Date {
  const d = new Date(now.getTime() + DUBAI_OFFSET_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function dubaiHour(now: Date): number {
  return new Date(now.getTime() + DUBAI_OFFSET_MS).getUTCHours();
}

/** AI calls are only placed inside the platform's Dubai calling hours [from, to). */
export const inCallWindow = (
  now: Date,
  hours: { from: number; to: number } = { from: 9, to: 18 },
) => {
  const h = dubaiHour(now);
  return h >= hours.from && h < hours.to;
};

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

export const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);

/** Due dates a rule should cover today: due + offset is today, or up to CATCH_UP_DAYS ago. */
export function dueWindow(today: Date, offsetDays: number): { from: Date; to: Date } {
  const to = addDays(today, -offsetDays);
  return { from: addDays(to, -CATCH_UP_DAYS), to };
}

/** Parses "YYYY-MM-DD" as a UTC-midnight Date. */
export function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatAed(amount: number): string {
  return `AED ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function describeOffset(offsetDays: number): string {
  if (offsetDays === 0) return 'On the due date';
  const n = Math.abs(offsetDays);
  const d = n === 1 ? 'day' : 'days';
  return offsetDays < 0
    ? `${n} ${d} before the due date`
    : `${n} ${d} after the due date (overdue)`;
}

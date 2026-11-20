/**
 * Viewing slot computation and conflict checks. Pure functions over UTC instants.
 *
 * Working hours are given in the agency's local time with a fixed UTC offset. The UAE has no
 * daylight saving (UTC+4 all year), so a fixed offset is exact there; other markets would need
 * an IANA-zone implementation.
 */

export interface Interval {
  readonly start: Date;
  readonly end: Date;
}

export interface WorkingHours {
  /** Minutes east of UTC, e.g. 240 for Asia/Dubai. */
  readonly utcOffsetMinutes: number;
  /** Per weekday (0 = Sunday), local "HH:MM" open/close; missing day = closed. */
  readonly days: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, { open: string; close: string }>>;
}

export interface SlotOptions {
  readonly durationMinutes: number;
  /** Free time required before and after each viewing (travel between properties). */
  readonly bufferMinutes: number;
  /** Earliest bookable time is now + this. */
  readonly minNoticeMinutes: number;
  /** Slot start granularity. */
  readonly stepMinutes: number;
  readonly maxSlots: number;
}

export const DEFAULT_SLOT_OPTIONS: SlotOptions = {
  durationMinutes: 30,
  bufferMinutes: 15,
  minNoticeMinutes: 120,
  stepMinutes: 30,
  maxSlots: 10,
};

/** Asia/Dubai default: Monday to Saturday 09:00 to 19:00. Agencies configure their own. */
export const DUBAI_DEFAULT_HOURS: WorkingHours = {
  utcOffsetMinutes: 240,
  days: Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((d) => [d, { open: '09:00', close: '19:00' }]),
  ) as WorkingHours['days'],
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const parseHm = (hm: string): number => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!m) throw new Error(`Invalid time ${hm}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

export const overlaps = (a: Interval, b: Interval): boolean =>
  a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

const padded = (i: Interval, bufferMin: number): Interval => ({
  start: new Date(i.start.getTime() - bufferMin * MIN),
  end: new Date(i.end.getTime() + bufferMin * MIN),
});

/** Working-hour windows (UTC) intersecting [from, to). */
export const workingWindows = (hours: WorkingHours, from: Date, to: Date): Interval[] => {
  const off = hours.utcOffsetMinutes * MIN;
  const out: Interval[] = [];
  // Iterate local calendar days.
  const firstLocalMidnight = Math.floor((from.getTime() + off) / DAY) * DAY - off;
  for (let dayStart = firstLocalMidnight; dayStart < to.getTime(); dayStart += DAY) {
    const weekday = new Date(dayStart + off).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const h = hours.days[weekday];
    if (!h) continue;
    const open = dayStart + parseHm(h.open) * MIN;
    const close = dayStart + parseHm(h.close) * MIN;
    const s = Math.max(open, from.getTime());
    const e = Math.min(close, to.getTime());
    if (e > s) out.push({ start: new Date(s), end: new Date(e) });
  }
  return out;
};

/**
 * Free viewing slots in [from, to): inside working hours, after the minimum notice, and not
 * overlapping any busy interval (padded by the buffer on both sides).
 */
export const findFreeSlots = (
  busy: readonly Interval[],
  hours: WorkingHours,
  range: Interval,
  now: Date,
  opts: SlotOptions = DEFAULT_SLOT_OPTIONS,
): Interval[] => {
  const earliest = now.getTime() + opts.minNoticeMinutes * MIN;
  const step = opts.stepMinutes * MIN;
  const dur = opts.durationMinutes * MIN;
  const blocked = busy.map((b) => padded(b, opts.bufferMinutes));
  const slots: Interval[] = [];
  for (const w of workingWindows(hours, range.start, range.end)) {
    // Align to the step grid in local time so slots land on :00/:30.
    const off = hours.utcOffsetMinutes * MIN;
    let t = Math.ceil((Math.max(w.start.getTime(), earliest) + off) / step) * step - off;
    for (; t + dur <= w.end.getTime(); t += step) {
      const slot = { start: new Date(t), end: new Date(t + dur) };
      if (!blocked.some((b) => overlaps(slot, b))) {
        slots.push(slot);
        if (slots.length >= opts.maxSlots) return slots;
      }
    }
  }
  return slots;
};

export type SlotCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'OUTSIDE_HOURS' | 'TOO_SOON' | 'CONFLICT' };

/** Re-checks a requested slot at booking time (never trust a slot offered earlier). */
export const checkSlot = (
  slot: Interval,
  busy: readonly Interval[],
  hours: WorkingHours,
  now: Date,
  opts: SlotOptions = DEFAULT_SLOT_OPTIONS,
): SlotCheck => {
  if (slot.start.getTime() < now.getTime() + opts.minNoticeMinutes * MIN) {
    return { ok: false, reason: 'TOO_SOON' };
  }
  const inHours = workingWindows(hours, slot.start, slot.end).some(
    (w) => w.start.getTime() === slot.start.getTime() && w.end.getTime() === slot.end.getTime(),
  );
  if (!inHours) return { ok: false, reason: 'OUTSIDE_HOURS' };
  if (busy.some((b) => overlaps(slot, padded(b, opts.bufferMinutes)))) {
    return { ok: false, reason: 'CONFLICT' };
  }
  return { ok: true };
};

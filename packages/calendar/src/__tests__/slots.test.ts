import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLOT_OPTIONS,
  DUBAI_DEFAULT_HOURS,
  checkSlot,
  findFreeSlots,
  workingWindows,
} from '../slots';

// 2026-11-23 is a Monday. Dubai is UTC+4, so 09:00 local = 05:00Z.
const d = (iso: string) => new Date(iso);
const now = d('2026-11-22T20:00:00Z'); // Monday 00:00 Dubai

describe('workingWindows', () => {
  it('maps local hours to UTC and skips closed days', () => {
    const w = workingWindows(
      DUBAI_DEFAULT_HOURS,
      d('2026-11-22T00:00:00Z'),
      d('2026-11-24T00:00:00Z'),
    );
    // Sunday 22nd closed; Monday 23rd 05:00Z-15:00Z.
    expect(w.map((x) => [x.start.toISOString(), x.end.toISOString()])).toEqual([
      ['2026-11-23T05:00:00.000Z', '2026-11-23T15:00:00.000Z'],
    ]);
  });
});

describe('findFreeSlots', () => {
  const range = { start: d('2026-11-23T00:00:00Z'), end: d('2026-11-24T00:00:00Z') };
  it('offers aligned slots around busy times with buffers', () => {
    const busy = [{ start: d('2026-11-23T06:00:00Z'), end: d('2026-11-23T07:00:00Z') }]; // 10:00-11:00 Dubai
    const slots = findFreeSlots(busy, DUBAI_DEFAULT_HOURS, range, now, {
      ...DEFAULT_SLOT_OPTIONS,
      maxSlots: 6,
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      '2026-11-23T05:00:00.000Z', // 09:00
      // 09:30 would end 10:00, inside the 15-minute buffer before the 10:00 busy block
      // 10:00-11:00 busy; 11:00 is inside the buffer after
      '2026-11-23T07:30:00.000Z', // 11:30
      '2026-11-23T08:00:00.000Z',
      '2026-11-23T08:30:00.000Z',
      '2026-11-23T09:00:00.000Z',
      '2026-11-23T09:30:00.000Z',
    ]);
  });
  it('respects minimum notice and the max count', () => {
    const late = d('2026-11-23T08:10:00Z'); // 12:10 Dubai; +2h notice = 14:10 → first slot 14:30
    const slots = findFreeSlots([], DUBAI_DEFAULT_HOURS, range, late, {
      ...DEFAULT_SLOT_OPTIONS,
      maxSlots: 2,
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      '2026-11-23T10:30:00.000Z',
      '2026-11-23T11:00:00.000Z',
    ]);
  });
  it('never offers a slot that ends after closing', () => {
    const slots = findFreeSlots([], DUBAI_DEFAULT_HOURS, range, now, {
      ...DEFAULT_SLOT_OPTIONS,
      maxSlots: 100,
    });
    expect(slots.at(-1)!.end.toISOString()).toBe('2026-11-23T15:00:00.000Z');
  });
});

describe('checkSlot', () => {
  const slot = { start: d('2026-11-23T07:00:00Z'), end: d('2026-11-23T07:30:00Z') };
  it('accepts a free slot in hours', () =>
    expect(checkSlot(slot, [], DUBAI_DEFAULT_HOURS, now)).toEqual({ ok: true }));
  it('rejects conflicts, including inside the buffer', () => {
    const busy = [{ start: d('2026-11-23T07:35:00Z'), end: d('2026-11-23T08:00:00Z') }];
    expect(checkSlot(slot, busy, DUBAI_DEFAULT_HOURS, now)).toEqual({
      ok: false,
      reason: 'CONFLICT',
    });
  });
  it('rejects outside hours and too soon', () => {
    expect(
      checkSlot(
        { start: d('2026-11-22T07:00:00Z'), end: d('2026-11-22T07:30:00Z') },
        [],
        DUBAI_DEFAULT_HOURS,
        d('2026-11-21T00:00:00Z'),
      ),
    ).toEqual({ ok: false, reason: 'OUTSIDE_HOURS' }); // Sunday
    expect(checkSlot(slot, [], DUBAI_DEFAULT_HOURS, d('2026-11-23T06:00:00Z'))).toEqual({
      ok: false,
      reason: 'TOO_SOON',
    });
  });
});

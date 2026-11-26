import { describe, expect, it } from 'vitest';
import { parseBulkLine } from '../crm/crm.schemas';
import { callSlots, callingWindow } from './ai-calling.service';

// 2026-11-27 08:30 Dubai = 04:30 UTC.
const dubai = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, day, h - 4, m));

describe('calling slots', () => {
  it('uses the Dubai calendar day for the window', () => {
    // 01:00 Dubai on the 27th is still the 26th in UTC.
    const w = callingWindow(dubai(27, 1), 9, 18);
    expect(w.start).toEqual(dubai(27, 9));
    expect(w.end).toEqual(dubai(27, 18));
  });

  it('moves early calls to 9am, spaces them, and rolls late ones to the next day', () => {
    const early = callSlots(dubai(27, 8, 30), 2, 60, 9, 18);
    expect(early.map((s) => s.earliestAt)).toEqual([dubai(27, 9), dubai(27, 9, 1)]);
    expect(early[0]!.latestAt).toEqual(dubai(27, 18));

    const late = callSlots(dubai(27, 17, 59), 3, 60, 9, 18);
    expect(late.map((s) => s.earliestAt)).toEqual([
      dubai(27, 17, 59),
      dubai(28, 9),
      dubai(28, 9, 1),
    ]);
    expect(late[1]!.latestAt).toEqual(dubai(28, 18));
  });
});

describe('bulk number lines', () => {
  it('reads a number alone, with a name either side, or after a space', () => {
    expect(parseBulkLine('050 123 4567')).toEqual({ phone: '+971501234567', name: null });
    expect(parseBulkLine('Sara Khan, +971 55 765 4321')).toEqual({
      phone: '+971557654321',
      name: 'Sara Khan',
    });
    expect(parseBulkLine('+44 7700 900123\tJohn')).toEqual({
      phone: '+447700900123',
      name: 'John',
    });
    expect(parseBulkLine('Omar 0509876543')).toEqual({ phone: '+971509876543', name: 'Omar' });
    expect(parseBulkLine('hello')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { addDays, uaeDate, weekStart } from './viewings';

describe('viewing dates', () => {
  it('uses UAE time for the calendar day', () => {
    expect(uaeDate(new Date('2026-12-01T21:30:00Z'))).toBe('2026-12-02');
    expect(uaeDate(new Date('2026-12-01T19:30:00Z'))).toBe('2026-12-01');
  });
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-12-03')).toBe('2026-11-30'); // Thursday
    expect(weekStart('2026-12-06')).toBe('2026-11-30'); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

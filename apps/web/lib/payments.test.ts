import { describe, expect, it } from 'vitest';
import { addMonths, generateSchedule } from './payments';

describe('payment schedule helpers', () => {
  it('clamps month ends', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('splits a price into a down payment and equal installments that add up', () => {
    const s = generateSchedule({
      total: 1_000_000,
      downPercent: 10,
      count: 3,
      everyMonths: 3,
      firstDate: '2026-12-01',
    });
    expect(s.map((i) => i.dueDate)).toEqual([
      '2026-12-01',
      '2027-03-01',
      '2027-06-01',
      '2027-09-01',
    ]);
    expect(s.reduce((a, i) => a + Number(i.amount), 0)).toBeCloseTo(1_000_000, 2);
    const odd = generateSchedule({
      total: 100,
      downPercent: 0,
      count: 3,
      everyMonths: 1,
      firstDate: '2026-12-01',
    });
    expect(odd.map((i) => i.amount)).toEqual(['33.33', '33.33', '33.34']);
  });
});

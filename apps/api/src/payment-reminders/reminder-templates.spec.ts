import { describe, expect, it } from 'vitest';
import { dubaiToday, dueWindow, inCallWindow, isoDate } from './reminder-schedule';
import {
  DEFAULT_TEMPLATES,
  fill,
  renderSms,
  SAMPLE_VALUES,
  sanitizeEmailHtml,
  SMS_MAX_LENGTH,
  stageForOffset,
  unknownPlaceholders,
} from './reminder-templates';

describe('reminder templates', () => {
  it('every default template uses only known placeholders and calls disclose AI', () => {
    for (const [key, t] of Object.entries(DEFAULT_TEMPLATES)) {
      expect(unknownPlaceholders(t.subject + t.body), key).toEqual([]);
      if (key.startsWith('ai_call')) expect(t.subject).toMatch(/\bAI\b/);
      if (key.startsWith('sms')) {
        expect(renderSms(t, SAMPLE_VALUES).length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
      }
    }
  });

  it('escapes values in HTML and leaves unknown placeholders alone', () => {
    const v = { ...SAMPLE_VALUES, buyer_name: '<img src=x onerror=alert(1)>' };
    expect(fill('Hi {{ buyer_name }} {{nope}}', v, 'html')).toBe(
      'Hi &lt;img src=x onerror=alert(1)&gt; {{nope}}',
    );
  });

  it('strips active content from developer HTML', () => {
    const out = sanitizeEmailHtml(
      '<p onmouseover="x()">ok</p><script>bad()</script><iframe src="//e"></iframe><a href="javascript:x">l</a><input name=a>',
    );
    expect(out).toBe('<p>ok</p><a href="#">l</a>');
  });

  it('maps offsets to stages', () => {
    expect([-7, 0, 3].map(stageForOffset)).toEqual(['before', 'due', 'overdue']);
  });
});

describe('reminder schedule', () => {
  it('uses the Dubai calendar day and calling hours', () => {
    // 22:30 UTC on 30 Nov is 02:30 on 1 Dec in Dubai.
    const now = new Date('2026-11-30T22:30:00Z');
    expect(isoDate(dubaiToday(now))).toBe('2026-12-01');
    expect(inCallWindow(now)).toBe(false);
    expect(inCallWindow(new Date('2026-12-01T05:00:00Z'))).toBe(true); // 09:00
    expect(inCallWindow(new Date('2026-12-01T14:00:00Z'))).toBe(false); // 18:00
  });

  it('covers due dates for a rule with a short catch-up window', () => {
    const today = new Date('2026-12-01T00:00:00Z');
    const w = dueWindow(today, -7);
    expect([isoDate(w.from), isoDate(w.to)]).toEqual(['2026-12-06', '2026-12-08']);
    const o = dueWindow(today, 3);
    expect([isoDate(o.from), isoDate(o.to)]).toEqual(['2026-11-26', '2026-11-28']);
  });
});

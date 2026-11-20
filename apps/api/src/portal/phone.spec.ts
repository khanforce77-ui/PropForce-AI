import { describe, expect, it } from 'vitest';
import { normalizePhone, whatsappLink } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['050 123 4567', '+971501234567'],
    ['0501234567', '+971501234567'],
    ['501234567', '+971501234567'],
    ['+971 50 123 4567', '+971501234567'],
    ['+971 (0)50 123 4567', '+971501234567'],
    ['00971501234567', '+971501234567'],
    ['971501234567', '+971501234567'],
    ['04 123 4567', '+97141234567'],
    ['+44 7700 900123', '+447700900123'],
    ['0044 7700 900123', '+447700900123'],
  ])('%s -> %s', (input, out) => {
    expect(normalizePhone(input)).toBe(out);
  });

  it.each(['', 'abc', '12', '+971 12', '050 123', '+0123456789', '7700900123', '0501234567890'])(
    'rejects %s',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('whatsappLink', () => {
  it('drops the plus and encodes the message', () => {
    expect(whatsappLink('+971501234567', 'Hi & ref 1')).toBe(
      'https://wa.me/971501234567?text=Hi%20%26%20ref%201',
    );
  });
});

/**
 * Normalises a phone number typed by an agent to E.164. UAE numbers are the default:
 * "050 123 4567" and "+971 50 123 4567" both become "+971501234567".
 * Returns null when the input cannot be a valid E.164 number.
 */
export function normalizePhone(input: string): string | null {
  let v = input.trim().replace(/[\s().-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  else if (/^0\d{8,9}$/.test(v)) v = `+971${v.slice(1)}`;
  else if (/^971\d{8,9}$/.test(v)) v = `+${v}`;
  return /^\+[1-9]\d{6,14}$/.test(v) ? v : null;
}

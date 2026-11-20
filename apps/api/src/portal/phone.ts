/**
 * Normalises a phone number typed by a visitor or agent to E.164. UAE local formats
 * (050 123 4567, 04 123 4567, 00971..., 971...) become +971...; other countries must be entered
 * with + or 00 and their country code. Returns null when the number cannot be valid.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!/^[+\d][\d\s().-]*$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('971')) {
    // 971501234567 typed without +
  } else if (digits.startsWith('0')) {
    digits = `971${digits.slice(1)}`;
  } else if (/^5\d{8}$/.test(digits)) {
    digits = `971${digits}`;
  } else {
    return null;
  }
  if (digits.startsWith('9710')) digits = `971${digits.slice(4)}`;
  if (digits.startsWith('971') && !/^971(5\d{8}|[234679]\d{7}|800\d{2,9})$/.test(digits)) {
    return null;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

/** wa.me click-to-chat link with a prefilled message. */
export function whatsappLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

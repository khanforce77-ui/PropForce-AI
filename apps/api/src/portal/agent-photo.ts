import { createHash } from 'node:crypto';

/** Largest photo the API accepts. The CRM resizes to 256x256 first, which is ~10-30 KB. */
export const MAX_PHOTO_BYTES = 64 * 1024;

export type PhotoType = 'image/webp' | 'image/jpeg' | 'image/png';

/**
 * Identifies an image by its first bytes, never by what the client claims. Anything else
 * (SVG, HTML, PDF...) is refused, so a "photo" can never carry script.
 */
export function detectImage(bytes: Uint8Array): PhotoType | null {
  const b = (i: number) => bytes[i];
  if (
    bytes.length >= 12 &&
    b(0) === 0x52 &&
    b(1) === 0x49 &&
    b(2) === 0x46 &&
    b(3) === 0x46 &&
    b(8) === 0x57 &&
    b(9) === 0x45 &&
    b(10) === 0x42 &&
    b(11) === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((v, i) => b(i) === v)) return 'image/png';
  return null;
}

/** Parses a data: URL (as produced by canvas.toDataURL) into checked image bytes. */
export function parsePhotoDataUrl(
  dataUrl: string,
): { bytes: Buffer; contentType: PhotoType; sha256: string } | { error: string } {
  const match = /^data:image\/(?:webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match?.[1]) return { error: 'Upload a JPG, PNG or WebP image.' };
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0) return { error: 'The image is empty.' };
  if (bytes.length > MAX_PHOTO_BYTES)
    return { error: 'The image is too large (max 64 KB after resizing).' };
  const contentType = detectImage(bytes);
  if (!contentType) return { error: 'Upload a JPG, PNG or WebP image.' };
  return { bytes, contentType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Refuse decompression bombs: 50 megapixels is far above any phone camera. */
const MAX_INPUT_PIXELS = 50_000_000;
/** Opacity of the watermark: faint enough not to spoil the photo, visible enough to deter reuse. */
const MARK_OPACITY = 0.32;

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heif';

export class MediaError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_IMAGE' | 'IMAGE_TOO_LARGE' | 'IMAGE_TOO_SMALL' | 'IMAGE_UNREADABLE',
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

/** Identifies the real file type from its first bytes; the file name and declared type are ignored. */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heif';
  }
  return null;
}

function assertAcceptable(buf: Buffer) {
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new MediaError('IMAGE_TOO_LARGE', 'Images must be 15 MB or smaller.');
  }
  if (!sniffImage(buf)) {
    throw new MediaError('UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG, WebP or HEIC image.');
  }
}

/** Decoder with a pixel limit, applying the EXIF orientation so photos come out upright. */
const open = (buf: Buffer) =>
  sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();

export interface Variant {
  bytes: Buffer;
  contentType: string;
  width: number;
  height: number;
}

export interface ProcessedPhoto {
  /** Clean copy for storage: upright, metadata (EXIF, GPS) removed, at most 2560 px. No watermark. */
  original: Variant;
  /** 1600 px WebP with the watermark: what the portal and the app show. */
  display: Variant;
  /** 480 px WebP with the watermark, for cards and grids. */
  thumb: Variant;
  /** SHA-256 of the clean original. */
  sha256: string;
}

async function encode(pipeline: sharp.Sharp, contentType: string): Promise<Variant> {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { bytes: data, contentType, width: info.width, height: info.height };
}

/**
 * Turns an uploaded photo into a clean stored original plus watermarked display versions.
 * `watermark` comes from prepareWatermark() or defaultWatermark(); the original is never marked.
 */
export async function processListingPhoto(
  input: Buffer,
  watermark: Buffer,
): Promise<ProcessedPhoto> {
  assertAcceptable(input);
  let original: Variant;
  try {
    // sharp drops all metadata (EXIF, GPS, XMP) unless asked to keep it.
    original = await encode(
      open(input)
        .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true }),
      'image/jpeg',
    );
  } catch {
    throw new MediaError('IMAGE_UNREADABLE', 'This image could not be read.');
  }
  if (Math.min(original.width, original.height) < 400) {
    throw new MediaError('IMAGE_TOO_SMALL', 'Photos must be at least 400 pixels on each side.');
  }
  const { display, thumb } = await renderDisplayVariants(original.bytes, watermark);
  const sha256 = createHash('sha256').update(original.bytes).digest('hex');
  return { original, display, thumb, sha256 };
}

/** Renders the watermarked versions from a stored clean original (also used after a logo change). */
export async function renderDisplayVariants(original: Buffer, watermark: Buffer) {
  return {
    display: await watermarked(original, 1600, watermark),
    thumb: await watermarked(original, 480, watermark),
  };
}

async function watermarked(clean: Buffer, size: number, mark: Buffer): Promise<Variant> {
  const base = await sharp(clean)
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  // The mark spans a bit over a third of the shorter side, centred, like the big portals.
  const markWidth = Math.max(60, Math.round(Math.min(width, height) * 0.4));
  const scaled = await sharp(mark)
    .resize({ width: markWidth, height: Math.round(height * 0.6), fit: 'inside' })
    .png()
    .toBuffer();
  return encode(
    sharp(base.data)
      .composite([{ input: scaled, gravity: 'centre' }])
      .webp({ quality: 82 }),
    'image/webp',
  );
}

/**
 * Turns a logo into a faint white mark with a soft dark edge, readable on light and dark photos.
 * Logos without transparency (e.g. a JPEG on white) use darkness as the shape, so the white
 * background disappears.
 */
export async function prepareWatermark(logo: Buffer): Promise<Buffer> {
  const decoded = await sharp(logo, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .toBuffer();
  const meta = await sharp(decoded).metadata();
  const { data, info } = await sharp(decoded)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const shape = new Float32Array(px);
  let max = 0;
  for (let i = 0; i < px; i++) {
    const luma = 0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!;
    const s = meta.hasAlpha ? data[i * 4 + 3]! : 255 - luma;
    shape[i] = s;
    if (s > max) max = s;
  }
  if (max === 0) throw new MediaError('IMAGE_UNREADABLE', 'This logo appears to be blank.');
  const white = Buffer.alloc(px * 4);
  const shadow = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const a = (shape[i]! / max) * 255 * MARK_OPACITY;
    white[i * 4] = 255;
    white[i * 4 + 1] = 255;
    white[i * 4 + 2] = 255;
    white[i * 4 + 3] = Math.round(a);
    shadow[i * 4 + 3] = Math.round(a * 0.45);
  }
  const raw = { width: info.width, height: info.height, channels: 4 as const };
  const pad = Math.max(2, Math.round(info.width / 200));
  return sharp({
    create: {
      width: info.width + pad,
      height: info.height + pad,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: shadow, raw, left: pad, top: pad },
      { input: white, raw, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Normalises an uploaded agency logo for storage: PNG, upright, metadata removed, at most 800 px. */
export async function normaliseLogo(logo: Buffer): Promise<Variant & { sha256: string }> {
  assertAcceptable(logo);
  let v: Variant;
  try {
    v = await encode(
      open(logo).resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).png(),
      'image/png',
    );
  } catch {
    throw new MediaError('IMAGE_UNREADABLE', 'This logo could not be read.');
  }
  return { ...v, sha256: createHash('sha256').update(v.bytes).digest('hex') };
}

/**
 * The PropForce mark (a house and "PF"), drawn with shapes only so no fonts are needed on the
 * server. Used for agencies without a logo and for the platform's own listings.
 */
const PROPFORCE_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="200" viewBox="0 0 420 200">
  <path d="M100 18 L182 82 V182 H18 V82 Z" fill="none" stroke="#000" stroke-width="16" stroke-linejoin="round"/>
  <path d="M74 182 V122 H126 V182" fill="none" stroke="#000" stroke-width="16"/>
  <path fill="#000" fill-rule="evenodd" d="M215 62 h44 a31 31 0 0 1 0 62 h-24 v58 h-20 z M235 80 v26 h24 a13 13 0 0 0 0 -26 z"/>
  <path fill="#000" d="M318 62 h86 v18 h-66 v26 h56 v18 h-56 v58 h-20 z"/>
</svg>`;

let cachedDefault: Promise<Buffer> | null = null;

/** Prepared watermark for the PropForce mark (our own SVG, so rendering it is safe). */
export function defaultWatermark(): Promise<Buffer> {
  cachedDefault ??= sharp(Buffer.from(PROPFORCE_MARK_SVG)).png().toBuffer().then(prepareWatermark);
  return cachedDefault;
}

/** Largest permit or other document we keep. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Checks an uploaded document (a regulator's permit, for example) and makes it safe to store.
 * PDFs are kept as they are; photos and scans are re-encoded as JPEG, upright, metadata removed.
 */
export async function normaliseDocument(
  buf: Buffer,
): Promise<{ bytes: Buffer; contentType: 'application/pdf' | 'image/jpeg'; sha256: string }> {
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new MediaError('IMAGE_TOO_LARGE', 'Files must be 15 MB or smaller.');
  }
  let bytes: Buffer;
  let contentType: 'application/pdf' | 'image/jpeg';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    if (buf.length > MAX_DOCUMENT_BYTES) {
      throw new MediaError('IMAGE_TOO_LARGE', 'PDFs must be 5 MB or smaller.');
    }
    bytes = buf;
    contentType = 'application/pdf';
  } else {
    if (!sniffImage(buf)) {
      throw new MediaError(
        'UNSUPPORTED_IMAGE',
        'Upload a PDF, or a photo or scan (JPEG, PNG, WebP, HEIC).',
      );
    }
    try {
      bytes = await open(buf)
        .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new MediaError('IMAGE_UNREADABLE', 'This file could not be read.');
    }
    contentType = 'image/jpeg';
  }
  return { bytes, contentType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

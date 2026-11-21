import { describe, expect, it } from 'vitest';
import { detectImage, parsePhotoDataUrl } from './agent-photo';

const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const url = (type: string, b: Buffer) => `data:${type};base64,${b.toString('base64')}`;

describe('agent photo checks', () => {
  it('detects images by their bytes', () => {
    expect(detectImage(webp)).toBe('image/webp');
    expect(detectImage(jpeg)).toBe('image/jpeg');
    expect(detectImage(png)).toBe('image/png');
    expect(detectImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });

  it('accepts a small image and hashes it', () => {
    const r = parsePhotoDataUrl(url('image/webp', webp));
    expect(r).toMatchObject({ contentType: 'image/webp' });
    expect('sha256' in r && r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the real type, not the claimed one', () => {
    expect(parsePhotoDataUrl(url('image/png', jpeg))).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('refuses SVG, HTML disguised as an image, and oversize files', () => {
    expect(parsePhotoDataUrl(url('image/svg+xml', Buffer.from('<svg/>')))).toHaveProperty('error');
    expect(parsePhotoDataUrl(url('image/png', Buffer.from('<html>')))).toHaveProperty('error');
    const big = Buffer.concat([jpeg, Buffer.alloc(70 * 1024)]);
    expect(parsePhotoDataUrl(url('image/jpeg', big))).toHaveProperty('error');
  });
});

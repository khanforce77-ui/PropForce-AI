import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  defaultWatermark,
  MediaError,
  normaliseDocument,
  normaliseLogo,
  prepareWatermark,
  processListingPhoto,
  sniffImage,
} from '../index';

/** A photo-like gradient with EXIF (including a GPS-looking comment) and a sideways orientation. */
async function photo(width = 1200, height = 800, orientation = 1) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = 128;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .withMetadata({
      orientation,
      exif: { IFD0: { Copyright: 'secret-owner', Artist: 'GPS 25.2N' } },
    })
    .jpeg()
    .toBuffer();
}

describe('sniffImage', () => {
  it('recognises real image bytes and ignores everything else', async () => {
    expect(sniffImage(await photo(500, 500))).toBe('jpeg');
    expect(
      sniffImage(
        await sharp(await photo(500, 500))
          .png()
          .toBuffer(),
      ),
    ).toBe('png');
    expect(
      sniffImage(
        await sharp(await photo(500, 500))
          .webp()
          .toBuffer(),
      ),
    ).toBe('webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7 not an image at all'))).toBeNull();
  });
});

describe('processListingPhoto', () => {
  it('keeps a clean upright original and makes watermarked WebP versions', async () => {
    // Orientation 6 = rotate 90°: a 1200x800 file is really an 800x1200 portrait photo.
    const out = await processListingPhoto(await photo(1200, 800, 6), await defaultWatermark());
    expect(out.original).toMatchObject({ contentType: 'image/jpeg', width: 800, height: 1200 });
    expect(out.display).toMatchObject({ contentType: 'image/webp', width: 800, height: 1200 });
    expect(out.thumb).toMatchObject({ width: 320, height: 480 });
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);

    // No EXIF survives in anything we store or serve.
    for (const v of [out.original, out.display, out.thumb]) {
      const meta = await sharp(v.bytes).metadata();
      expect(meta.exif).toBeUndefined();
      expect(v.bytes.includes(Buffer.from('secret-owner'))).toBe(false);
    }

    // The watermark changes the centre of the display image but the original stays untouched.
    const centre = async (buf: Buffer) => {
      const { data } = await sharp(buf)
        .extract({ left: 350, top: 560, width: 100, height: 80 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data.reduce((a, b) => a + b, 0) / data.length;
    };
    const markedCentre = await centre(out.display.bytes);
    const cleanCentre = await centre(await sharp(out.original.bytes).resize(800, 1200).toBuffer());
    expect(Math.abs(markedCentre - cleanCentre)).toBeGreaterThan(2);
  });

  it('refuses tiny images, non-images and oversized files', async () => {
    const mark = await defaultWatermark();
    await expect(processListingPhoto(await photo(300, 300), mark)).rejects.toMatchObject({
      code: 'IMAGE_TOO_SMALL',
    });
    await expect(
      processListingPhoto(Buffer.from('<svg onload="alert(1)"></svg>'), mark),
    ).rejects.toBeInstanceOf(MediaError);
    await expect(
      processListingPhoto(
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16e6)]),
        mark,
      ),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    await expect(
      processListingPhoto(
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)]),
        mark,
      ),
    ).rejects.toMatchObject({ code: 'IMAGE_UNREADABLE' });
  });
});

describe('logos', () => {
  it('turns a logo on a white background into a faint transparent mark', async () => {
    // Dark square logo on white, no transparency.
    const logo = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#ffffff' },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 200, height: 100, channels: 3, background: '#003366' },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 50,
        },
      ])
      .jpeg()
      .toBuffer();
    const stored = await normaliseLogo(logo);
    expect(stored.contentType).toBe('image/png');
    const mark = await prepareWatermark(stored.bytes);
    const { data, info } = await sharp(mark).raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    expect(alphaAt(5, 5)).toBe(0); // the white background became transparent
    expect(alphaAt(200, 100)).toBeGreaterThan(40); // the logo shows, faintly
    expect(alphaAt(200, 100)).toBeLessThan(120);
  });
});

describe('normaliseDocument', () => {
  it('keeps PDFs, re-encodes scans without metadata, refuses anything else', async () => {
        const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    expect((await normaliseDocument(pdf)).contentType).toBe('application/pdf');
    const scan = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#fff' },
    })
      .withExif({ IFD0: { Make: 'Scanner' } })
      .png()
      .toBuffer();
    const out = await normaliseDocument(scan);
    expect(out.contentType).toBe('image/jpeg');
    expect((await sharp(out.bytes).metadata()).exif).toBeUndefined();
    await expect(normaliseDocument(Buffer.from('<html><script>x</script></html>'))).rejects.toThrow(
      /Upload a PDF/,
    );
  });
});

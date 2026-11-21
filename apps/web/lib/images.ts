/** Largest side the server keeps; bigger photos are shrunk in the browser first. */
const MAX_SIDE = 2560;
/** Stay well under the hosting limit on request bodies (4.5 MB on Vercel). */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Makes a photo small enough to upload: browsers that can decode it redraw it upright at no more
 * than 2560 px as a JPEG. Files that are already small are sent untouched, and the server still
 * checks, strips and resizes everything.
 */
export async function prepareForUpload(file: File): Promise<Blob> {
  if (file.size <= MAX_BYTES && file.type !== 'image/heic' && file.type !== 'image/heif') {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (file.size > MAX_BYTES) {
      throw new Error(
        `${file.name} is too large and this browser cannot shrink it. Save it as a JPEG under 4 MB.`,
      );
    }
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Your browser cannot resize images.');
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.9, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error(`${file.name} is too large to upload.`);
}

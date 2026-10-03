'use client';

/**
 * Shrinks a photo in the browser before it is uploaded.
 *
 * Two reasons, and the first is not an optimisation. Uploads go through
 * /api/proxy so the browser never holds an access token, and that proxy runs
 * as a serverless function with a request body limit of about 4.5MB. A photo
 * straight off a phone is routinely larger than that, so sending originals
 * would fail for exactly the users most likely to be selling from a phone.
 *
 * The second is that a listing page has no use for a 4000px original: it costs
 * the buyer bandwidth and the seller nothing to lose.
 */

/** Longest edge, in CSS pixels, that a listing photo is stored at. */
export const MAX_EDGE = 1600;

const QUALITY = 0.82;

export interface DownscaleResult {
  file: File;
  /** False when the original was returned untouched. */
  resized: boolean;
}

/**
 * Returns a smaller file, or the original when shrinking is impossible or
 * would not help. Never throws for an unreadable image: the server validates
 * the bytes anyway and will reject what it cannot serve, with a better message
 * than this layer could give.
 */
export async function downscaleImage(file: File): Promise<DownscaleResult> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { file, resized: false };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // An unsupported format — HEIC in some browsers, or a corrupt file.
    return { file, resized: false };
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { file, resized: false };
    ctx.drawImage(bitmap, 0, 0, width, height);

    const encoded = await encode(canvas);
    if (!encoded) return { file, resized: false };

    // Re-encoding an already-small JPEG can make it bigger. Keep whichever
    // is smaller, so uploading never inflates a file.
    if (encoded.size >= file.size && scale === 1) return { file, resized: false };

    const extension = encoded.type === 'image/webp' ? 'webp' : 'jpg';
    return {
      file: new File([encoded], `${baseName(file.name)}.${extension}`, { type: encoded.type }),
      resized: true,
    };
  } finally {
    bitmap.close?.();
  }
}

/**
 * WebP where the browser has it, JPEG otherwise. `toBlob` silently falls back
 * to PNG for a type it cannot encode, which would be far larger than the
 * input, so the result is checked rather than trusted.
 */
async function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await toBlob(canvas, 'image/webp');
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg');
  return jpeg?.type === 'image/jpeg' ? jpeg : null;
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

function baseName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-');
  return stem.slice(0, 40) || 'photo';
}

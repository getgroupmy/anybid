import { randomBytes } from 'node:crypto';

/**
 * What the platform accepts as a listing photo, and how it decides.
 *
 * A client's declared content-type is not evidence — anyone can label a
 * payload `image/jpeg`. These functions read the bytes instead, so what lands
 * in the bucket is the format we say it is. That matters because the bucket is
 * served publicly from our own domain: an HTML or SVG file accepted as an
 * image would be a stored cross-site scripting hole.
 */
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 12;

const EXTENSIONS: Record<ImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Identifies an image by its leading bytes, or returns null for anything we
 * will not store. SVG is deliberately absent: it is a document that can carry
 * script, not a bitmap.
 */
export function sniffImageType(buf: Uint8Array): ImageType | null {
  // JPEG — SOI marker.
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG — the 8-byte signature.
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP — a RIFF container whose form type is WEBP.
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function extensionFor(type: ImageType): string {
  return EXTENSIONS[type];
}

/**
 * Builds the object key. The client's filename is never used: it is attacker
 * controlled and would let a caller pick paths, overwrite another seller's
 * photo, or smuggle a second extension past whatever reads the key later.
 */
export function imageKeyFor(userId: string, type: ImageType): string {
  const safeUser = userId.replace(/[^A-Za-z0-9_-]/g, '');
  return `listings/${safeUser}/${randomBytes(16).toString('hex')}.${extensionFor(type)}`;
}

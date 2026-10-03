import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';
import { currentAccessToken } from './api';
import { API_URL } from './config';

/**
 * Sends listing photos to the API, which stores them in R2 and returns the
 * URLs to put on the listing.
 *
 * The app talks to the API directly rather than through the website's proxy,
 * so there is no serverless body limit in the way here. Photos are still
 * shrunk to the same ceiling the web uploader uses, so a listing's gallery
 * does not depend on which client created it, and a 48MP original does not
 * land in the bucket.
 */

/** Longest edge a listing photo is stored at. Matches the web uploader. */
export const MAX_EDGE = 1600;

const QUALITY = 0.8;

export async function uploadListingPhotos(uris: string[]): Promise<string[]> {
  if (uris.length === 0) return [];

  const token = await currentAccessToken();
  if (!token) throw new Error('Sign in again to add photos.');

  const form = new FormData();
  for (const [i, uri] of uris.entries()) {
    const prepared = await shrink(uri);
    form.append('photos', {
      uri: prepared.uri,
      // The server generates its own object key and ignores this, but
      // multipart needs a filename for the part to be treated as a file.
      name: `photo-${i + 1}.jpg`,
      type: 'image/jpeg',
    } as unknown as Blob);
  }

  const res = await fetch(`${API_URL}/v1/uploads/images`, {
    method: 'POST',
    // No content-type header: fetch has to set it so the multipart boundary
    // it generated is the one the server is told about.
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    body: form,
  });

  const data = (await res.json().catch(() => null)) as
    | { images?: string[]; message?: string }
    | null;

  if (!res.ok || !data?.images) {
    throw new Error(data?.message ?? 'That upload failed. Please try again.');
  }
  return data.images;
}

/**
 * Downscales to MAX_EDGE and re-encodes as JPEG, which also converts the HEIC
 * an iPhone hands over into something the API will accept. Falls back to the
 * original file if the image cannot be decoded — the API validates the bytes
 * and will say so more usefully than this layer could.
 */
async function shrink(uri: string): Promise<{ uri: string }> {
  try {
    const original = await ImageManipulator.manipulate(uri).renderAsync();
    const longest = Math.max(original.width, original.height);

    if (longest <= MAX_EDGE) {
      return await save(original.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY }));
    }

    const landscape = original.width >= original.height;
    const scaled = await ImageManipulator.manipulate(original)
      .resize(landscape ? { width: MAX_EDGE } : { height: MAX_EDGE })
      .renderAsync();

    return await save(scaled.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY }));
  } catch {
    return { uri };
  }
}

async function save(pending: Promise<ImageResult>): Promise<{ uri: string }> {
  const result = await pending;
  return { uri: result.uri };
}

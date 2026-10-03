import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env, uploadsEnabled } from '../env.ts';
import type { ImageType } from './images.ts';

/**
 * Cloudflare R2, through its S3-compatible API.
 *
 * R2 is the right home for listing photos because egress is free: the images
 * are the heaviest thing the marketplace serves, and serving them from the
 * API's own small machine would be the first thing to fall over.
 *
 * The client is built once, and only when R2 is configured — unconfigured
 * deployments get a null client and the route turns that into an honest 503
 * rather than failing at import time.
 */
const client = uploadsEnabled
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${env.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.r2.accessKeyId,
        secretAccessKey: env.r2.secretAccessKey,
      },
    })
  : null;

export function storageReady(): boolean {
  return client !== null;
}

/** Stores one image and returns the URL it will be served from. */
export async function putImage(
  key: string,
  body: Uint8Array,
  contentType: ImageType,
): Promise<string> {
  if (!client) throw new Error('R2 is not configured');

  await client.send(
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Photos are immutable: a new upload gets a new key, so anything that
      // caches this may keep it indefinitely.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return publicUrl(key);
}

export function publicUrl(key: string): string {
  return `${env.r2.publicBaseUrl}/${key}`;
}

import type { FastifyInstance } from 'fastify';
import { assertNotSuspended, requireAuth, writeAudit } from '../lib/auth.ts';
import { badRequest, serviceUnavailable } from '../lib/errors.ts';
import { clientIp } from '../lib/http.ts';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_UPLOAD,
  imageKeyFor,
  sniffImageType,
} from '../lib/images.ts';
import { putImage, storageReady } from '../lib/storage.ts';

export async function uploadRoutes(app: FastifyInstance) {
  /**
   * Accepts listing photos and returns the URLs to store on the listing.
   *
   * The browser downscales before sending, so what arrives here is already
   * small. The limit below is headroom, not the expected size.
   */
  app.post(
    '/v1/uploads/images',
    // Multipart streams past the server's global JSON body limit, so this
    // route states its own ceiling.
    { bodyLimit: (MAX_IMAGE_BYTES + 64 * 1024) * MAX_IMAGES_PER_UPLOAD },
    async (req, reply) => {
      const auth = requireAuth(req);
      await assertNotSuspended(auth.id);

      if (!storageReady()) {
        throw serviceUnavailable(
          'Photo uploads are not configured on this deployment. Set the R2_* environment variables.',
        );
      }
      if (!req.isMultipart()) {
        throw badRequest('Send the photos as multipart/form-data');
      }

      const urls: string[] = [];

      for await (const part of req.files({ limits: { fileSize: MAX_IMAGE_BYTES } })) {
        if (urls.length >= MAX_IMAGES_PER_UPLOAD) {
          throw badRequest(`Up to ${MAX_IMAGES_PER_UPLOAD} photos at a time`);
        }

        let buf: Buffer;
        try {
          buf = await part.toBuffer();
        } catch {
          // The only way toBuffer rejects here is the file-size limit.
          throw badRequest(
            `Each photo must be under ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB`,
          );
        }

        if (buf.length === 0) throw badRequest('One of the photos was empty');

        // The declared mimetype is ignored in favour of the actual bytes.
        const type = sniffImageType(buf);
        if (!type) {
          throw badRequest('Photos must be JPEG, PNG or WebP');
        }

        try {
          urls.push(await putImage(imageKeyFor(auth.id, type), buf, type));
        } catch (err) {
          // A bad bucket name, a revoked token or R2 being down all surface as
          // SDK errors whose messages mean nothing to a seller and leak our
          // internals. Log the real cause and tell them something true.
          req.log.error({ err }, 'R2 upload failed');
          throw serviceUnavailable('Could not store that photo right now. Please try again.');
        }
      }

      if (urls.length === 0) throw badRequest('Attach at least one photo');

      await writeAudit({
        actorId: auth.id,
        action: 'upload.images',
        targetType: 'upload',
        targetId: String(urls.length),
        ip: clientIp(req),
      });

      reply.code(201);
      return { images: urls };
    },
  );
}

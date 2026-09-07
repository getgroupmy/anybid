import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { env } from './env.ts';
import { prisma } from './db.ts';
import { attachAuth } from './lib/auth.ts';
import { badRequest, HttpError } from './lib/errors.ts';
import { hub } from './realtime/hub.ts';
import { realtimeRoutes } from './realtime/routes.ts';
import { authRoutes } from './routes/auth.ts';
import { listingRoutes } from './routes/listings.ts';
import { orderRoutes } from './routes/orders.ts';
import { miscRoutes } from './routes/misc.ts';
import { advertiserRoutes } from './routes/advertiser.ts';
import { corporateRoutes } from './routes/corporate.ts';
import { adminRoutes } from './routes/admin.ts';
import { startSettlementLoop } from './services/settlement.ts';

export async function buildServer() {
  const app = Fastify({
    logger: env.isProd
      ? { level: 'info' }
      : { level: 'info', transport: undefined },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    // Bidding is the hot path; rate limit per account, falling back to IP.
    keyGenerator: (req) => (req as { auth?: { id: string } }).auth?.id ?? req.ip,
  });

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });

  // A POST with a JSON content-type but no body is a normal thing for clients
  // to send (an action endpoint with no arguments). Treat it as `{}` rather
  // than failing the request.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body || body.trim() === '') return done(null, {});
      try {
        done(null, JSON.parse(body));
      } catch {
        done(badRequest('Request body is not valid JSON'), undefined);
      }
    },
  );

  app.addHook('onRequest', attachAuth);

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(error.toJSON());
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'Some fields need attention',
        details: { issues: error.issues },
      });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        statusCode: 429,
        error: 'RATE_LIMITED',
        message: 'Slow down — too many requests',
      });
    }
    // Prisma "record not found" surfaces as P2025.
    if ((error as { code?: string }).code === 'P2025') {
      return reply.code(404).send({ statusCode: 404, error: 'NOT_FOUND', message: 'Not found' });
    }
    if ((error as { code?: string }).code === 'P2002') {
      return reply
        .code(409)
        .send({ statusCode: 409, error: 'CONFLICT', message: 'That record already exists' });
    }

    req.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      statusCode: 500,
      error: 'INTERNAL',
      message: env.isProd ? 'Something went wrong' : error.message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      statusCode: 404,
      error: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.url}`,
    });
  });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      service: 'anybid-api',
      time: new Date().toISOString(),
      realtime: hub.stats,
    };
  });

  await app.register(realtimeRoutes);
  await app.register(authRoutes);
  await app.register(listingRoutes);
  await app.register(orderRoutes);
  await app.register(miscRoutes);
  await app.register(advertiserRoutes);
  await app.register(corporateRoutes);
  await app.register(adminRoutes);

  return app;
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint() || process.env.ANYBID_START === '1') {
  const app = await buildServer();
  hub.startHeartbeat();
  const settlement = startSettlementLoop(env.settlementTickMs);

  try {
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`AnyBid API on http://${env.host}:${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down`);
    settlement.stop();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

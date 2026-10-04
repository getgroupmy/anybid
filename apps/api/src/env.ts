import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minimal .env loader — no dependency, only fills unset vars. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));
loadDotEnv(resolve(process.cwd(), '../../.env'));

function required(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${key}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  databaseUrl: required(
    'DATABASE_URL',
    'postgresql://anybid:anybid@localhost:5432/anybid?schema=public',
  ),
  port: Number(process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? '0.0.0.0',
  jwtSecret: required(
    'JWT_SECRET',
    isProd ? undefined : 'dev-only-secret-change-me-0123456789abcdef',
  ),
  accessTtlSec: Number(process.env.JWT_ACCESS_TTL ?? 900),
  refreshTtlSec: Number(process.env.JWT_REFRESH_TTL ?? 2_592_000),
  publicApiUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
  currency: process.env.PLATFORM_CURRENCY ?? 'MYR',
  settlementTickMs: Number(process.env.SETTLEMENT_TICK_MS ?? 5000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  /**
   * How many reverse proxies sit in front of the API.
   *
   * This used to be `trustProxy: true`, which means "believe any
   * X-Forwarded-For". Since that header is set by whoever is calling, it made
   * the client IP a request parameter: eight registrations went through a
   * limit of five by naming a different address each time, and the audit log
   * recorded addresses that were never involved. A count makes Fastify read
   * the entry the nearest trusted hop appended and ignore the rest.
   *
   * Production is one hop (Caddy). Development has none.
   */
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? (isProd ? 1 : 0)),
  /**
   * Shared with the website's server-side proxy, so it can state the end
   * user's address.
   *
   * Browser traffic reaches the API as Vercel -> Caddy, so the only address
   * Caddy can vouch for is Vercel's, and every web visitor would otherwise
   * share one rate-limit key. The website sends the real address alongside
   * this secret; without the secret set, the API ignores the claim entirely
   * rather than trusting it.
   */
  proxySharedSecret: process.env.PROXY_SHARED_SECRET ?? '',
  /**
   * How often the demo marketplace is destroyed and rebuilt. 0 = never, and
   * that is the default everywhere.
   *
   * This is not a cache refresh: it TRUNCATEs every table, so every account,
   * listing and order goes. Only set it on a deployment whose contents exist
   * to be thrown away.
   */
  demoResetIntervalMs: Number(process.env.DEMO_RESET_INTERVAL_MS ?? 0),
  /**
   * Cloudflare R2 holds listing photos. Every field is optional: with none of
   * them set the API still runs and the upload endpoint answers 503, so local
   * development and the degraded production path both stay honest rather than
   * crashing on boot.
   */
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    // Where the bucket is served from — a custom domain, or the r2.dev URL.
    // Trailing slashes are stripped so key joining is unambiguous.
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
  },
};

/** True only when every R2 setting needed to store and serve a photo is present. */
export const uploadsEnabled =
  env.r2.accountId !== '' &&
  env.r2.accessKeyId !== '' &&
  env.r2.secretAccessKey !== '' &&
  env.r2.bucket !== '' &&
  env.r2.publicBaseUrl !== '';

if (env.isProd && env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

// A short secret here is worse than none: it reads as protection while being
// guessable, and what it protects is the identity every rate limit keys on.
if (env.proxySharedSecret !== '' && env.proxySharedSecret.length < 32) {
  throw new Error('PROXY_SHARED_SECRET must be at least 32 characters');
}

if (!Number.isInteger(env.trustProxyHops) || env.trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS must be a non-negative whole number');
}

if (!Number.isFinite(env.demoResetIntervalMs) || env.demoResetIntervalMs < 0) {
  throw new Error('DEMO_RESET_INTERVAL_MS must be a non-negative number of milliseconds');
}

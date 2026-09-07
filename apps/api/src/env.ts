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
  // Railway, Render and Heroku inject PORT and route to whatever the process
  // binds. Honouring it first means the container works on those platforms
  // unchanged; API_PORT stays for local runs where several services coexist.
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  host: process.env.API_HOST ?? '0.0.0.0',
  jwtSecret: required(
    'JWT_SECRET',
    isProd ? undefined : 'dev-only-secret-change-me-0123456789abcdef',
  ),
  accessTtlSec: Number(process.env.JWT_ACCESS_TTL ?? 900),
  refreshTtlSec: Number(process.env.JWT_REFRESH_TTL ?? 2_592_000),
  publicApiUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  currency: process.env.PLATFORM_CURRENCY ?? 'MYR',
  settlementTickMs: Number(process.env.SETTLEMENT_TICK_MS ?? 5000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
};

if (env.isProd && env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

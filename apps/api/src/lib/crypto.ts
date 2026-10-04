import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env.ts';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 64;

/** scrypt password hashing — no native build step, no third-party dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const derived = await scryptAsync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A real scrypt record over a secret nobody holds.
 *
 * Verifying a password costs about 45ms; returning early because the account
 * does not exist costs about 2ms. That difference is an oracle: one request
 * tells an attacker whether an email is registered, however identical the
 * response body is. Sign-in spends this instead of returning early, so both
 * outcomes cost the same.
 */
const absentAccountRecord = hashPassword(randomBytes(32).toString('base64url'));

/** Spends the same time a real verification would, and always fails. */
export async function burnPasswordVerification(password: string): Promise<void> {
  await verifyPassword(password, await absentAccountRecord);
}

/* ---------------- JWT (HS256, self-contained) ---------------- */

interface JwtPayload {
  sub: string;
  roles: string[];
  orgId?: string | null;
  orgRole?: string | null;
  typ: 'access';
  iat: number;
  exp: number;
  jti: string;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64url');

function sign(data: string): string {
  return createHmac('sha256', env.jwtSecret).update(data).digest('base64url');
}

export function signAccessToken(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'typ' | 'jti'>,
  ttlSec = env.accessTtlSec,
): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = {
    ...payload,
    typ: 'access',
    iat: now,
    exp: now + ttlSec,
    jti: randomUUID(),
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify(body));
  const signature = sign(`${header}.${claims}`);
  return { token: `${header}.${claims}.${signature}`, expiresAt: body.exp * 1000 };
}

export function verifyAccessToken(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, claims, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${claims}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as JwtPayload;
    if (payload.typ !== 'access') return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Opaque refresh tokens — stored hashed so a database leak cannot mint sessions. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHmac('sha256', env.jwtSecret).update(token).digest('hex');
}

/**
 * A bidder's pseudonym on one listing.
 *
 * Public auction events have to let a watcher recognise their own bid without
 * telling every other watcher whose it is. A user id does the first and ruins
 * the second: /v1/users/:handle resolves an id as readily as a handle, so an
 * id on a public channel names the bidder outright.
 *
 * Keyed, so it cannot be reversed into a user id, and bound to the listing, so
 * the same person gets a different pseudonym on every auction and the values
 * cannot be joined across them to build one person's bidding history. 24 hex
 * characters is 96 bits — far past guessing, and this is compared, never
 * enumerated.
 */
export function listingPseudonym(listingId: string, userId: string): string {
  return createHmac('sha256', env.jwtSecret)
    .update(`bidref:${listingId}:${userId}`)
    .digest('hex')
    .slice(0, 24);
}

export function randomReference(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

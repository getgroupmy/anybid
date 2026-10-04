import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import { env } from '../env.ts';
import { badRequest } from './errors.ts';

/** Parse and validate a request body, turning zod issues into a 400 with field paths. */
export function parseBody<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw badRequest('Some fields need attention', { issues: result.error.issues });
  }
  return result.data;
}

export function parseQuery<T extends ZodTypeAny>(req: FastifyRequest, schema: T): z.infer<T> {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    throw badRequest('Invalid query parameters', { issues: result.error.issues });
  }
  return result.data;
}

export interface PageArgs {
  page: number;
  perPage: number;
  skip: number;
  take: number;
}

/**
 * Turns whatever arrived in `?page=` and `?perPage=` into arguments Prisma will
 * accept.
 *
 * Most callers reach this through `Number(query.page ?? 1)`, and `Number('abc')`
 * is NaN — which the clamping below used to carry straight through, because
 * `Math.max(1, NaN)` is NaN. Prisma then refused `skip: NaN` and the request
 * came back a 500, so `?page=x` read as a server fault rather than a typo in
 * the caller's query. A value that is not a number is treated as absent.
 */
export function pageArgs(page = 1, perPage = 24): PageArgs {
  const p = Math.max(1, Math.floor(Number.isFinite(page) ? page : 1));
  const pp = Math.min(100, Math.max(1, Math.floor(Number.isFinite(perPage) ? perPage : 24)));
  return { page: p, perPage: pp, skip: (p - 1) * pp, take: pp };
}

/**
 * A `?status=` style filter, checked against the values that exist.
 *
 * These used to be cast into Prisma as `query.status as never`, and the cast is
 * what made it possible: an arbitrary string reached a column typed as an enum,
 * Prisma refused it, and a mistyped filter came back a 500 instead of being
 * named as a bad parameter. Absent or empty means no filter, which is how every
 * one of these routes already behaved.
 */
export function enumFilter<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field = 'status',
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`Unknown ${field} — expected one of ${allowed.join(', ')}`, {
      issues: [{ path: [field], received: String(value) }],
    });
  }
  return value as T;
}

export function paginated<T>(items: T[], total: number, args: PageArgs) {
  return {
    items,
    page: args.page,
    perPage: args.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / args.perPage)),
  };
}

/** Headers the website's proxy uses to state the end user's address. */
export const CLIENT_IP_HEADER = 'x-anybid-client-ip';
export const PROXY_SECRET_HEADER = 'x-anybid-proxy-secret';

/** Rejects anything that is not plainly an address, so nothing else is stored. */
const IP_SHAPE = /^[0-9a-f.:]{3,45}$/i;

/**
 * Who made this request.
 *
 * This used to read the first entry of X-Forwarded-For, which is the entry
 * furthest from us and the one any caller can invent: eight registrations went
 * through a limit of five by naming a different address each time, and the
 * audit log recorded addresses that were never involved. Rate limits and the
 * audit trail both key on this, so it has to be something the caller cannot
 * choose.
 *
 * Two sources, in order:
 *
 *   - the website's server-side proxy, which states the end user's address and
 *     proves it is the proxy with a shared secret. Browser traffic arrives as
 *     Vercel -> Caddy, so this is the only way the end user's address survives
 *     the trip; without it every web visitor shares one key.
 *   - otherwise req.ip, which Fastify derives from the X-Forwarded-For entry
 *     appended by the nearest trusted hop, bounded by TRUST_PROXY_HOPS.
 *
 * X-Forwarded-For is never read here directly. Trusting it is Fastify's job,
 * and it only does so as far as the configured hop count allows.
 */
export function clientIp(req: FastifyRequest): string | null {
  const claimed = req.headers[CLIENT_IP_HEADER];
  const secret = req.headers[PROXY_SECRET_HEADER];
  if (typeof claimed === 'string' && typeof secret === 'string' && proxySecretMatches(secret)) {
    const ip = claimed.trim();
    if (IP_SHAPE.test(ip)) return ip;
  }
  return req.ip ?? null;
}

function proxySecretMatches(presented: string): boolean {
  const expected = env.proxySharedSecret;
  // Unset means the claim is ignored, not that everyone passes.
  if (expected === '') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // Compared in constant time, and only once the lengths match, because
  // timingSafeEqual throws on a length mismatch and that throw is itself a
  // signal about the secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

export function noStore(reply: FastifyReply) {
  reply.header('cache-control', 'no-store');
}

/**
 * Query parameters whose value is a credential rather than a parameter.
 *
 * The one that matters today is `token`: the realtime socket accepts the
 * access token in the URL, because a WebSocket cannot carry an Authorization
 * header from a browser, so it arrives where request logging can see it.
 */
const SECRET_PARAM = /^(token|access_token|refresh_token|refresh|secret|password|signature|sig|api_key|apikey)$/i;

/**
 * A URL safe to write to a log.
 *
 * A logged request line is kept, shipped and read by people and services that
 * have no business holding a live bearer token, and it outlives the token's
 * fifteen minutes in every one of those places.
 */
export function redactUrl(url: string): string {
  const split = url.indexOf('?');
  if (split === -1) return url;

  const path = url.slice(0, split);
  const query = url.slice(split + 1);
  if (!query) return url;

  // Parsed by hand rather than with URLSearchParams, which re-encodes
  // everything it round-trips and would rewrite URLs that hold no secret.
  let touched = false;
  const parts = query.split('&').map((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return part;
    const name = part.slice(0, eq);
    if (!SECRET_PARAM.test(decodeURIComponent(name))) return part;
    touched = true;
    return `${name}=[redacted]`;
  });

  return touched ? `${path}?${parts.join('&')}` : url;
}

/** URL-safe slug with a short random suffix so titles can repeat. */
export function slugify(title: string, suffix: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${base || 'listing'}-${suffix}`;
}

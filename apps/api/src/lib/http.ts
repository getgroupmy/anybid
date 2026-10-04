import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
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

export function pageArgs(page = 1, perPage = 24): PageArgs {
  const p = Math.max(1, Math.floor(page));
  const pp = Math.min(100, Math.max(1, Math.floor(perPage)));
  return { page: p, perPage: pp, skip: (p - 1) * pp, take: pp };
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

export function clientIp(req: FastifyRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  return req.ip ?? null;
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

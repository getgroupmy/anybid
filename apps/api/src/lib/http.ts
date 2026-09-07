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

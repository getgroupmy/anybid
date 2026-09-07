import type { FastifyRequest } from 'fastify';
import type { Permission, Role, OrgRole } from '@anybid/shared';
import { can, isAdmin } from '@anybid/shared';
import { prisma } from '../db.ts';
import { verifyAccessToken } from './crypto.ts';
import { forbidden, unauthorized } from './errors.ts';

export interface AuthUser {
  id: string;
  roles: Role[];
  orgId: string | null;
  orgRole: OrgRole | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthUser | null;
  }
}

/** Reads the bearer token; never throws, so public routes can stay public. */
export async function attachAuth(req: FastifyRequest): Promise<void> {
  req.auth = null;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const payload = verifyAccessToken(header.slice(7));
  if (!payload) return;
  req.auth = {
    id: payload.sub,
    roles: payload.roles as Role[],
    orgId: payload.orgId ?? null,
    orgRole: (payload.orgRole ?? null) as OrgRole | null,
  };
}

export function requireAuth(req: FastifyRequest): AuthUser {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requirePermission(req: FastifyRequest, permission: Permission): AuthUser {
  const user = requireAuth(req);
  if (!can(user, permission)) throw forbidden(`Missing permission: ${permission}`);
  return user;
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  const user = requireAuth(req);
  if (!isAdmin(user)) throw forbidden('Admin access required');
  return user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const user = requireAuth(req);
  if (!roles.some((r) => user.roles.includes(r))) {
    throw forbidden(`This area requires the ${roles.join(' or ')} role`);
  }
  return user;
}

/** Suspended accounts can read but never write. */
export async function assertNotSuspended(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { suspended: true, suspendedUntil: true, suspendedReason: true },
  });
  if (!user) throw unauthorized('Account no longer exists');
  if (!user.suspended) return;
  if (user.suspendedUntil && user.suspendedUntil < new Date()) {
    await prisma.user.update({
      where: { id: userId },
      data: { suspended: false, suspendedReason: null, suspendedUntil: null },
    });
    return;
  }
  throw forbidden(
    user.suspendedReason
      ? `Your account is suspended: ${user.suspendedReason}`
      : 'Your account is suspended',
  );
}

export async function writeAudit(input: {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      meta: (input.meta ?? null) as never,
      ip: input.ip ?? null,
    },
  });
}

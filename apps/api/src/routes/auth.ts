import type { FastifyInstance } from 'fastify';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  updateProfileSchema,
  type Role,
} from '@anybid/shared';
import { prisma } from '../db.ts';
import { assertNotSuspended, requireAuth, writeAudit } from '../lib/auth.ts';
import {
  hashPassword,
  hashToken,
  newRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../lib/crypto.ts';
import { conflict, unauthorized } from '../lib/errors.ts';
import { clientIp, parseBody } from '../lib/http.ts';
import { env } from '../env.ts';
import { sessionUser } from '../services/serialize.ts';

const USER_INCLUDE = {
  orgMembership: { include: { org: { select: { name: true } } } },
} as const;

async function issueSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: USER_INCLUDE,
  });

  const access = signAccessToken({
    sub: user.id,
    roles: user.roles,
    orgId: user.orgMembership?.orgId ?? null,
    orgRole: user.orgMembership?.orgRole ?? null,
  });
  const refresh = newRefreshToken();

  await prisma.session.create({
    data: {
      userId: user.id,
      refreshHash: refresh.hash,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + env.refreshTtlSec * 1000),
    },
  });

  const unread = await prisma.notification.count({ where: { userId: user.id, read: false } });

  return {
    user: sessionUser(user, unread),
    tokens: {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresAt: access.expiresAt,
    },
  };
}

/** "ahmad" -> "ahmad", taken -> "ahmad2", ... */
async function uniqueHandle(displayName: string): Promise<string> {
  const base =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 18) || 'bidder';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}${i + 1}`;
    const taken = await prisma.user.findUnique({ where: { handle: candidate } });
    if (!taken) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', async (req, reply) => {
    const body = parseBody(req, registerSchema);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('An account with that email already exists');

    const roles: Role[] = ['USER'];
    for (const r of body.requestRoles) if (!roles.includes(r)) roles.push(r);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName,
        handle: await uniqueHandle(body.displayName),
        phone: body.phone ?? null,
        accountType: body.accountType,
        roles,
      },
      select: { id: true },
    });

    // An advertiser account gets its billing profile straight away.
    if (roles.includes('ADVERTISER')) {
      await prisma.advertiser.create({
        data: {
          userId: user.id,
          companyName: body.organizationName ?? body.displayName,
          contactEmail: body.email,
          approved: true,
        },
      });
    }

    await writeAudit({
      actorId: user.id,
      action: 'user.register',
      targetType: 'user',
      targetId: user.id,
      ip: clientIp(req),
    });

    reply.code(201);
    return issueSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  });

  app.post('/v1/auth/login', async (req) => {
    const body = parseBody(req, loginSchema);
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, passwordHash: true, suspended: true, suspendedReason: true },
    });
    // Same failure for unknown email and wrong password — no account enumeration.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('Email or password is incorrect');
    }
    await assertNotSuspended(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return issueSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  });

  app.post('/v1/auth/refresh', async (req) => {
    const body = parseBody(req, refreshSchema);
    const session = await prisma.session.findUnique({
      where: { refreshHash: hashToken(body.refreshToken) },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized('Your session has expired — please sign in again');
    }
    // Rotate: the presented refresh token is burned as the new one is issued.
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return issueSession(session.userId, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const auth = req.auth;
    if (auth) {
      await prisma.session.updateMany({
        where: { userId: auth.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    reply.code(204);
    return null;
  });

  app.get('/v1/auth/me', async (req) => {
    const auth = requireAuth(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id }, include: USER_INCLUDE });
    if (!user) throw unauthorized();
    const unread = await prisma.notification.count({ where: { userId: user.id, read: false } });
    return { user: sessionUser(user, unread) };
  });

  app.patch('/v1/auth/me', async (req) => {
    const auth = requireAuth(req);
    await assertNotSuspended(auth.id);
    const body = parseBody(req, updateProfileSchema);
    const user = await prisma.user.update({
      where: { id: auth.id },
      data: body,
      include: USER_INCLUDE,
    });
    const unread = await prisma.notification.count({ where: { userId: user.id, read: false } });
    return { user: sessionUser(user, unread) };
  });
}

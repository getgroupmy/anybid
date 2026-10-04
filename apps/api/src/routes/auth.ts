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
  burnPasswordVerification,
  hashPassword,
  hashToken,
  newRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../lib/crypto.ts';
import { conflict, tooManyRequests, unauthorized } from '../lib/errors.ts';
import { refreshOnce } from '../lib/refresh-grace.ts';
import {
  accountRetryAfterSec,
  clearAccountFailures,
  recordAccountFailure,
} from '../lib/throttle.ts';
import { clientIp, parseBody } from '../lib/http.ts';
import { env } from '../env.ts';
import { sessionUser } from '../services/serialize.ts';

/**
 * Credential endpoints get their own ceilings. The global limit is 600 a
 * minute and falls back to the client IP when there is no account yet, which
 * on sign-in is 600 password guesses a minute from one address.
 *
 * These are per IP, and deliberately not tight. Malaysian mobile traffic is
 * heavily carrier-NAT'd, so many genuine users share one apparent address and
 * a low ceiling would lock them out — the end-to-end smoke test alone signs in
 * nine times in a few seconds from one address.
 *
 * Which means this blunts abuse rather than preventing brute force. The real
 * fix is per-account: a failed-attempt counter and a cooling-off period on the
 * User row, so guessing is bounded per victim instead of per source. That is a
 * schema change with its own trade-off — a hard lock hands an attacker a way
 * to deny a user their own account — so it is a decision, not a config line.
 * Worth settling before real money moves through this.
 */
const AUTH_LIMITS = {
  login: { max: 30, timeWindow: '1 minute' },
  // Account creation is cheap for us and valuable to a spammer.
  register: { max: 5, timeWindow: '1 minute' },
  // A refresh token is a 32-byte secret, so this is abuse control rather than
  // guess prevention; a signed-in app refreshes legitimately and often.
  refresh: { max: 60, timeWindow: '1 minute' },
} as const;

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
  app.post('/v1/auth/register', { config: { rateLimit: AUTH_LIMITS.register } }, async (req, reply) => {
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

  app.post('/v1/auth/login', { config: { rateLimit: AUTH_LIMITS.login } }, async (req) => {
    const body = parseBody(req, loginSchema);

    /**
     * Counted against the account as well as the address.
     *
     * The per-IP limit above does not slow down a password list worked through
     * one email at a time from many addresses. This does, and it tells an
     * attacker nothing new: the key is the email they submitted, so an account
     * that exists and one that does not answer identically here too.
     */
    const retryAfter = accountRetryAfterSec(body.email);
    if (retryAfter !== null) {
      throw tooManyRequests(
        'Too many sign-in attempts for this account — please try again shortly',
        retryAfter,
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, passwordHash: true, suspended: true, suspendedReason: true },
    });

    // Unknown email and wrong password must fail identically, in wording and in
    // how long they take. Returning early for an unknown email would skip
    // scrypt and answer in a couple of milliseconds instead of forty-odd,
    // which is a usable oracle on its own.
    if (!user) {
      await burnPasswordVerification(body.password);
      recordAccountFailure(body.email);
      throw unauthorized('Email or password is incorrect');
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      recordAccountFailure(body.email);
      throw unauthorized('Email or password is incorrect');
    }
    clearAccountFailures(body.email);
    await assertNotSuspended(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return issueSession(user.id, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  });

  app.post('/v1/auth/refresh', { config: { rateLimit: AUTH_LIMITS.refresh } }, async (req) => {
    const body = parseBody(req, refreshSchema);
    const refreshHash = hashToken(body.refreshToken);
    const session = await prisma.session.findUnique({
      where: { refreshHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    if (!session || session.expiresAt < new Date()) {
      throw unauthorized('Your session has expired — please sign in again');
    }

    /**
     * Rotate: the presented token is burned as the new one is issued, and
     * exactly one caller may do it.
     *
     * The revoked check used to sit above an unconditional update, so every
     * concurrent request presenting the same token passed it and issued its
     * own session. Measured: twelve simultaneous refreshes produced twelve
     * live sessions, each with its own thirty-day refresh token — one of which
     * the client keeps, the rest invisible to the person they belong to. That
     * is exactly what rotating is supposed to prevent.
     *
     * The callers that lose are usually the same client, though: the website
     * refreshes inside the last thirty seconds of the access token's life and
     * every parallel request on the page presents the same cookie. So one of
     * them does the work and the others wait for its answer, rather than
     * failing at a moment they did not choose. refreshOnce picks that one;
     * the conditional claim below is what still holds if this process is
     * bypassed or a second node appears.
     */
    return refreshOnce(refreshHash, async () => {
      const claimed = await prisma.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw unauthorized('Your session has expired — please sign in again');
      }
      return issueSession(session.userId, {
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });
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

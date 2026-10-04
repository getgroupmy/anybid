/**
 * Sign-in must fail identically for a wrong password and an email that was
 * never registered — in wording, and in how long it takes.
 *
 * The wording is easy to keep. The timing is easy to lose: fold the two
 * branches back into one `if` with a short-circuit and the unknown-email path
 * stops reaching scrypt, answers in about two milliseconds instead of forty,
 * and one request tells an attacker whether an email has an account. That
 * regression leaves no failing assertion behind unless something checks for it.
 *
 * Requires DATABASE_URL to point at a migrated database.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

/**
 * Set before anything reads the environment, so these tests can state a client
 * address the way the website does.
 *
 * That matters here beyond coverage: the per-IP limit on this route would
 * otherwise count every attempt in this file against one address and fire
 * before the per-account counter ever got a chance, leaving these tests
 * measuring the wrong control and failing depending on their order.
 */
const PROXY_SECRET = 'p'.repeat(64);
process.env.PROXY_SHARED_SECRET = PROXY_SECRET;

const { prisma } = await import('../db.ts');
const { hashPassword } = await import('../lib/crypto.ts');
const { MAX_ACCOUNT_FAILURES, resetAccountFailuresForTest } = await import('../lib/throttle.ts');
const { buildServer } = await import('../server.ts');
const { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } = await import('../lib/http.ts');
const { resetRefreshGraceForTest } = await import('../lib/refresh-grace.ts');

const RUN = randomBytes(4).toString('hex');
const PASSWORD = 'CorrectHorseBattery1';

let app: Awaited<ReturnType<typeof buildServer>>;
let email: string;
let userId: string;
/** Accounts created by the rate-limit tests, cleaned up in `after`. */
const registered: string[] = [];

/** Samples are kept well under the route's 30-a-minute ceiling. */
const WARMUP = 2;
const SAMPLES = 6;

/** Headers that make this request look like it came from `ip`. */
function from(ip: string): Record<string, string> {
  return { [CLIENT_IP_HEADER]: ip, [PROXY_SECRET_HEADER]: PROXY_SECRET };
}

/** Sign in as `email`, counted against `ip` rather than the shared default. */
function login(as: string, password: string, ip: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: from(ip),
    payload: { email: as, password },
  });
}

/** True when this 429 is the per-account counter rather than the per-IP one. */
function refusedForAccount(res: { statusCode: number; json: () => unknown }): boolean {
  if (res.statusCode !== 429) return false;
  return String((res.json() as { message?: string }).message ?? '').includes('this account');
}

async function timeLogin(as: string): Promise<number> {
  // This test is about timing, not throttling. Failed sign-ins are also
  // counted per account now, and a throttled attempt answers 429 without
  // running scrypt — which would be measuring the wrong thing.
  resetAccountFailuresForTest();
  const started = process.hrtime.bigint();
  const res = await login(as, 'definitely-not-the-password', '198.51.100.1');
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(res.statusCode, 401, `expected a rejected credential, got ${res.statusCode}`);
  return ms;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

before(async () => {
  email = `timing-${RUN}@auth.test.invalid`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      displayName: `Timing ${RUN}`,
      handle: `timing-${RUN}`,
    },
    select: { id: true },
  });
  userId = user.id;
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
  const spawned = await prisma.user.findMany({
    where: { email: { in: registered } },
    select: { id: true },
  });
  const ids = [userId, ...spawned.map((u) => u.id)];
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('sign-in failure', () => {
  it('costs the same whether or not the account exists', async () => {
    const absent = `absent-${RUN}@auth.test.invalid`;

    for (let i = 0; i < WARMUP; i++) {
      await timeLogin(email);
      await timeLogin(absent);
    }

    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      known.push(await timeLogin(email));
      unknown.push(await timeLogin(absent));
    }

    const kMedian = median(known);
    const uMedian = median(unknown);
    const detail = `registered ${kMedian.toFixed(1)}ms vs absent ${uMedian.toFixed(1)}ms`;

    // The decisive one. Skipping the password check for an absent account
    // answers in single-digit milliseconds; running scrypt cannot. A slower
    // machine only pushes both numbers up, so this floor is safe.
    assert.ok(
      uMedian > 10,
      `an absent account answered too quickly to have verified a password — ${detail}`,
    );
    assert.ok(kMedian > 10, `a registered account did not verify a password — ${detail}`);

    // And they should be in the same neighbourhood, not merely both non-trivial.
    assert.ok(
      uMedian > kMedian / 2,
      `the two paths are still distinguishable by timing — ${detail}`,
    );
  });

  it('says the same thing either way', async () => {
    resetAccountFailuresForTest();
    const a = await login(email, 'wrong', '198.51.100.2');
    const b = await login(`nobody-${RUN}@auth.test.invalid`, 'wrong', '198.51.100.2');
    assert.equal(a.statusCode, b.statusCode);
    assert.deepEqual(a.json(), b.json(), 'the response must not reveal which email exists');
  });
});

/**
 * Rate limits key on who is calling, so who is calling cannot be something the
 * caller chooses.
 *
 * Measured before this: eight registrations through a limit of five, by
 * sending a different X-Forwarded-For each time. The audit log recorded those
 * invented addresses as fact.
 */
describe('the address a limit is counted against', () => {
  it('is not whatever the caller puts in X-Forwarded-For', async () => {
    const codes: number[] = [];
    // One more attempt than the register limit allows, each claiming a
    // different address. If the header still decided the key, all would pass.
    for (let i = 0; i < 6; i += 1) {
      const email = `xff-${i}-${RUN}@auth.test.invalid`;
      registered.push(email);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
        payload: {
          email,
          password: 'CorrectHorseBattery1',
          displayName: `XFF ${i}`,
          handle: `xff${i}${RUN}`,
          requestRoles: [],
        },
      });
      codes.push(res.statusCode);
    }

    assert.ok(
      codes.includes(429),
      `six registrations from one caller all succeeded by naming a different address: ${codes.join(', ')}`,
    );
  });
});

describe('sign-in attempts against one account', () => {
  it('are refused after a run of failures, with a wait', async () => {
    resetAccountFailuresForTest();
    const codes: number[] = [];
    let refused = false;
    for (let i = 0; i <= MAX_ACCOUNT_FAILURES; i += 1) {
      const res = await login(email, `guess-${i}`, '203.0.113.21');
      codes.push(res.statusCode);
      if (refusedForAccount(res)) {
        refused = true;
        assert.ok(
          Number(res.headers['retry-after']) > 0,
          'a 429 must say how long to wait, so a client can behave',
        );
        break;
      }
    }
    assert.ok(
      refused,
      `a password list against one account was never slowed: ${codes.join(', ')}`,
    );
  });

  it('does not throttle a different account at the same time', async () => {
    resetAccountFailuresForTest();
    for (let i = 0; i <= MAX_ACCOUNT_FAILURES; i += 1) {
      await login(email, `guess-${i}`, '203.0.113.22');
    }
    // Otherwise this is a way to lock everyone else out, which is exactly the
    // denial of service a lockout would have been. A different address too,
    // so the per-IP limit is not what answers.
    const other = await login(`bystander-${RUN}@auth.test.invalid`, 'whatever', '203.0.113.23');
    assert.ok(
      !refusedForAccount(other),
      'one account under attack must not throttle another',
    );
    assert.equal(other.statusCode, 401, `expected a plain rejection, got ${other.statusCode}`);
  });

  it('throttles an email that has no account just the same', async () => {
    // The counter keys on the submitted email, so it cannot become a way to
    // ask whether an account exists.
    resetAccountFailuresForTest();
    const absent = `ghost-${RUN}@auth.test.invalid`;
    const codes: number[] = [];
    let refused = false;
    for (let i = 0; i <= MAX_ACCOUNT_FAILURES; i += 1) {
      const res = await login(absent, `guess-${i}`, '203.0.113.24');
      codes.push(res.statusCode);
      if (refusedForAccount(res)) {
        refused = true;
        break;
      }
    }
    assert.ok(refused, `an absent account answered differently: ${codes.join(', ')}`);
  });
});

describe('refreshing a session', () => {
  it('mints one session from one refresh token, however many ask at once', async () => {
    resetRefreshGraceForTest();
    const email2 = `rotate-${RUN}@auth.test.invalid`;
    registered.push(email2);
    const signUp = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: from('203.0.113.31'),
      payload: {
        email: email2,
        password: PASSWORD,
        displayName: `Rotate ${RUN}`,
        handle: `rotate${RUN}`,
        requestRoles: [],
      },
    });
    assert.equal(signUp.statusCode, 201, signUp.body);
    const { user, tokens } = signUp.json() as {
      user: { id: string };
      tokens: { refreshToken: string };
    };

    const FANOUT = 12;
    const responses = await Promise.all(
      Array.from({ length: FANOUT }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          headers: from('203.0.113.31'),
          payload: { refreshToken: tokens.refreshToken },
        }),
      ),
    );

    const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    // The one that matters. Each extra session carries its own thirty-day
    // refresh token, and the client keeps only one of them — the rest live on
    // invisibly. Measured at twelve before the claim became conditional.
    assert.equal(
      live,
      1,
      `one refresh token minted ${live} live sessions from ${FANOUT} simultaneous calls`,
    );

    // And the siblings must not be punished for the application's timing:
    // the website refreshes inside the last 30s of the access token's life,
    // so every parallel request on a page presents the same cookie.
    const codes = responses.map((r) => r.statusCode);
    assert.ok(
      codes.every((c) => c === 200),
      `a visitor saw requests fail at token-expiry time: ${codes.join(', ')}`,
    );

    const issued = new Set(
      responses.map((r) => (r.json() as { tokens: { refreshToken: string } }).tokens.refreshToken),
    );
    assert.equal(issued.size, 1, 'the siblings must all be told about the same session');
  });

  it('refuses a refresh token replayed later', async () => {
    resetRefreshGraceForTest();
    const email3 = `replay-${RUN}@auth.test.invalid`;
    registered.push(email3);
    const signUp = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: from('203.0.113.32'),
      payload: {
        email: email3,
        password: PASSWORD,
        displayName: `Replay ${RUN}`,
        handle: `replay${RUN}`,
        requestRoles: [],
      },
    });
    assert.equal(signUp.statusCode, 201, signUp.body);
    const { tokens } = signUp.json() as { tokens: { refreshToken: string } };

    const once = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: from('203.0.113.32'),
      payload: { refreshToken: tokens.refreshToken },
    });
    assert.equal(once.statusCode, 200);

    // Past the grace window a spent token is simply spent — the tolerance for
    // concurrent siblings must not become a tolerance for replay.
    resetRefreshGraceForTest();
    const again = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: from('203.0.113.32'),
      payload: { refreshToken: tokens.refreshToken },
    });
    assert.equal(again.statusCode, 401, 'a spent refresh token must not work again');
  });
});

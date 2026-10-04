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
import { prisma } from '../db.ts';
import { hashPassword } from '../lib/crypto.ts';
import { buildServer } from '../server.ts';

const RUN = randomBytes(4).toString('hex');
const PASSWORD = 'CorrectHorseBattery1';

let app: Awaited<ReturnType<typeof buildServer>>;
let email: string;
let userId: string;

/** Samples are kept well under the route's 30-a-minute ceiling. */
const WARMUP = 2;
const SAMPLES = 6;

async function timeLogin(as: string): Promise<number> {
  const started = process.hrtime.bigint();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: as, password: 'definitely-not-the-password' },
  });
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
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { actorId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
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
    const a = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'wrong' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: `nobody-${RUN}@auth.test.invalid`, password: 'wrong' },
    });
    assert.equal(a.statusCode, b.statusCode);
    assert.deepEqual(a.json(), b.json(), 'the response must not reveal which email exists');
  });
});

/**
 * Resolving a dispute moves money, so it has to happen once and within the
 * order it concerns.
 *
 * Requires DATABASE_URL to point at a migrated database.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../db.ts';
import { hashPassword, signAccessToken } from '../lib/crypto.ts';
import { buildServer } from '../server.ts';

const RUN = randomBytes(4).toString('hex');
const TOTAL = 500_00;
const PAYOUT = 400_00;

let app: Awaited<ReturnType<typeof buildServer>>;
let categoryId: string;
let adminToken: string;
const made = { users: [] as string[], listings: [] as string[] };

async function makeUser(tag: string, roles: ('USER' | 'ADMIN')[] = ['USER']): Promise<string> {
  const name = `${tag}-${RUN}`;
  const { id } = await prisma.user.create({
    data: {
      email: `${name}@admin.test.invalid`,
      passwordHash: await hashPassword('irrelevant'),
      displayName: name,
      handle: name,
      roles,
    },
    select: { id: true },
  });
  made.users.push(id);
  return id;
}

/** A disputed order, which is where resolution starts from. */
async function makeDisputedOrder(tag: string) {
  const sellerId = await makeUser(`${tag}-seller`);
  const buyerId = await makeUser(`${tag}-buyer`);
  const listing = await prisma.listing.create({
    data: {
      slug: `${tag}-${RUN}`,
      title: `Dispute probe ${tag}`,
      description: 'Fixture.',
      status: 'SOLD',
      sellerId,
      categoryId,
      startPrice: 400_00,
      currentPrice: 400_00,
    },
    select: { id: true },
  });
  made.listings.push(listing.id);

  const order = await prisma.order.create({
    data: {
      reference: `DSP-${tag}-${RUN}`.toUpperCase().slice(0, 24),
      listingId: listing.id,
      buyerId,
      sellerId,
      hammerPrice: 400_00,
      buyerPremium: 0,
      shippingCost: 100_00,
      total: TOTAL,
      sellerPayout: PAYOUT,
      platformFee: 24_00,
      paymentFee: 12_00,
      status: 'DISPUTED',
      paidAt: new Date(),
      dueAt: new Date(Date.now() + 86_400_000),
    },
    select: { id: true },
  });
  const dispute = await prisma.dispute.create({
    data: {
      orderId: order.id,
      openedById: buyerId,
      reason: 'NOT_AS_DESCRIBED',
      detail: 'Fixture dispute.',
    },
    select: { id: true },
  });
  return { disputeId: dispute.id, orderId: order.id, buyerId, sellerId };
}

function resolve(disputeId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/v1/admin/disputes/${disputeId}/resolve`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload,
  });
}

async function balanceOf(userId: string): Promise<number> {
  const { balance } = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { balance: true },
  });
  return balance;
}

before(async () => {
  const cat = await prisma.category.create({
    data: { name: `Admin ${RUN}`, slug: `admin-${RUN}` },
    select: { id: true },
  });
  categoryId = cat.id;
  const adminId = await makeUser('dsp-admin', ['USER', 'ADMIN']);
  adminToken = signAccessToken({
    sub: adminId,
    roles: ['USER', 'ADMIN'],
    orgId: null,
    orgRole: null,
  }).token;
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
  const orders = await prisma.order.findMany({
    where: { listingId: { in: made.listings } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  await prisma.dispute.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoiceLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: made.users } } });
  await prisma.listing.deleteMany({ where: { id: { in: made.listings } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
});

describe('resolving a dispute', () => {
  it('cannot be reopened after it was rejected', async () => {
    const { disputeId, buyerId } = await makeDisputedOrder('rejected');

    const rejected = await resolve(disputeId, { resolution: 'REJECTED', note: 'No case.' });
    assert.equal(rejected.statusCode, 204, 'the rejection itself must work');

    // The guard only refused a dispute already RESOLVED, and a rejection sets
    // REJECTED — so the same dispute could be resolved a second time, this
    // time paying the buyer the whole order. No race needed: an admin
    // retrying the request, or changing their mind, was enough.
    const again = await resolve(disputeId, { resolution: 'REFUND_BUYER', note: 'Changed mind.' });
    assert.equal(again.statusCode, 409, 'a decided dispute must not be decided again');
    assert.equal(
      await balanceOf(buyerId),
      0,
      'the buyer must not be refunded by re-deciding a rejected dispute',
    );
  });

  it('refunds once when resolved twice at the same time', async () => {
    const { disputeId, buyerId } = await makeDisputedOrder('race');

    const [a, b] = await Promise.all([
      resolve(disputeId, { resolution: 'REFUND_BUYER', note: 'Refund.' }),
      resolve(disputeId, { resolution: 'REFUND_BUYER', note: 'Refund.' }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();

    assert.equal(
      await balanceOf(buyerId),
      TOTAL,
      `the buyer was refunded more than once (responses ${codes.join(', ')})`,
    );
    assert.deepEqual(codes, [204, 409], 'the second resolution must be refused');
  });

  it('will not refund more than the order was worth', async () => {
    const { disputeId, buyerId } = await makeDisputedOrder('over');

    // moneySchema allows up to RM1,000,000,000 and knows nothing about this
    // order, so a "partial" refund could exceed what the buyer ever paid.
    const over = await resolve(disputeId, {
      resolution: 'PARTIAL_REFUND',
      amount: TOTAL * 10,
      note: 'Oops.',
    });
    assert.equal(over.statusCode, 400, 'a refund above the order total must be refused');
    assert.equal(await balanceOf(buyerId), 0, 'nothing may be credited');

    // A refund inside the total is fine.
    const ok = await resolve(disputeId, {
      resolution: 'PARTIAL_REFUND',
      amount: 100_00,
      note: 'Partial.',
    });
    assert.equal(ok.statusCode, 204);
    assert.equal(await balanceOf(buyerId), 100_00);
  });
});

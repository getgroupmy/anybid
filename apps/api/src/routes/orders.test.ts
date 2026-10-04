/**
 * Money leaving the platform has to happen once.
 *
 * Each route here reads the order, checks its status in application memory,
 * then writes. Between the read and the write the status can change, and the
 * write does not re-check it — so two requests that arrive together both pass
 * a guard that should have stopped the second. A double-clicked button is
 * enough; so is one retried request after a timeout.
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
const PAYOUT = 100_00;
const TOTAL = 120_00;

let app: Awaited<ReturnType<typeof buildServer>>;
let categoryId: string;
const made = { users: [] as string[], listings: [] as string[], orgs: [] as string[] };

async function makeUser(tag: string): Promise<string> {
  const name = `${tag}-${RUN}`;
  const { id } = await prisma.user.create({
    data: {
      email: `${name}@orders.test.invalid`,
      passwordHash: await hashPassword('irrelevant'),
      displayName: name,
      handle: name,
    },
    select: { id: true },
  });
  made.users.push(id);
  return id;
}

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, roles: ['USER'], orgId: null, orgRole: null }).token;
}

/** An order sitting where the given route expects to find it. */
async function makeOrder(status: 'AWAITING_PAYMENT' | 'SHIPPED', tag: string) {
  const sellerId = await makeUser(`${tag}-seller`);
  const buyerId = await makeUser(`${tag}-buyer`);
  const listing = await prisma.listing.create({
    data: {
      slug: `${tag}-${RUN}`,
      title: `Order probe ${tag}`,
      description: 'Fixture.',
      status: 'SOLD',
      sellerId,
      categoryId,
      startPrice: 100_00,
      currentPrice: 100_00,
    },
    select: { id: true },
  });
  made.listings.push(listing.id);

  const order = await prisma.order.create({
    data: {
      reference: `TEST-${tag}-${RUN}`.toUpperCase().slice(0, 24),
      listingId: listing.id,
      buyerId,
      sellerId,
      hammerPrice: 100_00,
      buyerPremium: 0,
      shippingCost: 20_00,
      total: TOTAL,
      sellerPayout: PAYOUT,
      platformFee: 6_00,
      paymentFee: 3_64,
      status,
      ...(status === 'SHIPPED' ? { paidAt: new Date(), shippedAt: new Date() } : {}),
      dueAt: new Date(Date.now() + 86_400_000),
    },
    select: { id: true },
  });
  return { orderId: order.id, buyerId, sellerId };
}

before(async () => {
  const cat = await prisma.category.create({
    data: { name: `Orders ${RUN}`, slug: `orders-${RUN}` },
    select: { id: true },
  });
  categoryId = cat.id;
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
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoiceLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.listing.deleteMany({ where: { id: { in: made.listings } } });
  await prisma.orgMember.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.organization.deleteMany({ where: { id: { in: made.orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
});

describe('confirming delivery', () => {
  it('releases the payout once when confirmed twice at the same time', async () => {
    const { orderId, buyerId, sellerId } = await makeOrder('SHIPPED', 'confirm');
    const token = tokenFor(buyerId);

    const confirm = () =>
      app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/confirm`,
        headers: { authorization: `Bearer ${token}` },
      });

    const [a, b] = await Promise.all([confirm(), confirm()]);
    const codes = [a.statusCode, b.statusCode].sort();

    const seller = await prisma.user.findUniqueOrThrow({
      where: { id: sellerId },
      select: { balance: true },
    });

    // This is the one that matters. The guard runs before the transaction and
    // the write does not re-check the status, so both requests can get through
    // and the seller's balance is credited twice for one delivery.
    assert.equal(
      seller.balance,
      PAYOUT,
      `the payout was released ${seller.balance / PAYOUT} times (responses ${codes.join(', ')})`,
    );
    assert.deepEqual(codes, [200, 409], 'the second confirmation must be refused, not absorbed');
  });

  it('refuses a confirmation on an order that is already complete', async () => {
    const { orderId, buyerId } = await makeOrder('SHIPPED', 'confirm-again');
    const token = tokenFor(buyerId);
    const once = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(once.statusCode, 200);
    const twice = await app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(twice.statusCode, 409, 'a completed order cannot be confirmed again');
  });
});

describe('paying for an order', () => {
  it('records one payment when paid twice at the same time', async () => {
    const { orderId, buyerId } = await makeOrder('AWAITING_PAYMENT', 'pay');
    const token = tokenFor(buyerId);

    const pay = () =>
      app.inject({
        method: 'POST',
        url: `/v1/orders/${orderId}/pay`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          method: 'CARD',
          shippingName: 'Test Buyer',
          shippingPhone: '+60123456789',
          addressLine1: '1 Test Street',
          city: 'Kuala Lumpur',
          state: 'Kuala Lumpur',
          postcode: '50000',
          country: 'MY',
        },
      });

    const [a, b] = await Promise.all([pay(), pay()]);
    const codes = [a.statusCode, b.statusCode].sort();

    const payments = await prisma.payment.count({ where: { orderId } });
    assert.equal(
      payments,
      1,
      `${payments} successful payments were recorded for one order (responses ${codes.join(', ')})`,
    );
    assert.deepEqual(codes, [200, 409], 'the second payment must be refused');
  });
});

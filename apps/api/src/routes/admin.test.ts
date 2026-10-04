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
import { settleListing } from '../services/settlement.ts';

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

/**
 * The verification path, which is how the marketplace decides who to trust.
 *
 * Approving a KYC submission sets `verified` on a user, and that badge is what
 * a buyer reads before sending money to a stranger. Every other admin
 * decision in this file leaves a row in the audit log — roles, suspension,
 * listing moderation, campaign decisions, dispute resolution, settings — so
 * that "who approved this seller?" has an answer after something goes wrong.
 */
describe('identity verification', () => {
  function tokenFor(userId: string): string {
    return signAccessToken({ sub: userId, roles: ['USER'], orgId: null, orgRole: null }).token;
  }

  const submission = {
    docType: 'NRIC' as const,
    docNumber: '900101015432',
    docFrontUrl: 'https://example.invalid/front.jpg',
  };

  it('takes one submission from one person, not one per request', async () => {
    const userId = await makeUser('kyc-dup');
    const token = tokenFor(userId);

    const codes = (
      await Promise.all(
        Array.from({ length: 6 }, () =>
          app.inject({
            method: 'POST',
            url: '/v1/me/kyc',
            headers: { authorization: `Bearer ${token}` },
            payload: submission,
          }),
        ),
      )
    ).map((r) => r.statusCode);

    const pending = await prisma.kycSubmission.count({
      where: { userId, status: 'PENDING' },
    });
    // The guard reads for a pending submission and the create does not
    // re-check, so requests arriving together all pass it. Each extra row is
    // another identity document stored, and another thing in the reviewer's
    // queue for the same person.
    assert.equal(
      pending,
      1,
      `one person has ${pending} verifications in review (responses ${codes.join(', ')})`,
    );
    assert.deepEqual(
      codes.filter((c) => c === 201).length,
      1,
      'exactly one request should have been accepted',
    );
  });

  it('records who decided a verification', async () => {
    const userId = await makeUser('kyc-audit');
    const created = await app.inject({
      method: 'POST',
      url: '/v1/me/kyc',
      headers: { authorization: `Bearer ${tokenFor(userId)}` },
      payload: submission,
    });
    assert.equal(created.statusCode, 201, created.body);
    const { submission: row } = created.json() as { submission: { id: string } };

    const decided = await app.inject({
      method: 'POST',
      url: `/v1/admin/kyc/${row.id}/decide`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { decision: 'APPROVE', note: 'Looks right.' },
    });
    assert.equal(decided.statusCode, 204, decided.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { verified: true, kycStatus: true },
    });
    assert.equal(user.verified, true, 'the approval should have taken effect');

    const trail = await prisma.auditLog.findMany({
      where: { targetType: 'kyc', targetId: row.id },
      select: { action: true, actorId: true },
    });
    assert.equal(
      trail.length,
      1,
      'approving a seller is the decision most likely to be questioned later, ' +
        'and it was the one admin decision leaving no trace',
    );
    assert.match(trail[0]!.action, /^kyc\./);
  });
});

/**
 * Moderating a listing that is no longer open for moderation.
 *
 * APPROVE decides the new status from the start time alone, with no regard for
 * what the listing currently is. A closed auction still has its price, its
 * leader and an end time in the past, and settlement looks for exactly one
 * thing: a LIVE listing whose end time has passed. So putting a sold listing
 * back to LIVE hands it to the settlement worker a second time.
 */
describe('moderating a listing that has already closed', () => {
  async function soldListingWithOrder(tag: string) {
    const sellerId = await makeUser(`${tag}-seller`);
    const buyerId = await makeUser(`${tag}-buyer`);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const listing = await prisma.listing.create({
      data: {
        slug: `${tag}-${RUN}`,
        title: `Moderation probe ${tag}`,
        description: 'Fixture for the closed-listing moderation suite.',
        status: 'SOLD',
        sellerId,
        categoryId,
        startPrice: 100_00,
        currentPrice: 400_00,
        leaderId: buyerId,
        leaderMax: 400_00,
        bidCount: 1,
        endsAt: past,
        originalEndsAt: past,
        closedAt: new Date(),
      },
      select: { id: true },
    });
    made.listings.push(listing.id);

    const order = await prisma.order.create({
      data: {
        reference: `MOD-${tag}-${RUN}`.toUpperCase().slice(0, 24),
        listingId: listing.id,
        buyerId,
        sellerId,
        hammerPrice: 400_00,
        buyerPremium: 0,
        shippingCost: 0,
        total: 400_00,
        sellerPayout: 376_00,
        platformFee: 24_00,
        paymentFee: 0,
        status: 'AWAITING_PAYMENT',
        dueAt: new Date(Date.now() + 86_400_000),
      },
      select: { id: true },
    });
    return { listingId: listing.id, orderId: order.id, buyerId, sellerId };
  }

  it('does not put a sold auction back on the block', async () => {
    const { listingId } = await soldListingWithOrder('approve');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/listings/${listingId}/moderate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: 'APPROVE', reason: 'Mis-clicked in the queue.' },
    });

    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { status: true },
    });
    assert.equal(
      listing.status,
      'SOLD',
      `a sold auction was moved to ${listing.status} (response ${res.statusCode})`,
    );
  });

  it('does not let one auction be settled and charged twice', async () => {
    const { listingId, buyerId } = await soldListingWithOrder('resettle');

    await app.inject({
      method: 'POST',
      url: `/v1/admin/listings/${listingId}/moderate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: 'APPROVE' },
    });

    // Whatever the route did, the worker must not find a second sale here.
    // This is the consequence that costs someone money: a duplicate order for
    // one auction means the winner owes twice and the seller is paid twice.
    await settleListing(listingId);

    const orders = await prisma.order.findMany({
      where: { listingId },
      select: { id: true, total: true, buyerId: true },
    });
    assert.equal(
      orders.length,
      1,
      `one auction produced ${orders.length} orders, charging the winner ` +
        `${orders.reduce((sum, o) => sum + o.total, 0)} sen in total`,
    );
    assert.equal(orders[0]!.buyerId, buyerId);
  });

  it('still lets an admin suspend or feature a closed listing', async () => {
    // Taking a sold listing down, or off the front page, stays sensible — the
    // fix must not make a closed listing untouchable.
    const { listingId } = await soldListingWithOrder('suspend');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/listings/${listingId}/moderate`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { action: 'UNFEATURE' },
    });
    assert.equal(res.statusCode, 204, res.body);
  });
});

describe('moderating a listing that closes mid-review', () => {
  it('refuses the decision rather than writing over what happened', async () => {
    const sellerId = await makeUser('midreview-seller');
    const buyerId = await makeUser('midreview-buyer');
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const listing = await prisma.listing.create({
      data: {
        slug: `midreview-${RUN}`,
        title: `Mid-review probe ${RUN}`,
        description: 'Fixture for the stale-moderation check.',
        status: 'LIVE',
        sellerId,
        categoryId,
        startPrice: 100_00,
        currentPrice: 400_00,
        leaderId: buyerId,
        leaderMax: 400_00,
        bidCount: 1,
        endsAt: past,
        originalEndsAt: past,
      },
      select: { id: true },
    });
    made.listings.push(listing.id);

    // The admin's read says LIVE. Between that and the write, the auction
    // closes — which is the same reopening as before, by a narrower route.
    // Holding the row makes the ordering certain instead of lucky.
    let pending: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listing.id} FOR UPDATE`;
      pending = app.inject({
        method: 'POST',
        url: `/v1/admin/listings/${listing.id}/moderate`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { action: 'APPROVE' },
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await tx.listing.update({
        where: { id: listing.id },
        data: { status: 'SOLD', closedAt: new Date() },
      });
    });

    const res = await (pending as Promise<Awaited<ReturnType<typeof app.inject>>>);
    const after = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
      select: { status: true },
    });
    assert.equal(
      after.status,
      'SOLD',
      `the auction closed and the stale approval put it back to ${after.status} (response ${res.statusCode})`,
    );
    assert.equal(res.statusCode, 409);
  });
});

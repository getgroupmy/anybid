/**
 * What a seller may still change after people have committed money to it.
 *
 * A bid cannot be retracted anywhere in this system — there is no route for
 * it. So every term a bidder agreed to when they bid has to be the term they
 * are held to. PATCH /v1/listings/:id froze only the buy-now price, and the
 * shipping cost is added straight onto the winner's order total, so the rest
 * of the terms were the seller's to move after the fact.
 *
 * Requires DATABASE_URL to point at a migrated database.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../db.ts';
import { hashPassword, signAccessToken } from '../lib/crypto.ts';
import { buildServer } from '../server.ts';
import { placeBidForUser } from '../services/bidding.ts';
import { settleListing } from '../services/settlement.ts';

const RUN = randomBytes(4).toString('hex');
const HOUR = 60 * 60 * 1000;
/** Far more than the item is worth, which is the whole point of the attack. */
const GOUGE = 100_000_00;

let app: Awaited<ReturnType<typeof buildServer>>;
let categoryId: string;
const made = { users: [] as string[], listings: [] as string[] };

async function makeUser(tag: string): Promise<string> {
  const name = `${tag}-${RUN}`;
  const { id } = await prisma.user.create({
    data: {
      email: `${name}@listings.test.invalid`,
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

/** A live auction advertised with free shipping, closing in an hour. */
async function makeListing(tag: string, sellerId: string) {
  const endsAt = new Date(Date.now() + HOUR);
  const { id } = await prisma.listing.create({
    data: {
      slug: `${tag}-${RUN}`,
      title: `Terms probe ${tag}`,
      description: 'Fixture for the listing-terms suite.',
      status: 'LIVE',
      sellerId,
      categoryId,
      startPrice: 100_00,
      currentPrice: 100_00,
      shippingCost: 0,
      images: ['https://example.invalid/real-item.jpg'],
      endsAt,
      originalEndsAt: endsAt,
    },
    select: { id: true },
  });
  made.listings.push(id);
  return id;
}

function patch(listingId: string, token: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/listings/${listingId}`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
}

before(async () => {
  const cat = await prisma.category.create({
    data: { name: `Listings ${RUN}`, slug: `listings-${RUN}` },
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
  await prisma.bid.deleteMany({ where: { listingId: { in: made.listings } } });
  await prisma.notification.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.listing.deleteMany({ where: { id: { in: made.listings } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
});

describe('editing a listing that has bids', () => {
  it('bills the winner the shipping they bid under, not a figure added afterwards', async () => {
    const sellerId = await makeUser('ship-seller');
    const buyerId = await makeUser('ship-buyer');
    const listingId = await makeListing('ship', sellerId);

    await placeBidForUser({ listingId, bidderId: buyerId, maxAmount: 150_00 });

    // Free shipping brought the bidder in; now the seller wants RM100,000 for
    // postage. There is no route to retract the bid.
    const raised = await patch(listingId, tokenFor(sellerId), { shippingCost: GOUGE });

    const stored = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { shippingCost: true },
    });
    assert.equal(
      stored.shippingCost,
      0,
      `shipping was changed to ${stored.shippingCost} sen after a bid (response ${raised.statusCode})`,
    );
    assert.equal(raised.statusCode, 409, 'the edit must be refused, not silently dropped');

    // And the money, end to end: settle the auction and read the order.
    const past = new Date(Date.now() - HOUR);
    await prisma.listing.update({
      where: { id: listingId },
      data: { endsAt: past, originalEndsAt: past },
    });
    assert.equal(await settleListing(listingId), true, 'the auction should have settled');

    const order = await prisma.order.findFirstOrThrow({
      where: { listingId },
      select: { shippingCost: true, total: true, hammerPrice: true, buyerPremium: true },
    });
    assert.equal(
      order.shippingCost,
      0,
      `the winner was invoiced ${order.shippingCost} sen of shipping they never agreed to`,
    );
    assert.equal(
      order.total,
      order.hammerPrice + order.buyerPremium,
      'the order total must be the terms the bidder saw',
    );
  });

  it('refuses to swap the item for a different one once someone has bid', async () => {
    const sellerId = await makeUser('swap-seller');
    const buyerId = await makeUser('swap-buyer');
    const listingId = await makeListing('swap', sellerId);

    await placeBidForUser({ listingId, bidderId: buyerId, maxAmount: 150_00 });

    const swapped = await patch(listingId, tokenFor(sellerId), {
      title: 'A completely different item',
      images: ['https://example.invalid/bait.jpg'],
    });

    const stored = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { title: true, images: true },
    });
    assert.match(
      stored.title,
      /^Terms probe swap/,
      `the item was renamed to "${stored.title}" after a bid (response ${swapped.statusCode})`,
    );
    assert.deepEqual(
      stored.images,
      ['https://example.invalid/real-item.jpg'],
      'the photos of the thing being sold were replaced after a bid',
    );
    assert.equal(swapped.statusCode, 409);
  });

  it('still lets the seller add to the description and tags', async () => {
    const sellerId = await makeUser('describe-seller');
    const buyerId = await makeUser('describe-buyer');
    const listingId = await makeListing('describe', sellerId);

    await placeBidForUser({ listingId, bidderId: buyerId, maxAmount: 150_00 });

    const answered = await patch(listingId, tokenFor(sellerId), {
      description: 'Fixture for the listing-terms suite. Answering a question: it is boxed.',
      tags: ['boxed'],
    });
    assert.equal(
      answered.statusCode,
      200,
      'freezing the terms must not stop a seller answering questions',
    );
  });

  it('waits for a bid that is still in flight instead of reading past it', async () => {
    const sellerId = await makeUser('race-seller');
    const listingId = await makeListing('race', sellerId);

    // The ordering that matters, made deterministic. "Edit, then bid" is a
    // legitimate sequence — the seller changed the terms before anyone had
    // committed to them. The one that must not happen is an edit reading
    // bidCount = 0 while a bid is mid-transaction and about to commit, which
    // is what the row lock the bid path holds is for. So hold the row the way
    // that path does, let the edit arrive, and commit the bid under it.
    let pending: Promise<Awaited<ReturnType<typeof patch>>> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
      pending = patch(listingId, tokenFor(sellerId), { shippingCost: GOUGE });
      // Long enough for the edit to reach the database and block on the lock.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await tx.listing.update({
        where: { id: listingId },
        data: { bidCount: 1, currentPrice: 150_00 },
      });
    });

    const raised = await (pending as Promise<Awaited<ReturnType<typeof patch>>>);
    const stored = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { shippingCost: true },
    });
    assert.equal(
      stored.shippingCost,
      0,
      `an edit read past a bid that was still committing and charged ` +
        `${stored.shippingCost} sen of shipping (response ${raised.statusCode})`,
    );
    assert.equal(raised.statusCode, 409);
  });
});

describe('editing a listing that is closed', () => {
  it('refuses to rewrite what was sold', async () => {
    const sellerId = await makeUser('sold-seller');
    const listingId = await makeListing('sold', sellerId);
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: 'SOLD', closedAt: new Date() },
    });

    // A dispute is judged on this record. If the seller can edit it after the
    // sale, the record is whatever the seller last said it was.
    const rewritten = await patch(listingId, tokenFor(sellerId), {
      description: 'It was always described as faulty, which is why it was cheap.',
      images: ['https://example.invalid/after-the-fact.jpg'],
    });

    const stored = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { description: true, images: true },
    });
    assert.deepEqual(
      stored.images,
      ['https://example.invalid/real-item.jpg'],
      `a sold listing's photos were rewritten (response ${rewritten.statusCode})`,
    );
    assert.match(stored.description, /^Fixture for the listing-terms suite\.$/);
    assert.equal(rewritten.statusCode, 409);
  });

  it('refuses to edit a listing an admin has suspended', async () => {
    const sellerId = await makeUser('susp-seller');
    const listingId = await makeListing('susp', sellerId);
    await prisma.listing.update({ where: { id: listingId }, data: { status: 'SUSPENDED' } });

    const edited = await patch(listingId, tokenFor(sellerId), { title: 'Nothing to see here' });
    assert.equal(edited.statusCode, 409, 'a seller must not edit their way out of a suspension');
  });
});

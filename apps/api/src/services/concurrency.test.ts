/**
 * The invariants that only break when two things happen at once.
 *
 * Each of these is load-bearing and silent when it fails: no error is raised,
 * the data is simply wrong afterwards. The auction engine's own tests cannot
 * catch them because the engine is pure — the bugs live in how the services
 * read, lock and write around it. So these run against a real PostgreSQL.
 *
 * Requires DATABASE_URL to point at a migrated database. `npm run db:up &&
 * npm run db:migrate` locally; CI provides one as a service container.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../db.ts';
import { placeApprovedBid, placeBidForUser } from './bidding.ts';
import { settleListing } from './settlement.ts';

const RUN = randomBytes(4).toString('hex');
const HOUR = 60 * 60 * 1000;

const made = {
  users: [] as string[],
  listings: [] as string[],
  orgs: [] as string[],
  categories: [] as string[],
};

async function makeUser(tag: string): Promise<string> {
  const name = `${tag}-${RUN}`;
  const { id } = await prisma.user.create({
    data: {
      email: `${name}@concurrency.test.invalid`,
      passwordHash: 'not-a-real-hash',
      displayName: name,
      handle: name,
    },
    select: { id: true },
  });
  made.users.push(id);
  return id;
}

/** One category for the whole suite — none of these tests care about it. */
let categoryId: string;

async function makeCategory(): Promise<string> {
  const { id } = await prisma.category.create({
    data: { name: `Concurrency ${RUN}`, slug: `concurrency-${RUN}` },
    select: { id: true },
  });
  made.categories.push(id);
  return id;
}

/** A live auction closing in an hour, so anti-snipe never fires. */
async function makeListing(opts: {
  sellerId: string;
  categoryId: string;
  startPrice: number;
  tag: string;
}): Promise<string> {
  const endsAt = new Date(Date.now() + HOUR);
  const { id } = await prisma.listing.create({
    data: {
      slug: `${opts.tag}-${RUN}`,
      title: `Concurrency probe ${opts.tag}`,
      description: 'Fixture for the concurrency suite.',
      status: 'LIVE',
      sellerId: opts.sellerId,
      categoryId: opts.categoryId,
      startPrice: opts.startPrice,
      currentPrice: opts.startPrice,
      endsAt,
      originalEndsAt: endsAt,
    },
    select: { id: true },
  });
  made.listings.push(id);
  return id;
}

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    categoryId = await makeCategory();
  } catch (err) {
    throw new Error(
      'These tests need a migrated PostgreSQL at DATABASE_URL. ' +
        'Run `npm run db:up && npm run db:migrate`.\nCause: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
});

after(async () => {
  const orders = await prisma.order.findMany({
    where: { listingId: { in: made.listings } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoiceLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.bid.deleteMany({ where: { listingId: { in: made.listings } } });
  await prisma.approvalRequest.deleteMany({ where: { listingId: { in: made.listings } } });
  await prisma.notification.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.listing.deleteMany({ where: { id: { in: made.listings } } });
  await prisma.orgMember.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.organization.deleteMany({ where: { id: { in: made.orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.category.deleteMany({ where: { id: { in: made.categories } } });
  await prisma.$disconnect();
});

describe('the bid row lock', () => {
  it('serialises two bids landing at once instead of losing one', async () => {
    const sellerId = await makeUser('lock-seller');
    const quiet = await makeUser('lock-quiet');
    const keen = await makeUser('lock-keen');
    const listingId = await makeListing({
      sellerId,
      categoryId,
      startPrice: 100_00,
      tag: 'lock',
    });

    // Both orderings of these two bids reach the same end state, so the
    // assertions below hold however the database serialises them:
    //   quiet then keen — quiet leads at 100_00, keen outbids to 205_00
    //   keen then quiet — keen leads at 100_00, quiet pushes it to 205_00
    // Either way keen leads at 205_00 with a 300_00 maximum, after two bids.
    const [a, b] = await Promise.allSettled([
      placeBidForUser({ listingId, bidderId: quiet, maxAmount: 200_00 }),
      placeBidForUser({ listingId, bidderId: keen, maxAmount: 300_00 }),
    ]);

    assert.equal(a.status, 'fulfilled', `quiet bidder rejected: ${describeRejection(a)}`);
    assert.equal(b.status, 'fulfilled', `keen bidder rejected: ${describeRejection(b)}`);

    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { currentPrice: true, leaderId: true, leaderMax: true, bidCount: true },
    });

    // The sharp one. Without `SELECT ... FOR UPDATE` both transactions read
    // bidCount 0, both compute 1, and the second write clobbers the first —
    // a lost update that leaves one bid unaccounted for.
    assert.equal(listing.bidCount, 2, 'a bid was lost: both transactions read the same row');
    assert.equal(listing.leaderId, keen, 'the higher maximum must lead');
    assert.equal(listing.leaderMax, 300_00);
    assert.equal(listing.currentPrice, 205_00, 'price must be one increment above the runner-up');

    const bids = await prisma.bid.count({ where: { listingId } });
    assert.equal(bids, 2, 'both bids must be recorded');
  });
});

describe("settlement's conditional claim", () => {
  it('creates one order when two workers close the same auction', async () => {
    const sellerId = await makeUser('claim-seller');
    const buyerId = await makeUser('claim-buyer');
    const listingId = await makeListing({
      sellerId,
      categoryId,
      startPrice: 500_00,
      tag: 'claim',
    });

    await placeBidForUser({ listingId, bidderId: buyerId, maxAmount: 600_00 });

    // Bidding needs a future close; settling needs a past one. Rewind it, the
    // way the seeder does.
    const past = new Date(Date.now() - HOUR);
    await prisma.listing.update({
      where: { id: listingId },
      data: { endsAt: past, originalEndsAt: past },
    });

    const [first, second] = await Promise.all([settleListing(listingId), settleListing(listingId)]);

    // Exactly one worker may win the row.
    assert.equal(
      [first, second].filter(Boolean).length,
      1,
      `both workers claimed the listing (${first}, ${second})`,
    );

    const orders = await prisma.order.count({ where: { listingId } });
    assert.equal(orders, 1, 'the conditional claim must stop a second order being created');

    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { status: true },
    });
    assert.equal(listing.status, 'SOLD');
  });
});

describe('the corporate approval gate', () => {
  it('holds a bid above the threshold without touching the auction', async () => {
    const sellerId = await makeUser('gate-seller');
    const approverId = await makeUser('gate-approver');
    const buyerId = await makeUser('gate-buyer');

    const org = await prisma.organization.create({
      data: {
        name: `Gate Co ${RUN}`,
        slug: `gate-co-${RUN}`,
        registrationNo: `REG-${RUN}`,
        billingEmail: `billing-${RUN}@concurrency.test.invalid`,
        defaultApprovalThreshold: 10_000_00,
      },
      select: { id: true },
    });
    made.orgs.push(org.id);
    await prisma.orgMember.create({
      data: { orgId: org.id, userId: approverId, orgRole: 'APPROVER' },
    });
    await prisma.orgMember.create({
      data: { orgId: org.id, userId: buyerId, orgRole: 'BUYER' },
    });

    const listingId = await makeListing({
      sellerId,
      categoryId,
      startPrice: 1_000_00,
      tag: 'gate',
    });

    const held = await placeBidForUser({ listingId, bidderId: buyerId, maxAmount: 20_000_00 });
    if (held.accepted) assert.fail('a bid over the threshold must not be accepted outright');
    assert.ok(held.approvalId, 'an approval request must be created');

    // The whole point: the auction never saw it.
    const untouched = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { currentPrice: true, leaderId: true, bidCount: true },
    });
    assert.equal(untouched.bidCount, 0, 'a held bid must not reach the auction');
    assert.equal(untouched.leaderId, null);
    assert.equal(untouched.currentPrice, 1_000_00);
    assert.equal(await prisma.bid.count({ where: { listingId } }), 0, 'no Bid row may exist yet');

    // Releasing it places the bid for real.
    const released = await placeApprovedBid(held.approvalId, approverId);
    if (!released.accepted) assert.fail('an approved bid must reach the auction');

    const bidding = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { currentPrice: true, leaderId: true, leaderMax: true, bidCount: true },
    });
    assert.equal(bidding.bidCount, 1);
    assert.equal(bidding.leaderId, buyerId);
    assert.equal(bidding.leaderMax, 20_000_00);
    assert.equal(bidding.currentPrice, 1_000_00, 'a first bid sits at the start price');

    // Approving twice must not place the bid twice.
    await assert.rejects(
      () => placeApprovedBid(held.approvalId, approverId),
      /already been decided/i,
      'a decided approval must not be replayable',
    );
    assert.equal(await prisma.bid.count({ where: { listingId } }), 1);
  });
});

function describeRejection(r: PromiseSettledResult<unknown>): string {
  if (r.status !== 'rejected') return '';
  return r.reason instanceof Error ? r.reason.message : String(r.reason);
}

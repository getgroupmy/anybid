/**
 * What a public auction channel is allowed to say about the people bidding.
 *
 * `listing:<id>` needs no account to join, so every field published on it is
 * world-readable. A bid event has to let a watcher recognise their own bid —
 * the web console's socket is anonymous by design, because the browser never
 * holds an access token — without telling every other watcher whose bid it is.
 *
 * A user id does the first and ruins the second: /v1/users/:handle resolves an
 * id as readily as a handle, with no authorisation, so an id on this channel
 * is one request away from a real name.
 *
 * Requires DATABASE_URL to point at a migrated database.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { listingChannel, type ServerMessage } from '@anybid/shared';
import { prisma } from '../db.ts';
import { listingPseudonym } from '../lib/crypto.ts';
import { hub, type RealtimeClient } from '../realtime/hub.ts';
import { sendListingState } from '../realtime/routes.ts';
import { placeBidForUser } from './bidding.ts';
import { settleListing } from './settlement.ts';
import { listingDetail } from './serialize.ts';

const RUN = randomBytes(4).toString('hex');
const HOUR = 60 * 60 * 1000;

const made = { users: [] as string[], listings: [] as string[], categories: [] as string[] };

/** A socket that only records what the hub sends it. */
function watcher(userId: string | null): { client: RealtimeClient; frames: ServerMessage[] } {
  const frames: ServerMessage[] = [];
  const socket = {
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => frames.push(JSON.parse(raw) as ServerMessage),
    ping: () => undefined,
    terminate: () => undefined,
  };
  const client = hub.add(socket as never, userId);
  return { client, frames };
}

async function makeUser(tag: string): Promise<{ id: string; handle: string }> {
  const name = `${tag}-${RUN}`;
  const u = await prisma.user.create({
    data: {
      email: `${name}@realtime.test.invalid`,
      passwordHash: 'not-a-real-hash',
      displayName: name,
      handle: name,
    },
    select: { id: true, handle: true },
  });
  made.users.push(u.id);
  return u;
}

let categoryId: string;

async function makeListing(tag: string, sellerId: string): Promise<string> {
  const endsAt = new Date(Date.now() + HOUR);
  const { id } = await prisma.listing.create({
    data: {
      slug: `${tag}-${RUN}`,
      title: `Realtime probe ${tag}`,
      description: 'Fixture for the public-channel suite.',
      status: 'LIVE',
      sellerId,
      categoryId,
      startPrice: 100_00,
      currentPrice: 100_00,
      endsAt,
      originalEndsAt: endsAt,
    },
    select: { id: true },
  });
  made.listings.push(id);
  return id;
}

before(async () => {
  const cat = await prisma.category.create({
    data: { name: `Realtime ${RUN}`, slug: `realtime-${RUN}` },
    select: { id: true },
  });
  categoryId = cat.id;
  made.categories.push(cat.id);
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
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.category.deleteMany({ where: { id: { in: made.categories } } });
  await prisma.$disconnect();
});

describe('a public listing channel', () => {
  it('does not tell an anonymous watcher who the leading bidder is', async () => {
    const seller = await makeUser('pub-seller');
    const bidder = await makeUser('pub-bidder');
    const listingId = await makeListing('pub', seller.id);

    // No userId: this is the web console's socket, and anyone at all.
    const { client, frames } = watcher(null);
    hub.subscribe(client, [listingChannel(listingId)]);

    await placeBidForUser({ listingId, bidderId: bidder.id, maxAmount: 150_00 });
    hub.remove(client);

    const bid = frames.find((f) => f.t === 'bid');
    assert.ok(bid, 'the watcher should have received the bid event');

    const serialised = JSON.stringify(bid);
    assert.ok(
      !serialised.includes(bidder.id),
      `the leading bidder's user id was broadcast to an anonymous watcher: ${serialised}`,
    );
    assert.ok(
      !serialised.includes(bidder.handle),
      `the leading bidder's handle was broadcast: ${serialised}`,
    );
  });

  it('does not tell an anonymous watcher who won', async () => {
    const seller = await makeUser('won-seller');
    const bidder = await makeUser('won-bidder');
    const listingId = await makeListing('won', seller.id);

    await placeBidForUser({ listingId, bidderId: bidder.id, maxAmount: 600_00 });

    const { client, frames } = watcher(null);
    hub.subscribe(client, [listingChannel(listingId)]);

    const past = new Date(Date.now() - HOUR);
    await prisma.listing.update({
      where: { id: listingId },
      data: { endsAt: past, originalEndsAt: past },
    });
    assert.equal(await settleListing(listingId), true, 'the auction should have settled');
    hub.remove(client);

    const closed = frames.find((f) => f.t === 'closed');
    assert.ok(closed, 'the watcher should have received the close event');
    const serialised = JSON.stringify(closed);
    assert.ok(
      !serialised.includes(bidder.id),
      `the winner's user id was broadcast to an anonymous watcher: ${serialised}`,
    );
    assert.ok(
      !serialised.includes(bidder.handle),
      `the winner's handle was broadcast: ${serialised}`,
    );
  });

  it('still lets the bidder recognise their own bid', async () => {
    const seller = await makeUser('self-seller');
    const bidder = await makeUser('self-bidder');
    const listingId = await makeListing('self', seller.id);

    const { client, frames } = watcher(null);
    hub.subscribe(client, [listingChannel(listingId)]);
    await placeBidForUser({ listingId, bidderId: bidder.id, maxAmount: 150_00 });
    hub.remove(client);

    const bid = frames.find((f) => f.t === 'bid');
    assert.ok(bid && bid.t === 'bid');

    // What the bidder's own listing payload hands them, which is the only
    // thing the published ref is ever compared against.
    const row = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: { seller: true, category: true },
    });
    const mine = listingDetail(row, { userId: bidder.id });

    assert.equal(
      bid.payload.leaderRef,
      mine.viewer?.myRef,
      'the leader must be recognisable to the person who is leading',
    );
    assert.ok(bid.payload.leaderRef, 'and it must actually be set');
  });

  it('gives the same person a different pseudonym on every listing', async () => {
    const seller = await makeUser('xlist-seller');
    const bidder = await makeUser('xlist-bidder');
    const one = await makeListing('xlist-a', seller.id);
    const two = await makeListing('xlist-b', seller.id);

    // Otherwise the pseudonym is just a user id with extra steps: anyone could
    // join a bidder's activity across every auction on the site.
    assert.notEqual(
      listingPseudonym(one, bidder.id),
      listingPseudonym(two, bidder.id),
      'a pseudonym reused across listings would correlate one person’s bidding',
    );
    assert.equal(
      listingPseudonym(one, bidder.id),
      listingPseudonym(one, bidder.id),
      'but it has to be stable within a listing, or the leader badge flickers',
    );
    assert.ok(
      !listingPseudonym(one, bidder.id).includes(bidder.id),
      'and it must not simply contain the id',
    );
  });
});

describe('subscribing to a listing channel', () => {
  it('says where the auction is, rather than waiting for someone else to bid', async () => {
    // A first page load fetched the listing over HTTP a moment earlier, so the
    // silence did not show. A reconnect has no such fetch: the socket drops when
    // a phone sleeps, a network changes, the heartbeat reaps it or the API
    // restarts, and the client resubscribed and kept showing the price from
    // before it dropped — with the indicator back on "Live".
    const seller = await makeUser('snap-seller');
    const bidder = await makeUser('snap-bidder');
    const listingId = await makeListing('snap', seller.id);
    await placeBidForUser({ listingId, bidderId: bidder.id, maxAmount: 150_00 });

    const stored = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { currentPrice: true, bidCount: true },
    });

    // A client that has just reconnected: subscribed, and told nothing since.
    const { client, frames } = watcher(null);
    const accepted = hub.subscribe(client, [listingChannel(listingId)]);
    await sendListingState(client, accepted);
    hub.remove(client);

    const snapshot = frames.find((f) => f.t === 'bid');
    assert.ok(snapshot, 'subscribing must say what the price is');
    assert.equal(
      snapshot.payload.currentPrice,
      stored.currentPrice,
      'and it must be the price the database holds',
    );
    assert.equal(snapshot.payload.bidCount, stored.bidCount);
    assert.ok(snapshot.payload.minimumBid > stored.currentPrice, 'with a usable minimum');
  });

  it('does not name the leading bidder in it either', async () => {
    // The live path is careful about this; a second path that emits the same
    // event is a second chance to get it wrong.
    const seller = await makeUser('snap-priv-seller');
    const bidder = await makeUser('snap-priv-bidder');
    const listingId = await makeListing('snap-priv', seller.id);
    await placeBidForUser({ listingId, bidderId: bidder.id, maxAmount: 150_00 });

    const { client, frames } = watcher(null);
    await sendListingState(client, hub.subscribe(client, [listingChannel(listingId)]));
    hub.remove(client);

    const serialised = JSON.stringify(frames.find((f) => f.t === 'bid'));
    assert.ok(
      !serialised.includes(bidder.id),
      `the snapshot carried the leading bidder's user id: ${serialised}`,
    );
    assert.ok(
      !serialised.includes(bidder.handle),
      `the snapshot carried the leading bidder's handle: ${serialised}`,
    );
  });

  it('still lets the leading bidder recognise themselves in it', async () => {
    // Same pseudonym as the live path, or a bidder who reconnects stops being
    // able to tell that the bid in the lead is their own.
    const seller = await makeUser('snap-self-seller');
    const bidder = await makeUser('snap-self-bidder');
    const listingId = await makeListing('snap-self', seller.id);
    await placeBidForUser({ listingId, bidderId: bidder.id, maxAmount: 150_00 });

    const { client, frames } = watcher(null);
    await sendListingState(client, hub.subscribe(client, [listingChannel(listingId)]));
    hub.remove(client);

    const snapshot = frames.find((f) => f.t === 'bid');
    assert.equal(
      snapshot?.payload.leaderRef,
      listingPseudonym(listingId, bidder.id),
      'the snapshot must use the same per-listing pseudonym as a live bid',
    );
  });

  it('says nothing about channels that are not listings', async () => {
    const { client, frames } = watcher(null);
    await sendListingState(client, ['user:someone', 'nonsense']);
    hub.remove(client);
    assert.deepEqual(frames, [], `it sent ${JSON.stringify(frames)}`);
  });
});

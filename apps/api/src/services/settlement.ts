import { formatMoney, listingChannel, maskHandle, settleAuction, type AuctionRules, type AuctionState } from '@anybid/shared';
import { prisma } from '../db.ts';
import { hub } from '../realtime/hub.ts';
import { notify } from './notifications.ts';
import { createOrderForSale } from './orders.ts';

/**
 * Closes auctions whose clock has run out.
 *
 * Each listing is claimed with a conditional update (`status: LIVE` in the
 * where-clause), so if two workers run at once only one wins the row and the
 * other closes nothing — no double orders.
 */
export async function settleDueAuctions(now = new Date()): Promise<number> {
  const due = await prisma.listing.findMany({
    where: { status: 'LIVE', endsAt: { lte: now } },
    select: { id: true },
    take: 100,
  });

  let closed = 0;
  for (const { id } of due) {
    try {
      if (await settleListing(id)) closed++;
    } catch (err) {
      console.error(`[settlement] failed to close listing ${id}`, err);
    }
  }
  return closed;
}

export async function settleListing(listingId: string): Promise<boolean> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      slug: true,
      title: true,
      kind: true,
      status: true,
      sellerId: true,
      startPrice: true,
      currentPrice: true,
      reservePrice: true,
      bidIncrement: true,
      leaderId: true,
      leaderMax: true,
      bidCount: true,
      endsAt: true,
      originalEndsAt: true,
      shippingCost: true,
      orgId: true,
    },
  });
  if (!listing || listing.status !== 'LIVE' || !listing.endsAt) return false;
  if (listing.endsAt > new Date()) return false;

  const rules: AuctionRules = {
    kind: listing.kind,
    startPrice: listing.startPrice,
    reservePrice: listing.reservePrice,
    bidIncrement: listing.bidIncrement,
    antiSnipeWindowMs: 0,
    antiSnipeExtensionMs: 0,
    sellerId: listing.sellerId,
  };
  const state: AuctionState = {
    currentPrice: listing.currentPrice,
    leaderId: listing.leaderId,
    leaderMax: listing.leaderMax,
    bidCount: listing.bidCount,
    endsAt: listing.endsAt.getTime(),
    originalEndsAt: (listing.originalEndsAt ?? listing.endsAt).getTime(),
  };

  const outcome = settleAuction(rules, state);
  const nextStatus = outcome.result === 'SOLD' ? 'SOLD' : 'UNSOLD';

  // Claim the listing — only the worker that flips LIVE -> closed proceeds.
  const claimed = await prisma.listing.updateMany({
    where: { id: listing.id, status: 'LIVE' },
    data: { status: nextStatus, closedAt: new Date() },
  });
  if (claimed.count === 0) return false;

  if (outcome.result === 'SOLD') {
    await prisma.bid.updateMany({
      where: { listingId: listing.id, bidderId: outcome.winnerId, status: 'ACTIVE' },
      data: { status: 'WON' },
    });
    await prisma.bid.updateMany({
      where: { listingId: listing.id, bidderId: { not: outcome.winnerId }, status: { in: ['ACTIVE', 'OUTBID'] } },
      data: { status: 'LOST' },
    });

    const buyerOrg = await prisma.orgMember.findUnique({
      where: { userId: outcome.winnerId },
      select: { orgId: true, org: { select: { paymentTerms: true } } },
    });

    await createOrderForSale({
      listingId: listing.id,
      buyerId: outcome.winnerId,
      sellerId: listing.sellerId,
      hammerPrice: outcome.salePrice,
      shippingCost: listing.shippingCost,
      orgId: buyerOrg?.orgId ?? null,
      invoiced: Boolean(buyerOrg && buyerOrg.org.paymentTerms !== 'PREPAID'),
    });

    if (buyerOrg?.orgId) {
      await prisma.orgMember.update({
        where: { userId: outcome.winnerId },
        data: { spentThisMonth: { increment: outcome.salePrice } },
      });
    }

    const winner = await prisma.user.findUnique({
      where: { id: outcome.winnerId },
      select: { handle: true },
    });
    hub.publish(listingChannel(listing.id), {
      t: 'closed',
      channel: listingChannel(listing.id),
      payload: {
        listingId: listing.id,
        status: 'SOLD',
        finalPrice: outcome.salePrice,
        winnerMasked: maskHandle(winner?.handle ?? ''),
        winnerId: outcome.winnerId,
      },
    });
    await notifyLosers(listing.id, listing.title, listing.slug, outcome.winnerId);
  } else {
    await prisma.bid.updateMany({
      where: { listingId: listing.id, status: { in: ['ACTIVE', 'OUTBID'] } },
      data: { status: 'LOST' },
    });
    hub.publish(listingChannel(listing.id), {
      t: 'closed',
      channel: listingChannel(listing.id),
      payload: {
        listingId: listing.id,
        status: 'UNSOLD',
        finalPrice: listing.currentPrice,
        winnerMasked: null,
        winnerId: null,
      },
    });
    await notify({
      userId: listing.sellerId,
      type: 'SYSTEM',
      title: 'Your auction ended without a sale',
      body:
        outcome.result === 'RESERVE_NOT_MET'
          ? `${listing.title} reached ${formatMoney(
              listing.currentPrice,
            )} but did not meet your reserve. You can relist it.`
          : `${listing.title} ended with no bids. You can relist it.`,
      link: `/account/listings`,
    });
    if (outcome.result === 'RESERVE_NOT_MET') {
      await notify({
        userId: outcome.highestBidderId,
        type: 'AUCTION_LOST',
        title: 'Reserve not met',
        body: `You were the highest bidder on ${listing.title} but the reserve was not met.`,
        link: `/listing/${listing.slug}`,
      });
    }
  }

  // Expire any corporate approvals still pending on a closed listing.
  await prisma.approvalRequest.updateMany({
    where: { listingId: listing.id, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });

  return true;
}

async function notifyLosers(
  listingId: string,
  title: string,
  slug: string,
  winnerId: string,
): Promise<void> {
  const losers = await prisma.bid.findMany({
    where: { listingId, bidderId: { not: winnerId } },
    distinct: ['bidderId'],
    select: { bidderId: true },
  });
  await Promise.all(
    losers.map((l) =>
      notify({
        userId: l.bidderId,
        type: 'AUCTION_LOST',
        title: 'Auction ended',
        body: `${title} sold to another bidder. Similar items are still live.`,
        link: `/listing/${slug}`,
      }),
    ),
  );
}

/** Flips SCHEDULED listings to LIVE once their start time passes. */
export async function activateScheduledListings(now = new Date()): Promise<number> {
  const result = await prisma.listing.updateMany({
    where: { status: 'SCHEDULED', startsAt: { lte: now } },
    data: { status: 'LIVE' },
  });
  return result.count;
}

/** Warns watchers and bidders an hour before an auction closes. */
export async function sendEndingSoonAlerts(now = new Date()): Promise<number> {
  const from = new Date(now.getTime() + 55 * 60_000);
  const to = new Date(now.getTime() + 60 * 60_000);
  const listings = await prisma.listing.findMany({
    where: { status: 'LIVE', endsAt: { gte: from, lte: to } },
    select: {
      id: true,
      title: true,
      slug: true,
      currentPrice: true,
      watchers: { select: { userId: true } },
    },
    take: 50,
  });

  let sent = 0;
  for (const listing of listings) {
    for (const w of listing.watchers) {
      await notify({
        userId: w.userId,
        type: 'AUCTION_ENDING',
        title: 'Ending in under an hour',
        body: `${listing.title} is at ${formatMoney(listing.currentPrice)}.`,
        link: `/listing/${listing.slug}`,
      });
      sent++;
    }
  }
  return sent;
}

export interface SettlementLoop {
  stop(): void;
}

/**
 * Starts the in-process scheduler. In production run exactly one of these —
 * either a dedicated worker process or a single API instance.
 *
 * A tick of 0 or less disables the loop, which is how additional API
 * instances opt out so they do not all race to settle the same auctions.
 */
export function startSettlementLoop(tickMs: number): SettlementLoop {
  if (tickMs <= 0) {
    console.log('[settlement] loop disabled (SETTLEMENT_TICK_MS <= 0)');
    return { stop: () => undefined };
  }

  let running = false;
  let lastAlertHour = -1;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await activateScheduledListings();
      await settleDueAuctions();
      const hour = new Date().getMinutes();
      if (hour !== lastAlertHour && hour % 5 === 0) {
        lastAlertHour = hour;
        await sendEndingSoonAlerts();
      }
    } catch (err) {
      console.error('[settlement] tick failed', err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, tickMs);
  timer.unref?.();
  void tick();
  return { stop: () => clearInterval(timer) };
}

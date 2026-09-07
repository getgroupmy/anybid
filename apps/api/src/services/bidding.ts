import {
  formatMoney,
  listingChannel,
  maskHandle,
  minimumAcceptableBid,
  placeBid as resolveBid,
  type AuctionRules,
  type AuctionState,
  type Money,
} from '@anybid/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { hub } from '../realtime/hub.ts';
import { notify } from './notifications.ts';

export interface PlaceBidRequest {
  listingId: string;
  bidderId: string;
  maxAmount: Money;
  expectedPrice?: Money;
  reference?: string;
  ip?: string | null;
}

export interface PlaceBidResult {
  accepted: true;
  isLeading: boolean;
  currentPrice: Money;
  minimumBid: Money;
  endsAt: string;
  extended: boolean;
  reserveMet: boolean;
  bidId: string;
}

export interface PendingApprovalResult {
  accepted: false;
  pendingApproval: true;
  approvalId: string;
  message: string;
}

type Outcome = PlaceBidResult | PendingApprovalResult;

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Places a bid.
 *
 * Correctness rests on one thing: the listing row is locked with
 * `SELECT ... FOR UPDATE` for the whole transaction, so two bids landing in
 * the same millisecond are serialised by the database rather than racing in
 * application memory. Everything the engine decides is computed from the
 * locked row and written back inside the same transaction.
 */
export async function placeBidForUser(
  req: PlaceBidRequest,
  opts: { skipApprovalGate?: boolean } = {},
): Promise<Outcome> {
  if (!opts.skipApprovalGate) {
    const gate = await checkCorporateApproval(req);
    if (gate) return gate;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Serialise concurrent bidders on this listing.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Listing" WHERE id = ${req.listingId} FOR UPDATE
      `;
      if (locked.length === 0) throw notFound('Listing');

      const listing = await tx.listing.findUniqueOrThrow({
        where: { id: req.listingId },
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
          startsAt: true,
          endsAt: true,
          originalEndsAt: true,
          antiSnipeWindowSec: true,
          antiSnipeExtensionSec: true,
          maxExtensionSec: true,
        },
      });

      if (listing.status !== 'LIVE') {
        throw conflict(
          listing.status === 'SCHEDULED'
            ? 'Bidding has not opened on this listing yet'
            : 'This listing is no longer accepting bids',
        );
      }
      if (!listing.endsAt) throw conflict('This listing has no closing time');
      if (listing.sellerId === req.bidderId) throw forbidden('You cannot bid on your own listing');
      if (listing.startsAt > new Date()) throw conflict('Bidding has not opened on this listing yet');

      // Guard against bidding against a price that moved while the form was open.
      if (
        req.expectedPrice !== undefined &&
        req.expectedPrice !== listing.currentPrice &&
        req.maxAmount <= listing.currentPrice
      ) {
        throw conflict(
          `The price moved to ${formatMoney(listing.currentPrice)} while you were bidding`,
        );
      }

      const rules: AuctionRules = {
        kind: listing.kind,
        startPrice: listing.startPrice,
        reservePrice: listing.reservePrice,
        bidIncrement: listing.bidIncrement,
        antiSnipeWindowMs: listing.antiSnipeWindowSec * 1000,
        antiSnipeExtensionMs: listing.antiSnipeExtensionSec * 1000,
        maxExtensionMs: listing.maxExtensionSec ? listing.maxExtensionSec * 1000 : null,
        sellerId: listing.sellerId,
      };
      const before: AuctionState = {
        currentPrice: listing.currentPrice,
        leaderId: listing.leaderId,
        leaderMax: listing.leaderMax,
        bidCount: listing.bidCount,
        endsAt: listing.endsAt.getTime(),
        originalEndsAt: (listing.originalEndsAt ?? listing.endsAt).getTime(),
      };

      const outcome = resolveBid(rules, before, {
        bidderId: req.bidderId,
        maxAmount: req.maxAmount,
        at: Date.now(),
      });

      if (!outcome.ok) {
        throw badRequest(outcome.message, {
          reason: outcome.reason,
          minimumAcceptable: outcome.minimumAcceptable,
        });
      }

      const after = outcome.state;

      // The previous leader loses their ACTIVE marker.
      if (outcome.outbidUserId) {
        await tx.bid.updateMany({
          where: { listingId: listing.id, bidderId: outcome.outbidUserId, status: 'ACTIVE' },
          data: { status: 'OUTBID' },
        });
      }
      // A losing challenger is recorded as already outbid.
      const bidStatus = outcome.isLeading ? 'ACTIVE' : 'OUTBID';
      if (outcome.isLeading) {
        await tx.bid.updateMany({
          where: { listingId: listing.id, bidderId: { not: req.bidderId }, status: 'ACTIVE' },
          data: { status: 'OUTBID' },
        });
      }

      const bid = await tx.bid.create({
        data: {
          listingId: listing.id,
          bidderId: req.bidderId,
          maxAmount: req.maxAmount,
          amount: after.currentPrice,
          status: bidStatus,
          reference: req.reference ?? null,
          ip: req.ip ?? null,
        },
        select: { id: true },
      });

      await tx.listing.update({
        where: { id: listing.id },
        data: {
          currentPrice: after.currentPrice,
          leaderId: after.leaderId,
          leaderMax: after.leaderMax,
          bidCount: after.bidCount,
          reserveMet: outcome.reserveMet,
          endsAt: new Date(after.endsAt),
          originalEndsAt: new Date(after.originalEndsAt),
        },
      });

      return {
        bidId: bid.id,
        listing,
        after,
        rules,
        isLeading: outcome.isLeading,
        outbidUserId: outcome.outbidUserId,
        extended: outcome.extended,
        extendedByMs: outcome.extendedByMs,
        reserveMet: outcome.reserveMet,
      };
    },
    { timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

  const { after, rules, listing } = result;
  const minimumBid = minimumAcceptableBid(rules, after);
  const endsAtIso = new Date(after.endsAt).toISOString();

  const leader = after.leaderId
    ? await prisma.user.findUnique({
        where: { id: after.leaderId },
        select: { handle: true },
      })
    : null;

  hub.publish(listingChannel(listing.id), {
    t: 'bid',
    channel: listingChannel(listing.id),
    payload: {
      listingId: listing.id,
      currentPrice: after.currentPrice,
      minimumBid,
      bidCount: after.bidCount,
      leaderMasked: maskHandle(leader?.handle ?? ''),
      leaderId: after.leaderId ?? '',
      reserveMet: result.reserveMet,
      endsAt: endsAtIso,
      at: Date.now(),
    },
  });

  if (result.extended) {
    hub.publish(listingChannel(listing.id), {
      t: 'extended',
      channel: listingChannel(listing.id),
      payload: {
        listingId: listing.id,
        endsAt: endsAtIso,
        extendedByMs: result.extendedByMs,
        reason: 'ANTI_SNIPE',
      },
    });
  }

  if (result.outbidUserId) {
    await notify({
      userId: result.outbidUserId,
      type: 'OUTBID',
      title: "You've been outbid",
      body: `${listing.title} is now at ${formatMoney(after.currentPrice)}.`,
      link: `/listing/${listing.slug}`,
    });
  }
  if (!result.isLeading) {
    await notify({
      userId: req.bidderId,
      type: 'OUTBID',
      title: 'Your bid was not enough',
      body: `Another bidder has a higher maximum on ${listing.title}. It is now at ${formatMoney(
        after.currentPrice,
      )}.`,
      link: `/listing/${listing.slug}`,
    });
  }

  return {
    accepted: true,
    isLeading: result.isLeading,
    currentPrice: after.currentPrice,
    minimumBid,
    endsAt: endsAtIso,
    extended: result.extended,
    reserveMet: result.reserveMet,
    bidId: result.bidId,
  };
}

/**
 * Corporate spend control: a bid above the member's threshold is parked as an
 * approval request instead of hitting the auction. An approver releasing it
 * calls `placeApprovedBid`.
 */
async function checkCorporateApproval(req: PlaceBidRequest): Promise<PendingApprovalResult | null> {
  const member = await prisma.orgMember.findUnique({
    where: { userId: req.bidderId },
    select: {
      id: true,
      orgId: true,
      orgRole: true,
      active: true,
      approvalThreshold: true,
      org: { select: { defaultApprovalThreshold: true, monthlyBudget: true } },
    },
  });
  if (!member) return null;
  if (!member.active) throw forbidden('Your organisation seat is inactive');
  if (member.orgRole === 'VIEWER') throw forbidden('Viewer seats cannot bid');

  const threshold = member.approvalThreshold ?? member.org.defaultApprovalThreshold;
  if (threshold <= 0 || req.maxAmount <= threshold) return null;

  // Approvers and owners sign off on their own spend.
  if (member.orgRole === 'OWNER' || member.orgRole === 'ADMIN' || member.orgRole === 'APPROVER') {
    return null;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: req.listingId },
    select: { id: true, title: true, slug: true, status: true },
  });
  if (!listing) throw notFound('Listing');
  if (listing.status !== 'LIVE') throw conflict('This listing is no longer accepting bids');

  const existing = await prisma.approvalRequest.findFirst({
    where: {
      orgId: member.orgId,
      listingId: req.listingId,
      requestedById: req.bidderId,
      status: 'PENDING',
    },
    select: { id: true },
  });
  if (existing) {
    return {
      accepted: false,
      pendingApproval: true,
      approvalId: existing.id,
      message: 'You already have an approval pending for this listing.',
    };
  }

  const approval = await prisma.approvalRequest.create({
    data: {
      orgId: member.orgId,
      listingId: req.listingId,
      requestedById: req.bidderId,
      amount: req.maxAmount,
      reference: req.reference ?? null,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
    select: { id: true },
  });

  const approvers = await prisma.orgMember.findMany({
    where: { orgId: member.orgId, active: true, orgRole: { in: ['OWNER', 'ADMIN', 'APPROVER'] } },
    select: { userId: true },
  });
  const requester = await prisma.user.findUnique({
    where: { id: req.bidderId },
    select: { displayName: true },
  });
  await Promise.all(
    approvers.map((a) =>
      notify({
        userId: a.userId,
        type: 'APPROVAL_REQUESTED',
        title: 'Bid approval needed',
        body: `${requester?.displayName ?? 'A team member'} wants to bid ${formatMoney(
          req.maxAmount,
        )} on ${listing.title}.`,
        link: `/corporate/approvals`,
      }),
    ),
  );

  return {
    accepted: false,
    pendingApproval: true,
    approvalId: approval.id,
    message: `Bids above ${formatMoney(
      threshold,
    )} need an approver. Your request has been sent to your organisation's approvers.`,
  };
}

/** Called when an approver releases a held corporate bid. */
export async function placeApprovedBid(approvalId: string, deciderId: string): Promise<Outcome> {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    select: {
      id: true,
      status: true,
      amount: true,
      reference: true,
      listingId: true,
      requestedById: true,
      orgId: true,
      expiresAt: true,
    },
  });
  if (!approval) throw notFound('Approval request');
  if (approval.status !== 'PENDING') throw conflict('This request has already been decided');
  if (approval.expiresAt < new Date()) {
    await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: { status: 'EXPIRED' },
    });
    throw conflict('This request expired before it was approved');
  }

  await prisma.approvalRequest.update({
    where: { id: approvalId },
    data: { status: 'APPROVED', decidedById: deciderId, decidedAt: new Date() },
  });

  // The approval *is* the authorisation, so the threshold gate is skipped.
  const result = await placeBidForUser(
    {
      listingId: approval.listingId,
      bidderId: approval.requestedById,
      maxAmount: approval.amount,
      reference: approval.reference ?? undefined,
    },
    { skipApprovalGate: true },
  );

  await prisma.bid.updateMany({
    where: { listingId: approval.listingId, bidderId: approval.requestedById, status: 'ACTIVE' },
    data: { orgId: approval.orgId },
  });

  await notify({
    userId: approval.requestedById,
    type: 'APPROVAL_DECIDED',
    title: 'Your bid was approved',
    body: `Your bid of ${formatMoney(approval.amount)} has been placed.`,
    link: `/account/bids`,
  });

  return result;
}

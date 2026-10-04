import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  buyNowSchema,
  createListingSchema,
  placeBidSchema,
  searchListingsSchema,
  updateListingSchema,
} from '@anybid/shared';
import { prisma } from '../db.ts';
import { assertNotSuspended, requireAuth, writeAudit } from '../lib/auth.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { clientIp, pageArgs, paginated, parseBody, parseQuery, slugify } from '../lib/http.ts';
import { placeBidForUser } from '../services/bidding.ts';
import { announceSale, createOrderForSale } from '../services/orders.ts';
import { getSettings } from '../services/settings.ts';
import { bidSummary, listingDetail, listingSummary, orderDto, type ViewerContext } from '../services/serialize.ts';

const LISTING_INCLUDE = {
  seller: true,
  category: { select: { id: true, name: true, slug: true } },
} as const;

/**
 * A seller may edit a listing while it is still theirs to withdraw. A closed
 * one is the record of what was sold, and a SUSPENDED one is an admin
 * decision the seller must not edit their way out of.
 */
const EDITABLE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'SCHEDULED', 'LIVE'] as const;

/** Fields a bidder relied on, so they stop being the seller's to change. */
const FROZEN_ONCE_BID = {
  title: 'the title',
  images: 'the photos',
  buyNowPrice: 'the buy-now price',
  shippingCost: 'the shipping cost',
  localPickup: 'the pickup option',
} as const;
type FrozenField = keyof typeof FROZEN_ONCE_BID;

function listFields(fields: FrozenField[]): string {
  const names = fields.map((f) => FROZEN_ONCE_BID[f]);
  const last = names.pop() as string;
  const list = names.length > 0 ? `${names.join(', ')} and ${last}` : last;
  return list.charAt(0).toUpperCase() + list.slice(1);
}

/** Loads the per-viewer flags (watching / leading / needs approval) in one pass. */
async function viewerContext(
  userId: string | null | undefined,
  listingIds: string[],
): Promise<ViewerContext | undefined> {
  if (!userId || listingIds.length === 0) return undefined;

  const [watched, myBids, member] = await Promise.all([
    prisma.watchlist.findMany({
      where: { userId, listingId: { in: listingIds } },
      select: { listingId: true },
    }),
    prisma.bid.findMany({
      where: { bidderId: userId, listingId: { in: listingIds } },
      select: { listingId: true, maxAmount: true },
      orderBy: { maxAmount: 'desc' },
    }),
    prisma.orgMember.findUnique({
      where: { userId },
      select: { approvalThreshold: true, org: { select: { defaultApprovalThreshold: true } } },
    }),
  ]);

  const myMaxByListing = new Map<string, number>();
  for (const b of myBids) {
    if (!myMaxByListing.has(b.listingId)) myMaxByListing.set(b.listingId, b.maxAmount);
  }

  return {
    userId,
    watchedIds: new Set(watched.map((w) => w.listingId)),
    myMaxByListing,
    approvalThreshold: member
      ? (member.approvalThreshold ?? member.org.defaultApprovalThreshold)
      : null,
  };
}

export async function listingRoutes(app: FastifyInstance) {
  /* ---------------- browse & search ---------------- */

  app.get('/v1/listings', async (req) => {
    const q = parseQuery(req, searchListingsSchema);
    const args = pageArgs(q.page, q.perPage);

    const where: Prisma.ListingWhereInput = {};
    if (q.status === 'ALL') where.status = { in: ['LIVE', 'ENDED', 'SOLD', 'UNSOLD'] };
    else where.status = q.status;

    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
        { tags: { has: q.q.toLowerCase() } },
      ];
    }
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.categorySlug) {
      const category = await prisma.category.findUnique({
        where: { slug: q.categorySlug },
        select: { id: true, children: { select: { id: true } } },
      });
      if (category) {
        where.categoryId = { in: [category.id, ...category.children.map((c) => c.id)] };
      }
    }
    if (q.kind) where.kind = q.kind;
    if (q.condition) where.condition = q.condition;
    if (q.sellerId) where.sellerId = q.sellerId;
    if (q.state) where.locationState = { equals: q.state, mode: 'insensitive' };
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      where.currentPrice = {
        ...(q.minPrice !== undefined ? { gte: q.minPrice } : {}),
        ...(q.maxPrice !== undefined ? { lte: q.maxPrice } : {}),
      };
    }
    if (q.endingWithinHours) {
      where.endsAt = { lte: new Date(Date.now() + q.endingWithinHours * 3_600_000) };
    }

    const orderBy = sortOrder(q.sort);

    const [rows, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy,
        skip: args.skip,
        take: args.take,
      }),
      prisma.listing.count({ where }),
    ]);

    const viewer = await viewerContext(req.auth?.id, rows.map((r) => r.id));
    return paginated(rows.map((r) => listingSummary(r, viewer)), total, args);
  });

  app.get<{ Params: { idOrSlug: string } }>('/v1/listings/:idOrSlug', async (req) => {
    const { idOrSlug } = req.params;
    const listing = await prisma.listing.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        ...LISTING_INCLUDE,
        bids: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: { bidder: { select: { handle: true, avatarUrl: true } } },
        },
      },
    });
    if (!listing) throw notFound('Listing');

    // Fire-and-forget view counter — never block the response on it.
    void prisma.listing
      .update({ where: { id: listing.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);

    const viewer = await viewerContext(req.auth?.id, [listing.id]);
    return { listing: listingDetail(listing, viewer) };
  });

  app.get<{ Params: { id: string } }>('/v1/listings/:id/bids', async (req) => {
    const bids = await prisma.bid.findMany({
      where: { listingId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { bidder: { select: { handle: true, avatarUrl: true } } },
    });
    return { bids: bids.map(bidSummary) };
  });

  app.get<{ Params: { id: string } }>('/v1/listings/:id/similar', async (req) => {
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { categoryId: true, id: true, currentPrice: true },
    });
    if (!listing) throw notFound('Listing');
    const items = await prisma.listing.findMany({
      where: { status: 'LIVE', categoryId: listing.categoryId, id: { not: listing.id } },
      include: LISTING_INCLUDE,
      orderBy: { endsAt: 'asc' },
      take: 8,
    });
    return { items: items.map((i) => listingSummary(i)) };
  });

  /* ---------------- selling ---------------- */

  app.post('/v1/listings', async (req, reply) => {
    const auth = requireAuth(req);
    await assertNotSuspended(auth.id);
    const body = parseBody(req, createListingSchema);
    const settings = await getSettings();

    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category) throw badRequest('Pick a valid category');

    const startsAt = body.startsAt ?? new Date();
    const endsAt = new Date(startsAt.getTime() + body.durationHours * 3_600_000);
    const scheduled = startsAt.getTime() > Date.now() + 60_000;
    const status = settings.newListingsRequireReview
      ? 'PENDING_REVIEW'
      : scheduled
        ? 'SCHEDULED'
        : 'LIVE';

    const member = await prisma.orgMember.findUnique({
      where: { userId: auth.id },
      select: { orgId: true },
    });

    const listing = await prisma.listing.create({
      data: {
        slug: slugify(body.title, randomBytes(3).toString('hex')),
        title: body.title,
        description: body.description,
        kind: body.kind,
        status,
        condition: body.condition,
        sellerId: auth.id,
        orgId: member?.orgId ?? null,
        categoryId: body.categoryId,
        images: body.images,
        tags: body.tags.map((t) => t.toLowerCase()),
        quantity: body.quantity,
        startPrice: body.startPrice,
        currentPrice: body.startPrice,
        reservePrice: body.reservePrice ?? null,
        buyNowPrice: body.buyNowPrice ?? null,
        bidIncrement: body.bidIncrement ?? null,
        shippingCost: body.shippingCost,
        localPickup: body.localPickup,
        startsAt,
        endsAt: body.kind === 'BUY_NOW' ? null : endsAt,
        originalEndsAt: body.kind === 'BUY_NOW' ? null : endsAt,
        antiSnipeWindowSec: body.antiSnipeWindowSec,
        antiSnipeExtensionSec: body.antiSnipeExtensionSec,
        locationCity: body.locationCity ?? null,
        locationState: body.locationState ?? null,
      },
      include: LISTING_INCLUDE,
    });

    await writeAudit({
      actorId: auth.id,
      action: 'listing.create',
      targetType: 'listing',
      targetId: listing.id,
      ip: clientIp(req),
    });

    reply.code(201);
    return { listing: listingDetail(listing) };
  });

  app.patch<{ Params: { id: string } }>('/v1/listings/:id', async (req) => {
    const auth = requireAuth(req);
    await assertNotSuspended(auth.id);
    const body = parseBody(req, updateListingSchema);

    const existing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { sellerId: true, bidCount: true, status: true },
    });
    if (!existing) throw notFound('Listing');
    if (existing.sellerId !== auth.id) throw forbidden('This is not your listing');
    if (!(EDITABLE_STATUSES as readonly string[]).includes(existing.status)) {
      throw conflict('A listing that is no longer open cannot be edited');
    }

    const data = {
      ...body,
      ...(body.tags ? { tags: body.tags.map((t) => t.toLowerCase()) } : {}),
    };
    const frozen = (Object.keys(FROZEN_ONCE_BID) as FrozenField[]).filter(
      (f) => body[f] !== undefined,
    );

    /**
     * Once someone has bid, the terms are fixed.
     *
     * A bid cannot be retracted anywhere in this system, so whatever a bidder
     * agreed to is what they are held to. The shipping cost is the sharp one:
     * it is added straight onto the winner's order total, and settlement reads
     * the figure that is on the listing when it closes — so a listing
     * advertised with free shipping could be edited to charge RM100,000 for
     * postage after the bids were in. The title and the photos are the
     * identity of the goods, and the record a dispute is later judged on.
     *
     * This reads bidCount under the same row lock the bid path holds, rather
     * than before it. Checking it outside the lock reads the value a bid
     * transaction has not committed yet: the bid holds the row from before it
     * increments bidCount until it commits, so an edit alongside it sees zero
     * bids, writes, and the bid lands on top of the new terms. Waiting on the
     * lock orders the two — either the bid commits and the edit is refused
     * below, or the edit commits first and the bidder bids on what they see.
     * Removing just this SELECT, keeping the check, fails the in-flight test.
     */
    if (frozen.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${req.params.id} FOR UPDATE`;
        const locked = await tx.listing.findUnique({
          where: { id: req.params.id },
          select: { bidCount: true, status: true },
        });
        if (!locked) throw notFound('Listing');
        if (!(EDITABLE_STATUSES as readonly string[]).includes(locked.status)) {
          throw conflict('A listing that is no longer open cannot be edited');
        }
        if (locked.bidCount > 0) {
          throw conflict(`${listFields(frozen)} cannot change once bidding has started`);
        }
        await tx.listing.update({ where: { id: req.params.id }, data });
      });
    } else {
      // Nothing here is a term of the sale, so it needs no lock — only the
      // status re-check, in case the auction closed a moment ago.
      const applied = await prisma.listing.updateMany({
        where: { id: req.params.id, sellerId: auth.id, status: { in: [...EDITABLE_STATUSES] } },
        data,
      });
      if (applied.count === 0) throw conflict('A listing that is no longer open cannot be edited');
    }

    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: req.params.id },
      include: LISTING_INCLUDE,
    });
    return { listing: listingDetail(listing) };
  });

  app.post<{ Params: { id: string } }>('/v1/listings/:id/publish', async (req) => {
    const auth = requireAuth(req);
    const existing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { sellerId: true, status: true, startsAt: true },
    });
    if (!existing) throw notFound('Listing');
    if (existing.sellerId !== auth.id) throw forbidden('This is not your listing');
    if (existing.status !== 'DRAFT') throw conflict('Only drafts can be published');

    const listing = await prisma.listing.update({
      where: { id: req.params.id },
      data: { status: existing.startsAt > new Date() ? 'SCHEDULED' : 'LIVE' },
      include: LISTING_INCLUDE,
    });
    return { listing: listingDetail(listing) };
  });

  app.post<{ Params: { id: string } }>('/v1/listings/:id/cancel', async (req) => {
    const auth = requireAuth(req);
    const existing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { sellerId: true, bidCount: true, status: true },
    });
    if (!existing) throw notFound('Listing');
    if (existing.sellerId !== auth.id) throw forbidden('This is not your listing');
    if (existing.bidCount > 0) {
      throw conflict('An auction with bids cannot be cancelled — contact support');
    }

    const listing = await prisma.listing.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', closedAt: new Date() },
      include: LISTING_INCLUDE,
    });
    await writeAudit({
      actorId: auth.id,
      action: 'listing.cancel',
      targetType: 'listing',
      targetId: listing.id,
      ip: clientIp(req),
    });
    return { listing: listingDetail(listing) };
  });

  app.get('/v1/me/listings', async (req) => {
    const auth = requireAuth(req);
    const q = parseQuery(req, searchListingsSchema.partial({ status: true }));
    const args = pageArgs(q.page, q.perPage);
    const where: Prisma.ListingWhereInput = { sellerId: auth.id };
    if (q.status && q.status !== 'ALL') where.status = q.status;

    const [rows, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.listing.count({ where }),
    ]);
    return paginated(rows.map((r) => listingSummary(r, { userId: auth.id })), total, args);
  });

  /* ---------------- bidding ---------------- */

  app.post<{ Params: { id: string } }>('/v1/listings/:id/bids', async (req) => {
    const auth = requireAuth(req);
    await assertNotSuspended(auth.id);
    const body = parseBody(req, placeBidSchema);

    const result = await placeBidForUser({
      listingId: req.params.id,
      bidderId: auth.id,
      maxAmount: body.maxAmount,
      expectedPrice: body.expectedPrice,
      reference: body.reference,
      ip: clientIp(req),
    });

    if (!result.accepted) {
      return {
        accepted: false,
        pendingApproval: true,
        approvalId: result.approvalId,
        message: result.message,
      };
    }
    return result;
  });

  app.post<{ Params: { id: string } }>('/v1/listings/:id/buy-now', async (req, reply) => {
    const auth = requireAuth(req);
    await assertNotSuspended(auth.id);
    const body = parseBody(req, buyNowSchema);

    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Listing" WHERE id = ${req.params.id} FOR UPDATE`;
      const listing = await tx.listing.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          sellerId: true,
          status: true,
          kind: true,
          buyNowPrice: true,
          quantity: true,
          shippingCost: true,
          bidCount: true,
          currentPrice: true,
        },
      });
      if (!listing) throw notFound('Listing');
      if (listing.sellerId === auth.id) throw forbidden('You cannot buy your own listing');
      if (listing.status !== 'LIVE') throw conflict('This listing is no longer available');
      if (!listing.buyNowPrice) throw conflict('This listing has no buy-now price');
      // Buy-now disappears once the auction is genuinely competitive.
      if (listing.kind === 'AUCTION_WITH_BUY_NOW' && listing.currentPrice >= listing.buyNowPrice) {
        throw conflict('Bidding has passed the buy-now price');
      }
      if (body.quantity > listing.quantity) throw badRequest('Not enough stock left');

      const remaining = listing.quantity - body.quantity;
      await tx.listing.update({
        where: { id: listing.id },
        data: {
          quantity: remaining,
          ...(remaining <= 0 ? { status: 'SOLD', closedAt: new Date() } : {}),
        },
      });

      // The order is written here, inside the lock, not after it. Taking the
      // stock and recording the sale in separate transactions means a failure
      // between them consumes the quantity — marking the listing SOLD when it
      // was the last one — with no order to show for it. Nothing retries that,
      // and the stock is simply gone.
      const orderInput = {
        listingId: listing.id,
        buyerId: auth.id,
        sellerId: listing.sellerId,
        hammerPrice: listing.buyNowPrice! * body.quantity,
        quantity: body.quantity,
        shippingCost: listing.shippingCost,
      };
      return { order: await createOrderForSale(orderInput, tx), orderInput };
    });

    // Only once it has committed.
    await announceSale(order.order, order.orderInput);

    const full = await prisma.order.findUniqueOrThrow({
      where: { id: order.order.id },
      include: {
        listing: { include: LISTING_INCLUDE },
        buyer: true,
        seller: true,
      },
    });
    reply.code(201);
    return { order: orderDto(full) };
  });

  app.get('/v1/me/bids', async (req) => {
    const auth = requireAuth(req);
    const args = pageArgs(Number((req.query as any)?.page ?? 1), Number((req.query as any)?.perPage ?? 24));
    const [rows, total] = await Promise.all([
      prisma.bid.findMany({
        where: { bidderId: auth.id },
        orderBy: { createdAt: 'desc' },
        distinct: ['listingId'],
        skip: args.skip,
        take: args.take,
        include: {
          bidder: { select: { handle: true, avatarUrl: true } },
          listing: { include: LISTING_INCLUDE },
        },
      }),
      prisma.bid.count({ where: { bidderId: auth.id } }),
    ]);

    const viewer = await viewerContext(auth.id, rows.map((r) => r.listingId));
    return paginated(
      rows.map((b) => ({ ...bidSummary(b), maxAmount: b.maxAmount, listing: listingSummary(b.listing, viewer) })),
      total,
      args,
    );
  });

  /* ---------------- watchlist ---------------- */

  app.post<{ Params: { id: string } }>('/v1/listings/:id/watch', async (req) => {
    const auth = requireAuth(req);
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!listing) throw notFound('Listing');

    try {
      await prisma.watchlist.create({ data: { userId: auth.id, listingId: listing.id } });
      const updated = await prisma.listing.update({
        where: { id: listing.id },
        data: { watchCount: { increment: 1 } },
        select: { watchCount: true },
      });
      return { watching: true, watchCount: updated.watchCount };
    } catch {
      const current = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { watchCount: true },
      });
      return { watching: true, watchCount: current.watchCount };
    }
  });

  app.delete<{ Params: { id: string } }>('/v1/listings/:id/watch', async (req) => {
    const auth = requireAuth(req);
    const removed = await prisma.watchlist.deleteMany({
      where: { userId: auth.id, listingId: req.params.id },
    });
    const updated = await prisma.listing.update({
      where: { id: req.params.id },
      data: removed.count > 0 ? { watchCount: { decrement: removed.count } } : {},
      select: { watchCount: true },
    });
    return { watching: false, watchCount: Math.max(0, updated.watchCount) };
  });

  app.get('/v1/me/watchlist', async (req) => {
    const auth = requireAuth(req);
    const args = pageArgs(Number((req.query as any)?.page ?? 1), Number((req.query as any)?.perPage ?? 24));
    const [rows, total] = await Promise.all([
      prisma.watchlist.findMany({
        where: { userId: auth.id },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
        include: { listing: { include: LISTING_INCLUDE } },
      }),
      prisma.watchlist.count({ where: { userId: auth.id } }),
    ]);
    const viewer = await viewerContext(auth.id, rows.map((r) => r.listingId));
    return paginated(rows.map((r) => listingSummary(r.listing, viewer)), total, args);
  });
}

function sortOrder(sort: string): Prisma.ListingOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'price_asc':
      return [{ currentPrice: 'asc' }];
    case 'price_desc':
      return [{ currentPrice: 'desc' }];
    case 'most_bids':
      return [{ bidCount: 'desc' }, { endsAt: 'asc' }];
    case 'relevance':
      return [{ featured: 'desc' }, { bidCount: 'desc' }, { createdAt: 'desc' }];
    case 'ending_soon':
    default:
      // A pure clock sort — featured placement is what `relevance` is for.
      return [{ endsAt: 'asc' }, { createdAt: 'desc' }];
  }
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CampaignStatus,
  DisputeStatus,
  KycStatus,
  ListingStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import {
  disputeResolutionSchema,
  formatMoney,
  kycDecisionSchema,
  moderateListingSchema,
  orgCreditSchema,
  platformSettingsSchema,
  setRolesSchema,
  suspendUserSchema,
  type Role,
} from '@anybid/shared';
import { prisma } from '../db.ts';
import { requireAdmin, requireAuth, writeAudit } from '../lib/auth.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import {
  clientIp,
  enumFilter,
  pageArgs,
  paginated,
  parseBody,
  parseQuery,
} from '../lib/http.ts';
import { notify } from '../services/notifications.ts';
import { getSettings, updateSettings } from '../services/settings.ts';
import { settleListing } from '../services/settlement.ts';
import {
  auditDto,
  campaignDto,
  listingSummary,
  orderDto,
  organizationDto,
  sessionUser,
} from '../services/serialize.ts';

/**
 * An auction that has reached one of these is finished. Nothing may move it
 * back to LIVE: the settlement worker takes any LIVE listing whose end time
 * has passed, so reopening a closed one sells it a second time.
 */
const CLOSED_LISTING_STATUSES = ['ENDED', 'SOLD', 'UNSOLD', 'CANCELLED'] as const;

const PAID_STATUSES: Prisma.OrderWhereInput['status'] = {
  in: ['PAID', 'AWAITING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'COMPLETED'],
};

export async function adminRoutes(app: FastifyInstance) {
  app.get('/v1/admin/metrics', async (req) => {
    requireAdmin(req);
    const now = new Date();
    const day = new Date(now.getTime() - 86_400_000);
    const week = new Date(now.getTime() - 7 * 86_400_000);
    const month = new Date(now.getTime() - 30 * 86_400_000);

    const [
      totalUsers,
      newUsers,
      suspended,
      pendingKyc,
      live,
      endingSoon,
      pendingReview,
      totalListings,
      totalBids,
      bids24h,
      gmvAll,
      gmv30,
      gmv24,
      adRevenue,
      awaitingPayment,
      disputed,
      completed,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: week } } }),
      prisma.user.count({ where: { suspended: true } }),
      prisma.kycSubmission.count({ where: { status: 'PENDING' } }),
      prisma.listing.count({ where: { status: 'LIVE' } }),
      prisma.listing.count({
        where: { status: 'LIVE', endsAt: { lte: new Date(now.getTime() + 3_600_000) } },
      }),
      prisma.listing.count({ where: { status: 'PENDING_REVIEW' } }),
      prisma.listing.count(),
      prisma.bid.count(),
      prisma.bid.count({ where: { createdAt: { gte: day } } }),
      prisma.order.aggregate({ where: { status: PAID_STATUSES }, _sum: { hammerPrice: true, platformFee: true } }),
      prisma.order.aggregate({
        where: { status: PAID_STATUSES, createdAt: { gte: month } },
        _sum: { hammerPrice: true },
      }),
      prisma.order.aggregate({
        where: { status: PAID_STATUSES, createdAt: { gte: day } },
        _sum: { hammerPrice: true },
      }),
      prisma.adCampaign.aggregate({ _sum: { spend: true } }),
      prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } }),
      prisma.order.count({ where: { status: 'DISPUTED' } }),
      prisma.order.count({ where: { status: 'COMPLETED' } }),
    ]);

    // 14-day activity series, assembled in SQL so it stays one round trip each.
    const since = new Date(now.getTime() - 14 * 86_400_000);
    const [gmvSeries, bidSeries, userSeries] = await Promise.all([
      prisma.$queryRaw<{ date: Date; value: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS date, COALESCE(SUM("hammerPrice"), 0)::bigint AS value
        FROM "Order" WHERE "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ date: Date; value: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS date, COUNT(*)::bigint AS value
        FROM "Bid" WHERE "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ date: Date; value: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS date, COUNT(*)::bigint AS value
        FROM "User" WHERE "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
    ]);

    const timeseries = buildSeries(since, now, { gmv: gmvSeries, bids: bidSeries, newUsers: userSeries });

    return {
      users: { total: totalUsers, new7d: newUsers, suspended, pendingKyc },
      listings: { live, endingSoon, pendingReview, total: totalListings },
      bids: { total: totalBids, last24h: bids24h },
      gmv: {
        allTime: gmvAll._sum.hammerPrice ?? 0,
        last30d: gmv30._sum.hammerPrice ?? 0,
        last24h: gmv24._sum.hammerPrice ?? 0,
      },
      revenue: {
        commission: gmvAll._sum.platformFee ?? 0,
        ads: adRevenue._sum.spend ?? 0,
      },
      orders: { awaitingPayment, disputed, completed },
      timeseries,
    };
  });

  /* ---------------- users ---------------- */

  app.get('/v1/admin/users', async (req) => {
    requireAdmin(req);
    const q = parseQuery(
      req,
      z.object({
        q: z.string().max(120).optional(),
        role: z.string().optional(),
        suspended: z.enum(['true', 'false']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        perPage: z.coerce.number().int().min(1).max(100).default(25),
      }),
    );
    const args = pageArgs(q.page, q.perPage);

    const where: Prisma.UserWhereInput = {};
    if (q.q) {
      where.OR = [
        { email: { contains: q.q, mode: 'insensitive' } },
        { displayName: { contains: q.q, mode: 'insensitive' } },
        { handle: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q.role) where.roles = { has: q.role as Role };
    if (q.suspended) where.suspended = q.suspended === 'true';

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { orgMembership: { include: { org: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.user.count({ where }),
    ]);
    return paginated(rows.map((u) => sessionUser(u)), total, args);
  });

  app.post<{ Params: { id: string } }>('/v1/admin/users/:id/roles', async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parseBody(req, setRolesSchema);
    // Only a super admin can mint another admin.
    if (
      (body.roles.includes('ADMIN') || body.roles.includes('SUPER_ADMIN')) &&
      !admin.roles.includes('SUPER_ADMIN')
    ) {
      throw forbidden('Only a super admin can grant admin roles');
    }
    if (req.params.id === admin.id && !body.roles.includes('SUPER_ADMIN') && admin.roles.includes('SUPER_ADMIN')) {
      throw conflict('You cannot remove your own super admin role');
    }

    await prisma.user.update({ where: { id: req.params.id }, data: { roles: body.roles } });

    // A new advertiser needs a billing profile to work with.
    if (body.roles.includes('ADVERTISER')) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id } });
      await prisma.advertiser.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          companyName: user.displayName,
          contactEmail: user.email,
          approved: true,
        },
        update: { approved: true },
      });
    }

    await writeAudit({
      actorId: admin.id,
      action: 'user.roles.set',
      targetType: 'user',
      targetId: req.params.id,
      meta: { roles: body.roles },
      ip: clientIp(req),
    });
    reply.code(204);
    return null;
  });

  /**
   * What the platform will extend to an organisation.
   *
   * These two settings used to sit in the corporate console's own budget
   * route, where the customer set them for itself — so an organisation could
   * put itself on NET_60 terms and name its own credit ceiling. They are the
   * platform's exposure, so they belong on this side of the line, and the
   * decision is recorded like every other admin decision here.
   */
  app.patch<{ Params: { id: string } }>('/v1/admin/organizations/:id/credit', async (req) => {
    const admin = requireAdmin(req);
    const body = parseBody(req, orgCreditSchema.partial());

    const existing = await prisma.organization.findUnique({
      where: { id: req.params.id },
      select: { id: true, outstanding: true },
    });
    if (!existing) throw notFound('Organisation');

    // Lowering a limit below what is already owed would leave the
    // organisation over its ceiling with no way back under it except paying,
    // which is fine — but say so rather than silently creating that state.
    if (body.creditLimit !== undefined && body.creditLimit < existing.outstanding) {
      throw badRequest(
        `That organisation already owes ${formatMoney(existing.outstanding)}; ` +
          'settle the outstanding balance before lowering the limit below it',
      );
    }

    const organization = await prisma.organization.update({
      where: { id: existing.id },
      data: body,
    });
    const memberCount = await prisma.orgMember.count({
      where: { orgId: organization.id, active: true },
    });

    await writeAudit({
      actorId: admin.id,
      action: 'org.credit.update',
      targetType: 'organization',
      targetId: organization.id,
      meta: body as Record<string, unknown>,
      ip: clientIp(req),
    });

    return { organization: organizationDto(organization, memberCount, 0) };
  });

  app.post<{ Params: { id: string } }>('/v1/admin/users/:id/suspend', async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parseBody(req, suspendUserSchema);
    if (req.params.id === admin.id) throw conflict('You cannot suspend yourself');

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { roles: true },
    });
    if (!target) throw notFound('User');
    if (target.roles.includes('SUPER_ADMIN')) throw forbidden('Super admins cannot be suspended');

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        suspended: body.suspended,
        suspendedReason: body.suspended ? body.reason : null,
        suspendedUntil: body.suspended ? (body.until ?? null) : null,
      },
    });
    if (body.suspended) {
      // Kill live sessions so the suspension bites immediately.
      await prisma.session.updateMany({
        where: { userId: req.params.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await notify({
      userId: req.params.id,
      type: 'SYSTEM',
      title: body.suspended ? 'Your account has been suspended' : 'Your account has been reinstated',
      body: body.reason,
      link: '/account',
    });
    await writeAudit({
      actorId: admin.id,
      action: body.suspended ? 'user.suspend' : 'user.reinstate',
      targetType: 'user',
      targetId: req.params.id,
      meta: { reason: body.reason },
      ip: clientIp(req),
    });
    reply.code(204);
    return null;
  });

  /* ---------------- listings ---------------- */

  app.get('/v1/admin/listings', async (req) => {
    requireAdmin(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 25));
    const where: Prisma.ListingWhereInput = {};
    const status = enumFilter(query.status, Object.values(ListingStatus));
    if (status) where.status = status;
    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        include: { seller: true, category: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.listing.count({ where }),
    ]);
    return paginated(rows.map((l) => listingSummary(l)), total, args);
  });

  app.post<{ Params: { id: string } }>('/v1/admin/listings/:id/moderate', async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parseBody(req, moderateListingSchema);
    const listing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { id: true, sellerId: true, title: true, slug: true, status: true, startsAt: true },
    });
    if (!listing) throw notFound('Listing');

    const data: Prisma.ListingUpdateInput = { moderationNote: body.reason ?? null };
    switch (body.action) {
      case 'APPROVE':
        /**
         * An auction that has closed cannot be reopened.
         *
         * This decided the new status from the start time alone, with no
         * regard for what the listing currently was — so approving a sold
         * auction set it back to LIVE. A closed listing still carries its
         * price, its leader and an end time in the past, and the settlement
         * worker looks for exactly one thing: a LIVE listing whose end time
         * has passed. So it sold again.
         *
         * Measured: one auction produced two orders, charging the winner
         * RM800 for a RM400 item and paying the seller twice. A mis-click in
         * the moderation queue was enough.
         */
        if ((CLOSED_LISTING_STATUSES as readonly string[]).includes(listing.status)) {
          throw conflict(
            'This auction has already closed — approving it would put it back on the block',
          );
        }
        data.status = listing.startsAt > new Date() ? 'SCHEDULED' : 'LIVE';
        break;
      case 'SUSPEND':
        data.status = 'SUSPENDED';
        break;
      case 'CANCEL':
        data.status = 'CANCELLED';
        data.closedAt = new Date();
        break;
      case 'FEATURE':
        data.featured = true;
        data.featuredUntil = new Date(Date.now() + 7 * 86_400_000);
        break;
      case 'UNFEATURE':
        data.featured = false;
        data.featuredUntil = null;
        break;
    }

    /**
     * The three actions that move the status claim the status they were
     * decided against, so an auction that closed while the admin was looking
     * at the queue cannot be written over — which is the same reopening by a
     * narrower route. Featuring does not depend on the status, so it is not
     * made to fail when an auction ends mid-review.
     */
    if (body.action === 'APPROVE' || body.action === 'SUSPEND' || body.action === 'CANCEL') {
      const applied = await prisma.listing.updateMany({
        where: { id: listing.id, status: listing.status },
        data,
      });
      if (applied.count === 0) {
        throw conflict('This listing changed while you were reviewing it — take another look');
      }
    } else {
      await prisma.listing.update({ where: { id: listing.id }, data });
    }

    if (body.action === 'SUSPEND' || body.action === 'CANCEL') {
      await notify({
        userId: listing.sellerId,
        type: 'SYSTEM',
        title: `Your listing was ${body.action.toLowerCase()}ed`,
        body: `${listing.title}${body.reason ? ` — ${body.reason}` : ''}`,
        link: `/listing/${listing.slug}`,
      });
    }
    await writeAudit({
      actorId: admin.id,
      action: `listing.${body.action.toLowerCase()}`,
      targetType: 'listing',
      targetId: listing.id,
      meta: { reason: body.reason },
      ip: clientIp(req),
    });
    reply.code(204);
    return null;
  });

  /** Manual close — used when an auction needs settling out of band. */
  app.post<{ Params: { id: string } }>('/v1/admin/listings/:id/settle', async (req) => {
    const admin = requireAdmin(req);
    const closed = await settleListing(req.params.id);
    await writeAudit({
      actorId: admin.id,
      action: 'listing.settle',
      targetType: 'listing',
      targetId: req.params.id,
      ip: clientIp(req),
    });
    return { settled: closed };
  });

  /* ---------------- campaigns ---------------- */

  app.get('/v1/admin/campaigns', async (req) => {
    requireAdmin(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 25));
    const status = enumFilter(query.status, Object.values(CampaignStatus));
    const where = status ? { status } : {};

    const [rows, total] = await Promise.all([
      prisma.adCampaign.findMany({
        where,
        include: {
          creatives: true,
          categories: { select: { categoryId: true } },
          advertiser: { select: { companyName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.adCampaign.count({ where }),
    ]);
    return paginated(
      rows.map((c) => ({ ...campaignDto(c), advertiserName: c.advertiser.companyName })),
      total,
      args,
    );
  });

  app.post<{ Params: { id: string } }>('/v1/admin/campaigns/:id/review', async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parseBody(
      req,
      z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(500).optional() }),
    );
    const campaign = await prisma.adCampaign.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, advertiser: { select: { userId: true } } },
    });
    if (!campaign) throw notFound('Campaign');

    await prisma.adCampaign.update({
      where: { id: campaign.id },
      data: {
        status: body.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED',
        reviewNote: body.note ?? null,
      },
    });
    await notify({
      userId: campaign.advertiser.userId,
      type: 'SYSTEM',
      title: body.decision === 'APPROVE' ? 'Campaign approved' : 'Campaign rejected',
      body: `${campaign.name}${body.note ? ` — ${body.note}` : ''}`,
      link: '/advertiser/campaigns',
    });
    await writeAudit({
      actorId: admin.id,
      action: `campaign.${body.decision.toLowerCase()}`,
      targetType: 'campaign',
      targetId: campaign.id,
      ip: clientIp(req),
    });
    reply.code(204);
    return null;
  });

  /* ---------------- orders, disputes, kyc ---------------- */

  app.get('/v1/admin/orders', async (req) => {
    requireAdmin(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 25));
    const status = enumFilter(query.status, Object.values(OrderStatus));
    const where = status ? { status } : {};

    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          listing: { include: { seller: true, category: { select: { id: true, name: true, slug: true } } } },
          buyer: true,
          seller: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.order.count({ where }),
    ]);
    return paginated(rows.map(orderDto), total, args);
  });

  app.get('/v1/admin/disputes', async (req) => {
    requireAdmin(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 25));
    const status = enumFilter(query.status, Object.values(DisputeStatus));
    const where = status
      ? { status }
      : { status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] } };

    const [rows, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        include: { order: { include: { listing: true, buyer: true, seller: true } }, openedBy: true },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.dispute.count({ where }),
    ]);
    return paginated(rows as never[], total, args);
  });

  app.post<{ Params: { id: string } }>('/v1/admin/disputes/:id/resolve', async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parseBody(req, disputeResolutionSchema);
    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: { order: true },
    });
    if (!dispute) throw notFound('Dispute');

    // A partial refund is bounded by what the buyer actually paid. moneySchema
    // allows up to a billion ringgit and knows nothing about this order, so
    // without this a "partial" refund could exceed the total — and because the
    // status below is chosen by comparing the refund against that total, it
    // would also quietly become a full refund with change.
    if (body.resolution === 'PARTIAL_REFUND') {
      const amount = body.amount ?? 0;
      if (amount <= 0) throw badRequest('A partial refund needs an amount above zero');
      if (amount > dispute.order.total) {
        throw badRequest(
          `A partial refund cannot exceed the order total of ${formatMoney(dispute.order.total)}`,
        );
      }
    }

    const refund =
      body.resolution === 'REFUND_BUYER'
        ? dispute.order.total
        : body.resolution === 'PARTIAL_REFUND'
          ? (body.amount ?? 0)
          : 0;

    await prisma.$transaction(async (tx) => {
      // Claim the dispute. The read above cannot see a second admin resolving
      // it alongside this one, and it only refused a dispute already RESOLVED
      // — so a REJECTED one could be decided a second time, that time paying
      // the buyer the whole order. Putting the undecided states in the
      // where-clause closes both: exactly one resolution happens, and only
      // from OPEN or UNDER_REVIEW.
      const claimed = await tx.dispute.updateMany({
        where: { id: dispute.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        data: {
          status: body.resolution === 'REJECTED' ? 'REJECTED' : 'RESOLVED',
          resolution: body.resolution,
          refundAmount: refund || null,
          resolvedById: admin.id,
          resolvedAt: new Date(),
        },
      });
      if (claimed.count === 0) throw conflict('This dispute has already been decided');
      await tx.order.update({
        where: { id: dispute.orderId },
        data: {
          status: refund >= dispute.order.total ? 'REFUNDED' : 'COMPLETED',
          completedAt: new Date(),
        },
      });
      if (refund > 0) {
        await tx.user.update({
          where: { id: dispute.order.buyerId },
          data: { balance: { increment: refund } },
        });
      } else if (body.resolution === 'RELEASE_SELLER') {
        await tx.user.update({
          where: { id: dispute.order.sellerId },
          data: { balance: { increment: dispute.order.sellerPayout } },
        });
      }
    });

    await notify({
      userId: dispute.order.buyerId,
      type: 'SYSTEM',
      title: 'Dispute resolved',
      body: body.note,
      link: `/account/orders/${dispute.orderId}`,
    });
    await notify({
      userId: dispute.order.sellerId,
      type: 'SYSTEM',
      title: 'Dispute resolved',
      body: body.note,
      link: `/account/sales/${dispute.orderId}`,
    });
    await writeAudit({
      actorId: admin.id,
      action: 'dispute.resolve',
      targetType: 'dispute',
      targetId: dispute.id,
      meta: { resolution: body.resolution, refund },
      ip: clientIp(req),
    });
    reply.code(204);
    return null;
  });

  app.get('/v1/admin/kyc', async (req) => {
    requireAdmin(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 25));
    const where = { status: enumFilter(query.status, Object.values(KycStatus)) ?? KycStatus.PENDING };

    const [rows, total] = await Promise.all([
      prisma.kycSubmission.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'asc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.kycSubmission.count({ where }),
    ]);
    return paginated(rows as never[], total, args);
  });

  app.post<{ Params: { id: string } }>('/v1/admin/kyc/:id/decide', async (req, reply) => {
    const admin = requireAdmin(req);
    const body = parseBody(req, kycDecisionSchema);
    const submission = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) throw notFound('KYC submission');

    const status =
      body.decision === 'APPROVE' ? 'APPROVED' : body.decision === 'REJECT' ? 'REJECTED' : 'PENDING';

    await prisma.$transaction([
      prisma.kycSubmission.update({
        where: { id: submission.id },
        data: { status, note: body.note ?? null, reviewedBy: admin.id, reviewedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: submission.userId },
        data: { kycStatus: status, verified: status === 'APPROVED' },
      }),
    ]);

    /**
     * Approving a submission sets `verified` on the person, and that badge is
     * what a buyer reads before sending money to a stranger — so this is the
     * admin decision most likely to be questioned after a fraud. It was the
     * only one in this file that left no trace: roles, suspension, listing
     * moderation, campaign decisions, dispute resolution and settings all
     * write a row.
     */
    await writeAudit({
      actorId: admin.id,
      action: `kyc.${body.decision.toLowerCase()}`,
      targetType: 'kyc',
      targetId: submission.id,
      meta: { userId: submission.userId, status },
      ip: clientIp(req),
    });

    await notify({
      userId: submission.userId,
      type: 'KYC_UPDATE',
      title: `Identity check ${status.toLowerCase()}`,
      body: body.note ?? 'Your verification status has been updated.',
      link: '/account/verification',
    });
    reply.code(204);
    return null;
  });

  /* ---------------- audit & settings ---------------- */

  app.get('/v1/admin/audit', async (req) => {
    requireAdmin(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 50));
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = { contains: query.action };
    if (query.targetId) where.targetId = query.targetId;

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: true },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return paginated(rows.map(auditDto), total, args);
  });

  app.get('/v1/admin/settings', async (req) => {
    requireAdmin(req);
    return { settings: await getSettings(true) };
  });

  app.patch('/v1/admin/settings', async (req) => {
    const admin = requireAdmin(req);
    const body = parseBody(req, platformSettingsSchema);
    const settings = await updateSettings(body, admin.id);
    await writeAudit({
      actorId: admin.id,
      action: 'settings.update',
      targetType: 'platform',
      targetId: 'platform',
      meta: body,
      ip: clientIp(req),
    });
    return { settings };
  });

  /* ---------------- KYC submission (user side) ---------------- */

  app.post('/v1/me/kyc', async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(
      req,
      z.object({
        docType: z.enum(['NRIC', 'PASSPORT', 'BUSINESS_REG']),
        docNumber: z.string().min(4).max(40),
        docFrontUrl: z.string().url(),
        docBackUrl: z.string().url().optional(),
        selfieUrl: z.string().url().optional(),
      }),
    );

    /**
     * One submission in review per person, and the person's status moves with
     * it.
     *
     * The check for a pending submission used to sit above an unconditional
     * create, so requests arriving together all passed it: six at once left
     * three verifications in review for one person. Each extra row is another
     * identity document stored and another item in the reviewer's queue for
     * somebody they have already seen.
     *
     * The user row is locked rather than the submission table, because what
     * has to be true at the end is a fact about the person. It also puts the
     * create and their status change in one transaction, so a submission
     * cannot exist for someone the system does not think is awaiting review.
     */
    const submission = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${auth.id} FOR UPDATE`;
      const pending = await tx.kycSubmission.findFirst({
        where: { userId: auth.id, status: 'PENDING' },
        select: { id: true },
      });
      if (pending) throw conflict('You already have a verification in review');

      const created = await tx.kycSubmission.create({
        data: {
          userId: auth.id,
          docType: body.docType,
          docNumber: body.docNumber,
          docFrontUrl: body.docFrontUrl,
          docBackUrl: body.docBackUrl ?? null,
          selfieUrl: body.selfieUrl ?? null,
        },
      });
      await tx.user.update({ where: { id: auth.id }, data: { kycStatus: 'PENDING' } });
      return created;
    });

    reply.code(201);
    return { submission };
  });
}

function buildSeries(
  since: Date,
  until: Date,
  sources: Record<string, { date: Date; value: bigint }[]>,
) {
  const keys = Object.keys(sources);
  const byDate = new Map<string, Record<string, number>>();

  for (let d = new Date(since); d <= until; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    byDate.set(key, Object.fromEntries(keys.map((k) => [k, 0])));
  }
  for (const [name, rows] of Object.entries(sources)) {
    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      const entry = byDate.get(key);
      if (entry) entry[name] = Number(row.value);
    }
  }
  return [...byDate.entries()].map(([date, values]) => ({ date, ...values }));
}

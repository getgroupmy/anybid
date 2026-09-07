import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  approvalDecisionSchema,
  createOrgSchema,
  inviteMemberSchema,
  orgBudgetSchema,
  rfqSchema,
  updateMemberSchema,
} from '@anybid/shared';
import { prisma } from '../db.ts';
import { requireAuth, writeAudit } from '../lib/auth.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { clientIp, pageArgs, paginated, parseBody, parseQuery, slugify } from '../lib/http.ts';
import { hashPassword } from '../lib/crypto.ts';
import { placeApprovedBid } from '../services/bidding.ts';
import { notify } from '../services/notifications.ts';
import { approvalDto, orderDto, organizationDto, orgMemberDto, publicUser } from '../services/serialize.ts';
import { randomBytes } from 'node:crypto';

type Seat = { orgId: string; orgRole: string; id: string };

async function mySeat(userId: string): Promise<Seat> {
  const member = await prisma.orgMember.findUnique({
    where: { userId },
    select: { id: true, orgId: true, orgRole: true, active: true },
  });
  if (!member) throw forbidden('You are not part of an organisation');
  if (!member.active) throw forbidden('Your organisation seat is inactive');
  return member;
}

function assertManages(seat: Seat) {
  if (!['OWNER', 'ADMIN'].includes(seat.orgRole)) {
    throw forbidden('Only organisation owners and admins can do this');
  }
}

function assertApproves(seat: Seat) {
  if (!['OWNER', 'ADMIN', 'APPROVER'].includes(seat.orgRole)) {
    throw forbidden('Only approvers can decide on bid requests');
  }
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function corporateRoutes(app: FastifyInstance) {
  app.get('/v1/corporate/organization', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: seat.orgId } });
    const [memberCount, spent] = await Promise.all([
      prisma.orgMember.count({ where: { orgId: org.id, active: true } }),
      prisma.order.aggregate({
        where: { orgId: org.id, createdAt: { gte: monthStart() } },
        _sum: { total: true },
      }),
    ]);
    return {
      organization: organizationDto(org, memberCount, spent._sum.total ?? 0),
      mySeat: { orgRole: seat.orgRole },
    };
  });

  /** Creating an organisation makes the caller its owner. */
  app.post('/v1/corporate/organization', async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(req, createOrgSchema);

    const existingSeat = await prisma.orgMember.findUnique({ where: { userId: auth.id } });
    if (existingSeat) throw conflict('You already belong to an organisation');

    const duplicate = await prisma.organization.findUnique({
      where: { registrationNo: body.registrationNo },
    });
    if (duplicate) throw conflict('An organisation with that registration number exists');

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          ...body,
          slug: slugify(body.name, randomBytes(2).toString('hex')),
        },
      });
      await tx.orgMember.create({
        data: { orgId: created.id, userId: auth.id, orgRole: 'OWNER' },
      });
      await tx.user.update({
        where: { id: auth.id },
        data: { roles: { push: 'CORPORATE' } },
      });
      return created;
    });

    await writeAudit({
      actorId: auth.id,
      action: 'org.create',
      targetType: 'organization',
      targetId: org.id,
      ip: clientIp(req),
    });

    reply.code(201);
    return { organization: organizationDto(org, 1, 0) };
  });

  app.patch('/v1/corporate/organization/budget', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    assertManages(seat);
    const body = parseBody(req, orgBudgetSchema.partial());

    const org = await prisma.organization.update({ where: { id: seat.orgId }, data: body });
    const memberCount = await prisma.orgMember.count({ where: { orgId: org.id, active: true } });
    await writeAudit({
      actorId: auth.id,
      action: 'org.budget.update',
      targetType: 'organization',
      targetId: org.id,
      meta: body as Record<string, unknown>,
      ip: clientIp(req),
    });
    return { organization: organizationDto(org, memberCount, 0) };
  });

  /* ---------------- members ---------------- */

  app.get('/v1/corporate/members', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    const members = await prisma.orgMember.findMany({
      where: { orgId: seat.orgId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    return { members: members.map(orgMemberDto) };
  });

  /**
   * Invites a teammate. An existing AnyBid account is attached to the seat;
   * an unknown email gets a provisional account with a one-time password the
   * caller passes on (a real deployment sends an invite email instead).
   */
  app.post('/v1/corporate/members', async (req, reply) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    assertManages(seat);
    const body = parseBody(req, inviteMemberSchema);

    let user = await prisma.user.findUnique({ where: { email: body.email } });
    let temporaryPassword: string | undefined;

    if (user) {
      const taken = await prisma.orgMember.findUnique({ where: { userId: user.id } });
      if (taken) throw conflict('That person already belongs to an organisation');
    } else {
      temporaryPassword = `ab-${randomBytes(6).toString('base64url')}`;
      const handleBase = body.email.split('@')[0]!.replace(/[^a-z0-9]/g, '').slice(0, 16) || 'member';
      user = await prisma.user.create({
        data: {
          email: body.email,
          passwordHash: await hashPassword(temporaryPassword),
          displayName: body.email.split('@')[0]!,
          handle: `${handleBase}${randomBytes(2).toString('hex')}`,
          roles: ['USER', 'CORPORATE'],
          accountType: 'BUSINESS',
        },
      });
    }

    const member = await prisma.orgMember.create({
      data: {
        orgId: seat.orgId,
        userId: user.id,
        orgRole: body.orgRole,
        approvalThreshold: body.approvalThreshold ?? null,
      },
      include: { user: true },
    });

    if (!user.roles.includes('CORPORATE')) {
      await prisma.user.update({
        where: { id: user.id },
        data: { roles: { push: 'CORPORATE' } },
      });
    }

    await notify({
      userId: user.id,
      type: 'SYSTEM',
      title: 'You were added to an organisation',
      body: 'You can now bid on behalf of your company in the Corporate console.',
      link: '/corporate',
    });

    reply.code(201);
    return { member: orgMemberDto(member), temporaryPassword };
  });

  app.patch<{ Params: { id: string } }>('/v1/corporate/members/:id', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    assertManages(seat);
    const body = parseBody(req, updateMemberSchema);

    const target = await prisma.orgMember.findFirst({
      where: { id: req.params.id, orgId: seat.orgId },
      select: { id: true, orgRole: true, userId: true },
    });
    if (!target) throw notFound('Member');
    if (target.orgRole === 'OWNER' && seat.orgRole !== 'OWNER') {
      throw forbidden('Only an owner can change another owner');
    }

    const member = await prisma.orgMember.update({
      where: { id: target.id },
      data: body,
      include: { user: true },
    });
    return { member: orgMemberDto(member) };
  });

  app.delete<{ Params: { id: string } }>('/v1/corporate/members/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    assertManages(seat);

    const target = await prisma.orgMember.findFirst({
      where: { id: req.params.id, orgId: seat.orgId },
      select: { id: true, orgRole: true, userId: true },
    });
    if (!target) throw notFound('Member');
    if (target.orgRole === 'OWNER') throw forbidden('The owner seat cannot be removed');

    await prisma.orgMember.delete({ where: { id: target.id } });
    reply.code(204);
    return null;
  });

  /* ---------------- approvals ---------------- */

  app.get('/v1/corporate/approvals', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    const q = parseQuery(
      req,
      z.object({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'ALL']).default('PENDING'),
        page: z.coerce.number().int().min(1).default(1),
        perPage: z.coerce.number().int().min(1).max(60).default(20),
      }),
    );
    const args = pageArgs(q.page, q.perPage);

    const where = {
      orgId: seat.orgId,
      ...(q.status === 'ALL' ? {} : { status: q.status }),
      // A plain buyer only sees their own requests.
      ...(['OWNER', 'ADMIN', 'APPROVER'].includes(seat.orgRole)
        ? {}
        : { requestedById: auth.id }),
    };

    const [rows, total] = await Promise.all([
      prisma.approvalRequest.findMany({
        where,
        include: { listing: true, requestedBy: true, decidedBy: true },
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.approvalRequest.count({ where }),
    ]);
    return paginated(rows.map(approvalDto), total, args);
  });

  app.post<{ Params: { id: string } }>('/v1/corporate/approvals/:id/decide', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    assertApproves(seat);
    const body = parseBody(req, approvalDecisionSchema);

    const approval = await prisma.approvalRequest.findFirst({
      where: { id: req.params.id, orgId: seat.orgId },
      select: { id: true, status: true, requestedById: true, amount: true },
    });
    if (!approval) throw notFound('Approval request');
    if (approval.status !== 'PENDING') throw conflict('This request has already been decided');
    if (approval.requestedById === auth.id) {
      throw forbidden('You cannot approve your own request');
    }

    if (body.decision === 'REJECT') {
      const rejected = await prisma.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: 'REJECTED',
          decidedById: auth.id,
          decidedAt: new Date(),
          note: body.note ?? null,
        },
        include: { listing: true, requestedBy: true, decidedBy: true },
      });
      await notify({
        userId: approval.requestedById,
        type: 'APPROVAL_DECIDED',
        title: 'Bid request declined',
        body: body.note ?? 'Your approver declined this bid request.',
        link: '/corporate/approvals',
      });
      return { approval: approvalDto(rejected) };
    }

    // Approving places the held bid against the live auction.
    const result = await placeApprovedBid(approval.id, auth.id);
    const updated = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approval.id },
      include: { listing: true, requestedBy: true, decidedBy: true },
    });

    await writeAudit({
      actorId: auth.id,
      action: 'org.approval.approve',
      targetType: 'approval',
      targetId: approval.id,
      meta: { amount: approval.amount },
      ip: clientIp(req),
    });

    return { approval: approvalDto(updated), bid: result };
  });

  /* ---------------- spend & orders ---------------- */

  app.get('/v1/corporate/spend', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: seat.orgId } });
    const since = monthStart();

    const members = await prisma.orgMember.findMany({
      where: { orgId: seat.orgId },
      include: { user: true },
    });

    const rows = await Promise.all(
      members.map(async (m) => {
        const [bids, won, spend] = await Promise.all([
          prisma.bid.count({ where: { bidderId: m.userId, createdAt: { gte: since } } }),
          prisma.order.count({ where: { buyerId: m.userId, orgId: org.id, createdAt: { gte: since } } }),
          prisma.order.aggregate({
            where: { buyerId: m.userId, orgId: org.id, createdAt: { gte: since } },
            _sum: { total: true },
          }),
        ]);
        return {
          member: publicUser(m.user),
          orgRole: m.orgRole,
          bids,
          won,
          spend: spend._sum.total ?? 0,
        };
      }),
    );

    // Money committed but not yet won: live auctions this org is leading.
    const leading = await prisma.listing.findMany({
      where: {
        status: 'LIVE',
        leaderId: { in: members.map((m) => m.userId) },
      },
      select: { currentPrice: true },
    });
    const committed = leading.reduce((sum, l) => sum + l.currentPrice, 0);
    const spent = rows.reduce((sum, r) => sum + r.spend, 0);

    return {
      rows,
      totals: {
        budget: org.monthlyBudget,
        spent,
        committed,
        remaining: Math.max(0, org.monthlyBudget - spent - committed),
        outstanding: org.outstanding,
        creditLimit: org.creditLimit,
      },
    };
  });

  app.get('/v1/corporate/orders', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 20));
    const where = { orgId: seat.orgId, ...(query.status ? { status: query.status as never } : {}) };

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

  app.get('/v1/corporate/invoices', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    const invoices = await prisma.invoice.findMany({
      where: { orgId: seat.orgId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { invoices };
  });

  /* ---------------- RFQ (reverse auction) ---------------- */

  app.get('/v1/corporate/rfqs', async (req) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    const rfqs = await prisma.rfq.findMany({
      where: { orgId: seat.orgId },
      include: { quotes: { orderBy: { unitPrice: 'asc' }, take: 10 }, category: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { rfqs };
  });

  app.post('/v1/corporate/rfqs', async (req, reply) => {
    const auth = requireAuth(req);
    const seat = await mySeat(auth.id);
    if (seat.orgRole === 'VIEWER') throw forbidden('Viewer seats cannot raise RFQs');
    const body = parseBody(req, rfqSchema);

    const rfq = await prisma.rfq.create({
      data: {
        orgId: seat.orgId,
        categoryId: body.categoryId,
        title: body.title,
        description: body.description,
        quantity: body.quantity,
        targetUnitPrice: body.targetUnitPrice ?? null,
        deliveryState: body.deliveryState ?? null,
        closesAt: body.closesAt,
      },
    });
    reply.code(201);
    return { rfq };
  });
}

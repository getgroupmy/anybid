import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { checkoutSchema, disputeSchema, reviewSchema, shipOrderSchema } from '@anybid/shared';
import { prisma } from '../db.ts';
import { assertNotSuspended, requireAuth } from '../lib/auth.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { pageArgs, paginated, parseBody } from '../lib/http.ts';
import { notify } from '../services/notifications.ts';
import { orderDto } from '../services/serialize.ts';

const ORDER_INCLUDE = {
  listing: { include: { seller: true, category: { select: { id: true, name: true, slug: true } } } },
  buyer: true,
  seller: true,
} as const;

async function loadOrderFor(orderId: string, userId: string, isAdmin = false) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  if (!order) throw notFound('Order');
  if (!isAdmin && order.buyerId !== userId && order.sellerId !== userId) {
    throw forbidden('This order is not yours');
  }
  return order;
}

export async function orderRoutes(app: FastifyInstance) {
  app.get('/v1/orders', async (req) => {
    const auth = requireAuth(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 20));
    // role=buying (default) or role=selling
    const where: Prisma.OrderWhereInput =
      query.role === 'selling' ? { sellerId: auth.id } : { buyerId: auth.id };
    if (query.status) where.status = query.status as never;

    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.order.count({ where }),
    ]);
    return paginated(rows.map(orderDto), total, args);
  });

  app.get<{ Params: { id: string } }>('/v1/orders/:id', async (req) => {
    const auth = requireAuth(req);
    const order = await loadOrderFor(req.params.id, auth.id);
    return { order: orderDto(order) };
  });

  /**
   * Checkout. The payment provider is stubbed behind this one call: swapping
   * in FPX/Stripe means implementing `capturePayment` and nothing else.
   */
  app.post<{ Params: { id: string } }>('/v1/orders/:id/pay', async (req) => {
    const auth = requireAuth(req);
    await assertNotSuspended(auth.id);
    const body = parseBody(req, checkoutSchema);
    const order = await loadOrderFor(req.params.id, auth.id);

    if (order.buyerId !== auth.id) throw forbidden('Only the buyer can pay for this order');
    if (order.status !== 'AWAITING_PAYMENT') throw conflict('This order is not awaiting payment');

    const isInvoice = body.method === 'CORPORATE_INVOICE';
    if (isInvoice) {
      const member = await prisma.orgMember.findUnique({
        where: { userId: auth.id },
        select: { org: { select: { id: true, paymentTerms: true, creditLimit: true, outstanding: true } } },
      });
      if (!member || member.org.paymentTerms === 'PREPAID') {
        throw conflict('Invoice payment is not enabled for your organisation');
      }
      if (member.org.outstanding + order.total > member.org.creditLimit) {
        throw conflict('This purchase would exceed your organisation credit limit');
      }
      await prisma.organization.update({
        where: { id: member.org.id },
        data: { outstanding: { increment: order.total } },
      });
    }

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        amount: order.total,
        method: body.method,
        status: 'SUCCEEDED',
        provider: isInvoice ? 'invoice' : 'mock',
        providerRef: `MOCK-${Date.now().toString(36).toUpperCase()}`,
        settledAt: new Date(),
      },
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: isInvoice ? 'AWAITING_SHIPMENT' : 'PAID',
        paymentMethod: body.method,
        paymentRef: payment.providerRef,
        paidAt: new Date(),
        shippingName: body.shippingName,
        shippingPhone: body.shippingPhone,
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2 ?? null,
        city: body.city,
        state: body.state,
        postcode: body.postcode,
        country: body.country,
        notes: body.notes ?? null,
      },
      include: ORDER_INCLUDE,
    });

    await notify({
      userId: order.sellerId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment received — ship it',
      body: `${updated.listing.title} is paid for. Ship to ${body.city}, ${body.state}.`,
      link: `/account/sales/${order.id}`,
    });

    return { order: orderDto(updated) };
  });

  app.post<{ Params: { id: string } }>('/v1/orders/:id/ship', async (req) => {
    const auth = requireAuth(req);
    const body = parseBody(req, shipOrderSchema);
    const order = await loadOrderFor(req.params.id, auth.id);
    if (order.sellerId !== auth.id) throw forbidden('Only the seller can mark this shipped');
    if (!['PAID', 'AWAITING_SHIPMENT'].includes(order.status)) {
      throw conflict('This order is not ready to ship');
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'SHIPPED',
        courier: body.courier,
        trackingNumber: body.trackingNumber,
        shippedAt: new Date(),
      },
      include: ORDER_INCLUDE,
    });

    await notify({
      userId: order.buyerId,
      type: 'ORDER_SHIPPED',
      title: 'Your item is on its way',
      body: `${updated.listing.title} shipped via ${body.courier} (${body.trackingNumber}).`,
      link: `/account/orders/${order.id}`,
    });

    return { order: orderDto(updated) };
  });

  /** Buyer confirms delivery — this is what releases the seller payout. */
  app.post<{ Params: { id: string } }>('/v1/orders/:id/confirm', async (req) => {
    const auth = requireAuth(req);
    const order = await loadOrderFor(req.params.id, auth.id);
    if (order.buyerId !== auth.id) throw forbidden('Only the buyer can confirm delivery');
    if (!['SHIPPED', 'DELIVERED'].includes(order.status)) {
      throw conflict('This order has not shipped yet');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', deliveredAt: new Date(), completedAt: new Date() },
        include: ORDER_INCLUDE,
      });
      await tx.user.update({
        where: { id: o.sellerId },
        data: { balance: { increment: o.sellerPayout } },
      });
      return o;
    });

    await notify({
      userId: order.sellerId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payout released',
      body: `Delivery confirmed for ${updated.listing.title}. Your payout is in your balance.`,
      link: `/account/sales/${order.id}`,
    });

    return { order: orderDto(updated) };
  });

  app.post<{ Params: { id: string } }>('/v1/orders/:id/review', async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(req, reviewSchema);
    const order = await loadOrderFor(req.params.id, auth.id);
    if (order.status !== 'COMPLETED') throw conflict('You can review once the order is complete');

    const subjectId = order.buyerId === auth.id ? order.sellerId : order.buyerId;
    const existing = await prisma.review.findUnique({
      where: { orderId_authorId: { orderId: order.id, authorId: auth.id } },
    });
    if (existing) throw conflict('You have already reviewed this order');

    await prisma.$transaction([
      prisma.review.create({
        data: {
          orderId: order.id,
          authorId: auth.id,
          subjectId,
          rating: body.rating,
          comment: body.comment ?? null,
        },
      }),
      prisma.user.update({
        where: { id: subjectId },
        data: { ratingSum: { increment: body.rating }, ratingCount: { increment: 1 } },
      }),
    ]);

    reply.code(201);
    return null;
  });

  app.post<{ Params: { id: string } }>('/v1/orders/:id/dispute', async (req, reply) => {
    const auth = requireAuth(req);
    const body = parseBody(req, disputeSchema.omit({ orderId: true }));
    const order = await loadOrderFor(req.params.id, auth.id);
    if (order.buyerId !== auth.id) throw forbidden('Only the buyer can open a dispute');
    if (['COMPLETED', 'REFUNDED', 'CANCELLED'].includes(order.status)) {
      throw conflict('This order is already closed');
    }

    await prisma.$transaction([
      prisma.dispute.create({
        data: {
          orderId: order.id,
          openedById: auth.id,
          reason: body.reason,
          detail: body.detail,
        },
      }),
      prisma.order.update({ where: { id: order.id }, data: { status: 'DISPUTED' } }),
    ]);

    await notify({
      userId: order.sellerId,
      type: 'SYSTEM',
      title: 'A dispute was opened',
      body: `The buyer opened a dispute on ${order.listing.title}. Our team will review it.`,
      link: `/account/sales/${order.id}`,
    });

    reply.code(201);
    return null;
  });
}

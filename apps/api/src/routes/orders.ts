import type { FastifyInstance } from 'fastify';
import { OrderStatus, Prisma } from '@prisma/client';
import { checkoutSchema, disputeSchema, reviewSchema, shipOrderSchema } from '@anybid/shared';
import { prisma } from '../db.ts';
import { assertNotSuspended, requireAuth } from '../lib/auth.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { enumFilter, pageArgs, paginated, parseBody } from '../lib/http.ts';
import { notify } from '../services/notifications.ts';
import { orderDto } from '../services/serialize.ts';

const ORDER_INCLUDE = {
  listing: { include: { seller: true, category: { select: { id: true, name: true, slug: true } } } },
  buyer: true,
  seller: true,
} as const;

/** Past arguing: the money has settled one way or the other. */
const CLOSED_TO_DISPUTE: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.REFUNDED,
  OrderStatus.CANCELLED,
];

/**
 * Everything a dispute may still be raised against, derived from the closed
 * list rather than written out beside it — two lists that have to stay
 * complementary drift, and the one that would drift is the one guarding a
 * payout. DISPUTED is left out because an order can only hold one dispute.
 */
const OPEN_TO_DISPUTE: OrderStatus[] = Object.values(OrderStatus).filter(
  (s) => s !== OrderStatus.DISPUTED && !CLOSED_TO_DISPUTE.includes(s),
);

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
    const status = enumFilter(query.status, Object.values(OrderStatus));
    if (status) where.status = status;

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
    const providerRef = `MOCK-${Date.now().toString(36).toUpperCase()}`;

    /**
     * Paying is one transaction that starts by claiming the order.
     *
     * The status check above ran before any of this and cannot see a second
     * payment arriving alongside it. Two requests together used to pass that
     * guard and both go through: two SUCCEEDED payments for one order, and for
     * an invoice, the organisation's outstanding balance incremented twice.
     */
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: 'AWAITING_PAYMENT' },
        data: {
          status: isInvoice ? 'AWAITING_SHIPMENT' : 'PAID',
          paymentMethod: body.method,
          paymentRef: providerRef,
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
      });
      if (claimed.count === 0) return null;

      if (isInvoice) {
        const member = await tx.orgMember.findUnique({
          where: { userId: auth.id },
          select: { org: { select: { id: true, paymentTerms: true, creditLimit: true } } },
        });
        if (!member || member.org.paymentTerms === 'PREPAID') {
          throw conflict('Invoice payment is not enabled for your organisation');
        }

        // Lock the organisation before reading what it owes. Two invoice
        // payments on different orders would otherwise each read the same
        // outstanding figure, both find room under the limit, and together
        // exceed it — the credit limit is only a limit if the check and the
        // increment cannot interleave.
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${member.org.id} FOR UPDATE`;
        const org = await tx.organization.findUniqueOrThrow({
          where: { id: member.org.id },
          select: { outstanding: true, creditLimit: true },
        });
        if (org.outstanding + order.total > org.creditLimit) {
          throw conflict('This purchase would exceed your organisation credit limit');
        }
        await tx.organization.update({
          where: { id: member.org.id },
          data: { outstanding: { increment: order.total } },
        });
      }

      await tx.payment.create({
        data: {
          orderId: order.id,
          amount: order.total,
          method: body.method,
          status: 'SUCCEEDED',
          provider: isInvoice ? 'invoice' : 'mock',
          providerRef,
          settledAt: new Date(),
        },
      });

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
    });
    if (!updated) throw conflict('This order is not awaiting payment');

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

    // Same reason as the payout below, with a smaller consequence: two
    // requests together would otherwise each tell the buyer it had shipped.
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, status: { in: ['PAID', 'AWAITING_SHIPMENT'] } },
      data: {
        status: 'SHIPPED',
        courier: body.courier,
        trackingNumber: body.trackingNumber,
        shippedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw conflict('This order is not ready to ship');
    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
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
      // The status check above ran before this transaction and cannot see a
      // confirmation arriving alongside it. Re-stating it here is what makes
      // the payout happen once: the second writer matches no row and leaves
      // without crediting anything. Without it, two confirmations landing
      // together each incremented the balance.
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: { in: ['SHIPPED', 'DELIVERED'] } },
        data: { status: 'COMPLETED', deliveredAt: new Date(), completedAt: new Date() },
      });
      if (claimed.count === 0) return null;

      const o = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: ORDER_INCLUDE,
      });
      await tx.user.update({
        where: { id: o.sellerId },
        data: { balance: { increment: o.sellerPayout } },
      });
      return o;
    });
    if (!updated) throw conflict('This order has already been confirmed');

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
    if (CLOSED_TO_DISPUTE.includes(order.status)) {
      throw conflict('This order is already closed');
    }

    const raised = await prisma.$transaction(async (tx) => {
      /**
       * The check above ran before this transaction and cannot see a
       * confirmation arriving alongside it. That confirmation releases the
       * seller's payout, and writing DISPUTED over the top of it left an order
       * an admin could then resolve for the buyer as well — the same sale paid
       * out twice, once to each side. Re-stating the status here is what stops
       * it: the second writer matches no row, nothing is written, and the buyer
       * is told the order moved on.
       *
       * The claim comes before the dispute row so a refused one leaves nothing
       * behind. A second dispute on the same order is refused by the unique on
       * orderId, which the error handler turns into the same 409.
       */
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: { in: OPEN_TO_DISPUTE } },
        data: { status: 'DISPUTED' },
      });
      if (claimed.count === 0) return false;
      await tx.dispute.create({
        data: {
          orderId: order.id,
          openedById: auth.id,
          reason: body.reason,
          detail: body.detail,
        },
      });
      return true;
    });
    if (!raised) throw conflict('This order is no longer open to a dispute');

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

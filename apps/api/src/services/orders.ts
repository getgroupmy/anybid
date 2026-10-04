import { computeFees, formatMoney, type Money } from '@anybid/shared';
import { prisma, type Tx } from '../db.ts';
import { randomReference } from '../lib/crypto.ts';
import { getSettings } from './settings.ts';
import { notify } from './notifications.ts';

/** Buyers get this long to pay before the order is chased/cancelled. */
export const PAYMENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface CreateOrderInput {
  listingId: string;
  buyerId: string;
  sellerId: string;
  hammerPrice: Money;
  quantity?: number;
  shippingCost?: Money;
  orgId?: string | null;
  /** corporate invoice orders skip the payment window */
  invoiced?: boolean;
}

/**
 * Records a sale.
 *
 * Takes the caller's transaction, because the order and whatever closed the
 * listing have to commit together. Written on its own it can fail after the
 * listing is already marked sold, and nothing retries: settlement only looks
 * at LIVE listings, so the auction stays closed with nothing to pay.
 *
 * Telling people about it is `announceSale`, deliberately separate — a
 * notification must not be sent for a sale that did not commit, and is not
 * worth rolling one back for.
 */
export async function createOrderForSale(input: CreateOrderInput, tx: Tx = prisma) {
  const settings = await getSettings(false, tx);
  const fees = computeFees(input.hammerPrice, settings);
  const shipping = input.shippingCost ?? 0;

  const order = await tx.order.create({
    data: {
      reference: randomReference('AB'),
      listingId: input.listingId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      orgId: input.orgId ?? null,
      quantity: input.quantity ?? 1,
      hammerPrice: fees.hammerPrice,
      buyerPremium: fees.buyerPremium,
      shippingCost: shipping,
      total: fees.buyerTotal + shipping,
      sellerPayout: fees.sellerPayout,
      platformFee: fees.sellerCommission + fees.buyerPremium,
      paymentFee: fees.paymentFee,
      status: 'AWAITING_PAYMENT',
      paymentMethod: input.invoiced ? 'CORPORATE_INVOICE' : null,
      dueAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
    },
    include: { listing: { select: { title: true, slug: true } } },
  });

  return order;
}

export type SaleOrder = Awaited<ReturnType<typeof createOrderForSale>>;

/** Sent once the sale has committed, never before. */
export async function announceSale(order: SaleOrder, input: CreateOrderInput): Promise<void> {
  await notify({
    userId: input.buyerId,
    type: 'AUCTION_WON',
    title: 'You won — time to pay',
    body: `${order.listing.title} is yours at ${formatMoney(
      order.hammerPrice,
    )}. Total due ${formatMoney(order.total)}.`,
    link: `/account/orders/${order.id}`,
  });
  await notify({
    userId: input.sellerId,
    type: 'ITEM_SOLD',
    title: 'Your item sold',
    body: `${order.listing.title} sold for ${formatMoney(order.hammerPrice)}. Payout ${formatMoney(
      order.sellerPayout,
    )} after fees.`,
    link: `/account/sales/${order.id}`,
  });
}

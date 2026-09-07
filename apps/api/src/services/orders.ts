import { computeFees, formatMoney, type Money } from '@anybid/shared';
import { prisma } from '../db.ts';
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

export async function createOrderForSale(input: CreateOrderInput) {
  const settings = await getSettings();
  const fees = computeFees(input.hammerPrice, settings);
  const shipping = input.shippingCost ?? 0;

  const order = await prisma.order.create({
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

  await notify({
    userId: input.buyerId,
    type: 'AUCTION_WON',
    title: 'You won — time to pay',
    body: `${order.listing.title} is yours at ${formatMoney(
      fees.hammerPrice,
    )}. Total due ${formatMoney(order.total)}.`,
    link: `/account/orders/${order.id}`,
  });
  await notify({
    userId: input.sellerId,
    type: 'ITEM_SOLD',
    title: 'Your item sold',
    body: `${order.listing.title} sold for ${formatMoney(fees.hammerPrice)}. Payout ${formatMoney(
      fees.sellerPayout,
    )} after fees.`,
    link: `/account/sales/${order.id}`,
  });

  return order;
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverClient, readSession } from '@/lib/session';
import { Panel } from '@/components/ConsoleShell';
import { CheckoutForm } from '@/components/CheckoutForm';
import { ConfirmDeliveryButton } from '@/components/ConfirmDeliveryButton';
import { dateTime, formatMoney, statusTone } from '@/lib/format';
import { ApiError } from '@anybid/shared';

export const metadata = { title: 'Order' };
export const dynamic = 'force-dynamic';

const STEPS = ['AWAITING_PAYMENT', 'PAID', 'SHIPPED', 'COMPLETED'] as const;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await serverClient();
  const session = await readSession();

  let order;
  try {
    order = (await api.orders.get(id)).order;
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  const isBuyer = order.buyer?.id === session?.user.id;
  const stepIndex = Math.max(
    0,
    STEPS.indexOf(order.status as (typeof STEPS)[number]) === -1
      ? order.status === 'AWAITING_SHIPMENT'
        ? 1
        : order.status === 'DELIVERED'
          ? 2
          : 0
      : STEPS.indexOf(order.status as (typeof STEPS)[number]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink-900">Order {order.reference}</h2>
          <p className="text-sm text-ink-500">Placed {dateTime(order.createdAt)}</p>
        </div>
        <span className={`badge ${statusTone(order.status)}`}>{order.status.replace(/_/g, ' ')}</span>
      </div>

      <ol className="flex items-center gap-2">
        {['Payment', 'Paid', 'Shipped', 'Complete'].map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                i <= stepIndex ? 'bg-bid-600 text-white' : 'bg-ink-200 text-ink-500'
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-xs ${i <= stepIndex ? 'font-medium text-ink-900' : 'text-ink-400'}`}>
              {label}
            </span>
            {i < 3 && <span className={`h-px flex-1 ${i < stepIndex ? 'bg-bid-400' : 'bg-ink-200'}`} />}
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Panel title="Item">
            <div className="flex gap-4 p-5">
              {order.listing?.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={order.listing.image} alt="" className="h-24 w-24 rounded-lg object-cover" />
              )}
              <div className="min-w-0">
                <Link
                  href={`/listing/${order.listing?.slug}`}
                  className="font-medium text-ink-900 hover:text-bid-600"
                >
                  {order.listing?.title}
                </Link>
                <p className="mt-1 text-sm text-ink-500">
                  Sold by {order.seller?.displayName} · {order.listing?.locationState}
                </p>
              </div>
            </div>
          </Panel>

          {order.status === 'AWAITING_PAYMENT' && isBuyer && (
            <Panel title="Delivery and payment">
              <CheckoutForm orderId={order.id} total={order.total} />
            </Panel>
          )}

          {order.trackingNumber && (
            <Panel title="Shipping">
              <dl className="space-y-2 p-5 text-sm">
                <Row label="Courier" value={order.courier ?? '—'} />
                <Row label="Tracking number" value={order.trackingNumber} mono />
                <Row label="Shipped" value={dateTime(order.shippedAt)} />
              </dl>
              {isBuyer && order.status === 'SHIPPED' && (
                <div className="border-t border-ink-200 p-5">
                  <ConfirmDeliveryButton orderId={order.id} />
                  <p className="mt-2 text-xs text-ink-500">
                    Confirming delivery releases the seller&apos;s payout. Do it once the item is
                    in your hands and as described.
                  </p>
                </div>
              )}
            </Panel>
          )}
        </div>

        <Panel title="Payment summary" className="h-fit">
          <dl className="space-y-2 p-5 text-sm">
            <Row label="Hammer price" value={formatMoney(order.hammerPrice)} />
            {order.buyerPremium > 0 && (
              <Row label="Buyer premium" value={formatMoney(order.buyerPremium)} />
            )}
            <Row
              label="Shipping"
              value={order.shippingCost > 0 ? formatMoney(order.shippingCost) : 'Free'}
            />
            <div className="border-t border-ink-200 pt-2">
              <Row label="Total" value={formatMoney(order.total)} strong />
            </div>
            {order.paymentMethod && <Row label="Paid with" value={order.paymentMethod} />}
            {order.dueAt && order.status === 'AWAITING_PAYMENT' && (
              <Row label="Pay by" value={dateTime(order.dueAt)} />
            )}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={`text-right ${strong ? 'text-base font-bold text-ink-900' : 'font-medium'} ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState, StatCard } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { ShipButton } from '@/components/ShipButton';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'Sales' };
export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const api = await serverClient();
  const sales = await api.orders.list({ role: 'selling', perPage: 40 });

  const toShip = sales.items.filter((o) => o.status === 'PAID' || o.status === 'AWAITING_SHIPMENT');
  const payout = sales.items
    .filter((o) => o.status === 'COMPLETED')
    .reduce((sum, o) => sum + o.sellerPayout, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Sales" value={String(sales.total)} />
        <StatCard
          label="Ready to ship"
          value={String(toShip.length)}
          tone={toShip.length > 0 ? 'warn' : 'default'}
        />
        <StatCard label="Paid out" value={formatMoney(payout)} tone="good" />
      </div>

      <Panel title="Your sales">
        <DataTable
          rows={sales.items}
          rowKey={(o) => o.id}
          empty={<EmptyState title="No sales yet" body="Sold items appear here with payout details." />}
          columns={[
            {
              key: 'item',
              header: 'Item',
              render: (o) => (
                <Link href={`/listing/${o.listing?.slug}`} className="flex items-center gap-3 hover:opacity-80">
                  {o.listing?.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.listing.image} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
                  )}
                  <span className="min-w-0">
                    <span className="block max-w-xs truncate font-medium">{o.listing?.title}</span>
                    <span className="block font-mono text-xs text-ink-500">{o.reference}</span>
                  </span>
                </Link>
              ),
            },
            { key: 'buyer', header: 'Buyer', render: (o) => o.buyer?.displayName ?? '—' },
            {
              key: 'hammer',
              header: 'Sold for',
              align: 'right',
              render: (o) => formatMoney(o.hammerPrice),
            },
            {
              key: 'payout',
              header: 'Your payout',
              align: 'right',
              render: (o) => <span className="font-semibold text-deal-700">{formatMoney(o.sellerPayout)}</span>,
            },
            { key: 'date', header: 'Sold', align: 'right', render: (o) => relativeTime(o.createdAt) },
            {
              key: 'status',
              header: 'Status',
              align: 'right',
              render: (o) =>
                o.status === 'PAID' || o.status === 'AWAITING_SHIPMENT' ? (
                  <ShipButton orderId={o.id} />
                ) : (
                  <span className={`badge ${statusTone(o.status)}`}>{o.status.replace(/_/g, ' ')}</span>
                ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

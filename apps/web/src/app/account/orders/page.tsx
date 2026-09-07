import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'Purchases' };
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const api = await serverClient();
  const orders = await api.orders.list({ role: 'buying', perPage: 40 });

  return (
    <Panel title={`${orders.total} purchases`}>
      <DataTable
        rows={orders.items}
        rowKey={(o) => o.id}
        empty={<EmptyState title="No purchases yet" body="Auctions you win appear here." />}
        columns={[
          {
            key: 'item',
            header: 'Item',
            render: (o) => (
              <Link href={`/account/orders/${o.id}`} className="flex items-center gap-3 hover:opacity-80">
                {o.listing?.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.listing.image} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
                )}
                <span className="min-w-0">
                  <span className="block max-w-xs truncate font-medium text-ink-900">
                    {o.listing?.title}
                  </span>
                  <span className="block font-mono text-xs text-ink-500">{o.reference}</span>
                </span>
              </Link>
            ),
          },
          { key: 'seller', header: 'Seller', render: (o) => o.seller?.displayName ?? '—' },
          {
            key: 'total',
            header: 'Total',
            align: 'right',
            render: (o) => <span className="font-semibold">{formatMoney(o.total)}</span>,
          },
          { key: 'date', header: 'Ordered', align: 'right', render: (o) => relativeTime(o.createdAt) },
          {
            key: 'status',
            header: 'Status',
            align: 'right',
            render: (o) => (
              <span className={`badge ${statusTone(o.status)}`}>{o.status.replace(/_/g, ' ')}</span>
            ),
          },
        ]}
      />
    </Panel>
  );
}

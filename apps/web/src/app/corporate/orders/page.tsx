import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState, StatCard } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { FilterTabs } from '@/components/FilterTabs';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'Corporate purchases' };
export const dynamic = 'force-dynamic';

const TABS = [
  ['', 'All'],
  ['AWAITING_PAYMENT', 'Awaiting payment'],
  ['AWAITING_SHIPMENT', 'On invoice'],
  ['SHIPPED', 'Shipped'],
  ['COMPLETED', 'Completed'],
] as const;

export default async function CorporateOrders({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const api = await serverClient();
  const orders = await api.corporate.orders({ ...params, perPage: 40 });

  const total = orders.items.reduce((sum, o) => sum + o.total, 0);
  const onInvoice = orders.items.filter((o) => o.paymentMethod === 'CORPORATE_INVOICE').length;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Purchases" value={String(orders.total)} />
        <StatCard label="Value on this page" value={formatMoney(total)} />
        <StatCard label="Billed to invoice" value={String(onInvoice)} />
      </div>

      <Panel title="Purchase history">
        <div className="border-b border-ink-200 px-5 py-3">
          <FilterTabs param="status" tabs={TABS.map(([v, l]) => ({ value: v, label: l }))} />
        </div>
        <DataTable
          rows={orders.items}
          rowKey={(o) => o.id}
          empty={<EmptyState title="No purchases" body="Auctions your team wins appear here." />}
          columns={[
            {
              key: 'item',
              header: 'Item',
              render: (o) => (
                <Link href={`/account/orders/${o.id}`} className="flex items-center gap-3 hover:opacity-80">
                  {o.listing?.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.listing.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
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
            { key: 'buyer', header: 'Bought by', render: (o) => o.buyer?.displayName ?? '—' },
            { key: 'seller', header: 'Supplier', render: (o) => o.seller?.displayName ?? '—' },
            {
              key: 'payment',
              header: 'Payment',
              render: (o) =>
                o.paymentMethod ? (
                  <span className="badge bg-ink-100 text-ink-700">
                    {o.paymentMethod.replace(/_/g, ' ').toLowerCase()}
                  </span>
                ) : (
                  <span className="text-ink-400">—</span>
                ),
            },
            {
              key: 'total',
              header: 'Total',
              align: 'right',
              render: (o) => <span className="font-semibold">{formatMoney(o.total)}</span>,
            },
            { key: 'when', header: 'Date', align: 'right', render: (o) => relativeTime(o.createdAt) },
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
    </div>
  );
}

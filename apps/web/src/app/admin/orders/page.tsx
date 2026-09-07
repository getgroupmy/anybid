import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { FilterTabs } from '@/components/FilterTabs';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'Orders · Admin' };
export const dynamic = 'force-dynamic';

const TABS = [
  ['', 'All'],
  ['AWAITING_PAYMENT', 'Awaiting payment'],
  ['PAID', 'Paid'],
  ['SHIPPED', 'Shipped'],
  ['COMPLETED', 'Completed'],
  ['DISPUTED', 'Disputed'],
] as const;

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const api = await serverClient();
  const orders = await api.admin.orders({ ...params, perPage: 30 });

  const gmv = orders.items.reduce((sum, o) => sum + o.hammerPrice, 0);
  const fees = orders.items.reduce((sum, o) => sum + o.platformFee, 0);

  return (
    <Panel title={`${orders.total} orders · ${formatMoney(gmv)} on this page (${formatMoney(fees)} fees)`}>
      <div className="border-b border-ink-200 px-5 py-3">
        <FilterTabs param="status" tabs={TABS.map(([v, l]) => ({ value: v, label: l }))} />
      </div>
      <DataTable
        rows={orders.items}
        rowKey={(o) => o.id}
        empty={<EmptyState title="No orders" body="Nothing matches this filter." />}
        columns={[
          {
            key: 'ref',
            header: 'Reference',
            render: (o) => (
              <span>
                <span className="block font-mono text-xs font-medium">{o.reference}</span>
                <span className="block max-w-xs truncate text-xs text-ink-500">
                  {o.listing?.title}
                </span>
              </span>
            ),
          },
          { key: 'buyer', header: 'Buyer', render: (o) => o.buyer?.displayName ?? '—' },
          { key: 'seller', header: 'Seller', render: (o) => o.seller?.displayName ?? '—' },
          {
            key: 'total',
            header: 'Total',
            align: 'right',
            render: (o) => <span className="font-semibold">{formatMoney(o.total)}</span>,
          },
          {
            key: 'fee',
            header: 'Platform fee',
            align: 'right',
            render: (o) => <span className="text-deal-700">{formatMoney(o.platformFee)}</span>,
          },
          { key: 'date', header: 'Placed', align: 'right', render: (o) => relativeTime(o.createdAt) },
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

import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { Countdown } from '@/components/Countdown';
import { formatMoney, statusTone } from '@/lib/format';

export const metadata = { title: 'My listings' };
export const dynamic = 'force-dynamic';

export default async function MyListingsPage() {
  const api = await serverClient();
  const listings = await api.listings.mine({ perPage: 40, status: 'ALL' });

  return (
    <Panel
      title={`${listings.total} listings`}
      action={
        <Link href="/sell" className="text-xs font-medium text-bid-600 hover:underline">
          List an item
        </Link>
      }
    >
      <DataTable
        rows={listings.items}
        rowKey={(l) => l.id}
        empty={
          <EmptyState
            title="You have not listed anything"
            body="Start an auction and let the market set the price."
          />
        }
        columns={[
          {
            key: 'item',
            header: 'Item',
            render: (l) => (
              <Link href={`/listing/${l.slug}`} className="flex items-center gap-3 hover:opacity-80">
                {l.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.image} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
                )}
                <span className="block max-w-xs truncate font-medium text-ink-900">{l.title}</span>
              </Link>
            ),
          },
          {
            key: 'price',
            header: 'Current',
            align: 'right',
            render: (l) => <span className="font-semibold">{formatMoney(l.currentPrice)}</span>,
          },
          { key: 'bids', header: 'Bids', align: 'right', render: (l) => l.bidCount },
          { key: 'watch', header: 'Watching', align: 'right', render: (l) => l.watchCount },
          {
            key: 'closes',
            header: 'Closes',
            align: 'right',
            render: (l) =>
              l.status === 'LIVE' ? <Countdown endsAt={l.endsAt} compact /> : <span className="text-ink-400">—</span>,
          },
          {
            key: 'status',
            header: 'Status',
            align: 'right',
            render: (l) => <span className={`badge ${statusTone(l.status)}`}>{l.status}</span>,
          },
        ]}
      />
    </Panel>
  );
}

import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { Countdown } from '@/components/Countdown';
import { formatMoney, relativeTime } from '@/lib/format';

export const metadata = { title: 'My bids' };
export const dynamic = 'force-dynamic';

export default async function BidsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const api = await serverClient();
  const bids = await api.bidding.myBids({ page: page ?? 1, perPage: 30 });

  return (
    <Panel title={`${bids.total} auctions you have bid on`}>
      <DataTable
        rows={bids.items}
        rowKey={(b) => b.id}
        empty={
          <EmptyState
            title="You have not bid on anything yet"
            body="Your maximum stays hidden — we only reveal enough to keep you in front."
          />
        }
        columns={[
          {
            key: 'item',
            header: 'Item',
            render: (b) => (
              <Link href={`/listing/${b.listing.slug}`} className="flex items-center gap-3 hover:opacity-80">
                {b.listing.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.listing.image} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
                )}
                <span className="min-w-0">
                  <span className="block max-w-xs truncate font-medium text-ink-900">
                    {b.listing.title}
                  </span>
                  <span className="block text-xs text-ink-500">
                    {b.listing.bidCount} bids · {relativeTime(b.createdAt)}
                  </span>
                </span>
              </Link>
            ),
          },
          {
            key: 'max',
            header: 'Your maximum',
            align: 'right',
            render: (b) => (
              <span className="font-mono text-xs text-ink-600">
                {formatMoney((b as unknown as { maxAmount: number }).maxAmount ?? b.amount)}
              </span>
            ),
          },
          {
            key: 'price',
            header: 'Current price',
            align: 'right',
            render: (b) => <span className="font-semibold">{formatMoney(b.listing.currentPrice)}</span>,
          },
          {
            key: 'time',
            header: 'Closes',
            align: 'right',
            render: (b) =>
              b.listing.status === 'LIVE' ? (
                <Countdown endsAt={b.listing.endsAt} compact />
              ) : (
                <span className="text-ink-400">Ended</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            align: 'right',
            render: (b) => {
              if (b.listing.status !== 'LIVE') {
                return (
                  <span className={`badge ${b.status === 'WON' ? 'bg-deal-100 text-deal-800' : 'bg-ink-100 text-ink-600'}`}>
                    {b.status === 'WON' ? 'Won' : 'Lost'}
                  </span>
                );
              }
              return b.listing.viewer?.isLeading ? (
                <span className="badge bg-deal-100 text-deal-800">Winning</span>
              ) : (
                <span className="badge bg-amber-100 text-amber-800">Outbid</span>
              );
            },
          },
        ]}
      />
    </Panel>
  );
}

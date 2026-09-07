import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { ModerateListing } from '@/components/AdminActions';
import { FilterTabs } from '@/components/FilterTabs';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'Listings · Admin' };
export const dynamic = 'force-dynamic';

const TABS = [
  ['', 'All'],
  ['LIVE', 'Live'],
  ['PENDING_REVIEW', 'Awaiting review'],
  ['SOLD', 'Sold'],
  ['SUSPENDED', 'Suspended'],
] as const;

export default async function AdminListings({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status, page } = await searchParams;
  const api = await serverClient();
  const listings = await api.admin.listings({ status, page: page ?? 1, perPage: 30 });

  return (
    <Panel title={`${listings.total} listings`}>
      <div className="border-b border-ink-200 px-5 py-3">
        <FilterTabs param="status" tabs={TABS.map(([v, l]) => ({ value: v, label: l }))} />
      </div>
      <DataTable
        rows={listings.items}
        rowKey={(l) => l.id}
        empty={<EmptyState title="Nothing here" body="No listings match this filter." />}
        columns={[
          {
            key: 'item',
            header: 'Listing',
            render: (l) => (
              <Link href={`/listing/${l.slug}`} className="flex items-center gap-3 hover:opacity-80">
                {l.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.image} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                )}
                <span className="min-w-0">
                  <span className="block max-w-xs truncate font-medium text-ink-900">{l.title}</span>
                  <span className="block text-xs text-ink-500">
                    {l.category.name} · {relativeTime(l.createdAt)}
                  </span>
                </span>
              </Link>
            ),
          },
          {
            key: 'seller',
            header: 'Seller',
            render: (l) => (
              <Link href={`/seller/${l.seller.handle}`} className="text-ink-700 hover:text-bid-600">
                {l.seller.displayName}
              </Link>
            ),
          },
          {
            key: 'price',
            header: 'Price',
            align: 'right',
            render: (l) => <span className="font-semibold">{formatMoney(l.currentPrice)}</span>,
          },
          { key: 'bids', header: 'Bids', align: 'right', render: (l) => l.bidCount },
          {
            key: 'status',
            header: 'Status',
            align: 'right',
            render: (l) => (
              <span className={`badge ${statusTone(l.status)}`}>
                {l.featured ? '★ ' : ''}
                {l.status}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (l) => <ModerateListing listingId={l.id} featured={l.featured} />,
          },
        ]}
      />
    </Panel>
  );
}

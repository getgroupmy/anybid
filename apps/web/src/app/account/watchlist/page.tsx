import { serverClient } from '@/lib/session';
import { ListingGrid } from '@/components/ListingCard';
import { Panel, EmptyState } from '@/components/ConsoleShell';

export const metadata = { title: 'Watchlist' };
export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  const api = await serverClient();
  const watchlist = await api.listings.watchlist({ perPage: 40 });

  if (watchlist.items.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="Your watchlist is empty"
          body="Watch an auction and we will tell you an hour before it closes."
        />
      </Panel>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-ink-500">
        {watchlist.total} watched — you will be alerted an hour before each one closes.
      </p>
      <ListingGrid listings={watchlist.items} />
    </div>
  );
}

import Link from 'next/link';
import { serverClient, readSession } from '@/lib/session';
import { StatCard, Panel, EmptyState } from '@/components/ConsoleShell';
import { ListingCard } from '@/components/ListingCard';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'My Account' };
export const dynamic = 'force-dynamic';

export default async function AccountOverview() {
  const api = await serverClient();
  const session = await readSession();
  const user = session!.user;

  const [bids, watchlist, orders, listings, notifications] = await Promise.all([
    api.bidding.myBids({ perPage: 6 }),
    api.listings.watchlist({ perPage: 5 }),
    api.orders.list({ perPage: 5 }),
    api.listings.mine({ perPage: 5 }),
    api.notifications.list({ perPage: 6 }),
  ]);

  const leading = bids.items.filter((b) => b.listing.viewer?.isLeading).length;
  const awaitingPayment = orders.items.filter((o) => o.status === 'AWAITING_PAYMENT').length;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Auctions I'm winning"
          value={String(leading)}
          hint={`out of ${bids.total} active bids`}
          tone={leading > 0 ? 'good' : 'default'}
          href="/account/bids"
        />
        <StatCard label="Watching" value={String(watchlist.total)} href="/account/watchlist" />
        <StatCard
          label="Awaiting payment"
          value={String(awaitingPayment)}
          tone={awaitingPayment > 0 ? 'warn' : 'default'}
          href="/account/orders"
        />
        <StatCard label="Store credit" value={formatMoney(user.balance)} hint="From completed sales" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Bids in play"
          action={
            <Link href="/account/bids" className="text-xs font-medium text-bid-600 hover:underline">
              See all
            </Link>
          }
        >
          {bids.items.length === 0 ? (
            <EmptyState
              title="No bids yet"
              body="Find something you want and set your maximum — we bid for you."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {bids.items.slice(0, 5).map((bid) => (
                <li key={bid.id}>
                  <Link
                    href={`/listing/${bid.listing.slug}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50"
                  >
                    {bid.listing.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={bid.listing.image} alt="" className="h-12 w-12 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink-900">
                        {bid.listing.title}
                      </div>
                      <div className="text-xs text-ink-500">
                        {formatMoney(bid.listing.currentPrice)} · {bid.listing.bidCount} bids
                      </div>
                    </div>
                    <span
                      className={`badge ${
                        bid.listing.viewer?.isLeading
                          ? 'bg-deal-100 text-deal-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {bid.listing.viewer?.isLeading ? 'Winning' : 'Outbid'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent activity"
          action={
            <Link
              href="/account/notifications"
              className="text-xs font-medium text-bid-600 hover:underline"
            >
              See all
            </Link>
          }
        >
          {notifications.items.length === 0 ? (
            <EmptyState title="Nothing yet" body="Outbid alerts and order updates land here." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {notifications.items.map((n) => (
                <li key={n.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink-900">{n.title}</div>
                      <div className="text-xs text-ink-500">{n.body}</div>
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-400">
                      {relativeTime(n.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Your listings"
        action={
          <Link href="/sell" className="text-xs font-medium text-bid-600 hover:underline">
            List an item
          </Link>
        }
      >
        {listings.items.length === 0 ? (
          <EmptyState title="Nothing listed" body="Turn what you no longer need into bids." />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
            {listings.items.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Recent purchases"
        action={
          <Link href="/account/orders" className="text-xs font-medium text-bid-600 hover:underline">
            See all
          </Link>
        }
      >
        {orders.items.length === 0 ? (
          <EmptyState title="No purchases yet" body="Auctions you win will show up here." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {orders.items.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/account/orders/${o.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{o.listing?.title}</div>
                    <div className="text-xs text-ink-500">
                      {o.reference} · {relativeTime(o.createdAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold">{formatMoney(o.total)}</span>
                    <span className={`badge ${statusTone(o.status)}`}>{o.status.replace(/_/g, ' ')}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

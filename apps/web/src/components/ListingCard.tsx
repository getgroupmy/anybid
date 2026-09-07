import Link from 'next/link';
import clsx from 'clsx';
import type { ListingSummary } from '@anybid/shared';
import { formatMoney } from '@/lib/format';
import { Countdown } from './Countdown';

export function ListingCard({ listing, className }: { listing: ListingSummary; className?: string }) {
  const isAuction = listing.kind !== 'BUY_NOW';
  const closed = listing.status !== 'LIVE';

  return (
    <Link
      href={`/listing/${listing.slug}`}
      className={clsx(
        'card group flex flex-col overflow-hidden transition hover:border-ink-300 hover:shadow-md',
        className,
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-ink-100">
        {listing.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-400">No photo</div>
        )}

        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {listing.featured && (
            <span className="badge bg-bid-600 text-white">Featured</span>
          )}
          {listing.hasReserve && !listing.reserveMet && (
            <span className="badge bg-white/90 text-ink-700">Reserve not met</span>
          )}
          {listing.kind === 'BUY_NOW' && (
            <span className="badge bg-deal-600 text-white">Buy now</span>
          )}
        </div>

        {closed && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-950/55">
            <span className="badge bg-white text-ink-900">
              {listing.status === 'SOLD' ? 'Sold' : 'Ended'}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink-900 group-hover:text-bid-700">
          {listing.title}
        </h3>

        <div className="mt-auto space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-500">
                {isAuction ? (listing.bidCount > 0 ? 'Current bid' : 'Starting bid') : 'Price'}
              </div>
              <div className="text-base font-bold text-ink-900">
                {formatMoney(listing.currentPrice)}
              </div>
            </div>
            {isAuction && (
              <div className="text-right text-xs text-ink-500">
                {listing.bidCount} {listing.bidCount === 1 ? 'bid' : 'bids'}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-ink-500">
            <span className="truncate">{listing.locationState ?? 'Malaysia'}</span>
            {isAuction && listing.status === 'LIVE' && (
              <Countdown endsAt={listing.endsAt} compact />
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ListingGrid({ listings }: { listings: ListingSummary[] }) {
  if (listings.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-ink-500">
        Nothing here yet. Try a different filter or search.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} />
      ))}
    </div>
  );
}

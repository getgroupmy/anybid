import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverClient, readSession } from '@/lib/session';
import { BidPanel } from '@/components/BidPanel';
import { ImageGallery } from '@/components/ImageGallery';
import { WatchButton } from '@/components/WatchButton';
import { ListingCard } from '@/components/ListingCard';
import { AdSlot } from '@/components/AdSlot';
import { dateTime, formatMoney, relativeTime, statusTone } from '@/lib/format';
import { ApiError } from '@anybid/shared';

export const dynamic = 'force-dynamic';

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like new',
  GOOD: 'Good',
  FAIR: 'Fair',
  FOR_PARTS: 'For parts or not working',
  REFURBISHED: 'Refurbished',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const api = await serverClient();
    const { listing } = await api.listings.get(slug);
    return {
      title: listing.title,
      description: listing.description.slice(0, 155),
      openGraph: { images: listing.image ? [listing.image] : [] },
    };
  } catch {
    return { title: 'Listing' };
  }
}

export default async function ListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const api = await serverClient();
  const session = await readSession();

  let listing;
  try {
    listing = (await api.listings.get(slug)).listing;
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  const similar = await api.listings.similar(listing.id).catch(() => ({ items: [] }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <Link href="/" className="hover:text-bid-600">
          Home
        </Link>
        <span>/</span>
        <Link href={`/category/${listing.category.slug}`} className="hover:text-bid-600">
          {listing.category.name}
        </Link>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <ImageGallery images={listing.images} title={listing.title} />

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`badge ${statusTone(listing.status)}`}>{listing.status}</span>
              <span className="badge bg-ink-100 text-ink-700">
                {CONDITION_LABELS[listing.condition] ?? listing.condition}
              </span>
              {listing.tags.slice(0, 4).map((t) => (
                <Link
                  key={t}
                  href={`/search?q=${encodeURIComponent(t)}`}
                  className="badge bg-ink-100 text-ink-600 hover:bg-ink-200"
                >
                  #{t}
                </Link>
              ))}
            </div>

            <h1 className="text-2xl font-bold leading-tight text-ink-900">{listing.title}</h1>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-500">
              <span>{listing.viewCount.toLocaleString()} views</span>
              <span>{listing.watchCount} watching</span>
              <span>Listed {relativeTime(listing.createdAt)}</span>
              {listing.locationState && (
                <span>
                  {listing.locationCity ? `${listing.locationCity}, ` : ''}
                  {listing.locationState}
                </span>
              )}
            </div>
          </div>

          <section className="card p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Description</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-700">
              {listing.description.split('\n\n').map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
              Item details
            </h2>
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Detail label="Condition" value={CONDITION_LABELS[listing.condition] ?? listing.condition} />
              <Detail label="Quantity" value={String(listing.quantity)} />
              <Detail label="Starting price" value={formatMoney(listing.startPrice)} />
              <Detail
                label="Bid increment"
                value={listing.bidIncrement ? formatMoney(listing.bidIncrement) : 'Automatic (tiered)'}
              />
              <Detail
                label="Shipping"
                value={listing.shippingCost > 0 ? formatMoney(listing.shippingCost) : 'Free'}
              />
              <Detail label="Local pickup" value={listing.localPickup ? 'Available' : 'Not available'} />
              <Detail
                label="Anti-snipe"
                value={
                  listing.antiSnipeWindowSec > 0
                    ? `Bids in the last ${listing.antiSnipeWindowSec / 60} min extend by ${
                        listing.antiSnipeExtensionSec / 60
                      } min`
                    : 'Off'
                }
              />
              <Detail label="Closes" value={dateTime(listing.endsAt)} />
            </dl>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
                Bid history
              </h2>
              <span className="text-sm text-ink-500">{listing.bidCount} bids</span>
            </div>

            {listing.bids.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">
                No bids yet — be the first to open this auction.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="table-head">
                      <th className="px-3 py-2">Bidder</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-right">When</th>
                      <th className="px-3 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {listing.bids.map((b) => (
                      <tr key={b.id}>
                        <td className="px-3 py-2 font-mono text-xs text-ink-600">{b.bidder.masked}</td>
                        <td className="px-3 py-2 text-right font-semibold">{formatMoney(b.amount)}</td>
                        <td className="px-3 py-2 text-right text-ink-500">{relativeTime(b.createdAt)}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`badge ${statusTone(b.status)}`}>{b.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-ink-400">
                  Bidder identities are masked. Maximum bids stay private until they are needed.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <BidPanel listing={listing} viewer={session?.user ?? null} />

          <WatchButton
            listingId={listing.id}
            initialWatching={listing.viewer?.watching ?? false}
            initialCount={listing.watchCount}
            authenticated={Boolean(session)}
          />

          <div className="card p-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-500">Seller</h2>
            <Link
              href={`/seller/${listing.seller.handle}`}
              className="mt-3 flex items-center gap-3 hover:opacity-80"
            >
              {listing.seller.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={listing.seller.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-full bg-ink-200 font-bold">
                  {listing.seller.displayName.charAt(0)}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold">{listing.seller.displayName}</span>
                  {listing.seller.verified && (
                    <span className="badge bg-deal-100 px-1.5 py-0.5 text-deal-700">Verified</span>
                  )}
                </div>
                <div className="text-xs text-ink-500">
                  {listing.seller.ratingCount > 0
                    ? `★ ${listing.seller.ratingAvg.toFixed(1)} · ${listing.seller.ratingCount} reviews`
                    : 'No reviews yet'}
                </div>
              </div>
            </Link>
            <div className="mt-3 text-xs text-ink-500">
              Member since {relativeTime(listing.seller.createdAt)}
            </div>
          </div>

          <AdSlot placement="LISTING_SIDEBAR" categoryId={listing.category.id} query={listing.tags.join(' ')} />
        </div>
      </div>

      {similar.items.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-bold text-ink-900">Similar auctions</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {similar.items.slice(0, 5).map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ink-100 pb-2 sm:border-none sm:pb-0">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

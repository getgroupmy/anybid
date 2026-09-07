import { notFound } from 'next/navigation';
import { serverClient } from '@/lib/session';
import { ListingGrid } from '@/components/ListingCard';
import { relativeTime } from '@/lib/format';
import { ServiceUnavailable } from '@/components/ServiceUnavailable';
import { ApiError } from '@anybid/shared';

export const dynamic = 'force-dynamic';

export default async function SellerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const api = await serverClient();

  let data;
  try {
    data = await api.users.profile(handle);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <ServiceUnavailable what="Seller profiles" />
      </div>
    );
  }

  const { user, listings } = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="card flex flex-wrap items-center gap-5 p-6">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <span className="grid h-20 w-20 place-items-center rounded-full bg-ink-200 text-2xl font-bold">
            {user.displayName.charAt(0)}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-ink-900">{user.displayName}</h1>
            {user.verified && <span className="badge bg-deal-100 text-deal-700">Verified</span>}
          </div>
          <p className="text-sm text-ink-500">@{user.handle}</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-600">
            <span>
              {user.ratingCount > 0
                ? `★ ${user.ratingAvg.toFixed(1)} from ${user.ratingCount} reviews`
                : 'No reviews yet'}
            </span>
            {user.state && <span>{user.city ? `${user.city}, ` : ''}{user.state}</span>}
            <span>Joined {relativeTime(user.createdAt)}</span>
          </div>
        </div>
      </div>

      <h2 className="mb-4 mt-8 text-lg font-bold text-ink-900">
        Listings from {user.displayName}
      </h2>
      <ListingGrid listings={listings} />
    </div>
  );
}

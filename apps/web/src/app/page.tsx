import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { ListingCard, ListingGrid } from '@/components/ListingCard';
import { AdSlot } from '@/components/AdSlot';
import { ServiceUnavailable } from '@/components/ServiceUnavailable';
import { orNull } from '@/lib/resilient';
import { formatMoney } from '@/lib/format';
import type { Category, ListingSummary } from '@anybid/shared';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const api = await serverClient();

  // Each call degrades on its own. Without this a single unreachable
  // dependency replaces the entire home page with an error boundary.
  const [endingSoon, featured, newest, categories, stats] = await Promise.all([
    orNull(api.listings.search({ sort: 'ending_soon', perPage: 10, status: 'LIVE', endingWithinHours: 48 })),
    orNull(api.listings.search({ sort: 'relevance', perPage: 5, status: 'LIVE' })),
    orNull(api.listings.search({ sort: 'newest', perPage: 10, status: 'LIVE' })),
    orNull(api.categories.tree()),
    orNull(
      api.request<{ liveListings: number; bids: number; users: number; gmv: number }>('/v1/stats', {
        method: 'GET',
        auth: false,
      }),
    ),
  ]);

  const marketplaceDown = endingSoon === null && newest === null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ink-900 via-ink-800 to-bid-800 px-6 py-10 text-white sm:px-10 sm:py-14">
          <h1 className="max-w-xl text-3xl font-bold leading-tight sm:text-4xl">
            Every listing is an auction. Name your maximum and let it bid for you.
          </h1>
          <p className="mt-3 max-w-lg text-sm text-white/80 sm:text-base">
            Proxy bidding means you never pay more than one increment above the runner-up. Anti-sniping
            means a last-second bid can always be answered.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/search?endingWithinHours=24" className="btn bg-white text-ink-900 hover:bg-ink-100">
              Ending in 24 hours
            </Link>
            <Link href="/sell" className="btn border border-white/40 text-white hover:bg-white/10">
              Sell an item
            </Link>
          </div>

          {stats && (
            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-sm">
              <Stat label="Live auctions" value={stats.liveListings.toLocaleString()} />
              <Stat label="Bids placed" value={stats.bids.toLocaleString()} />
              <Stat label="Traded" value={formatMoney(stats.gmv)} />
            </dl>
          )}
        </div>

        <AdSlot placement="HOME_HERO" className="hidden lg:block" />
      </section>

      {marketplaceDown ? (
        <div className="mt-10">
          <ServiceUnavailable />
        </div>
      ) : (
        <Section
          title="Ending soon"
          subtitle="The clock is the whole point — these close within 48 hours."
          href="/search?sort=ending_soon"
        >
          <ListingGrid listings={endingSoon?.items ?? []} />
        </Section>
      )}

      {(categories?.categories.length ?? 0) > 0 && (
      <section className="mt-10">
        <h2 className="text-lg font-bold text-ink-900">Browse by category</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(categories?.categories ?? []).map((c: Category) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className="card flex flex-col items-center gap-2 p-4 text-center transition hover:border-bid-300 hover:shadow-md"
            >
              <span className="text-2xl">{c.icon}</span>
              <span className="text-sm font-medium text-ink-900">{c.name}</span>
              <span className="text-xs text-ink-500">{c.listingCount ?? 0} live</span>
            </Link>
          ))}
        </div>
      </section>
      )}

      {(featured?.items.length ?? 0) > 0 && (
        <Section title="Featured" subtitle="Promoted by sellers and hand-picked by our team.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(featured?.items ?? []).slice(0, 3).map((l: ListingSummary) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </Section>
      )}

      {!marketplaceDown && (
        <Section title="Just listed" href="/search?sort=newest">
          <ListingGrid listings={newest?.items ?? []} />
        </Section>
      )}

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Explainer
          title="Bid your maximum, once"
          body="Set the most you will pay. AnyBid raises your bid one increment at a time only when someone pushes you, and stops at your limit."
        />
        <Explainer
          title="No last-second theft"
          body="A bid in the final two minutes pushes the close out by two more, so the winner is whoever wanted it most — not whoever had the fastest connection."
        />
        <Explainer
          title="Reserve when it matters"
          body="Sellers can set a hidden floor. The price only jumps to the reserve once a bid clears it, and nothing sells below it."
        />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-white/60">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
    </div>
  );
}

function Section({
  title,
  subtitle,
  href,
  children,
}: {
  title: string;
  subtitle?: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-sm font-medium text-bid-600 hover:underline">
            See all →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Explainer({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold text-ink-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}

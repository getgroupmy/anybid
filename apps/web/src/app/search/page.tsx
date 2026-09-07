import { Suspense } from 'react';
import { serverClient } from '@/lib/session';
import { ListingGrid } from '@/components/ListingCard';
import { SearchFilters } from '@/components/SearchFilters';
import { Pagination } from '@/components/Pagination';
import { AdSlot } from '@/components/AdSlot';
import { plural } from '@/lib/format';
import { ServiceUnavailable } from '@/components/ServiceUnavailable';
import { emptyPage, orNull } from '@/lib/resilient';
import type { ListingSummary } from '@anybid/shared';

export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : null;
  return { title: q ? `${q} — search results` : 'Search auctions' };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const api = await serverClient();

  const query = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === 'string' && v !== ''),
  ) as Record<string, string>;

  const [found, categories] = await Promise.all([
    orNull(api.listings.search({ ...query, perPage: 24 })),
    orNull(api.categories.tree()),
  ]);
  const results = found ?? emptyPage<ListingSummary>();

  const q = typeof params.q === 'string' ? params.q : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-ink-200" />}>
            <SearchFilters categories={categories?.categories ?? []} />
          </Suspense>
          <AdSlot placement="SEARCH_INLINE" className="mt-6 hidden lg:block" query={q ?? undefined} />
        </div>

        <div>
          <div className="mb-4">
            <h1 className="text-xl font-bold text-ink-900">
              {q ? `Results for “${q}”` : 'All live auctions'}
            </h1>
            {found !== null && (
              <p className="mt-0.5 text-sm text-ink-500">{plural(results.total, 'listing')}</p>
            )}
          </div>

          {found === null ? <ServiceUnavailable /> : <ListingGrid listings={results.items} />}

          <Suspense>
            <Pagination page={results.page} totalPages={results.totalPages} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

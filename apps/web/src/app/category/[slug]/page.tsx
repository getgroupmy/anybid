import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverClient } from '@/lib/session';
import { ListingGrid } from '@/components/ListingCard';
import { Pagination } from '@/components/Pagination';
import { AdSlot } from '@/components/AdSlot';
import { plural } from '@/lib/format';
import { Suspense } from 'react';
import type { Category } from '@anybid/shared';

export const dynamic = 'force-dynamic';

function findCategory(tree: Category[], slug: string): { node: Category; parent: Category | null } | null {
  for (const parent of tree) {
    if (parent.slug === slug) return { node: parent, parent: null };
    for (const child of parent.children ?? []) {
      if (child.slug === slug) return { node: child, parent };
    }
  }
  return null;
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const api = await serverClient();

  const { categories } = await api.categories.tree();
  const found = findCategory(categories, slug);
  if (!found) notFound();

  const query = Object.fromEntries(
    Object.entries(search).filter(([, v]) => typeof v === 'string' && v !== ''),
  ) as Record<string, string>;

  const results = await api.listings.search({
    ...query,
    categorySlug: slug,
    perPage: 24,
    sort: query.sort ?? 'ending_soon',
  });

  const siblings = found.parent?.children ?? found.node.children ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <nav className="mb-3 flex items-center gap-2 text-sm text-ink-500">
        <Link href="/" className="hover:text-bid-600">
          Home
        </Link>
        {found.parent && (
          <>
            <span>/</span>
            <Link href={`/category/${found.parent.slug}`} className="hover:text-bid-600">
              {found.parent.name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-ink-900">{found.node.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-ink-900">
        {found.node.icon} {found.node.name}
      </h1>
      <p className="mt-0.5 text-sm text-ink-500">{plural(results.total, 'live listing')}</p>

      {siblings.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {siblings.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className={
                c.slug === slug
                  ? 'rounded-full bg-bid-600 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-700 hover:border-bid-400'
              }
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <AdSlot placement="CATEGORY_BANNER" categoryId={found.node.id} className="mt-6" />

      <div className="mt-6">
        <ListingGrid listings={results.items} />
        <Suspense>
          <Pagination page={results.page} totalPages={results.totalPages} />
        </Suspense>
      </div>
    </div>
  );
}

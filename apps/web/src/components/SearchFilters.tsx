'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { Category } from '@anybid/shared';

const SORTS = [
  ['ending_soon', 'Ending soonest'],
  ['newest', 'Newly listed'],
  ['most_bids', 'Most bids'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
] as const;

const CONDITIONS = [
  ['NEW', 'New'],
  ['LIKE_NEW', 'Like new'],
  ['GOOD', 'Good'],
  ['FAIR', 'Fair'],
  ['REFURBISHED', 'Refurbished'],
  ['FOR_PARTS', 'For parts'],
] as const;

const STATES = [
  'Kuala Lumpur',
  'Selangor',
  'Penang',
  'Johor',
  'Perak',
  'Sabah',
  'Sarawak',
];

export function SearchFilters({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  const activeCount = ['categorySlug', 'condition', 'state', 'kind', 'minPrice', 'maxPrice', 'endingWithinHours']
    .filter((k) => params.get(k))
    .length;

  return (
    <aside className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink-900">Filters</h2>
        {activeCount > 0 && (
          <button
            type="button"
            className="text-xs font-medium text-bid-600 hover:underline"
            onClick={() => router.push(pathname + (params.get('q') ? `?q=${params.get('q')}` : ''))}
          >
            Clear {activeCount}
          </button>
        )}
      </div>

      <Field label="Sort by">
        <select
          className="input"
          value={params.get('sort') ?? 'ending_soon'}
          onChange={(e) => setParam('sort', e.target.value)}
        >
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Category">
        <select
          className="input"
          value={params.get('categorySlug') ?? ''}
          onChange={(e) => setParam('categorySlug', e.target.value || null)}
        >
          <option value="">All categories</option>
          {categories.map((parent) => (
            <optgroup key={parent.id} label={`${parent.icon ?? ''} ${parent.name}`}>
              <option value={parent.slug}>All {parent.name}</option>
              {(parent.children ?? []).map((child) => (
                <option key={child.id} value={child.slug}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      <Field label="Listing type">
        <select
          className="input"
          value={params.get('kind') ?? ''}
          onChange={(e) => setParam('kind', e.target.value || null)}
        >
          <option value="">Auctions and fixed price</option>
          <option value="AUCTION">Auction only</option>
          <option value="AUCTION_WITH_BUY_NOW">Auction with buy now</option>
          <option value="BUY_NOW">Fixed price only</option>
        </select>
      </Field>

      <Field label="Condition">
        <select
          className="input"
          value={params.get('condition') ?? ''}
          onChange={(e) => setParam('condition', e.target.value || null)}
        >
          <option value="">Any condition</option>
          {CONDITIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Location">
        <select
          className="input"
          value={params.get('state') ?? ''}
          onChange={(e) => setParam('state', e.target.value || null)}
        >
          <option value="">Anywhere in Malaysia</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Price range (RM)">
        <div className="flex items-center gap-2">
          <input
            className="input"
            inputMode="numeric"
            placeholder="Min"
            defaultValue={params.get('minPrice') ? Number(params.get('minPrice')) / 100 : ''}
            onBlur={(e) =>
              setParam('minPrice', e.target.value ? String(Math.round(Number(e.target.value) * 100)) : null)
            }
          />
          <span className="text-ink-400">–</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="Max"
            defaultValue={params.get('maxPrice') ? Number(params.get('maxPrice')) / 100 : ''}
            onBlur={(e) =>
              setParam('maxPrice', e.target.value ? String(Math.round(Number(e.target.value) * 100)) : null)
            }
          />
        </div>
      </Field>

      <Field label="Closing within">
        <select
          className="input"
          value={params.get('endingWithinHours') ?? ''}
          onChange={(e) => setParam('endingWithinHours', e.target.value || null)}
        >
          <option value="">Any time</option>
          <option value="1">1 hour</option>
          <option value="6">6 hours</option>
          <option value="24">24 hours</option>
          <option value="72">3 days</option>
        </select>
      </Field>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

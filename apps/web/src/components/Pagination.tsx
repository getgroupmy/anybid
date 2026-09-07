'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function Pagination({ page, totalPages }: { page: number; totalPages: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (totalPages <= 1) return null;

  function go(p: number) {
    const next = new URLSearchParams(params.toString());
    next.set('page', String(p));
    router.push(`${pathname}?${next.toString()}`);
  }

  const window = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2,
  );

  return (
    <nav className="mt-8 flex items-center justify-center gap-1" aria-label="Pagination">
      <button
        type="button"
        className="btn-secondary px-3 py-2"
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        Previous
      </button>
      {window.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && window[i - 1] !== p - 1 && <span className="px-1 text-ink-400">…</span>}
          <button
            type="button"
            onClick={() => go(p)}
            aria-current={p === page ? 'page' : undefined}
            className={
              p === page
                ? 'rounded-lg bg-bid-600 px-3.5 py-2 text-sm font-semibold text-white'
                : 'rounded-lg px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100'
            }
          >
            {p}
          </button>
        </span>
      ))}
      <button
        type="button"
        className="btn-secondary px-3 py-2"
        disabled={page >= totalPages}
        onClick={() => go(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

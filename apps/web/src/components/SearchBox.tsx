'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import clsx from 'clsx';

export function SearchBox({ className }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  return (
    <form
      className={clsx('relative', className)}
      onSubmit={(e) => {
        e.preventDefault();
        router.push(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : '/search');
      }}
      role="search"
    >
      <input
        className="input pl-9"
        placeholder="Search auctions — iPhone, Rolex, Myvi…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search listings"
      />
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
          clipRule="evenodd"
        />
      </svg>
    </form>
  );
}

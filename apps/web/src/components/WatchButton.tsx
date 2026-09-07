'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { browserClient } from '@/lib/client';

export function WatchButton({
  listingId,
  initialWatching,
  initialCount,
  authenticated,
}: {
  listingId: string;
  initialWatching: boolean;
  initialCount: number;
  authenticated: boolean;
}) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!authenticated) {
      router.push('/login');
      return;
    }
    setBusy(true);
    // Optimistic — the API result reconciles the count.
    const next = !watching;
    setWatching(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = next
        ? await browserClient.listings.watch(listingId)
        : await browserClient.listings.unwatch(listingId);
      setWatching(res.watching);
      setCount(res.watchCount);
    } catch {
      setWatching(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={clsx(
        'btn w-full border',
        watching
          ? 'border-bid-300 bg-bid-50 text-bid-700'
          : 'border-ink-300 bg-white text-ink-800 hover:bg-ink-100',
      )}
      aria-pressed={watching}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill={watching ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M10 17s-6-4.35-6-8.5A3.5 3.5 0 0110 6a3.5 3.5 0 016 2.5C16 12.65 10 17 10 17z" />
      </svg>
      {watching ? 'Watching' : 'Watch'}
      <span className="text-xs opacity-70">({count})</span>
    </button>
  );
}

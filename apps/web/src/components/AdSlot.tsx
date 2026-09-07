'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { AdPlacement, ServedAd } from '@anybid/shared';
import { browserClient } from '@/lib/client';

interface Props {
  placement: AdPlacement;
  categoryId?: string;
  query?: string;
  className?: string;
}

/**
 * A sponsored slot. Ads are fetched client-side so an empty ad auction never
 * delays the page, and clicks route through the API so they are billed.
 */
export function AdSlot({ placement, categoryId, query, className }: Props) {
  const [ad, setAd] = useState<ServedAd | null>(null);

  useEffect(() => {
    let cancelled = false;
    browserClient.ads
      .serve(placement, { categoryId, q: query, limit: 1 })
      .then((res) => {
        if (!cancelled) setAd(res.ads[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [placement, categoryId, query]);

  if (!ad) return null;

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    if (!ad) return;
    try {
      const { redirectUrl } = await browserClient.ads.click(ad.slotId);
      window.open(redirectUrl, '_blank', 'noopener,noreferrer');
    } catch {
      window.open(ad.ctaUrl, '_blank', 'noopener,noreferrer');
    }
  }

  const banner = placement === 'HOME_HERO' || placement === 'CATEGORY_BANNER';

  return (
    <a
      href={ad.ctaUrl}
      onClick={onClick}
      className={clsx(
        'card group relative block overflow-hidden transition hover:border-ink-300 hover:shadow-md',
        className,
      )}
    >
      <span className="absolute right-2 top-2 z-10 rounded bg-ink-950/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
        Sponsored
      </span>

      <div className={clsx('overflow-hidden bg-ink-100', banner ? 'aspect-[3/1]' : 'aspect-[4/3]')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ad.imageUrl}
          alt=""
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
        />
      </div>

      <div className="p-3">
        <div className="text-sm font-semibold text-ink-900">{ad.headline}</div>
        {ad.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{ad.body}</p>}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs font-medium text-bid-600">{ad.ctaLabel} →</span>
          <span className="truncate text-[11px] text-ink-400">{ad.advertiserName}</span>
        </div>
      </div>
    </a>
  );
}

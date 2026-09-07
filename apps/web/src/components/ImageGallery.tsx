'use client';

import { useState } from 'react';
import clsx from 'clsx';

export function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = useState(0);
  const current = images[active] ?? images[0];

  return (
    <div className="space-y-3">
      <div className="card aspect-[4/3] overflow-hidden bg-ink-100">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-ink-400">No photo</div>
        )}
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-5 gap-2">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View photo ${i + 1}`}
              className={clsx(
                'aspect-square overflow-hidden rounded-lg border-2 bg-ink-100 transition',
                i === active ? 'border-bid-500' : 'border-transparent hover:border-ink-300',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { formatMoneyCompact } from '@/lib/format';

export interface SeriesPoint {
  date: string;
  gmv: number;
  bids: number;
  newUsers: number;
}

type Metric = 'gmv' | 'bids' | 'newUsers';

const METRICS: { key: Metric; label: string; format: (v: number) => string; color: string }[] = [
  { key: 'gmv', label: 'GMV', format: (v) => formatMoneyCompact(v), color: '#ef3307' },
  { key: 'bids', label: 'Bids', format: (v) => v.toLocaleString(), color: '#178253' },
  { key: 'newUsers', label: 'New users', format: (v) => v.toLocaleString(), color: '#4f5e7a' },
];

/**
 * A bar chart drawn as plain SVG — no charting dependency for what is
 * fundamentally fourteen rectangles.
 */
export function ActivityChart({ data }: { data: SeriesPoint[] }) {
  const [metric, setMetric] = useState<Metric>('gmv');
  const active = METRICS.find((m) => m.key === metric)!;
  const values = data.map((d) => d[metric]);
  const max = Math.max(1, ...values);

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            className={
              m.key === metric
                ? 'rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white'
                : 'rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100'
            }
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex h-44 items-end gap-1">
        {data.map((point) => {
          const value = point[metric];
          const height = (value / max) * 100;
          return (
            <div key={point.date} className="group relative flex flex-1 flex-col items-center gap-1">
              <div className="relative flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${Math.max(2, height)}%`,
                    backgroundColor: active.color,
                    opacity: value === 0 ? 0.2 : 0.85,
                  }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-900 px-2 py-1 text-[11px] text-white group-hover:block">
                  {active.format(value)} · {point.date.slice(5)}
                </div>
              </div>
              <span className="text-[9px] text-ink-400">{point.date.slice(8)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-500">Last {data.length} days · hover for values</p>
    </div>
  );
}

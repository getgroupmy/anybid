'use client';

import { useState } from 'react';
import { formatMoneyCompact } from '@/lib/format';

export interface ReportRow {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
}

type Metric = 'impressions' | 'clicks' | 'spend';

const METRICS: { key: Metric; label: string; format: (v: number) => string }[] = [
  { key: 'impressions', label: 'Impressions', format: (v) => v.toLocaleString() },
  { key: 'clicks', label: 'Clicks', format: (v) => v.toLocaleString() },
  { key: 'spend', label: 'Spend', format: (v) => formatMoneyCompact(v) },
];

/** A line chart as an SVG polyline — the shape is the point, not the library. */
export function AdPerformanceChart({ rows }: { rows: ReportRow[] }) {
  const [metric, setMetric] = useState<Metric>('impressions');
  const active = METRICS.find((m) => m.key === metric)!;

  if (rows.length === 0) {
    return (
      <div className="px-5 py-12 text-center text-sm text-ink-500">
        No delivery data yet — the chart fills in once your campaigns start serving.
      </div>
    );
  }

  const values = rows.map((r) => r[metric]);
  const max = Math.max(1, ...values);
  const width = 100;
  const height = 40;
  const step = rows.length > 1 ? width / (rows.length - 1) : width;

  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(' ');
  const area = `0,${height} ${points} ${((rows.length - 1) * step).toFixed(2)},${height}`;

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
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
        <div className="text-sm">
          <span className="text-ink-500">Total </span>
          <span className="font-bold text-ink-900">
            {active.format(values.reduce((a, b) => a + b, 0))}
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label={`${active.label} over time`}>
        <polygon points={area} fill="#fe4d11" opacity="0.12" />
        <polyline
          points={points}
          fill="none"
          stroke="#ef3307"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </svg>

      <div className="mt-2 flex justify-between text-[11px] text-ink-400">
        <span>{rows[0]?.date}</span>
        <span>{rows[rows.length - 1]?.date}</span>
      </div>
    </div>
  );
}

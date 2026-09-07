'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';

export function CampaignStatusToggle({
  campaignId,
  status,
}: {
  campaignId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canActivate = status !== 'ACTIVE' && status !== 'PENDING_REVIEW' && status !== 'REJECTED';
  if (!canActivate && status !== 'ACTIVE') return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await browserClient.advertiser.setCampaignStatus(
        campaignId,
        status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={toggle} disabled={busy}>
        {status === 'ACTIVE' ? 'Pause' : 'Activate'}
      </button>
      {error && <span className="max-w-[12rem] text-right text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

export function TopUpForm({ balance }: { balance: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('100');

  async function topUp() {
    setBusy(true);
    setError(null);
    try {
      await browserClient.advertiser.topUp({
        amount: Math.round(Number(amount) * 100),
        method: 'FPX',
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Top-up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap gap-2">
        {[100, 250, 500, 1000].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(String(v))}
            className={
              amount === String(v)
                ? 'rounded-lg bg-bid-600 px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-lg border border-ink-300 px-3 py-1.5 text-sm text-ink-700 hover:border-bid-400'
            }
          >
            RM{v}
          </button>
        ))}
      </div>

      <div>
        <span className="label">Amount (RM)</span>
        <input
          className="input max-w-xs"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="button" className="btn-primary" onClick={topUp} disabled={busy}>
        {busy ? 'Processing…' : `Top up RM${amount}`}
      </button>
      <p className="text-xs text-ink-500">
        Current balance {(balance / 100).toFixed(2)} MYR. Payment is simulated in this environment.
      </p>
    </div>
  );
}

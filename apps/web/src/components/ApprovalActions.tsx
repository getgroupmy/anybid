'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';
import { formatMoney } from '@/lib/format';

export function ApprovalActions({ approvalId, amount }: { approvalId: string; amount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function decide(decision: 'APPROVE' | 'REJECT') {
    setBusy(true);
    setError(null);
    try {
      await browserClient.corporate.decide(approvalId, { decision, note: note || undefined });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full shrink-0 space-y-2 sm:w-56">
      <input
        className="input text-sm"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary w-full"
        disabled={busy}
        onClick={() => decide('APPROVE')}
      >
        {busy ? 'Working…' : `Approve ${formatMoney(amount)}`}
      </button>
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={busy}
        onClick={() => decide('REJECT')}
      >
        Decline
      </button>
      <p className="text-[11px] text-ink-500">
        Approving places the bid immediately at the requested maximum.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';

const COURIERS = ['J&T Express', 'Pos Laju', 'Ninja Van', 'DHL eCommerce', 'City-Link', 'Skynet'];

export function ShipButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await browserClient.orders.ship(orderId, {
        courier: String(form.get('courier')),
        trackingNumber: String(form.get('trackingNumber')),
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark as shipped');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>
        Mark shipped
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-2 text-left">
      <select name="courier" className="input py-1.5 text-xs" required>
        {COURIERS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        name="trackingNumber"
        className="input py-1.5 text-xs"
        placeholder="Tracking number"
        required
        minLength={3}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
      <div className="flex gap-1">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn-primary px-3 py-1 text-xs" disabled={busy}>
          {busy ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </form>
  );
}

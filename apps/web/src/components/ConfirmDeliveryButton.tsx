'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';

export function ConfirmDeliveryButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await browserClient.orders.confirmDelivery(orderId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm delivery');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-primary w-full" onClick={confirm} disabled={busy}>
        {busy ? 'Confirming…' : 'I have received this item'}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

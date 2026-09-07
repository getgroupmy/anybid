'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';
import { formatMoney } from '@/lib/format';

const METHODS = [
  ['FPX', 'Online banking (FPX)'],
  ['CARD', 'Credit or debit card'],
  ['EWALLET', 'E-wallet'],
  ['CORPORATE_INVOICE', 'Company invoice'],
] as const;

const STATES = ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor', 'Perak', 'Sabah', 'Sarawak'];

export function CheckoutForm({ orderId, total }: { orderId: string; total: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const form = new FormData(e.currentTarget);

    try {
      await browserClient.orders.checkout(orderId, Object.fromEntries(form));
      router.refresh();
    } catch (err) {
      const apiErr = err as { message?: string; fieldErrors?: Record<string, string> };
      setError(apiErr.message ?? 'Payment could not be completed');
      if (apiErr.fieldErrors) setFieldErrors(apiErr.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 p-5" onSubmit={onSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={fieldErrors.shippingName}>
          <input name="shippingName" className="input" required autoComplete="name" />
        </Field>
        <Field label="Phone" error={fieldErrors.shippingPhone}>
          <input name="shippingPhone" className="input" required autoComplete="tel" placeholder="+60 12-345 6789" />
        </Field>
      </div>

      <Field label="Address" error={fieldErrors.addressLine1}>
        <input name="addressLine1" className="input" required autoComplete="address-line1" />
      </Field>
      <Field label="Address line 2 (optional)">
        <input name="addressLine2" className="input" autoComplete="address-line2" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" error={fieldErrors.city}>
          <input name="city" className="input" required autoComplete="address-level2" />
        </Field>
        <Field label="State" error={fieldErrors.state}>
          <select name="state" className="input" required defaultValue="Selangor">
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Postcode" error={fieldErrors.postcode}>
          <input name="postcode" className="input" required inputMode="numeric" autoComplete="postal-code" />
        </Field>
      </div>

      <Field label="Payment method">
        <select name="method" className="input" defaultValue="FPX">
          {METHODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note to seller (optional)">
        <input name="notes" className="input" placeholder="Leave with the guardhouse" />
      </Field>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Processing…' : `Pay ${formatMoney(total)}`}
      </button>
      <p className="text-center text-xs text-ink-500">
        Payment is held until you confirm delivery.
      </p>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

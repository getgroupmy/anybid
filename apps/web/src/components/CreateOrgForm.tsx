'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';

const STATES = ['Kuala Lumpur', 'Selangor', 'Penang', 'Johor', 'Perak', 'Sabah', 'Sarawak'];

export function CreateOrgForm({ defaultEmail }: { defaultEmail: string }) {
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
      await browserClient.corporate.create(Object.fromEntries(form));
      router.refresh();
    } catch (err) {
      const apiErr = err as { message?: string; fieldErrors?: Record<string, string> };
      setError(apiErr.message ?? 'Could not create the organisation');
      if (apiErr.fieldErrors) setFieldErrors(apiErr.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 p-5" onSubmit={onSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" error={fieldErrors.name}>
          <input name="name" className="input" required placeholder="MegaCorp Sdn Bhd" />
        </Field>
        <Field label="Registration number (SSM)" error={fieldErrors.registrationNo}>
          <input name="registrationNo" className="input" required placeholder="201901012345" />
        </Field>
        <Field label="Tax ID (optional)">
          <input name="taxId" className="input" placeholder="C24680135790" />
        </Field>
        <Field label="Industry (optional)">
          <input name="industry" className="input" placeholder="Manufacturing" />
        </Field>
      </div>

      <Field label="Billing email" error={fieldErrors.billingEmail}>
        <input name="billingEmail" type="email" className="input" required defaultValue={defaultEmail} />
      </Field>

      <Field label="Registered address" error={fieldErrors.addressLine1}>
        <input name="addressLine1" className="input" required placeholder="Level 22, Menara MegaCorp, Jalan Ampang" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" error={fieldErrors.city}>
          <input name="city" className="input" required />
        </Field>
        <Field label="State" error={fieldErrors.state}>
          <select name="state" className="input" defaultValue="Kuala Lumpur">
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Postcode" error={fieldErrors.postcode}>
          <input name="postcode" className="input" required inputMode="numeric" />
        </Field>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create organisation'}
      </button>
      <p className="text-xs text-ink-500">
        You become the owner. Invite your team and set spend thresholds next.
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

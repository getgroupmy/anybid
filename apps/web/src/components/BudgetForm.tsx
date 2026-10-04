'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';
import { formatMoney, moneyInputToMinor } from '@/lib/format';

/**
 * Your own spending policy, and what the platform has extended to you.
 *
 * The credit limit and the payment terms used to be fields on this form. They
 * decide whether this organisation can take goods now and pay later, and for
 * how much — the platform's exposure rather than the customer's preference —
 * so they are set on the admin side and shown here as facts.
 */
export function BudgetForm({
  monthlyBudget,
  defaultApprovalThreshold,
  creditLimit,
  paymentTerms,
}: {
  monthlyBudget: number;
  defaultApprovalThreshold: number;
  creditLimit: number;
  paymentTerms: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const form = new FormData(e.currentTarget);

    try {
      await browserClient.corporate.updateBudget({
        monthlyBudget: moneyInputToMinor(String(form.get('monthlyBudget'))),
        defaultApprovalThreshold: moneyInputToMinor(String(form.get('defaultApprovalThreshold'))),
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the policy');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 p-5" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="label">Monthly budget (RM)</span>
          <input
            name="monthlyBudget"
            className="input"
            inputMode="decimal"
            defaultValue={(monthlyBudget / 100).toFixed(2)}
          />
          <p className="mt-1 text-xs text-ink-500">Reported against, not hard-enforced.</p>
        </div>

        <div>
          <span className="label">Approval needed above (RM)</span>
          <input
            name="defaultApprovalThreshold"
            className="input"
            inputMode="decimal"
            defaultValue={(defaultApprovalThreshold / 100).toFixed(2)}
          />
          <p className="mt-1 text-xs text-ink-500">
            The default for buyer seats. A bid above this is held until an approver releases it.
          </p>
        </div>

        <div>
          <span className="label">Credit limit</span>
          <p className="input bg-ink-50 text-ink-700">{formatMoney(creditLimit)}</p>
          <p className="mt-1 text-xs text-ink-500">
            Ceiling on unpaid invoices before purchases must be prepaid. Set by AnyBid — talk to
            us to review it.
          </p>
        </div>

        <div>
          <span className="label">Payment terms</span>
          <p className="input bg-ink-50 text-ink-700">{paymentTerms.replace('_', ' ')}</p>
          <p className="mt-1 text-xs text-ink-500">
            Anything other than prepaid lets buyers check out against an invoice. Agreed with
            AnyBid, not changed here.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-deal-600">Policy saved.</p>}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save policy'}
      </button>
    </form>
  );
}

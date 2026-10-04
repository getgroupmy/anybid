'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';
import { formatMoney, moneyInputToMinor } from '@/lib/format';

const ORG_ROLES = ['OWNER', 'ADMIN', 'APPROVER', 'BUYER', 'VIEWER'] as const;

export function InviteMemberForm({ defaultThreshold }: { defaultThreshold: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setTemporaryPassword(null);
    const form = new FormData(e.currentTarget);
    const threshold = String(form.get('approvalThreshold') ?? '');

    const approvalThreshold = threshold === '' ? null : moneyInputToMinor(threshold);
    if (approvalThreshold !== null && !Number.isFinite(approvalThreshold)) {
      // Null here means "use the organisation default", so sending an
      // unreadable figure as null would quietly grant that instead of failing.
      setError('That approval limit is not an amount. Leave it blank for the organisation default.');
      setBusy(false);
      return;
    }

    try {
      const result = (await browserClient.corporate.invite({
        email: String(form.get('email')),
        orgRole: String(form.get('orgRole')),
        approvalThreshold,
      })) as unknown as { temporaryPassword?: string };

      if (result.temporaryPassword) setTemporaryPassword(result.temporaryPassword);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that person');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 p-5" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <span className="label">Work email</span>
          <input name="email" type="email" className="input" required placeholder="buyer@company.my" />
        </div>
        <div>
          <span className="label">Seat</span>
          <select name="orgRole" className="input" defaultValue="BUYER">
            {ORG_ROLES.filter((r) => r !== 'OWNER').map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Approval needed above (RM)</span>
          <input
            name="approvalThreshold"
            className="input"
            inputMode="decimal"
            placeholder={(defaultThreshold / 100).toFixed(2)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {temporaryPassword && (
        <div className="rounded-lg bg-deal-50 px-3 py-2 text-sm text-deal-900">
          Account created. Share this one-time password with them:{' '}
          <code className="font-mono font-bold">{temporaryPassword}</code>
        </div>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
      <p className="text-xs text-ink-500">
        Buyers bidding above their threshold need an approver to release the bid. Leave the field
        empty to use the organisation default of {formatMoney(defaultThreshold)}.
      </p>
    </form>
  );
}

export function MemberRoleEditor({
  memberId,
  orgRole,
  threshold,
  active,
}: {
  memberId: string;
  orgRole: string;
  threshold: number | null;
  active: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState(orgRole);
  const [limit, setLimit] = useState(threshold === null ? '' : (threshold / 100).toFixed(2));

  async function save() {
    setBusy(true);
    setError(null);
    const approvalThreshold = limit === '' ? null : moneyInputToMinor(limit);
    if (approvalThreshold !== null && !Number.isFinite(approvalThreshold)) {
      setError('That approval limit is not an amount. Leave it blank for the organisation default.');
      setBusy(false);
      return;
    }

    try {
      await browserClient.corporate.updateMember(memberId, {
        orgRole: role,
        approvalThreshold,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the seat');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await browserClient.corporate.updateMember(memberId, { active: !active });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the seat');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end gap-1">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(true)}>
          Edit
        </button>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs text-ink-500"
          onClick={toggleActive}
          disabled={busy}
        >
          {active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <select className="input py-1 text-xs" value={role} onChange={(e) => setRole(e.target.value)}>
        {ORG_ROLES.filter((r) => r !== 'OWNER').map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        className="input py-1 text-xs"
        inputMode="decimal"
        placeholder="Threshold (RM)"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
      />
      <div className="flex gap-1">
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="btn-primary px-2.5 py-0.5 text-xs" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

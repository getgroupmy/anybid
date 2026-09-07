'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/client';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function ModerateListing({ listingId, featured }: { listingId: string; featured: boolean }) {
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy}
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() =>
            run(() =>
              browserClient.admin.moderate(listingId, {
                action: featured ? 'UNFEATURE' : 'FEATURE',
              }),
            )
          }
        >
          {featured ? 'Unfeature' : 'Feature'}
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-ghost px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          onClick={() => {
            const reason = window.prompt('Reason for suspending this listing?');
            if (reason) run(() => browserClient.admin.moderate(listingId, { action: 'SUSPEND', reason }));
          }}
        >
          Suspend
        </button>
      </div>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

export function SuspendUser({ userId, suspended }: { userId: string; suspended: boolean }) {
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        className={`btn px-2.5 py-1 text-xs ${
          suspended ? 'bg-deal-600 text-white hover:bg-deal-700' : 'text-red-600 hover:bg-red-50'
        }`}
        onClick={() => {
          if (suspended) {
            run(() => browserClient.admin.suspend(userId, { suspended: false, reason: 'Reinstated by admin' }));
            return;
          }
          const reason = window.prompt('Reason for suspending this account?');
          if (reason) run(() => browserClient.admin.suspend(userId, { suspended: true, reason }));
        }}
      >
        {suspended ? 'Reinstate' : 'Suspend'}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

const ALL_ROLES = ['USER', 'ADVERTISER', 'CORPORATE', 'ADMIN', 'SUPER_ADMIN'];

export function RoleEditor({ userId, roles }: { userId: string; roles: string[] }) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(roles);

  if (!open) {
    return (
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(true)}>
        Edit roles
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-1">
        {ALL_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() =>
              setSelected((prev) =>
                prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
              )
            }
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
              selected.includes(role)
                ? 'bg-bid-600 text-white'
                : 'border border-ink-300 text-ink-600'
            }`}
          >
            {role}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary px-2.5 py-0.5 text-xs"
          disabled={busy || selected.length === 0}
          onClick={() =>
            run(async () => {
              await browserClient.admin.setRoles(userId, selected);
              setOpen(false);
            })
          }
        >
          Save
        </button>
      </div>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

export function ReviewCampaign({ campaignId }: { campaignId: string }) {
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy}
          className="btn-primary px-2.5 py-1 text-xs"
          onClick={() => run(() => browserClient.admin.reviewCampaign(campaignId, { decision: 'APPROVE' }))}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-ghost px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          onClick={() => {
            const note = window.prompt('Why is this campaign rejected?');
            if (note) run(() => browserClient.admin.reviewCampaign(campaignId, { decision: 'REJECT', note }));
          }}
        >
          Reject
        </button>
      </div>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

export function ResolveDispute({ disputeId }: { disputeId: string }) {
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        <button
          type="button"
          disabled={busy}
          className="btn-ghost px-2 py-1 text-xs text-bid-700 hover:bg-bid-50"
          onClick={() => {
            const note = window.prompt('Note for both parties (refund the buyer in full)?');
            if (note)
              run(() =>
                browserClient.admin.resolveDispute(disputeId, { resolution: 'REFUND_BUYER', note }),
              );
          }}
        >
          Refund buyer
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-ghost px-2 py-1 text-xs text-deal-700 hover:bg-deal-50"
          onClick={() => {
            const note = window.prompt('Note for both parties (release funds to the seller)?');
            if (note)
              run(() =>
                browserClient.admin.resolveDispute(disputeId, { resolution: 'RELEASE_SELLER', note }),
              );
          }}
        >
          Release to seller
        </button>
      </div>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

export function DecideKyc({ submissionId }: { submissionId: string }) {
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy}
          className="btn-primary px-2.5 py-1 text-xs"
          onClick={() => run(() => browserClient.admin.decideKyc(submissionId, { decision: 'APPROVE' }))}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn-ghost px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          onClick={() => {
            const note = window.prompt('Why is this rejected?');
            if (note) run(() => browserClient.admin.decideKyc(submissionId, { decision: 'REJECT', note }));
          }}
        >
          Reject
        </button>
      </div>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

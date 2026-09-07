import Link from 'next/link';
import { serverClient, readSession } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { FilterTabs } from '@/components/FilterTabs';
import { ApprovalActions } from '@/components/ApprovalActions';
import { Countdown } from '@/components/Countdown';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

const TABS = [
  ['PENDING', 'Pending'],
  ['APPROVED', 'Approved'],
  ['REJECTED', 'Rejected'],
  ['EXPIRED', 'Expired'],
  ['ALL', 'All'],
] as const;

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const api = await serverClient();
  const session = await readSession();
  const approvals = await api.corporate.approvals({ status: status ?? 'PENDING', perPage: 30 });

  const canApprove = ['OWNER', 'ADMIN', 'APPROVER'].includes(session?.user.orgRole ?? '');

  return (
    <div className="space-y-4">
      <Panel>
        <div className="px-5 py-3">
          <FilterTabs param="status" tabs={TABS.map(([v, l]) => ({ value: v, label: l }))} />
        </div>
      </Panel>

      {approvals.items.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing here"
            body="When a team member bids above their threshold, the bid waits here until an approver releases it."
          />
        </Panel>
      ) : (
        approvals.items.map((a) => (
          <Panel key={a.id}>
            <div className="flex flex-wrap items-start gap-4 p-5">
              {a.listing.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.listing.image} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${statusTone(a.status)}`}>{a.status}</span>
                  {a.reference && (
                    <span className="font-mono text-xs text-ink-500">{a.reference}</span>
                  )}
                  <span className="text-xs text-ink-400">requested {relativeTime(a.createdAt)}</span>
                </div>

                <Link
                  href={`/listing/${a.listing.slug}`}
                  className="mt-1 block font-medium text-ink-900 hover:text-bid-600"
                >
                  {a.listing.title}
                </Link>

                <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <Item label="Requested by" value={a.requestedBy.displayName} />
                  <Item label="Maximum bid" value={formatMoney(a.amount)} strong />
                  <Item label="Current price" value={formatMoney(a.listing.currentPrice)} />
                  {a.listing.endsAt && a.status === 'PENDING' && (
                    <div>
                      <dt className="text-xs text-ink-500">Auction closes</dt>
                      <dd className="text-sm font-medium">
                        <Countdown endsAt={a.listing.endsAt} compact />
                      </dd>
                    </div>
                  )}
                </dl>

                {a.note && <p className="mt-2 text-sm text-ink-600">“{a.note}”</p>}
                {a.decidedBy && (
                  <p className="mt-2 text-xs text-ink-500">
                    Decided by {a.decidedBy.displayName} {relativeTime(a.decidedAt)}
                  </p>
                )}
              </div>

              {a.status === 'PENDING' && canApprove && a.requestedBy.id !== session?.user.id && (
                <ApprovalActions approvalId={a.id} amount={a.amount} />
              )}
              {a.status === 'PENDING' && a.requestedBy.id === session?.user.id && (
                <p className="max-w-[12rem] text-xs text-ink-500">
                  Waiting on an approver — you cannot approve your own request.
                </p>
              )}
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={strong ? 'text-sm font-bold text-ink-900' : 'text-sm font-medium'}>{value}</dd>
    </div>
  );
}

import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { ResolveDispute } from '@/components/AdminActions';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';

export const metadata = { title: 'Disputes · Admin' };
export const dynamic = 'force-dynamic';

interface DisputeRow {
  id: string;
  reason: string;
  detail: string;
  status: string;
  createdAt: string;
  openedBy: { displayName: string };
  order: {
    reference: string;
    total: number;
    listing: { title: string };
    buyer: { displayName: string };
    seller: { displayName: string };
  };
}

export default async function AdminDisputes() {
  const api = await serverClient();
  const disputes = await api.admin.disputes({ perPage: 30 });
  const rows = disputes.items as unknown as DisputeRow[];

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No open disputes"
          body="Buyers can raise a dispute from an order that has not completed."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((d) => (
        <Panel key={d.id}>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${statusTone(d.status)}`}>{d.status.replace(/_/g, ' ')}</span>
                <span className="badge bg-ink-100 text-ink-700">{d.reason.replace(/_/g, ' ')}</span>
                <span className="font-mono text-xs text-ink-500">{d.order.reference}</span>
                <span className="text-xs text-ink-400">{relativeTime(d.createdAt)}</span>
              </div>

              <h3 className="mt-2 font-medium text-ink-900">{d.order.listing.title}</h3>
              <p className="mt-1 text-sm text-ink-600">{d.detail}</p>

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-500">
                <span>Buyer: {d.order.buyer.displayName}</span>
                <span>Seller: {d.order.seller.displayName}</span>
                <span>Order value: {formatMoney(d.order.total)}</span>
              </dl>
            </div>

            {d.status !== 'RESOLVED' && d.status !== 'REJECTED' && (
              <ResolveDispute disputeId={d.id} />
            )}
          </div>
        </Panel>
      ))}
    </div>
  );
}

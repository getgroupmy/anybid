import Link from 'next/link';
import { serverClient, readSession } from '@/lib/session';
import { StatCard, Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { CreateOrgForm } from '@/components/CreateOrgForm';
import { formatMoney, relativeTime, statusTone } from '@/lib/format';
import { ApiError } from '@anybid/shared';

export const metadata = { title: 'Corporate overview' };
export const dynamic = 'force-dynamic';

export default async function CorporateOverview() {
  const api = await serverClient();
  const session = await readSession();

  let org;
  try {
    org = (await api.corporate.org()).organization;
  } catch (err) {
    // Not in an organisation yet — offer to create one.
    if (err instanceof ApiError && err.isAuth) {
      return (
        <Panel title="Set up your organisation">
          <div className="border-b border-ink-200 px-5 py-4 text-sm text-ink-600">
            A corporate account gives your team shared budgets, spend thresholds that route large
            bids to an approver, consolidated invoices and purchase reporting.
          </div>
          <CreateOrgForm defaultEmail={session?.user.email ?? ''} />
        </Panel>
      );
    }
    throw err;
  }

  const [spend, approvals, orders] = await Promise.all([
    api.corporate.spend(),
    api.corporate.approvals({ status: 'PENDING', perPage: 5 }),
    api.corporate.orders({ perPage: 5 }),
  ]);

  const totals = spend.totals as typeof spend.totals & { outstanding: number; creditLimit: number };
  const budgetUsed = org.monthlyBudget > 0 ? (totals.spent / org.monthlyBudget) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Spent this month"
          value={formatMoney(totals.spent)}
          hint={`of ${formatMoney(org.monthlyBudget)} budget`}
          tone={budgetUsed > 90 ? 'bad' : budgetUsed > 70 ? 'warn' : 'default'}
        />
        <StatCard
          label="Committed in live bids"
          value={formatMoney(totals.committed)}
          hint="Auctions your team is currently leading"
        />
        <StatCard
          label="Awaiting approval"
          value={String(approvals.total)}
          tone={approvals.total > 0 ? 'warn' : 'default'}
          href="/corporate/approvals"
        />
        <StatCard
          label="Outstanding invoices"
          value={formatMoney(totals.outstanding ?? 0)}
          hint={`${org.paymentTerms.replace('_', ' ')} · ${formatMoney(org.creditLimit)} limit`}
          href="/corporate/budget"
        />
      </div>

      <Panel title="Monthly budget">
        <div className="p-5">
          <div className="h-2.5 overflow-hidden rounded-full bg-ink-200">
            <div
              className={`h-full rounded-full ${
                budgetUsed > 90 ? 'bg-red-500' : budgetUsed > 70 ? 'bg-amber-500' : 'bg-deal-500'
              }`}
              style={{ width: `${Math.min(100, budgetUsed)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm text-ink-600">
            <span>
              {formatMoney(totals.spent)} spent · {formatMoney(totals.committed)} committed
            </span>
            <span className="font-medium text-ink-900">
              {formatMoney(totals.remaining)} remaining
            </span>
          </div>
        </div>
      </Panel>

      <Panel
        title="Awaiting your approval"
        action={
          <Link href="/corporate/approvals" className="text-xs font-medium text-bid-600 hover:underline">
            See all
          </Link>
        }
      >
        {approvals.items.length === 0 ? (
          <EmptyState
            title="Nothing pending"
            body="Bids above a member's threshold appear here for sign-off before they reach the auction."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {approvals.items.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                {a.listing.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.listing.image} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-900">{a.listing.title}</div>
                  <div className="text-xs text-ink-500">
                    {a.requestedBy.displayName} · {formatMoney(a.amount)} ·{' '}
                    {a.reference ?? 'no reference'}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-ink-400">{relativeTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Spend by team member">
        <DataTable
          rows={spend.rows}
          rowKey={(r) => r.member.id}
          empty={<EmptyState title="No members" body="Invite your team to start buying." />}
          columns={[
            {
              key: 'member',
              header: 'Member',
              render: (r) => (
                <span>
                  <span className="block font-medium text-ink-900">{r.member.displayName}</span>
                  <span className="block text-xs text-ink-500">
                    {(r as unknown as { orgRole: string }).orgRole}
                  </span>
                </span>
              ),
            },
            { key: 'bids', header: 'Bids placed', align: 'right', render: (r) => r.bids },
            { key: 'won', header: 'Auctions won', align: 'right', render: (r) => r.won },
            {
              key: 'spend',
              header: 'Spend this month',
              align: 'right',
              render: (r) => <span className="font-semibold">{formatMoney(r.spend)}</span>,
            },
          ]}
        />
      </Panel>

      <Panel
        title="Recent purchases"
        action={
          <Link href="/corporate/orders" className="text-xs font-medium text-bid-600 hover:underline">
            See all
          </Link>
        }
      >
        <DataTable
          rows={orders.items}
          rowKey={(o) => o.id}
          empty={<EmptyState title="No purchases yet" body="Auctions your team wins land here." />}
          columns={[
            {
              key: 'item',
              header: 'Item',
              render: (o) => (
                <span>
                  <span className="block max-w-xs truncate font-medium">{o.listing?.title}</span>
                  <span className="block font-mono text-xs text-ink-500">{o.reference}</span>
                </span>
              ),
            },
            { key: 'buyer', header: 'Bought by', render: (o) => o.buyer?.displayName ?? '—' },
            {
              key: 'total',
              header: 'Total',
              align: 'right',
              render: (o) => <span className="font-semibold">{formatMoney(o.total)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              align: 'right',
              render: (o) => <span className={`badge ${statusTone(o.status)}`}>{o.status.replace(/_/g, ' ')}</span>,
            },
          ]}
        />
      </Panel>
    </div>
  );
}

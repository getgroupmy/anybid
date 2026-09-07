import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { StatCard, Panel } from '@/components/ConsoleShell';
import { ActivityChart } from '@/components/ActivityChart';
import { formatMoney, relativeTime } from '@/lib/format';

export const metadata = { title: 'Admin dashboard' };
export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const api = await serverClient();
  const [metrics, audit] = await Promise.all([
    api.admin.metrics(),
    api.admin.audit({ perPage: 8 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="GMV (30 days)"
          value={formatMoney(metrics.gmv.last30d)}
          hint={`${formatMoney(metrics.gmv.allTime)} all time`}
        />
        <StatCard
          label="Commission earned"
          value={formatMoney(metrics.revenue.commission)}
          hint={`+ ${formatMoney(metrics.revenue.ads)} ad revenue`}
          tone="good"
        />
        <StatCard
          label="Live auctions"
          value={metrics.listings.live.toLocaleString()}
          hint={`${metrics.listings.endingSoon} closing within the hour`}
          href="/admin/listings"
        />
        <StatCard
          label="Bids in 24h"
          value={metrics.bids.last24h.toLocaleString()}
          hint={`${metrics.bids.total.toLocaleString()} all time`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Users"
          value={metrics.users.total.toLocaleString()}
          hint={`${metrics.users.new7d} joined this week`}
          href="/admin/users"
        />
        <StatCard
          label="Awaiting review"
          value={String(metrics.listings.pendingReview)}
          tone={metrics.listings.pendingReview > 0 ? 'warn' : 'default'}
          href="/admin/listings?status=PENDING_REVIEW"
        />
        <StatCard
          label="Open disputes"
          value={String(metrics.orders.disputed)}
          tone={metrics.orders.disputed > 0 ? 'bad' : 'default'}
          href="/admin/disputes"
        />
        <StatCard
          label="KYC pending"
          value={String(metrics.users.pendingKyc)}
          tone={metrics.users.pendingKyc > 0 ? 'warn' : 'default'}
          href="/admin/kyc"
        />
      </div>

      <Panel title="Marketplace activity">
        <ActivityChart data={metrics.timeseries} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Order pipeline">
          <dl className="divide-y divide-ink-100">
            <PipelineRow
              label="Awaiting payment"
              value={metrics.orders.awaitingPayment}
              href="/admin/orders?status=AWAITING_PAYMENT"
            />
            <PipelineRow
              label="Disputed"
              value={metrics.orders.disputed}
              href="/admin/orders?status=DISPUTED"
            />
            <PipelineRow
              label="Completed"
              value={metrics.orders.completed}
              href="/admin/orders?status=COMPLETED"
            />
            <PipelineRow label="Suspended accounts" value={metrics.users.suspended} href="/admin/users?suspended=true" />
          </dl>
        </Panel>

        <Panel
          title="Recent admin actions"
          action={
            <Link href="/admin/audit" className="text-xs font-medium text-bid-600 hover:underline">
              Full log
            </Link>
          }
        >
          <ul className="divide-y divide-ink-100">
            {audit.items.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-medium text-ink-900">{entry.action}</span>
                  <span className="ml-2 text-xs text-ink-500">
                    {entry.actor?.displayName ?? 'system'}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-ink-400">
                  {relativeTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function PipelineRow({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between px-5 py-3 hover:bg-ink-50">
      <dt className="text-sm text-ink-600">{label}</dt>
      <dd className="text-sm font-bold text-ink-900">{value.toLocaleString()}</dd>
    </Link>
  );
}

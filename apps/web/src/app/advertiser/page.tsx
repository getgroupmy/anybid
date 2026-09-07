import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { StatCard, Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { CampaignStatusToggle } from '@/components/CampaignActions';
import { AdPerformanceChart } from '@/components/AdPerformanceChart';
import { formatMoney, statusTone } from '@/lib/format';

export const metadata = { title: 'Advertiser overview' };
export const dynamic = 'force-dynamic';

export default async function AdvertiserOverview() {
  const api = await serverClient();
  const [overview, campaigns, report] = await Promise.all([
    api.advertiser.overview(),
    api.advertiser.campaigns({ perPage: 10 }),
    api.advertiser.report({ days: 14 }),
  ]);

  const ctr =
    overview.impressions > 0
      ? ((overview.clicks / overview.impressions) * 100).toFixed(2)
      : '0.00';

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Wallet balance"
          value={formatMoney(overview.balance)}
          hint={overview.balance <= 0 ? 'Top up to keep serving' : 'Prepaid credit'}
          tone={overview.balance <= 0 ? 'bad' : 'good'}
          href="/advertiser/wallet"
        />
        <StatCard label="Spent today" value={formatMoney(overview.spendToday)} />
        <StatCard
          label="Impressions"
          value={overview.impressions.toLocaleString()}
          hint={`${overview.clicks.toLocaleString()} clicks · ${ctr}% CTR`}
        />
        <StatCard
          label="Active campaigns"
          value={String(overview.campaigns)}
          href="/advertiser/campaigns"
        />
      </div>

      {overview.balance <= 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-medium text-amber-900">Your ad wallet is empty</p>
          <p className="mt-0.5 text-sm text-amber-800">
            Campaigns stop serving when the balance runs out.{' '}
            <Link href="/advertiser/wallet" className="font-medium underline">
              Top up now
            </Link>
            .
          </p>
        </div>
      )}

      <Panel title="Performance — last 14 days">
        <AdPerformanceChart rows={report.rows} />
      </Panel>

      <Panel
        title="Campaigns"
        action={
          <Link
            href="/advertiser/campaigns/new"
            className="text-xs font-medium text-bid-600 hover:underline"
          >
            New campaign
          </Link>
        }
      >
        <DataTable
          rows={campaigns.items}
          rowKey={(c) => c.id}
          empty={
            <EmptyState
              title="No campaigns yet"
              body="Create one to place promoted listings across search, category and mobile feeds."
            />
          }
          columns={[
            {
              key: 'name',
              header: 'Campaign',
              render: (c) => (
                <Link href={`/advertiser/campaigns/${c.id}`} className="hover:text-bid-600">
                  <span className="block font-medium text-ink-900">{c.name}</span>
                  <span className="block text-xs text-ink-500">
                    {formatMoney(c.bidAmount)} {c.pricingModel} · {c.placements.length} placements
                  </span>
                </Link>
              ),
            },
            {
              key: 'budget',
              header: 'Daily budget',
              align: 'right',
              render: (c) => (
                <span>
                  <span className="block">{formatMoney(c.spendToday)}</span>
                  <span className="block text-xs text-ink-500">of {formatMoney(c.dailyBudget)}</span>
                </span>
              ),
            },
            { key: 'impr', header: 'Impressions', align: 'right', render: (c) => c.impressions.toLocaleString() },
            { key: 'ctr', header: 'CTR', align: 'right', render: (c) => `${c.ctr}%` },
            {
              key: 'spend',
              header: 'Total spend',
              align: 'right',
              render: (c) => <span className="font-semibold">{formatMoney(c.spend)}</span>,
            },
            {
              key: 'status',
              header: 'Status',
              align: 'right',
              render: (c) => <span className={`badge ${statusTone(c.status)}`}>{c.status.replace(/_/g, ' ')}</span>,
            },
            {
              key: 'toggle',
              header: '',
              align: 'right',
              render: (c) => <CampaignStatusToggle campaignId={c.id} status={c.status} />,
            },
          ]}
        />
      </Panel>
    </div>
  );
}

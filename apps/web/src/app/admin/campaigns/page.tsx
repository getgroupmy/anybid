import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { ReviewCampaign } from '@/components/AdminActions';
import { FilterTabs } from '@/components/FilterTabs';
import { formatMoney, statusTone } from '@/lib/format';

export const metadata = { title: 'Ad campaigns · Admin' };
export const dynamic = 'force-dynamic';

const TABS = [
  ['', 'All'],
  ['PENDING_REVIEW', 'Awaiting review'],
  ['ACTIVE', 'Active'],
  ['PAUSED', 'Paused'],
  ['OUT_OF_BUDGET', 'Out of budget'],
  ['REJECTED', 'Rejected'],
] as const;

type Row = Awaited<ReturnType<Awaited<ReturnType<typeof serverClient>>['admin']['campaigns']>>['items'][number] & {
  advertiserName?: string;
};

export default async function AdminCampaigns({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const api = await serverClient();
  const campaigns = await api.admin.campaigns({ ...params, perPage: 30 });

  const totalSpend = campaigns.items.reduce((sum, c) => sum + c.spend, 0);

  return (
    <Panel title={`${campaigns.total} campaigns · ${formatMoney(totalSpend)} spend on this page`}>
      <div className="border-b border-ink-200 px-5 py-3">
        <FilterTabs param="status" tabs={TABS.map(([v, l]) => ({ value: v, label: l }))} />
      </div>
      <DataTable
        rows={campaigns.items as Row[]}
        rowKey={(c) => c.id}
        empty={<EmptyState title="No campaigns" body="Nothing matches this filter." />}
        columns={[
          {
            key: 'name',
            header: 'Campaign',
            render: (c) => (
              <span>
                <span className="block font-medium text-ink-900">{c.name}</span>
                <span className="block text-xs text-ink-500">
                  {c.advertiserName ?? '—'} · {c.placements.join(', ')}
                </span>
              </span>
            ),
          },
          {
            key: 'bid',
            header: 'Bid',
            align: 'right',
            render: (c) => `${formatMoney(c.bidAmount)} ${c.pricingModel}`,
          },
          { key: 'impr', header: 'Impressions', align: 'right', render: (c) => c.impressions.toLocaleString() },
          { key: 'clicks', header: 'Clicks', align: 'right', render: (c) => c.clicks.toLocaleString() },
          { key: 'ctr', header: 'CTR', align: 'right', render: (c) => `${c.ctr}%` },
          {
            key: 'spend',
            header: 'Spend',
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
            key: 'actions',
            header: '',
            align: 'right',
            render: (c) =>
              c.status === 'PENDING_REVIEW' ? <ReviewCampaign campaignId={c.id} /> : null,
          },
        ]}
      />
    </Panel>
  );
}

import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { CampaignStatusToggle } from '@/components/CampaignActions';
import { formatMoney, shortDate, statusTone } from '@/lib/format';

export const metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const api = await serverClient();
  const campaigns = await api.advertiser.campaigns({ perPage: 40 });

  return (
    <Panel
      title={`${campaigns.total} campaigns`}
      action={
        <Link href="/advertiser/campaigns/new" className="btn-primary px-3 py-1.5 text-xs">
          New campaign
        </Link>
      }
    >
      <DataTable
        rows={campaigns.items}
        rowKey={(c) => c.id}
        empty={<EmptyState title="No campaigns" body="Create your first promoted placement." />}
        columns={[
          {
            key: 'name',
            header: 'Campaign',
            render: (c) => (
              <Link href={`/advertiser/campaigns/${c.id}`} className="hover:text-bid-600">
                <span className="block font-medium text-ink-900">{c.name}</span>
                <span className="block text-xs text-ink-500">
                  {shortDate(c.startsAt)} – {c.endsAt ? shortDate(c.endsAt) : 'ongoing'}
                </span>
              </Link>
            ),
          },
          {
            key: 'placements',
            header: 'Placements',
            render: (c) => (
              <span className="flex flex-wrap gap-1">
                {c.placements.map((p) => (
                  <span key={p} className="badge bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                    {p.replace(/_/g, ' ').toLowerCase()}
                  </span>
                ))}
              </span>
            ),
          },
          {
            key: 'bid',
            header: 'Bid',
            align: 'right',
            render: (c) => `${formatMoney(c.bidAmount)} ${c.pricingModel}`,
          },
          { key: 'impr', header: 'Impr.', align: 'right', render: (c) => c.impressions.toLocaleString() },
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
            key: 'toggle',
            header: '',
            align: 'right',
            render: (c) => <CampaignStatusToggle campaignId={c.id} status={c.status} />,
          },
        ]}
      />
    </Panel>
  );
}

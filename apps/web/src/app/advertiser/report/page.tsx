import { serverClient } from '@/lib/session';
import { Panel, StatCard } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { AdPerformanceChart } from '@/components/AdPerformanceChart';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'Reporting' };
export const dynamic = 'force-dynamic';

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  const api = await serverClient();
  const report = await api.advertiser.report({ days: days ?? 30 });

  const cpc = report.totals.clicks > 0 ? report.totals.spend / report.totals.clicks : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Impressions" value={report.totals.impressions.toLocaleString()} />
        <StatCard label="Clicks" value={report.totals.clicks.toLocaleString()} />
        <StatCard label="CTR" value={`${report.totals.ctr}%`} />
        <StatCard
          label="Spend"
          value={formatMoney(report.totals.spend)}
          hint={`${formatMoney(Math.round(cpc))} effective CPC`}
        />
      </div>

      <Panel title="Delivery over time">
        <AdPerformanceChart rows={report.rows} />
      </Panel>

      <Panel title="Daily breakdown">
        <DataTable
          rows={[...report.rows].reverse()}
          rowKey={(r) => r.date}
          empty={<div className="px-5 py-12 text-center text-sm text-ink-500">No data in this period.</div>}
          columns={[
            { key: 'date', header: 'Date', render: (r) => r.date },
            { key: 'impr', header: 'Impressions', align: 'right', render: (r) => r.impressions.toLocaleString() },
            { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => r.clicks.toLocaleString() },
            { key: 'ctr', header: 'CTR', align: 'right', render: (r) => `${r.ctr}%` },
            {
              key: 'spend',
              header: 'Spend',
              align: 'right',
              render: (r) => <span className="font-semibold">{formatMoney(r.spend)}</span>,
            },
          ]}
        />
      </Panel>
    </div>
  );
}

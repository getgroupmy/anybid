import { notFound } from 'next/navigation';
import { serverClient } from '@/lib/session';
import { Panel, StatCard, EmptyState } from '@/components/ConsoleShell';
import { CampaignStatusToggle } from '@/components/CampaignActions';
import { AdPerformanceChart } from '@/components/AdPerformanceChart';
import { formatMoney, shortDate, statusTone } from '@/lib/format';
import { ApiError } from '@anybid/shared';

export const metadata = { title: 'Campaign' };
export const dynamic = 'force-dynamic';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await serverClient();

  let campaign;
  try {
    campaign = (await api.advertiser.campaign(id)).campaign;
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  const report = await api.advertiser.report({ days: 30, campaignId: id }).catch(() => ({ rows: [] }));
  const budgetUsed = campaign.dailyBudget > 0 ? (campaign.spendToday / campaign.dailyBudget) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-ink-900">{campaign.name}</h2>
            <span className={`badge ${statusTone(campaign.status)}`}>
              {campaign.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {shortDate(campaign.startsAt)} – {campaign.endsAt ? shortDate(campaign.endsAt) : 'ongoing'} ·{' '}
            {formatMoney(campaign.bidAmount)} {campaign.pricingModel}
          </p>
        </div>
        <CampaignStatusToggle campaignId={campaign.id} status={campaign.status} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Impressions" value={campaign.impressions.toLocaleString()} />
        <StatCard label="Clicks" value={campaign.clicks.toLocaleString()} hint={`${campaign.ctr}% CTR`} />
        <StatCard label="Total spend" value={formatMoney(campaign.spend)} />
        <StatCard
          label="Today"
          value={formatMoney(campaign.spendToday)}
          hint={`${budgetUsed.toFixed(0)}% of daily budget`}
          tone={budgetUsed >= 100 ? 'warn' : 'default'}
        />
      </div>

      <Panel title="Daily budget">
        <div className="p-5">
          <div className="h-2 overflow-hidden rounded-full bg-ink-200">
            <div
              className={`h-full rounded-full ${budgetUsed >= 100 ? 'bg-amber-500' : 'bg-bid-500'}`}
              style={{ width: `${Math.min(100, budgetUsed)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-ink-600">
            {formatMoney(campaign.spendToday)} of {formatMoney(campaign.dailyBudget)} spent today
            {campaign.totalBudget && (
              <>
                {' '}
                · {formatMoney(campaign.spend)} of {formatMoney(campaign.totalBudget)} lifetime
              </>
            )}
          </p>
        </div>
      </Panel>

      <Panel title="Performance — last 30 days">
        <AdPerformanceChart rows={report.rows} />
      </Panel>

      <Panel title="Targeting">
        <dl className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
          <Row label="Placements" value={campaign.placements.map((p) => p.replace(/_/g, ' ').toLowerCase()).join(', ')} />
          <Row
            label="Keywords"
            value={campaign.targetKeywords.length ? campaign.targetKeywords.join(', ') : 'Untargeted'}
          />
          <Row
            label="Categories"
            value={campaign.targetCategoryIds.length ? `${campaign.targetCategoryIds.length} selected` : 'All categories'}
          />
          <Row label="Objective" value={campaign.objective.replace(/_/g, ' ').toLowerCase()} />
        </dl>
      </Panel>

      <Panel title={`Creatives (${campaign.creatives.length})`}>
        {campaign.creatives.length === 0 ? (
          <EmptyState
            title="No creatives"
            body="A campaign needs at least one creative before it can go live."
          />
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {campaign.creatives.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-lg border border-ink-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrl} alt="" className="aspect-[3/1] w-full object-cover" />
                <div className="p-3">
                  <div className="text-sm font-semibold text-ink-900">{c.headline}</div>
                  {c.body && <p className="mt-0.5 text-xs text-ink-500">{c.body}</p>}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-bid-600">{c.ctaLabel} →</span>
                    <span className="text-ink-500">
                      {c.impressions.toLocaleString()} impr · {c.clicks.toLocaleString()} clicks
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ink-100 pb-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

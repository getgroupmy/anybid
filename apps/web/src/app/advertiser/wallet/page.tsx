import { serverClient } from '@/lib/session';
import { Panel, StatCard } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { TopUpForm } from '@/components/CampaignActions';
import { dateTime, formatMoney } from '@/lib/format';

export const metadata = { title: 'Ad wallet' };
export const dynamic = 'force-dynamic';

interface WalletTx {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export default async function WalletPage() {
  const api = await serverClient();
  const [overview, wallet] = await Promise.all([
    api.advertiser.overview(),
    api.request<{ balance: number; transactions: WalletTx[] }>('/v1/advertiser/wallet', {
      method: 'GET',
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Balance"
          value={formatMoney(wallet.balance)}
          tone={wallet.balance <= 0 ? 'bad' : 'good'}
        />
        <StatCard label="Spent today" value={formatMoney(overview.spendToday)} />
        <StatCard
          label="Lifetime spend"
          value={formatMoney((overview as unknown as { lifetimeSpend: number }).lifetimeSpend ?? 0)}
        />
      </div>

      <Panel title="Top up">
        <TopUpForm balance={wallet.balance} />
      </Panel>

      <Panel title="Transactions">
        <DataTable
          rows={wallet.transactions}
          rowKey={(t) => t.id}
          empty={<div className="px-5 py-12 text-center text-sm text-ink-500">No transactions yet.</div>}
          columns={[
            {
              key: 'type',
              header: 'Type',
              render: (t) => (
                <span
                  className={`badge ${
                    t.amount >= 0 ? 'bg-deal-100 text-deal-700' : 'bg-ink-100 text-ink-600'
                  }`}
                >
                  {t.type.replace(/_/g, ' ').toLowerCase()}
                </span>
              ),
            },
            { key: 'note', header: 'Detail', render: (t) => t.note ?? '—' },
            {
              key: 'amount',
              header: 'Amount',
              align: 'right',
              render: (t) => (
                <span className={t.amount >= 0 ? 'font-semibold text-deal-700' : 'text-ink-700'}>
                  {t.amount >= 0 ? '+' : ''}
                  {formatMoney(t.amount)}
                </span>
              ),
            },
            {
              key: 'balance',
              header: 'Balance after',
              align: 'right',
              render: (t) => formatMoney(t.balanceAfter),
            },
            { key: 'when', header: 'When', align: 'right', render: (t) => dateTime(t.createdAt) },
          ]}
        />
      </Panel>
    </div>
  );
}

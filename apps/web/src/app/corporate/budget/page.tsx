import { serverClient, readSession } from '@/lib/session';
import { Panel, StatCard } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { BudgetForm } from '@/components/BudgetForm';
import { dateTime, formatMoney, statusTone } from '@/lib/format';

export const metadata = { title: 'Budget & billing' };
export const dynamic = 'force-dynamic';

interface Invoice {
  id: string;
  number: string;
  total: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  paidAt: string | null;
}

export default async function BudgetPage() {
  const api = await serverClient();
  const session = await readSession();
  const [{ organization }, spend, invoices] = await Promise.all([
    api.corporate.org(),
    api.corporate.spend(),
    api
      .request<{ invoices: Invoice[] }>('/v1/corporate/invoices', { method: 'GET' })
      .catch(() => ({ invoices: [] as Invoice[] })),
  ]);

  const canManage = ['OWNER', 'ADMIN'].includes(session?.user.orgRole ?? '');
  const totals = spend.totals as typeof spend.totals & { outstanding: number; creditLimit: number };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Monthly budget" value={formatMoney(organization.monthlyBudget)} />
        <StatCard label="Spent" value={formatMoney(totals.spent)} />
        <StatCard label="Remaining" value={formatMoney(totals.remaining)} tone="good" />
        <StatCard
          label="Credit used"
          value={formatMoney(totals.outstanding ?? 0)}
          hint={`of ${formatMoney(organization.creditLimit)} · ${organization.paymentTerms.replace('_', ' ')}`}
        />
      </div>

      <Panel title="Organisation">
        <dl className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
          <Row label="Name" value={organization.name} />
          <Row label="Registration number" value={organization.registrationNo} />
          <Row label="Billing email" value={organization.billingEmail} />
          <Row label="Industry" value={organization.industry ?? '—'} />
          <Row label="Seats" value={String(organization.memberCount)} />
          <Row label="Created" value={dateTime(organization.createdAt)} />
        </dl>
      </Panel>

      {canManage && (
        <Panel title="Budget and approval policy">
          <BudgetForm
            monthlyBudget={organization.monthlyBudget}
            defaultApprovalThreshold={organization.defaultApprovalThreshold}
            creditLimit={organization.creditLimit}
            paymentTerms={organization.paymentTerms}
          />
        </Panel>
      )}

      <Panel title="Invoices">
        <DataTable
          rows={invoices.invoices}
          rowKey={(i) => i.id}
          empty={
            <div className="px-5 py-12 text-center text-sm text-ink-500">
              No invoices yet. Purchases on {organization.paymentTerms.replace('_', ' ')} terms are
              consolidated into a monthly invoice.
            </div>
          }
          columns={[
            {
              key: 'number',
              header: 'Invoice',
              render: (i) => <span className="font-mono text-xs font-medium">{i.number}</span>,
            },
            {
              key: 'period',
              header: 'Period',
              render: (i) => `${dateTime(i.periodStart)} – ${dateTime(i.periodEnd)}`,
            },
            {
              key: 'total',
              header: 'Total',
              align: 'right',
              render: (i) => <span className="font-semibold">{formatMoney(i.total)}</span>,
            },
            { key: 'due', header: 'Due', align: 'right', render: (i) => dateTime(i.dueAt) },
            {
              key: 'status',
              header: 'Status',
              align: 'right',
              render: (i) => <span className={`badge ${statusTone(i.status)}`}>{i.status}</span>,
            },
          ]}
        />
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

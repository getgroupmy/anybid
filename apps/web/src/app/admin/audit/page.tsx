import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { dateTime } from '@/lib/format';

export const metadata = { title: 'Audit log · Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const params = await searchParams;
  const api = await serverClient();
  const audit = await api.admin.audit({ ...params, perPage: 50 });

  return (
    <Panel title={`${audit.total} recorded actions`}>
      <DataTable
        rows={audit.items}
        rowKey={(a) => a.id}
        empty={<EmptyState title="Nothing logged" body="Privileged actions are recorded here." />}
        columns={[
          {
            key: 'action',
            header: 'Action',
            render: (a) => <span className="font-mono text-xs font-medium text-ink-900">{a.action}</span>,
          },
          {
            key: 'actor',
            header: 'Actor',
            render: (a) => a.actor?.displayName ?? <span className="text-ink-400">system</span>,
          },
          {
            key: 'target',
            header: 'Target',
            render: (a) => (
              <span className="font-mono text-xs text-ink-500">
                {a.targetType}/{a.targetId.slice(0, 10)}…
              </span>
            ),
          },
          {
            key: 'meta',
            header: 'Detail',
            render: (a) =>
              a.meta ? (
                <span className="block max-w-xs truncate font-mono text-[11px] text-ink-500">
                  {JSON.stringify(a.meta)}
                </span>
              ) : (
                <span className="text-ink-400">—</span>
              ),
          },
          { key: 'ip', header: 'IP', render: (a) => <span className="font-mono text-xs">{a.ip ?? '—'}</span> },
          { key: 'when', header: 'When', align: 'right', render: (a) => dateTime(a.createdAt) },
        ]}
      />
    </Panel>
  );
}

import Link from 'next/link';
import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { RoleEditor, SuspendUser } from '@/components/AdminActions';
import { AdminSearch } from '@/components/AdminSearch';
import { formatMoney, relativeTime } from '@/lib/format';

export const metadata = { title: 'Users · Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; suspended?: string; page?: string }>;
}) {
  const params = await searchParams;
  const api = await serverClient();
  const users = await api.admin.users({ ...params, perPage: 30 });

  return (
    <Panel title={`${users.total} users`}>
      <div className="border-b border-ink-200 px-5 py-3">
        <AdminSearch placeholder="Search by name, email or handle" />
      </div>
      <DataTable
        rows={users.items}
        rowKey={(u) => u.id}
        empty={<EmptyState title="No users found" body="Try a different search." />}
        columns={[
          {
            key: 'user',
            header: 'User',
            render: (u) => (
              <Link href={`/seller/${u.handle}`} className="flex items-center gap-3 hover:opacity-80">
                {u.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-200 text-xs font-bold">
                    {u.displayName.charAt(0)}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">{u.displayName}</span>
                  <span className="block truncate text-xs text-ink-500">{u.email}</span>
                </span>
              </Link>
            ),
          },
          {
            key: 'roles',
            header: 'Roles',
            render: (u) => (
              <span className="flex flex-wrap gap-1">
                {u.roles.map((r) => (
                  <span key={r} className="badge bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                    {r}
                  </span>
                ))}
              </span>
            ),
          },
          {
            key: 'org',
            header: 'Organisation',
            render: (u) => u.orgName ?? <span className="text-ink-400">—</span>,
          },
          { key: 'balance', header: 'Balance', align: 'right', render: (u) => formatMoney(u.balance) },
          { key: 'joined', header: 'Joined', align: 'right', render: (u) => relativeTime(u.createdAt) },
          {
            key: 'roleEdit',
            header: '',
            align: 'right',
            render: (u) => <RoleEditor userId={u.id} roles={u.roles} />,
          },
          {
            key: 'suspend',
            header: '',
            align: 'right',
            render: (u) => <SuspendUser userId={u.id} suspended={u.suspended} />,
          },
        ]}
      />
    </Panel>
  );
}

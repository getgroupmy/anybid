import { serverClient, readSession } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { InviteMemberForm, MemberRoleEditor } from '@/components/TeamActions';
import { formatMoney, relativeTime } from '@/lib/format';

export const metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const api = await serverClient();
  const session = await readSession();
  const [{ members }, { organization }] = await Promise.all([
    api.corporate.members(),
    api.corporate.org(),
  ]);

  const canManage = ['OWNER', 'ADMIN'].includes(session?.user.orgRole ?? '');

  return (
    <div className="space-y-6">
      {canManage && (
        <Panel title="Invite a team member">
          <InviteMemberForm defaultThreshold={organization.defaultApprovalThreshold} />
        </Panel>
      )}

      <Panel title={`${members.length} seats`}>
        <DataTable
          rows={members}
          rowKey={(m) => m.id}
          empty={<EmptyState title="No members" body="Invite your first team member." />}
          columns={[
            {
              key: 'member',
              header: 'Member',
              render: (m) => (
                <span className="flex items-center gap-3">
                  {m.user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-200 text-xs font-bold">
                      {m.user.displayName.charAt(0)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-900">
                      {m.user.displayName}
                    </span>
                    <span className="block text-xs text-ink-500">
                      joined {relativeTime(m.joinedAt)}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              key: 'role',
              header: 'Seat',
              render: (m) => (
                <span className="badge bg-ink-100 text-ink-700">{m.orgRole}</span>
              ),
            },
            {
              key: 'threshold',
              header: 'Approval needed above',
              align: 'right',
              render: (m) =>
                m.approvalThreshold === null ? (
                  <span className="text-ink-500">
                    {formatMoney(organization.defaultApprovalThreshold)}{' '}
                    <span className="text-xs">(default)</span>
                  </span>
                ) : m.approvalThreshold === 0 ? (
                  <span className="text-deal-600">No limit</span>
                ) : (
                  formatMoney(m.approvalThreshold)
                ),
            },
            {
              key: 'spend',
              header: 'Spend this month',
              align: 'right',
              render: (m) => formatMoney(m.spentThisMonth),
            },
            {
              key: 'status',
              header: 'Status',
              align: 'right',
              render: (m) => (
                <span className={`badge ${m.active ? 'bg-deal-100 text-deal-700' : 'bg-ink-100 text-ink-600'}`}>
                  {m.active ? 'Active' : 'Inactive'}
                </span>
              ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (m) =>
                canManage && m.orgRole !== 'OWNER' ? (
                  <MemberRoleEditor
                    memberId={m.id}
                    orgRole={m.orgRole}
                    threshold={m.approvalThreshold}
                    active={m.active}
                  />
                ) : null,
            },
          ]}
        />
      </Panel>
    </div>
  );
}

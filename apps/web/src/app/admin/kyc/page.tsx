import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { DataTable } from '@/components/DataTable';
import { DecideKyc } from '@/components/AdminActions';
import { relativeTime } from '@/lib/format';

export const metadata = { title: 'Verification · Admin' };
export const dynamic = 'force-dynamic';

interface KycRow {
  id: string;
  docType: string;
  docNumber: string;
  status: string;
  createdAt: string;
  user: { displayName: string; email: string; handle: string };
}

export default async function AdminKyc() {
  const api = await serverClient();
  const submissions = await api.admin.kyc({ perPage: 30 });
  const rows = submissions.items as unknown as KycRow[];

  return (
    <Panel title={`${submissions.total} pending verifications`}>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <EmptyState
            title="Nothing to review"
            body="Identity submissions land here for approval before an account is marked verified."
          />
        }
        columns={[
          {
            key: 'user',
            header: 'Applicant',
            render: (r) => (
              <span>
                <span className="block font-medium text-ink-900">{r.user.displayName}</span>
                <span className="block text-xs text-ink-500">{r.user.email}</span>
              </span>
            ),
          },
          { key: 'doc', header: 'Document', render: (r) => r.docType.replace(/_/g, ' ') },
          {
            key: 'number',
            header: 'Number',
            render: (r) => <span className="font-mono text-xs">{maskDoc(r.docNumber)}</span>,
          },
          { key: 'when', header: 'Submitted', align: 'right', render: (r) => relativeTime(r.createdAt) },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r) => <DecideKyc submissionId={r.id} />,
          },
        ]}
      />
    </Panel>
  );
}

/** Reviewers do not need the full document number on a list screen. */
function maskDoc(value: string): string {
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

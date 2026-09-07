import { readSession } from '@/lib/session';
import { Panel } from '@/components/ConsoleShell';
import { ProfileForm } from '@/components/ProfileForm';
import { dateTime } from '@/lib/format';

export const metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await readSession();
  const user = session!.user;

  return (
    <div className="space-y-6">
      <Panel title="Your details">
        <ProfileForm user={user} />
      </Panel>

      <Panel title="Account">
        <dl className="space-y-2 p-5 text-sm">
          <Row label="Email" value={user.email} />
          <Row label="Handle" value={`@${user.handle}`} />
          <Row label="Consoles" value={user.roles.join(', ')} />
          {user.orgName && <Row label="Organisation" value={`${user.orgName} · ${user.orgRole}`} />}
          <Row label="Identity check" value={user.kycStatus} />
          <Row label="Member since" value={dateTime(user.createdAt)} />
        </dl>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

import { redirect } from 'next/navigation';
import { isAdmin } from '@anybid/shared';
import { readSession } from '@/lib/session';
import { ConsoleShell } from '@/components/ConsoleShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/login?next=/admin');
  if (!isAdmin(session.user)) redirect('/account');

  const nav = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/listings', label: 'Listings' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/orders', label: 'Orders' },
    { href: '/admin/campaigns', label: 'Ad campaigns' },
    { href: '/admin/disputes', label: 'Disputes' },
    { href: '/admin/kyc', label: 'Verification' },
    { href: '/admin/audit', label: 'Audit log' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  return (
    <ConsoleShell
      title="Admin Console"
      subtitle="Platform operations, moderation and configuration"
      nav={nav}
    >
      {children}
    </ConsoleShell>
  );
}

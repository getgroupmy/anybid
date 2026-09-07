import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';
import { ConsoleShell } from '@/components/ConsoleShell';

export const dynamic = 'force-dynamic';

export default async function CorporateLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/login?next=/corporate');

  const nav = [
    { href: '/corporate', label: 'Overview' },
    { href: '/corporate/approvals', label: 'Approvals' },
    { href: '/corporate/team', label: 'Team' },
    { href: '/corporate/orders', label: 'Purchases' },
    { href: '/corporate/budget', label: 'Budget & billing' },
  ];

  return (
    <ConsoleShell
      title="Corporate Console"
      subtitle={session.user.orgName ?? 'Procurement, approvals and team spend'}
      nav={nav}
    >
      {children}
    </ConsoleShell>
  );
}

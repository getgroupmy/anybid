import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';
import { ConsoleShell } from '@/components/ConsoleShell';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/login?next=/account');

  const nav = [
    { href: '/account', label: 'Overview' },
    { href: '/account/bids', label: 'My bids' },
    { href: '/account/watchlist', label: 'Watchlist' },
    { href: '/account/orders', label: 'Purchases' },
    { href: '/account/listings', label: 'My listings' },
    { href: '/account/sales', label: 'Sales' },
    {
      href: '/account/notifications',
      label: 'Notifications',
      badge: session.user.unreadNotifications,
    },
    { href: '/account/profile', label: 'Profile' },
  ];

  return (
    <ConsoleShell
      title="My Account"
      subtitle={`Signed in as ${session.user.displayName}`}
      nav={nav}
    >
      {children}
    </ConsoleShell>
  );
}

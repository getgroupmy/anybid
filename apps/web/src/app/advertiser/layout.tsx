import { redirect } from 'next/navigation';
import { hasRole } from '@anybid/shared';
import { readSession } from '@/lib/session';
import { ConsoleShell } from '@/components/ConsoleShell';

export const dynamic = 'force-dynamic';

export default async function AdvertiserLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/login?next=/advertiser');
  if (!hasRole(session.user, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN')) redirect('/account');

  const nav = [
    { href: '/advertiser', label: 'Overview' },
    { href: '/advertiser/campaigns', label: 'Campaigns' },
    { href: '/advertiser/report', label: 'Reporting' },
    { href: '/advertiser/wallet', label: 'Wallet' },
  ];

  return (
    <ConsoleShell
      title="Advertiser Console"
      subtitle="Promoted placements across the AnyBid marketplace"
      nav={nav}
    >
      {children}
    </ConsoleShell>
  );
}

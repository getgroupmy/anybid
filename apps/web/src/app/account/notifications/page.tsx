import { serverClient } from '@/lib/session';
import { Panel, EmptyState } from '@/components/ConsoleShell';
import { NotificationList } from '@/components/NotificationList';

export const metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const api = await serverClient();
  const notifications = await api.notifications.list({ perPage: 50 });

  if (notifications.items.length === 0) {
    return (
      <Panel>
        <EmptyState title="No notifications" body="Outbid alerts and order updates arrive here." />
      </Panel>
    );
  }

  return <NotificationList initial={notifications.items} />;
}

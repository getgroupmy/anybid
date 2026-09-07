'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { NotificationItem } from '@anybid/shared';
import { browserClient } from '@/lib/client';
import { relativeTime } from '@/lib/format';

const TONE: Record<string, string> = {
  OUTBID: 'bg-amber-100 text-amber-700',
  AUCTION_WON: 'bg-deal-100 text-deal-700',
  AUCTION_LOST: 'bg-ink-100 text-ink-600',
  ITEM_SOLD: 'bg-deal-100 text-deal-700',
  PAYMENT_RECEIVED: 'bg-deal-100 text-deal-700',
  APPROVAL_REQUESTED: 'bg-bid-100 text-bid-700',
  AUCTION_ENDING: 'bg-amber-100 text-amber-700',
};

export function NotificationList({ initial }: { initial: NotificationItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const unread = items.filter((i) => !i.read).length;

  async function markAll() {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await browserClient.notifications.markAllRead().catch(() => undefined);
    router.refresh();
  }

  async function markOne(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    await browserClient.notifications.markRead(id).catch(() => undefined);
    router.refresh();
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
        <h2 className="text-sm font-bold text-ink-900">
          Notifications {unread > 0 && <span className="text-bid-600">({unread} unread)</span>}
        </h2>
        {unread > 0 && (
          <button type="button" onClick={markAll} className="text-xs font-medium text-bid-600 hover:underline">
            Mark all read
          </button>
        )}
      </div>

      <ul className="divide-y divide-ink-100">
        {items.map((n) => {
          const body = (
            <div className={clsx('flex gap-3 px-5 py-3', !n.read && 'bg-bid-50/40')}>
              <span className={clsx('badge h-fit shrink-0', TONE[n.type] ?? 'bg-ink-100 text-ink-600')}>
                {n.type.replace(/_/g, ' ').toLowerCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink-900">{n.title}</div>
                <div className="text-sm text-ink-600">{n.body}</div>
              </div>
              <span className="shrink-0 text-[11px] text-ink-400">{relativeTime(n.createdAt)}</span>
            </div>
          );

          return (
            <li key={n.id} onClick={() => !n.read && markOne(n.id)}>
              {n.link ? <Link href={n.link}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

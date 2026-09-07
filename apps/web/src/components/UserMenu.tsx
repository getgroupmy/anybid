'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ConsoleEntry, SessionUser } from '@anybid/shared';

export function UserMenu({ user, consoles }: { user: SessionUser; consoles: ConsoleEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-100"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
        ) : (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-200 text-xs font-bold">
            {user.displayName.charAt(0)}
          </span>
        )}
        <span className="hidden max-w-[9rem] truncate text-sm font-medium sm:block">
          {user.displayName}
        </span>
        {user.unreadNotifications > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-bid-600 px-1 text-[11px] font-bold text-white">
            {user.unreadNotifications > 9 ? '9+' : user.unreadNotifications}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg"
          role="menu"
        >
          <div className="border-b border-ink-100 px-4 py-3">
            <div className="truncate text-sm font-semibold">{user.displayName}</div>
            <div className="truncate text-xs text-ink-500">{user.email}</div>
            {user.orgName && (
              <div className="mt-1 truncate text-xs text-ink-500">{user.orgName}</div>
            )}
          </div>

          <div className="py-1">
            {consoles.map((c) => (
              <Link
                key={c.key}
                href={c.path}
                className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-100"
                onClick={() => setOpen(false)}
                role="menuitem"
              >
                {c.label}
              </Link>
            ))}
          </div>

          <div className="border-t border-ink-100 py-1">
            <Link
              href="/account/bids"
              className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-100"
              onClick={() => setOpen(false)}
            >
              My bids
            </Link>
            <Link
              href="/account/watchlist"
              className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-100"
              onClick={() => setOpen(false)}
            >
              Watchlist
            </Link>
            <Link
              href="/account/notifications"
              className="block px-4 py-2 text-sm text-ink-700 hover:bg-ink-100"
              onClick={() => setOpen(false)}
            >
              Notifications
              {user.unreadNotifications > 0 && (
                <span className="ml-2 text-xs font-semibold text-bid-600">
                  {user.unreadNotifications}
                </span>
              )}
            </Link>
          </div>

          <div className="border-t border-ink-100 py-1">
            <button
              type="button"
              className="block w-full px-4 py-2 text-left text-sm text-ink-700 hover:bg-ink-100"
              onClick={logout}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

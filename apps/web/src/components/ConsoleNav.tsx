'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import type { NavItem } from './ConsoleShell';

export function ConsoleNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-28 lg:h-fit lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active =
          pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition',
              active
                ? 'bg-bid-50 font-semibold text-bid-700'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
            )}
          >
            <span className="whitespace-nowrap">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-bid-600 px-1 text-[11px] font-bold text-white">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

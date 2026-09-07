import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConsoleNav } from './ConsoleNav';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

export function ConsoleShell({
  title,
  subtitle,
  nav,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  nav: NavItem[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
        </div>
        {actions}
      </div>

      <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
        <ConsoleNav items={nav} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  href?: string;
}) {
  const toneClass = {
    default: 'text-ink-900',
    good: 'text-deal-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
  }[tone];

  const content = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-500">{hint}</div>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="card p-4 transition hover:border-ink-300 hover:shadow-md">
        {content}
      </Link>
    );
  }
  return <div className="card p-4">{content}</div>;
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <h2 className="text-sm font-bold text-ink-900">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      <p className="mt-1 text-sm text-ink-500">{body}</p>
    </div>
  );
}

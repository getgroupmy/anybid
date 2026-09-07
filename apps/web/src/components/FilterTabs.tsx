'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function FilterTabs({
  param,
  tabs,
}: {
  param: string;
  tabs: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(param) ?? '';

  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            if (tab.value) next.set(param, tab.value);
            else next.delete(param);
            next.delete('page');
            router.push(`${pathname}?${next.toString()}`);
          }}
          className={
            current === tab.value
              ? 'rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white'
              : 'rounded-lg px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100'
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

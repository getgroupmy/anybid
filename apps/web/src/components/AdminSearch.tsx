'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function AdminSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const next = new URLSearchParams(params.toString());
        if (value.trim()) next.set('q', value.trim());
        else next.delete('q');
        next.delete('page');
        router.push(`${pathname}?${next.toString()}`);
      }}
      className="flex gap-2"
      role="search"
    >
      <input
        className="input max-w-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn-secondary">
        Search
      </button>
    </form>
  );
}

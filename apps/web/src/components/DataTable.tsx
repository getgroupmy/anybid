import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  empty,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  empty: ReactNode;
  rowKey: (row: T, index: number) => string;
}) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="table-head">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 ${
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="hover:bg-ink-50">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 ${
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                  } ${c.className ?? ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

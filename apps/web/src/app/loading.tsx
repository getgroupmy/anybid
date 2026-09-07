export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="h-8 w-56 animate-pulse rounded bg-ink-200" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="aspect-[4/3] animate-pulse bg-ink-200" />
            <div className="space-y-2 p-3">
              <div className="h-3 animate-pulse rounded bg-ink-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-ink-200" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

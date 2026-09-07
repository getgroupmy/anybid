'use client';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-bold text-ink-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-600">
        {error.message || 'The page could not be loaded.'}
      </p>
      <button type="button" className="btn-primary mt-6" onClick={reset}>
        Try again
      </button>
    </div>
  );
}

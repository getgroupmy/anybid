import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-3xl font-bold text-ink-900">Page not found</h1>
      <p className="mt-2 text-sm text-ink-600">
        The listing may have ended, or the link is wrong.
      </p>
      <Link href="/" className="btn-primary mt-6">
        Back to auctions
      </Link>
    </div>
  );
}

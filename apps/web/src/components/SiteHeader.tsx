import Link from 'next/link';
import { consolesFor, type Category, type SessionUser } from '@anybid/shared';
import { SearchBox } from './SearchBox';
import { UserMenu } from './UserMenu';

export function SiteHeader({
  user,
  categories,
}: {
  user: SessionUser | null;
  categories: Category[];
}) {
  const consoles = user ? consolesFor(user) : [];

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-bid-600 text-sm font-black text-white">
            AB
          </span>
          <span className="hidden text-lg font-bold tracking-tight text-ink-900 sm:block">
            AnyBid
          </span>
        </Link>

        <SearchBox className="flex-1" />

        <nav className="flex shrink-0 items-center gap-1">
          <Link href="/sell" className="btn-ghost hidden sm:inline-flex">
            Sell
          </Link>
          {user ? (
            <UserMenu user={user} consoles={consoles} />
          ) : (
            <>
              <Link href="/login" className="btn-ghost">
                Sign in
              </Link>
              <Link href="/register" className="btn-primary">
                Join
              </Link>
            </>
          )}
        </nav>
      </div>

      <div className="border-t border-ink-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4 py-2 text-sm">
          <Link
            href="/search?sort=ending_soon&endingWithinHours=24"
            className="whitespace-nowrap rounded-md px-2.5 py-1 font-medium text-bid-700 hover:bg-bid-50"
          >
            Ending today
          </Link>
          {categories.slice(0, 7).map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              className="whitespace-nowrap rounded-md px-2.5 py-1 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
            >
              {c.icon} {c.name}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}

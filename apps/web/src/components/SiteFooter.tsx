import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Buy',
    links: [
      ['Live auctions', '/search'],
      ['Ending today', '/search?endingWithinHours=24'],
      ['How bidding works', '/how-it-works'],
      ['Watchlist', '/account/watchlist'],
    ],
  },
  {
    title: 'Sell',
    links: [
      ['Start a listing', '/sell'],
      ['Seller fees', '/how-it-works#fees'],
      ['My listings', '/account/listings'],
    ],
  },
  {
    title: 'Business',
    links: [
      ['Advertise on AnyBid', '/advertiser'],
      ['Corporate procurement', '/corporate'],
      ['Bulk & wholesale', '/category/industrial-business'],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-ink-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-bid-600 text-sm font-black text-white">
              AB
            </span>
            <span className="text-lg font-bold">AnyBid</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-ink-500">
            Malaysia&apos;s bidding-first marketplace. Every listing is an auction, with proxy
            bidding and anti-sniping built in.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h3 className="text-sm font-semibold text-ink-900">{col.title}</h3>
            <ul className="mt-3 space-y-2">
              {col.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-ink-500 hover:text-bid-600">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-ink-100 py-4 text-center text-xs text-ink-400">
        © {new Date().getFullYear()} AnyBid Sdn Bhd · Prices in Malaysian Ringgit (MYR)
      </div>
    </footer>
  );
}

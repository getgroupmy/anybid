import Link from 'next/link';
import { DEFAULT_FEES, computeFees } from '@anybid/shared';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'How bidding works' };

const example = computeFees(1_000_00, DEFAULT_FEES);

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-ink-900">How bidding works on AnyBid</h1>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-bold text-ink-900">Proxy bidding</h2>
        <p className="text-sm leading-relaxed text-ink-700">
          You enter the most you are willing to pay — your maximum. AnyBid then bids on your behalf,
          raising your bid only as far as it needs to go to stay in front, one increment at a time.
        </p>
        <div className="card p-5 text-sm">
          <p className="font-medium text-ink-900">An example</p>
          <ol className="mt-3 space-y-2 text-ink-700">
            <li>
              An auction opens at {formatMoney(100_00)}. Aisha bids a maximum of{' '}
              {formatMoney(500_00)}. The price shows {formatMoney(100_00)} — her maximum stays
              hidden.
            </li>
            <li>
              Daniel bids {formatMoney(200_00)}. Aisha&apos;s proxy answers automatically: the price
              moves to {formatMoney(205_00)} and Aisha is still winning.
            </li>
            <li>
              Daniel bids {formatMoney(900_00)}. He beats Aisha&apos;s hidden maximum, so the price
              moves to {formatMoney(510_00)} — one increment above her maximum — and Daniel leads.
            </li>
          </ol>
          <p className="mt-3 text-ink-500">
            Daniel pays {formatMoney(510_00)}, not his {formatMoney(900_00)} maximum. You only ever
            pay what it takes to win.
          </p>
        </div>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-lg font-bold text-ink-900">Bid increments</h2>
        <p className="text-sm leading-relaxed text-ink-700">
          The minimum step between bids scales with the price, so a RM50 item is not fought over in
          one-sen steps and a RM50,000 car does not need a hundred bids to move.
        </p>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head">
                <th className="px-4 py-2">Current price</th>
                <th className="px-4 py-2 text-right">Minimum increment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {[
                ['Up to RM500', 'RM5.00'],
                ['RM500 – RM1,000', 'RM10.00'],
                ['RM1,000 – RM5,000', 'RM25.00'],
                ['RM5,000 – RM10,000', 'RM50.00'],
                ['RM10,000 – RM50,000', 'RM100.00'],
                ['RM50,000 – RM250,000', 'RM500.00'],
                ['Above RM250,000', 'RM1,000.00'],
              ].map(([range, step]) => (
                <tr key={range}>
                  <td className="px-4 py-2.5">{range}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{step}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-lg font-bold text-ink-900">Anti-sniping</h2>
        <p className="text-sm leading-relaxed text-ink-700">
          A bid placed in the closing window pushes the end time out by the same amount, so a
          last-second bid can always be answered. The auction ends when the bidding genuinely stops,
          not when the clock catches someone out. Sellers choose the window, up to five minutes.
        </p>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-lg font-bold text-ink-900">Reserve prices</h2>
        <p className="text-sm leading-relaxed text-ink-700">
          A seller can set a hidden floor. Bidders see only whether the reserve has been met. Once a
          bid clears it, the visible price jumps to the reserve. If the auction ends below it,
          nothing sells and the seller can relist.
        </p>
      </section>

      <section id="fees" className="mt-10 space-y-4">
        <h2 className="text-lg font-bold text-ink-900">Fees</h2>
        <p className="text-sm leading-relaxed text-ink-700">
          Buyers pay the hammer price plus shipping. Sellers pay a commission out of the sale.
        </p>
        <div className="card p-5 text-sm">
          <p className="font-medium text-ink-900">On a {formatMoney(1_000_00)} sale</p>
          <dl className="mt-3 space-y-1.5 text-ink-700">
            <Row label="Buyer pays" value={formatMoney(example.buyerTotal)} />
            <Row label="Commission (6%)" value={`− ${formatMoney(example.sellerCommission)}`} />
            <Row label="Seller receives" value={formatMoney(example.sellerPayout)} strong />
          </dl>
        </div>
      </section>

      <div className="mt-10 flex gap-3">
        <Link href="/search" className="btn-primary">
          Browse auctions
        </Link>
        <Link href="/sell" className="btn-secondary">
          Sell an item
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className={strong ? 'font-bold text-ink-900' : ''}>{value}</dd>
    </div>
  );
}

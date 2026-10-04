'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  effectiveIncrement,
  formatMoney,
  listingChannel,
  type ListingDetail,
  type ServerMessage,
  type SessionUser,
} from '@anybid/shared';
import { browserClient } from '@/lib/client';
import { useRealtime } from '@/lib/useRealtime';
import { moneyInputToMinor } from '@/lib/format';
import { Countdown } from './Countdown';

interface Props {
  listing: ListingDetail;
  viewer: SessionUser | null;
}

interface LiveState {
  currentPrice: number;
  minimumBid: number;
  bidCount: number;
  endsAt: string | null;
  /**
   * Our pseudonym on this listing if we are the leader, else whoever is. The
   * live feed carries a per-listing pseudonym rather than a user id, so this
   * is compared with `listing.viewer.myRef` and never resolved to a person.
   */
  leaderRef: string | null;
  reserveMet: boolean;
  status: string;
  lastEventAt: number;
}

/**
 * The live bidding panel: price and clock update over the socket as other
 * people bid, and an anti-snipe extension animates the countdown outward
 * rather than silently changing under the bidder.
 */
export function BidPanel({ listing, viewer }: Props) {
  const router = useRouter();
  const [live, setLive] = useState<LiveState>({
    currentPrice: listing.currentPrice,
    minimumBid: listing.minimumBid,
    bidCount: listing.bidCount,
    endsAt: listing.endsAt,
    leaderRef: listing.viewer?.isLeading ? (listing.viewer?.myRef ?? null) : null,
    reserveMet: listing.reserveMet,
    status: listing.status,
    lastEventAt: 0,
  });
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [extended, setExtended] = useState(false);

  const onMessage = useCallback((message: ServerMessage) => {
    if (message.t === 'bid') {
      setLive((prev) => ({
        ...prev,
        currentPrice: message.payload.currentPrice,
        minimumBid: message.payload.minimumBid,
        bidCount: message.payload.bidCount,
        endsAt: message.payload.endsAt,
        leaderRef: message.payload.leaderRef,
        reserveMet: message.payload.reserveMet,
        lastEventAt: Date.now(),
      }));
    } else if (message.t === 'extended') {
      setLive((prev) => ({ ...prev, endsAt: message.payload.endsAt }));
      setExtended(true);
      setTimeout(() => setExtended(false), 6000);
    } else if (message.t === 'closed') {
      setLive((prev) => ({ ...prev, status: message.payload.status, lastEventAt: Date.now() }));
      router.refresh();
    }
  }, [router]);

  const { connected } = useRealtime([listingChannel(listing.id)], onMessage);

  const isSeller = listing.viewer?.isSeller ?? false;
  const myRef = listing.viewer?.myRef ?? null;
  const isLeading = myRef !== null && live.leaderRef === myRef;
  const isLive = live.status === 'LIVE';
  const increment = useMemo(
    () => effectiveIncrement(live.currentPrice, listing.bidIncrement),
    [live.currentPrice, listing.bidIncrement],
  );

  const quickBids = useMemo(
    () => [live.minimumBid, live.minimumBid + increment * 2, live.minimumBid + increment * 5],
    [live.minimumBid, increment],
  );

  async function submitBid(maxAmount: number) {
    if (!viewer) {
      router.push(`/login?next=/listing/${listing.slug}`);
      return;
    }
    if (!Number.isFinite(maxAmount)) {
      setError('That is not an amount — enter what you are willing to pay.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await browserClient.bidding.place(listing.id, {
        maxAmount,
        expectedPrice: live.currentPrice,
      });
      if (!result.accepted) {
        setNotice(
          (result as unknown as { message: string }).message ??
            'Your bid needs approval before it can be placed.',
        );
      } else {
        setLive((prev) => ({
          ...prev,
          currentPrice: result.currentPrice,
          minimumBid: result.minimumBid,
          endsAt: result.endsAt,
          reserveMet: result.reserveMet,
          leaderRef: result.isLeading ? myRef : prev.leaderRef,
          lastEventAt: Date.now(),
        }));
        setNotice(
          result.isLeading
            ? "You're the highest bidder."
            : 'Another bidder has a higher maximum — you have been outbid.',
        );
        setAmount('');
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your bid could not be placed');
    } finally {
      setBusy(false);
    }
  }

  async function buyNow() {
    if (!viewer) {
      router.push(`/login?next=/listing/${listing.slug}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { order } = await browserClient.bidding.buyNow(listing.id, { quantity: 1 });
      router.push(`/account/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card sticky top-4 overflow-hidden">
      <div className="border-b border-ink-200 bg-ink-50 px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {live.bidCount > 0 ? 'Current bid' : 'Starting bid'}
          </span>
          <span
            className={clsx(
              'flex items-center gap-1.5 text-[11px]',
              connected ? 'text-deal-600' : 'text-ink-400',
            )}
            title={connected ? 'Live updates on' : 'Reconnecting…'}
          >
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full',
                connected ? 'animate-pulse bg-deal-500' : 'bg-ink-300',
              )}
            />
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        <div
          key={live.lastEventAt}
          className={clsx(
            'mt-1 text-3xl font-bold text-ink-900',
            live.lastEventAt > 0 && 'animate-price-pop',
          )}
        >
          {formatMoney(live.currentPrice)}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
          <span>{live.bidCount} {live.bidCount === 1 ? 'bid' : 'bids'}</span>
          {listing.hasReserve && (
            <span className={live.reserveMet ? 'text-deal-600' : 'text-amber-600'}>
              {live.reserveMet ? 'Reserve met' : 'Reserve not met'}
            </span>
          )}
          {isLeading && isLive && (
            <span className="badge bg-deal-100 text-deal-800">You are winning</span>
          )}
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-500">{isLive ? 'Closes in' : 'Closed'}</span>
          <Countdown endsAt={live.endsAt} className="font-medium" />
        </div>

        {extended && (
          <div className="animate-fade-up rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            A late bid extended this auction. Everyone gets a chance to answer.
          </div>
        )}

        {!isLive ? (
          <div className="rounded-lg bg-ink-100 px-3 py-3 text-center text-sm text-ink-600">
            {live.status === 'SOLD' ? 'This auction has sold.' : 'Bidding has closed.'}
          </div>
        ) : isSeller ? (
          <div className="rounded-lg bg-ink-100 px-3 py-3 text-center text-sm text-ink-600">
            This is your listing — you cannot bid on it.
          </div>
        ) : (
          <>
            {listing.kind !== 'BUY_NOW' && (
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="bid-amount">
                    Your maximum bid
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">
                      RM
                    </span>
                    <input
                      id="bid-amount"
                      className="input pl-10 text-base font-semibold"
                      inputMode="decimal"
                      placeholder={(live.minimumBid / 100).toFixed(2)}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-ink-500">
                    Enter the most you will pay. We bid only as much as needed to keep you in
                    front — minimum {formatMoney(live.minimumBid)}.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {quickBids.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmount((v / 100).toFixed(2))}
                      className="rounded-lg border border-ink-300 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:border-bid-400 hover:text-bid-700"
                    >
                      {formatMoney(v)}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={busy || !amount}
                  onClick={() => submitBid(moneyInputToMinor(amount))}
                >
                  {busy ? 'Placing…' : 'Place bid'}
                </button>
              </div>
            )}

            {listing.buyNowPrice && live.currentPrice < listing.buyNowPrice && (
              <div className="space-y-2 border-t border-ink-200 pt-4">
                <button type="button" className="btn-secondary w-full" disabled={busy} onClick={buyNow}>
                  Buy now for {formatMoney(listing.buyNowPrice)}
                </button>
                <p className="text-center text-xs text-ink-500">
                  Ends the auction immediately and creates your order.
                </p>
              </div>
            )}
          </>
        )}

        {listing.viewer?.requiresApproval && (
          <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600">
            Bids above your organisation&apos;s threshold are sent to an approver before they reach
            the auction.
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg bg-deal-50 px-3 py-2 text-sm text-deal-800" role="status">
            {notice}
          </p>
        )}

        {!viewer && (
          <p className="text-center text-xs text-ink-500">
            <a href={`/login?next=/listing/${listing.slug}`} className="font-medium text-bid-600 hover:underline">
              Sign in
            </a>{' '}
            to bid or buy.
          </p>
        )}
      </div>
    </div>
  );
}

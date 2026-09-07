import { applyBps, type Money } from './money.ts';
import { DEFAULT_INCREMENT_TIERS, effectiveIncrement, type IncrementTier } from './increments.ts';

export type ListingKind = 'AUCTION' | 'BUY_NOW' | 'AUCTION_WITH_BUY_NOW';

export type ListingStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'SCHEDULED'
  | 'LIVE'
  | 'ENDED'
  | 'SOLD'
  | 'UNSOLD'
  | 'CANCELLED'
  | 'SUSPENDED';

/** Everything the engine needs to know about the auction being bid on. */
export interface AuctionRules {
  kind: ListingKind;
  startPrice: Money;
  reservePrice?: Money | null;
  buyNowPrice?: Money | null;
  bidIncrement?: Money | null;
  /** ms before close inside which a bid extends the auction (0 = disabled) */
  antiSnipeWindowMs: number;
  /** ms the close time moves forward by when a snipe is detected */
  antiSnipeExtensionMs: number;
  /** hard ceiling on total extension; null = unlimited */
  maxExtensionMs?: number | null;
  tiers?: IncrementTier[];
  /** the seller — used to reject self-bidding (shill) attempts */
  sellerId?: string;
}

/** The mutable competitive state of an auction. */
export interface AuctionState {
  /** publicly displayed current price */
  currentPrice: Money;
  /** leading bidder, or null when there are no bids yet */
  leaderId: string | null;
  /** the leader's hidden proxy maximum */
  leaderMax: Money;
  bidCount: number;
  endsAt: number; // epoch ms
  originalEndsAt: number; // epoch ms, before any anti-snipe extension
}

export interface IncomingBid {
  bidderId: string;
  /** the bidder's proxy maximum — what they are willing to pay, not the current price */
  maxAmount: Money;
  at: number; // epoch ms
}

export type BidRejection =
  | 'AUCTION_NOT_LIVE'
  | 'AUCTION_ENDED'
  | 'AUCTION_NOT_STARTED'
  | 'SELF_BID'
  | 'BELOW_START_PRICE'
  | 'BELOW_MINIMUM_INCREMENT'
  | 'NOT_AN_AUCTION'
  | 'ALREADY_LEADING_LOWER'
  | 'BID_TOO_LARGE';

export interface BidRejected {
  ok: false;
  reason: BidRejection;
  /** the amount the bidder would need to submit to be accepted */
  minimumAcceptable: Money;
  message: string;
}

export interface BidAccepted {
  ok: true;
  state: AuctionState;
  /** true when the incoming bid took the lead */
  isLeading: boolean;
  /** the previous leader who just got outbid (null if none / unchanged) */
  outbidUserId: string | null;
  /** true when the close time moved because of anti-snipe */
  extended: boolean;
  extendedByMs: number;
  reserveMet: boolean;
  /** the price the bid is recorded at (the leader's committed max) */
  recordedMax: Money;
}

export type BidResult = BidAccepted | BidRejected;

/** Absolute ceiling for a single bid — guards fat-finger and overflow. */
export const MAX_BID: Money = 1_000_000_000_00; // RM1,000,000,000.00

function reject(reason: BidRejection, minimumAcceptable: Money, message: string): BidRejected {
  return { ok: false, reason, minimumAcceptable, message };
}

/**
 * The minimum a *new* bidder must offer for the bid to be accepted.
 * With no bids yet this is the start price; afterwards it is one increment
 * above the displayed price.
 */
export function minimumAcceptableBid(rules: AuctionRules, state: AuctionState): Money {
  const tiers = rules.tiers ?? DEFAULT_INCREMENT_TIERS;
  if (state.leaderId === null) return rules.startPrice;
  return state.currentPrice + effectiveIncrement(state.currentPrice, rules.bidIncrement, tiers);
}

/**
 * Core proxy ("automatic") bidding resolution — the same model eBay uses.
 *
 * A bidder submits the maximum they will pay. The engine only ever raises the
 * visible price to the amount needed to beat the runner-up by one increment,
 * so a bidder never pays their maximum unless someone pushed them there.
 *
 * Pure: no clock, no I/O. `bid.at` supplies the time so it is deterministic
 * and testable; the caller persists whatever this returns inside one
 * serialisable database transaction.
 */
export function placeBid(rules: AuctionRules, state: AuctionState, bid: IncomingBid): BidResult {
  const tiers = rules.tiers ?? DEFAULT_INCREMENT_TIERS;

  if (rules.kind === 'BUY_NOW') {
    return reject('NOT_AN_AUCTION', 0, 'This listing is fixed price and does not accept bids.');
  }
  if (bid.at >= state.endsAt) {
    return reject('AUCTION_ENDED', 0, 'Bidding has closed for this listing.');
  }
  if (bid.maxAmount > MAX_BID) {
    return reject('BID_TOO_LARGE', 0, 'That bid exceeds the maximum allowed on AnyBid.');
  }
  if (rules.sellerId && bid.bidderId === rules.sellerId) {
    return reject('SELF_BID', 0, 'You cannot bid on your own listing.');
  }

  const minimum = minimumAcceptableBid(rules, state);

  // Raising your own proxy maximum is allowed, but only upwards.
  const isLeaderRaising = state.leaderId === bid.bidderId;
  if (isLeaderRaising) {
    if (bid.maxAmount <= state.leaderMax) {
      return reject(
        'ALREADY_LEADING_LOWER',
        state.leaderMax + effectiveIncrement(state.leaderMax, rules.bidIncrement, tiers),
        'You are already the highest bidder — a new maximum must be higher than your current one.',
      );
    }
    const raised: AuctionState = {
      ...state,
      leaderMax: bid.maxAmount,
      bidCount: state.bidCount + 1,
    };
    // Raising the hidden maximum does not move the visible price, but it can
    // clear the reserve, which does.
    const reserveMet = isReserveMet(rules, raised.leaderMax);
    if (reserveMet && rules.reservePrice && raised.currentPrice < rules.reservePrice) {
      raised.currentPrice = Math.min(rules.reservePrice, raised.leaderMax);
    }
    const snipe = applyAntiSnipe(rules, raised, bid.at);
    return {
      ok: true,
      state: snipe.state,
      isLeading: true,
      outbidUserId: null,
      extended: snipe.extended,
      extendedByMs: snipe.extendedByMs,
      reserveMet,
      recordedMax: bid.maxAmount,
    };
  }

  if (state.leaderId === null && bid.maxAmount < rules.startPrice) {
    return reject('BELOW_START_PRICE', rules.startPrice, 'Your bid is below the starting price.');
  }
  if (state.leaderId !== null && bid.maxAmount < minimum) {
    return reject(
      'BELOW_MINIMUM_INCREMENT',
      minimum,
      'Your bid does not beat the current price by the minimum increment.',
    );
  }

  const next: AuctionState = { ...state, bidCount: state.bidCount + 1 };
  let outbidUserId: string | null = null;
  let isLeading: boolean;

  if (state.leaderId === null) {
    // First bid: the price sits at the start price, not at the bidder's max.
    next.leaderId = bid.bidderId;
    next.leaderMax = bid.maxAmount;
    next.currentPrice = rules.startPrice;
    isLeading = true;
  } else if (bid.maxAmount > state.leaderMax) {
    // Challenger wins: price climbs to one increment over the old leader's
    // maximum, capped at the challenger's own maximum.
    const step = effectiveIncrement(state.leaderMax, rules.bidIncrement, tiers);
    next.currentPrice = Math.min(bid.maxAmount, state.leaderMax + step);
    next.leaderId = bid.bidderId;
    next.leaderMax = bid.maxAmount;
    outbidUserId = state.leaderId;
    isLeading = true;
  } else {
    // Challenger loses to the standing proxy: the leader's price is pushed up
    // to one increment over the challenger, capped at the leader's maximum.
    // Ties go to the earlier bid.
    const step = effectiveIncrement(bid.maxAmount, rules.bidIncrement, tiers);
    next.currentPrice = Math.min(state.leaderMax, bid.maxAmount + step);
    isLeading = false;
  }

  // A bid at or above a hidden reserve pulls the visible price up to it.
  const reserveMet = isReserveMet(rules, next.leaderMax);
  if (reserveMet && rules.reservePrice && next.currentPrice < rules.reservePrice) {
    next.currentPrice = Math.min(rules.reservePrice, next.leaderMax);
  }

  const snipe = applyAntiSnipe(rules, next, bid.at);
  return {
    ok: true,
    state: snipe.state,
    isLeading,
    outbidUserId,
    extended: snipe.extended,
    extendedByMs: snipe.extendedByMs,
    reserveMet,
    recordedMax: bid.maxAmount,
  };
}

export function isReserveMet(rules: AuctionRules, highestMax: Money): boolean {
  if (!rules.reservePrice || rules.reservePrice <= 0) return true;
  return highestMax >= rules.reservePrice;
}

/**
 * Anti-sniping: a bid landing inside the closing window pushes the close time
 * out, so a last-second bid can always be answered. Honours `maxExtensionMs`
 * so an auction cannot be kept open indefinitely.
 */
export function applyAntiSnipe(
  rules: AuctionRules,
  state: AuctionState,
  at: number,
): { state: AuctionState; extended: boolean; extendedByMs: number } {
  if (rules.antiSnipeWindowMs <= 0 || rules.antiSnipeExtensionMs <= 0) {
    return { state, extended: false, extendedByMs: 0 };
  }
  const remaining = state.endsAt - at;
  if (remaining > rules.antiSnipeWindowMs) return { state, extended: false, extendedByMs: 0 };

  let target = at + rules.antiSnipeExtensionMs;
  if (rules.maxExtensionMs != null) {
    const ceiling = state.originalEndsAt + rules.maxExtensionMs;
    target = Math.min(target, ceiling);
  }
  if (target <= state.endsAt) return { state, extended: false, extendedByMs: 0 };

  const extendedByMs = target - state.endsAt;
  return { state: { ...state, endsAt: target }, extended: true, extendedByMs };
}

export type SettlementOutcome =
  | { result: 'SOLD'; winnerId: string; salePrice: Money }
  | { result: 'RESERVE_NOT_MET'; highestBidderId: string; highestBid: Money }
  | { result: 'NO_BIDS' };

/** Decides what happens when the clock runs out. */
export function settleAuction(rules: AuctionRules, state: AuctionState): SettlementOutcome {
  if (state.leaderId === null || state.bidCount === 0) return { result: 'NO_BIDS' };
  if (!isReserveMet(rules, state.leaderMax)) {
    return {
      result: 'RESERVE_NOT_MET',
      highestBidderId: state.leaderId,
      highestBid: state.currentPrice,
    };
  }
  return { result: 'SOLD', winnerId: state.leaderId, salePrice: state.currentPrice };
}

/* ------------------------------------------------------------------ */
/* Fees                                                                */
/* ------------------------------------------------------------------ */

export interface FeeSchedule {
  /** commission taken from the seller, in basis points */
  sellerCommissionBps: number;
  /** premium added on top of the hammer price for the buyer, in basis points */
  buyerPremiumBps: number;
  /** payment processing, in basis points */
  paymentProcessingBps: number;
  /** flat payment fee in minor units */
  paymentFlatFee: Money;
  /** commission is never less than this */
  minCommission: Money;
  /** commission is capped here (0 = uncapped) */
  maxCommission: Money;
}

export const DEFAULT_FEES: FeeSchedule = {
  sellerCommissionBps: 600, // 6%
  buyerPremiumBps: 0,
  paymentProcessingBps: 220, // 2.2%
  paymentFlatFee: 1_00, // RM1.00
  minCommission: 1_00,
  maxCommission: 500_00,
};

export interface FeeBreakdown {
  hammerPrice: Money;
  buyerPremium: Money;
  buyerTotal: Money;
  sellerCommission: Money;
  paymentFee: Money;
  sellerPayout: Money;
  platformRevenue: Money;
}

export function computeFees(hammerPrice: Money, fees: FeeSchedule = DEFAULT_FEES): FeeBreakdown {
  const buyerPremium = applyBps(hammerPrice, fees.buyerPremiumBps);
  const buyerTotal = hammerPrice + buyerPremium;

  let sellerCommission = applyBps(hammerPrice, fees.sellerCommissionBps);
  sellerCommission = Math.max(sellerCommission, fees.minCommission);
  if (fees.maxCommission > 0) sellerCommission = Math.min(sellerCommission, fees.maxCommission);

  const paymentFee = applyBps(buyerTotal, fees.paymentProcessingBps) + fees.paymentFlatFee;
  const sellerPayout = Math.max(0, hammerPrice - sellerCommission);
  const platformRevenue = sellerCommission + buyerPremium - paymentFee;

  return {
    hammerPrice,
    buyerPremium,
    buyerTotal,
    sellerCommission,
    paymentFee,
    sellerPayout,
    platformRevenue,
  };
}

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

export function msRemaining(endsAt: number | string | Date, now = Date.now()): number {
  const end = endsAt instanceof Date ? endsAt.getTime() : new Date(endsAt).getTime();
  return Math.max(0, end - now);
}

/** "2d 4h", "3h 12m", "4m 09s", "42s" — stable width-ish for countdown UI. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Ended';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Auctions closing inside this window get the "ending soon" treatment. */
export const ENDING_SOON_MS = 60 * 60 * 1000;

export function isEndingSoon(endsAt: number | string | Date, now = Date.now()): boolean {
  const ms = msRemaining(endsAt, now);
  return ms > 0 && ms <= ENDING_SOON_MS;
}

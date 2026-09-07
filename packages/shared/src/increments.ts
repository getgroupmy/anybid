import type { Money } from './money.ts';

/**
 * Minimum bid increment tiers (values in sen / minor units).
 * Modelled on Malaysian marketplace conventions — a listing may override
 * with a fixed `bidIncrement`, but never below the tier floor.
 */
export interface IncrementTier {
  /** inclusive lower bound of current price */
  from: Money;
  /** exclusive upper bound (Infinity for the last tier) */
  to: Money;
  increment: Money;
}

export const DEFAULT_INCREMENT_TIERS: IncrementTier[] = [
  { from: 0, to: 500_00, increment: 5_00 },
  { from: 500_00, to: 1_000_00, increment: 10_00 },
  { from: 1_000_00, to: 5_000_00, increment: 25_00 },
  { from: 5_000_00, to: 10_000_00, increment: 50_00 },
  { from: 10_000_00, to: 50_000_00, increment: 100_00 },
  { from: 50_000_00, to: 250_000_00, increment: 500_00 },
  { from: 250_000_00, to: Number.POSITIVE_INFINITY, increment: 1_000_00 },
];

export function tierIncrement(
  currentPrice: Money,
  tiers: IncrementTier[] = DEFAULT_INCREMENT_TIERS,
): Money {
  for (const t of tiers) {
    if (currentPrice >= t.from && currentPrice < t.to) return t.increment;
  }
  return tiers[tiers.length - 1]?.increment ?? 1_00;
}

/**
 * Effective increment for a listing: the listing's own increment when set,
 * otherwise the tier increment. A listing increment below the tier floor is
 * ignored so sellers cannot enable 1-sen bid wars.
 */
export function effectiveIncrement(
  currentPrice: Money,
  listingIncrement?: Money | null,
  tiers: IncrementTier[] = DEFAULT_INCREMENT_TIERS,
): Money {
  const floor = tierIncrement(currentPrice, tiers);
  if (!listingIncrement || listingIncrement <= 0) return floor;
  return Math.max(listingIncrement, floor);
}

/** The smallest amount a new bidder must commit to be allowed in. */
export function minimumBid(
  currentPrice: Money,
  hasBids: boolean,
  listingIncrement?: Money | null,
  tiers: IncrementTier[] = DEFAULT_INCREMENT_TIERS,
): Money {
  if (!hasBids) return currentPrice; // opening bid may equal the start price
  return currentPrice + effectiveIncrement(currentPrice, listingIncrement, tiers);
}

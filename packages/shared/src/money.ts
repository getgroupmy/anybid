/**
 * All monetary values in AnyBid are integer minor units (sen for MYR).
 * Never use floats for money.
 */

export type Money = number; // integer minor units

export const CURRENCY = {
  MYR: { code: 'MYR', symbol: 'RM', minorUnits: 100, locale: 'ms-MY' },
  SGD: { code: 'SGD', symbol: 'S$', minorUnits: 100, locale: 'en-SG' },
  USD: { code: 'USD', symbol: '$', minorUnits: 100, locale: 'en-US' },
} as const;

export type CurrencyCode = keyof typeof CURRENCY;

export function toMinor(major: number | string, currency: CurrencyCode = 'MYR'): Money {
  const n = typeof major === 'string' ? Number(major.replace(/[^0-9.-]/g, '')) : major;
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${major}`);
  return Math.round(n * CURRENCY[currency].minorUnits);
}

export function toMajor(minor: Money, currency: CurrencyCode = 'MYR'): number {
  return minor / CURRENCY[currency].minorUnits;
}

export function formatMoney(minor: Money, currency: CurrencyCode = 'MYR'): string {
  const c = CURRENCY[currency];
  const value = toMajor(minor, currency);
  return `${c.symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact display for cards/feeds: RM1.2k, RM3.4m */
export function formatMoneyCompact(minor: Money, currency: CurrencyCode = 'MYR'): string {
  const c = CURRENCY[currency];
  const v = toMajor(minor, currency);
  if (v >= 1_000_000) return `${c.symbol}${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}m`;
  if (v >= 1_000) return `${c.symbol}${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return formatMoney(minor, currency);
}

/** Percentage in basis points (100 bps = 1%). Rounds half-up. */
export function applyBps(amount: Money, bps: number): Money {
  return Math.round((amount * bps) / 10_000);
}

export function clampMoney(v: Money, min: Money, max: Money): Money {
  return Math.min(Math.max(v, min), max);
}

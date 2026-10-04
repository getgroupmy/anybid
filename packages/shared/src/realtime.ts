import type { Money } from './money.ts';

/** Messages the client sends over the realtime socket. */
export type ClientMessage =
  | { t: 'subscribe'; channels: string[] }
  | { t: 'unsubscribe'; channels: string[] }
  | { t: 'auth'; token: string }
  | { t: 'ping' };

/** Messages the server pushes. */
export type ServerMessage =
  | { t: 'ready'; userId: string | null; serverTime: number }
  | { t: 'pong'; serverTime: number }
  | { t: 'subscribed'; channels: string[] }
  | { t: 'error'; message: string }
  | { t: 'bid'; channel: string; payload: BidEvent }
  | { t: 'extended'; channel: string; payload: ExtendedEvent }
  | { t: 'closed'; channel: string; payload: ClosedEvent }
  | { t: 'watch'; channel: string; payload: { listingId: string; watchCount: number } }
  | { t: 'notification'; payload: { id: string; type: string; title: string; body: string; link: string | null } };

export interface BidEvent {
  listingId: string;
  currentPrice: Money;
  minimumBid: Money;
  bidCount: number;
  leaderMasked: string;
  /** Keyed per-listing pseudonym: compare it with your own, never resolve it. */
  leaderRef: string | null;
  reserveMet: boolean;
  endsAt: string;
  at: number;
}

export interface ExtendedEvent {
  listingId: string;
  endsAt: string;
  extendedByMs: number;
  reason: 'ANTI_SNIPE';
}

export interface ClosedEvent {
  listingId: string;
  status: 'SOLD' | 'UNSOLD';
  finalPrice: Money;
  winnerMasked: string | null;
  /** Keyed per-listing pseudonym: compare it with your own, never resolve it. */
  winnerRef: string | null;
}

export const listingChannel = (listingId: string) => `listing:${listingId}`;
export const userChannel = (userId: string) => `user:${userId}`;
export const orgChannel = (orgId: string) => `org:${orgId}`;

/** "ah***23" — bidder identity is masked in public bid history. */
export function maskHandle(handle: string): string {
  if (!handle) return 'b***r';
  const clean = handle.replace(/[^a-z0-9]/gi, '');
  if (clean.length <= 3) return `${clean.charAt(0)}***`;
  return `${clean.slice(0, 2)}***${clean.slice(-2)}`;
}

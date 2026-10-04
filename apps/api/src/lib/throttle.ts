/**
 * Per-account failure counting for sign-in.
 *
 * The per-IP limit on /v1/auth/login is the wrong instrument on its own. It
 * counts how fast one address is trying, and an address is cheap: a botnet has
 * thousands, and until the client IP became something a caller could not
 * choose it was simply a header. Neither case slows down someone working
 * through a password list against one known email.
 *
 * So failures are also counted against the account being attempted. Deliberately
 * a counter and not a lockout: a lockout hands anyone who knows an email
 * address a way to keep its owner out, which trades one person's problem for
 * another's. The window here expires on its own, with no reset step and no
 * administrator in the loop.
 *
 * In process, like the realtime hub, because the API is one node today. A
 * second node would need this in Postgres or Redis to be worth anything, and
 * the comment in server.ts about the rate limiter says the same.
 */

/** Failures against one account before it starts answering 429. */
export const MAX_ACCOUNT_FAILURES = 10;

/** How long a run of failures is remembered. */
export const ACCOUNT_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Accounts tracked at once.
 *
 * Keys are attacker-supplied, so this is a bound on memory, not a tuning knob.
 * Spraying past it evicts the stalest entry, which is the right thing to lose:
 * the entries that matter are the ones being hammered right now.
 */
const MAX_TRACKED_ACCOUNTS = 10_000;

interface Attempts {
  count: number;
  /** When this run of failures stops being remembered. */
  resetAt: number;
}

const attempts = new Map<string, Attempts>();

/** The same account however the email was capitalised or padded. */
function key(email: string): string {
  return email.trim().toLowerCase();
}

function live(entry: Attempts | undefined, now: number): Attempts | undefined {
  if (!entry) return undefined;
  return entry.resetAt > now ? entry : undefined;
}

/** Drops expired entries, then the oldest, until there is room for one more. */
function makeRoom(now: number): void {
  if (attempts.size < MAX_TRACKED_ACCOUNTS) return;
  for (const [k, entry] of attempts) if (entry.resetAt <= now) attempts.delete(k);
  while (attempts.size >= MAX_TRACKED_ACCOUNTS) {
    const oldest = attempts.keys().next();
    if (oldest.done) break;
    attempts.delete(oldest.value);
  }
}

/**
 * Whether this account has failed too often lately, and for how much longer.
 *
 * Takes `now` rather than reading the clock, so the window is testable without
 * waiting fifteen minutes.
 */
export function accountRetryAfterSec(email: string, now = Date.now()): number | null {
  const entry = live(attempts.get(key(email)), now);
  if (!entry || entry.count < MAX_ACCOUNT_FAILURES) return null;
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

/**
 * Records one failed sign-in against this account.
 *
 * The window is measured from the first failure of a run, not the last, so a
 * steady trickle of attempts cannot hold the counter open indefinitely.
 */
export function recordAccountFailure(email: string, now = Date.now()): void {
  const k = key(email);
  const entry = live(attempts.get(k), now);
  if (entry) {
    entry.count += 1;
    return;
  }
  makeRoom(now);
  attempts.set(k, { count: 1, resetAt: now + ACCOUNT_FAILURE_WINDOW_MS });
}

/** Forgets the run of failures — the password was right after all. */
export function clearAccountFailures(email: string): void {
  attempts.delete(key(email));
}

/** Test seam: nothing in the application resets this. */
export function resetAccountFailuresForTest(): void {
  attempts.clear();
}

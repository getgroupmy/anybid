/**
 * One answer per refresh token, shared by everyone who presents it at once.
 *
 * Rotation has to burn the presented token, and exactly one caller may do it —
 * otherwise one token mints a session per concurrent request, each with its own
 * thirty-day refresh token. Measured at twelve from twelve simultaneous calls,
 * of which the client keeps one and the rest live on invisibly. That is
 * precisely what rotating is meant to prevent.
 *
 * But the callers that lose are usually not attackers. The website refreshes
 * inside the last thirty seconds of the access token's life, and every parallel
 * request on a page presents the same cookie, so they all arrive together.
 * Refusing them means a visitor sees requests fail at a moment the application
 * chose, not them.
 *
 * So the first caller to arrive becomes the one that rotates, and the others
 * wait for its answer rather than racing it. Checking a cache is not enough:
 * the answer does not exist yet when the siblings look, which left ten of
 * twelve getting a 401 — so what is shared is the work in progress, not its
 * result. JavaScript's single thread is what makes claiming that slot
 * reliable; the conditional claim in the database is still there, and is what
 * holds if this cache is ever bypassed or a second node appears.
 *
 * The answer is then handed out for a few seconds more, for a sibling that
 * arrives slightly late. A token replayed after that gets nothing: the window
 * is seconds, and outside it a spent token is simply spent.
 *
 * Plaintext tokens live only here, in memory, for the length of the window.
 * The database stores nothing but their hashes and that does not change.
 * In process, like the realtime hub and the sign-in counter, because the API
 * is one node today.
 */

/** How long a completed answer is still handed out. */
export const REFRESH_GRACE_MS = 20_000;

/** A bound on memory, not a tuning knob: keys come from callers. */
const MAX_IN_FLIGHT = 5_000;

interface Entry {
  answer: Promise<unknown>;
  /** Set once the answer is known; until then the entry cannot be swept. */
  expiresAt: number | null;
}

const entries = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [k, entry] of entries) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) entries.delete(k);
  }
  while (entries.size >= MAX_IN_FLIGHT) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

/**
 * Runs `issue` once for this token, and gives everyone else the same answer.
 *
 * Keyed by the hash the database stores, never by the token itself. A failure
 * is not remembered, so a token that genuinely cannot be refreshed is refused
 * again on its own merits rather than from here.
 */
export function refreshOnce<T>(
  refreshHash: string,
  issue: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const existing = entries.get(refreshHash);
  if (existing && (existing.expiresAt === null || existing.expiresAt > now)) {
    return existing.answer as Promise<T>;
  }

  sweep(now);
  // Single-threaded, so this slot is taken exactly once and whoever takes it
  // is the one that rotates. Registered before the work starts, which is the
  // whole point: the siblings have something to wait on.
  const entry: Entry = { answer: Promise.resolve(), expiresAt: null };
  entries.set(refreshHash, entry);

  const answer = (async () => {
    try {
      const result = await issue();
      entry.expiresAt = Date.now() + REFRESH_GRACE_MS;
      return result;
    } catch (err) {
      entries.delete(refreshHash);
      throw err;
    }
  })();

  entry.answer = answer;
  return answer;
}

/** Test seam: nothing in the application clears this wholesale. */
export function resetRefreshGraceForTest(): void {
  entries.clear();
}

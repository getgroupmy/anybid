import 'server-only';

/**
 * Resolves to `null` when an API call fails instead of throwing.
 *
 * A page that awaits several API calls in one `Promise.all` dies entirely if
 * any one of them rejects — a single unreachable dependency then replaces the
 * whole page with an error boundary. Wrapping each call lets a page render
 * everything it still has and show an honest notice for the rest.
 *
 * Genuine 404s are a different matter: those should reach `notFound()`, so
 * callers that care use their own try/catch instead.
 */
export async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    // Server-side only; the visitor sees the fallback UI, not this.
    console.error('[anybid] API call failed, rendering degraded:', describe(error));
    return null;
  }
}

/** An empty page of results, so a list renders as "nothing" rather than crashing. */
export function emptyPage<T>() {
  return { items: [] as T[], page: 1, perPage: 0, total: 0, totalPages: 1 };
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}

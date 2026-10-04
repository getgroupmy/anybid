import 'server-only';
import { cookies } from 'next/headers';
import { AnyBidClient } from '@anybid/shared';
import {
  API_TIMEOUT_MS,
  API_URL,
  SESSION_COOKIE,
  decodeSession,
  encodeSession,
  type StoredSession,
} from './config';

export { encodeSession };
export type { StoredSession };

/** Reads the httpOnly session cookie set by the auth route handlers. */
export async function readSession(): Promise<StoredSession | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

/**
 * A client bound to the caller's session, for use in server components.
 *
 * The token is used as given and deliberately not refreshed here. A server
 * component cannot write a cookie, so a refresh from this call would rotate the
 * session's refresh token and then throw the new one away — leaving the stored
 * one burned and the visitor unable to refresh ever again. Keeping the cookie
 * fresh is the middleware's job, which runs where a cookie can be set.
 */
export async function serverClient(): Promise<AnyBidClient> {
  const session = await readSession();
  return new AnyBidClient({
    baseUrl: API_URL,
    token: session?.tokens.accessToken ?? null,
    // Tighter than the client's default, because a page render cannot wait as
    // long as a person watching a spinner will. Set as the option rather than a
    // signal inside fetchImpl: the client sets its own signal on the request,
    // and whichever of the two is spread last would silently win.
    timeoutMs: API_TIMEOUT_MS,
    fetchImpl: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
}

export async function requireSession(): Promise<StoredSession> {
  const session = await readSession();
  if (!session) throw new Error('UNAUTHENTICATED');
  return session;
}

import { NextRequest, NextResponse } from 'next/server';
import {
  API_URL,
  SESSION_COOKIE,
  accessTokenIsStale,
  decodeSession,
  encodeSession,
  sessionCookieOptions,
  REFRESH_TIMEOUT_MS,
} from '@/lib/config';

/**
 * Keeps the session cookie's access token fresh before a page renders.
 *
 * The access token lives fifteen minutes and the cookie holding it lives a
 * month. The API proxy refreshes it for browser calls, but server components
 * cannot: Next does not let them write a cookie, so they used the token as
 * stored. Fifteen minutes after signing in, every server-rendered account page
 * called the API with an expired token, the 401 reached no handler, and the
 * visitor got "Something went wrong" under a header still showing their name.
 * Measured on /account/orders with a five-second token: the page rendered, and
 * eight seconds later it was the error boundary, and stayed there.
 *
 * Middleware is where this belongs, because it runs before the page and can set
 * a cookie — and the cookie it sets reaches the render that follows, not just
 * the browser, so the page is served with the fresh token rather than being
 * fixed by the next navigation. Verified against a production build, since
 * middleware does not behave the same in dev: the documented belt-and-braces
 * form, writing the cookie onto the forwarded request as well, changed nothing
 * on Next 15 and is left out.
 *
 * A refresh that fails is a session that is over — the token was rotated away
 * or revoked — so the cookie is dropped and the visitor is offered sign-in
 * instead of an error. Racing a proxy call is fine: the API shares one answer
 * for concurrent refreshes of the same token.
 */
export async function middleware(req: NextRequest) {
  const session = decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.next();
  if (!accessTokenIsStale(session.tokens)) return NextResponse.next();

  let tokens: typeof session.tokens | null = null;
  try {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.tokens.refreshToken }),
      cache: 'no-store',
      // This runs in front of every page, so it must not be able to hold one
      // open. `fetch` rejects when a connection fails but waits for ever on a
      // connection that is accepted and never answered — an API that is slow
      // rather than down — and without a bound that stalls the whole site for
      // every signed-in visitor, which is worse than the stale token this is
      // here to replace. A refresh takes milliseconds; anything near this is
      // already broken.
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (res.ok) tokens = ((await res.json()) as { tokens: typeof session.tokens }).tokens;
  } catch {
    // Unreachable, or too slow to wait for. Leaving the cookie alone is right
    // either way: the visitor's session is not over, our side is struggling,
    // and the page will say so rather than signing them out over it.
    return NextResponse.next();
  }

  if (!tokens) {
    const expired = NextResponse.next();
    expired.cookies.delete(SESSION_COOKIE);
    return expired;
  }

  const response = NextResponse.next();
  response.cookies.set(
    SESSION_COOKIE,
    encodeSession({ ...session, tokens }),
    sessionCookieOptions(),
  );
  return response;
}

export const config = {
  /**
   * Pages only. `/api/proxy` refreshes and re-stamps the cookie itself, the
   * auth routes are what issue it, and static assets have no session to keep.
   */
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};

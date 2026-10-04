import { NextRequest, NextResponse } from 'next/server';
import {
  API_TIMEOUT_MS,
  API_URL,
  REFRESH_TIMEOUT_MS,
  SESSION_COOKIE,
  accessTokenIsStale,
  encodeSession,
  sessionCookieOptions,
} from '@/lib/config';
import { readSession } from '@/lib/session';
import { clientHeaders } from '@/lib/upstream';

/**
 * Server-side proxy to the AnyBid API.
 *
 * The access token is held in an httpOnly cookie, so browser code never sees
 * it; this route attaches it on the way through. It also refreshes an expired
 * access token transparently and re-stamps the cookie.
 */
async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const search = req.nextUrl.search;
  const target = `${API_URL}/${path.join('/')}${search}`;

  const session = await readSession();
  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('accept', 'application/json');
  // Not the visitor's own x-forwarded-for, which they can set to anything.
  for (const [name, value] of Object.entries(clientHeaders(req))) headers.set(name, value);

  let accessToken = session?.tokens.accessToken;
  let refreshed: { accessToken: string; refreshToken: string; expiresAt: number } | null = null;

  if (session && accessTokenIsStale(session.tokens)) {
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...clientHeaders(req) },
        body: JSON.stringify({ refreshToken: session.tokens.refreshToken }),
        cache: 'no-store',
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as { tokens: typeof session.tokens };
        refreshed = data.tokens;
        accessToken = data.tokens.accessToken;
      }
    } catch {
      // Unreachable or too slow. Not fatal: the call below goes out with the
      // token we have and the browser gets the API's own answer to it, which
      // beats a 500 from here.
    }
  }
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const body =
    req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

  // Bounded for the same reason as the server client: an API that never
  // answers would otherwise hold this request, and the browser's, open.
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    // Unreachable, or past the bound above. This used to be an unhandled throw
    // and a bare 500; the auth routes already answer this case properly, so
    // this one does too.
    console.error('[anybid] proxy upstream unreachable:', error);
    return NextResponse.json(
      {
        statusCode: 503,
        error: 'SERVICE_UNAVAILABLE',
        message: 'The AnyBid service is not responding. Please try again shortly.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const text = await upstream.text();
  const response = new NextResponse(text || null, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });

  if (refreshed && session) {
    response.cookies.set(
      SESSION_COOKIE,
      encodeSession({ ...session, tokens: refreshed }),
      sessionCookieOptions(),
    );
  }

  return response;
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;

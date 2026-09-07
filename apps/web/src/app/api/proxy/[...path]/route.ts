import { NextRequest, NextResponse } from 'next/server';
import { API_URL, SESSION_COOKIE } from '@/lib/config';
import { readSession } from '@/lib/session';

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
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) headers.set('x-forwarded-for', forwarded);

  let accessToken = session?.tokens.accessToken;
  let refreshed: { accessToken: string; refreshToken: string; expiresAt: number } | null = null;

  if (session && session.tokens.expiresAt - 30_000 < Date.now()) {
    const res = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.tokens.refreshToken }),
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as { tokens: typeof session.tokens };
      refreshed = data.tokens;
      accessToken = data.tokens.accessToken;
    }
  }
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const body =
    req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    cache: 'no-store',
  });

  const text = await upstream.text();
  const response = new NextResponse(text || null, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });

  if (refreshed && session) {
    const { encodeSession } = await import('@/lib/session');
    response.cookies.set(SESSION_COOKIE, encodeSession({ ...session, tokens: refreshed }), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;

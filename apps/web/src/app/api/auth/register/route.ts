import { NextRequest, NextResponse } from 'next/server';
import { API_URL, SESSION_COOKIE } from '@/lib/config';
import { encodeSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const upstream = await fetch(`${API_URL}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    cache: 'no-store',
  });
  const data = await upstream.json();

  if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

  const response = NextResponse.json({ user: data.user });
  response.cookies.set(SESSION_COOKIE, encodeSession({ tokens: data.tokens, user: data.user }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

import { NextRequest, NextResponse } from 'next/server';
import {
  API_TIMEOUT_MS,
  API_URL,
  SESSION_COOKIE,
  encodeSession,
  sessionCookieOptions,
} from '@/lib/config';
import { clientHeaders } from '@/lib/upstream';

export async function POST(req: NextRequest) {
  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...clientHeaders(req) },
      body,
      cache: 'no-store',
      // Its catch already answers 503; without this it could wait for ever on
      // an API that accepts the connection and never replies.
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    // The marketplace service is unreachable from the server. This is ours,
    // not the visitor's network, and saying so saves them debugging their wifi.
    console.error('[anybid] auth upstream unreachable:', error);
    return NextResponse.json(
      {
        error: 'SERVICE_UNAVAILABLE',
        message:
          'Sign-in is temporarily unavailable — we could not reach the AnyBid service. Please try again shortly.',
      },
      { status: 503 },
    );
  }

  const data = await upstream.json();

  if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

  const response = NextResponse.json({ user: data.user });
  response.cookies.set(
    SESSION_COOKIE,
    encodeSession({ tokens: data.tokens, user: data.user }),
    sessionCookieOptions(),
  );
  return response;
}

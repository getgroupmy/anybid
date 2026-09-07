import { NextResponse } from 'next/server';
import { API_URL, SESSION_COOKIE } from '@/lib/config';
import { readSession } from '@/lib/session';

export async function POST() {
  const session = await readSession();
  if (session) {
    await fetch(`${API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.tokens.accessToken}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

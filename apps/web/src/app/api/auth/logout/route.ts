import { NextResponse } from 'next/server';
import { API_URL, SESSION_COOKIE, accessTokenIsStale } from '@/lib/config';
import { readSession } from '@/lib/session';

export async function POST() {
  const session = await readSession();

  // Whatever happens upstream, this browser is signed out.
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  if (!session) return response;

  /**
   * Revoking server-side needs a token the API will accept, and fifteen minutes
   * after signing in the stored one is not. This used to send it anyway: the API
   * answered 401, the catch below swallowed it, and the session was never
   * revoked — so signing out of a tab that had been left open deleted the cookie
   * here and left a thirty-day refresh token live there. Measured: after signing
   * out, the captured refresh token still minted a new session.
   *
   * Refreshing first fixes it twice over. The rotation burns the stored refresh
   * token on its own, and the access token it returns is one the logout endpoint
   * will accept, so every live session for the account is revoked.
   */
  let accessToken = session.tokens.accessToken;
  if (accessTokenIsStale(session.tokens)) {
    try {
      const refreshed = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.tokens.refreshToken }),
        cache: 'no-store',
      });
      if (refreshed.ok) {
        const data = (await refreshed.json()) as { tokens: { accessToken: string } };
        accessToken = data.tokens.accessToken;
      }
      // A refresh that fails means the session was already spent or revoked,
      // which is the state we were trying to reach. Nothing left to do.
    } catch {
      // Unreachable API — fall through and try the stored token anyway.
    }
  }

  try {
    const revoked = await fetch(`${API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!revoked.ok) {
      // Worth saying out loud: the cookie is gone but a credential may not be.
      console.error('[anybid] sign-out did not revoke the session:', revoked.status);
    }
  } catch (error) {
    console.error('[anybid] sign-out could not reach the API:', error);
  }

  return response;
}

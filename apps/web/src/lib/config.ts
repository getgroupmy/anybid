import type { Tokens, SessionUser } from '@anybid/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? API_URL.replace(/^http/, 'ws') + '/realtime';
export const SESSION_COOKIE = 'anybid_session';

export interface StoredSession {
  tokens: Tokens;
  user: SessionUser;
}

/**
 * The session cookie's wire format and flags, in one place.
 *
 * Four things read or write this cookie — the login and register routes, the
 * API proxy, the server components' client, and the middleware that keeps it
 * fresh — and three of them run in different runtimes. So the codec avoids
 * Buffer, which middleware does not have on the edge, and the flags are
 * written once rather than copied into each route.
 */
export function encodeSession(session: StoredSession): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(session)));
}

export function decodeSession(raw: string | undefined): StoredSession | null {
  if (!raw) return null;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(raw));
    const parsed = JSON.parse(json) as StoredSession;
    // A cookie from an older format, or a truncated one, is no session at all.
    if (!parsed?.tokens?.refreshToken || typeof parsed.tokens.expiresAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A month, matching the API's refresh token, which is what makes it last. */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

/**
 * Refreshing is worth doing slightly early: a token that expires while the
 * request is still in flight is as useless as one that already had.
 */
export const REFRESH_SKEW_MS = 30_000;

export function accessTokenIsStale(tokens: Tokens, now = Date.now()): boolean {
  return tokens.expiresAt - REFRESH_SKEW_MS < now;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

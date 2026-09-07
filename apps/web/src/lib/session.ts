import 'server-only';
import { cookies } from 'next/headers';
import { AnyBidClient, type SessionUser, type Tokens } from '@anybid/shared';
import { API_URL, SESSION_COOKIE } from './config';

export interface StoredSession {
  tokens: Tokens;
  user: SessionUser;
}

/** Reads the httpOnly session cookie set by the auth route handlers. */
export async function readSession(): Promise<StoredSession | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as StoredSession;
  } catch {
    return null;
  }
}

export function encodeSession(session: StoredSession): string {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
}

/** A client bound to the caller's session, for use in server components. */
export async function serverClient(): Promise<AnyBidClient> {
  const session = await readSession();
  return new AnyBidClient({
    baseUrl: API_URL,
    token: session?.tokens.accessToken ?? null,
    fetchImpl: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
}

export async function requireSession(): Promise<StoredSession> {
  const session = await readSession();
  if (!session) throw new Error('UNAUTHENTICATED');
  return session;
}

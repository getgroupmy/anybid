import type { NextRequest } from 'next/server';

/**
 * Telling the API who is really calling.
 *
 * Browser traffic reaches the API as visitor -> Vercel -> Caddy -> API, so the
 * only address Caddy can vouch for is Vercel's. Without this every web visitor
 * would share one rate-limit key and one line in the audit log.
 *
 * What this must not do is pass the visitor's own X-Forwarded-For through,
 * which is what the proxy route used to do. That header is set by whoever is
 * calling, so forwarding it let a visitor name any address they liked: eight
 * registrations went through a limit of five, and the audit log recorded
 * addresses that were never involved.
 *
 * So the address is taken from what the platform determined, and sent under a
 * secret shared with the API. The API ignores the claim unless the secret
 * matches, and ignores it entirely when no secret is configured — coarse but
 * honest, rather than trusting a header because it has our name on it.
 */
export function clientHeaders(req: NextRequest): Record<string, string> {
  const secret = process.env.PROXY_SHARED_SECRET ?? '';
  const ip = endUserIp(req);
  if (!secret || !ip) return {};
  return { 'x-anybid-client-ip': ip, 'x-anybid-proxy-secret': secret };
}

/**
 * The visitor's address as the platform in front of us reports it.
 *
 * `x-real-ip` first, which Vercel sets to the client address as a single
 * value. Otherwise the *last* entry of X-Forwarded-For: entries are appended
 * left to right as a request passes through hops, so the rightmost is the one
 * the nearest hop wrote and the leftmost is whatever the caller invented. That
 * ordering holds whether the platform overwrites the header or appends to it,
 * which is why it is read from this end.
 */
function endUserIp(req: NextRequest): string | null {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;

  const forwarded = req.headers.get('x-forwarded-for');
  if (!forwarded) return null;
  const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
  return hops.length > 0 ? hops[hops.length - 1]! : null;
}

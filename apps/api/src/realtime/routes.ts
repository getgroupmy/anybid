import type { FastifyInstance } from 'fastify';
import { listingChannel, maskHandle, minimumBid, type ClientMessage } from '@anybid/shared';
import { prisma } from '../db.ts';
import { listingPseudonym, verifyAccessToken } from '../lib/crypto.ts';
import { hub, type RealtimeClient } from './hub.ts';

/**
 * Tells a new subscriber where each auction actually is.
 *
 * Subscribing used to register the client and say nothing else, so everything
 * it knew came from the next bid somebody else placed. That is fine on a first
 * page load, which fetched the listing over HTTP a moment earlier. It is not
 * fine on a reconnect: the socket drops when a phone sleeps, a network changes,
 * the heartbeat reaps a stale connection or the API restarts, and the client
 * resubscribes and goes back to showing the price from before it dropped — with
 * the indicator back on "Live", which is worse than showing nothing, because it
 * says the number is current. Nothing arrives to correct it until another
 * bidder moves, and near a close that is exactly when it matters.
 *
 * Sent in the same shape as a live bid, so every client already handles it and
 * neither the website nor the app needs to change. Built from the row the same
 * way `listingDto` does, so a snapshot and a page fetch agree.
 */
export async function sendListingState(client: RealtimeClient, channels: string[]): Promise<void> {
  const ids = channels
    .filter((channel) => channel.startsWith('listing:'))
    .map((channel) => channel.slice('listing:'.length))
    .filter(Boolean);
  if (ids.length === 0) return;

  const listings = await prisma.listing.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      currentPrice: true,
      bidCount: true,
      bidIncrement: true,
      reserveMet: true,
      endsAt: true,
      leaderId: true,
    },
  });

  // Listing has no relation to its leader, only the id — the same reason the
  // bid path looks the handle up separately. One query for all of them.
  const leaderIds = listings.map((l) => l.leaderId).filter((id): id is string => id !== null);
  const handles = new Map(
    leaderIds.length === 0
      ? []
      : (
          await prisma.user.findMany({
            where: { id: { in: leaderIds } },
            select: { id: true, handle: true },
          })
        ).map((u) => [u.id, u.handle] as const),
  );

  for (const listing of listings) {
    hub.send(client, {
      t: 'bid',
      channel: listingChannel(listing.id),
      payload: {
        listingId: listing.id,
        currentPrice: listing.currentPrice,
        minimumBid: minimumBid(listing.currentPrice, listing.bidCount > 0, listing.bidIncrement),
        bidCount: listing.bidCount,
        leaderMasked: maskHandle(listing.leaderId ? (handles.get(listing.leaderId) ?? '') : ''),
        // A pseudonym, never the leader's id: this channel is public, and the
        // live path is careful about the same thing.
        leaderRef: listing.leaderId ? listingPseudonym(listing.id, listing.leaderId) : null,
        reserveMet: Boolean(listing.reserveMet),
        endsAt: (listing.endsAt ?? new Date()).toISOString(),
        at: Date.now(),
      },
    });
  }
}

/**
 * `GET /realtime` — the live auction socket.
 *
 * Auth is optional: anyone can watch a listing channel, but private channels
 * (`user:<id>`) only accept the owner, enforced inside the hub.
 *
 * Clients should authenticate with an `auth` message once connected, not with
 * `?token=`. A URL is the wrong place for a credential: it reaches every
 * request log between the client and here, and ours wrote the whole token
 * until the serialiser in server.ts began redacting it — which does nothing
 * for a reverse proxy's own access log. `?token=` is still accepted so an
 * older build of the app keeps working, and is redacted where we log.
 */
export async function realtimeRoutes(app: FastifyInstance) {
  app.get('/realtime', { websocket: true }, (socket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    const header = req.headers.authorization;
    const token = queryToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : null);
    const payload = token ? verifyAccessToken(token) : null;

    const client = hub.add(socket as never, null);
    if (payload) hub.authenticate(client, payload.sub);
    hub.send(client, { t: 'ready', userId: client.userId, serverTime: Date.now() });

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        hub.send(client, { t: 'error', message: 'Malformed message' });
        return;
      }

      switch (msg.t) {
        case 'subscribe': {
          const accepted = hub.subscribe(client, msg.channels ?? []);
          hub.send(client, { t: 'subscribed', channels: accepted });
          // Not awaited: the socket handler is synchronous, and a failed or slow
          // read must not take the connection down. A client that misses this
          // is where it was before — stale, not broken.
          void sendListingState(client, accepted).catch((err) => {
            req.log.error({ err }, 'could not send listing state on subscribe');
          });
          break;
        }
        case 'unsubscribe':
          hub.unsubscribe(client, msg.channels ?? []);
          break;
        case 'auth': {
          const next = verifyAccessToken(msg.token);
          if (next) {
            // Through the hub, so signing in as a second account releases the
            // first account's private channel instead of keeping both.
            hub.authenticate(client, next.sub);
            hub.send(client, { t: 'ready', userId: next.sub, serverTime: Date.now() });
          } else {
            hub.send(client, { t: 'error', message: 'Invalid token' });
          }
          break;
        }
        case 'ping':
          client.alive = true;
          hub.send(client, { t: 'pong', serverTime: Date.now() });
          break;
      }
    });

    socket.on('close', () => hub.remove(client));
    socket.on('error', () => hub.remove(client));
  });
}

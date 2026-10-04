import type { FastifyInstance } from 'fastify';
import type { ClientMessage } from '@anybid/shared';
import { verifyAccessToken } from '../lib/crypto.ts';
import { hub } from './hub.ts';

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

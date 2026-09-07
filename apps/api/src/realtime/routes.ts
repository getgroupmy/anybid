import type { FastifyInstance } from 'fastify';
import type { ClientMessage } from '@anybid/shared';
import { verifyAccessToken } from '../lib/crypto.ts';
import { hub } from './hub.ts';

/**
 * `GET /realtime` — the live auction socket.
 *
 * Auth is optional: anyone can watch a listing channel, but private channels
 * (`user:<id>`) only accept the owner, enforced inside the hub.
 */
export async function realtimeRoutes(app: FastifyInstance) {
  app.get('/realtime', { websocket: true }, (socket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    const header = req.headers.authorization;
    const token = queryToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : null);
    const payload = token ? verifyAccessToken(token) : null;

    const client = hub.add(socket as never, payload?.sub ?? null);
    hub.send(client, { t: 'ready', userId: client.userId, serverTime: Date.now() });

    // Auto-subscribe an authenticated client to its own notification channel.
    if (client.userId) hub.subscribe(client, [`user:${client.userId}`]);

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
            client.userId = next.sub;
            hub.subscribe(client, [`user:${next.sub}`]);
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

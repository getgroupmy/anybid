import type { WebSocket } from 'ws';
import { userChannel, type ServerMessage } from '@anybid/shared';

/** Channels one `subscribe` message may ask for. */
const MAX_CHANNELS_PER_MESSAGE = 50;

/**
 * Channels one socket may hold at once.
 *
 * A listing page needs two or three. The marketplace index watching a screen
 * of cards needs a few dozen, so this leaves generous room while putting a
 * ceiling on what a single connection can make the server allocate.
 */
const MAX_CHANNELS_PER_CLIENT = 200;

interface Client {
  socket: WebSocket;
  userId: string | null;
  channels: Set<string>;
  alive: boolean;
}

/**
 * In-process pub/sub for live auction updates.
 *
 * Single-node by design: `publish` is the only write path, so swapping in a
 * Redis fan-out later means changing this one class and nothing else.
 */
export class RealtimeHub {
  private readonly clients = new Set<Client>();
  private readonly byChannel = new Map<string, Set<Client>>();

  add(socket: WebSocket, userId: string | null): Client {
    const client: Client = { socket, userId, channels: new Set(), alive: true };
    this.clients.add(client);
    return client;
  }

  remove(client: Client): void {
    for (const channel of client.channels) {
      const set = this.byChannel.get(channel);
      set?.delete(client);
      if (set && set.size === 0) this.byChannel.delete(channel);
    }
    this.clients.delete(client);
  }

  /**
   * Binds this socket to a user, releasing whoever it was bound to before.
   *
   * The release is the point. Reassigning `userId` on its own leaves the
   * previous user's private channel in this client's subscription set, because
   * membership was granted when the guard in `subscribe` saw the old identity
   * — so the socket keeps receiving their notifications, which carry what they
   * won, what they owe and what they were paid. One socket that signs in as a
   * second account, which is what logging out and back in without a reconnect
   * looks like, is enough.
   */
  authenticate(client: Client, userId: string): void {
    if (client.userId && client.userId !== userId) {
      this.unsubscribe(client, [userChannel(client.userId)]);
    }
    client.userId = userId;
    this.subscribe(client, [userChannel(userId)]);
  }

  subscribe(client: Client, channels: string[]): string[] {
    const accepted: string[] = [];
    for (const raw of channels.slice(0, MAX_CHANNELS_PER_MESSAGE)) {
      const channel = String(raw).slice(0, 120);
      // Private channels are only readable by their owner, and a socket that
      // has not signed in owns none of them. Comparing against an empty id
      // would make the literal channel "user:" everybody's.
      if (channel.startsWith('user:')) {
        if (!client.userId || channel !== userChannel(client.userId)) continue;
      }
      // The per-message cap above means nothing on its own: nothing limits how
      // many messages a socket sends, so one anonymous connection could make
      // the server hold as many channels as it cared to name. Measured at
      // 10,000 from 200 messages before this.
      if (!client.channels.has(channel) && client.channels.size >= MAX_CHANNELS_PER_CLIENT) break;
      client.channels.add(channel);
      let set = this.byChannel.get(channel);
      if (!set) this.byChannel.set(channel, (set = new Set()));
      set.add(client);
      accepted.push(channel);
    }
    return accepted;
  }

  unsubscribe(client: Client, channels: string[]): void {
    for (const channel of channels) {
      client.channels.delete(channel);
      this.byChannel.get(channel)?.delete(client);
    }
  }

  publish(channel: string, message: ServerMessage): void {
    const subscribers = this.byChannel.get(channel);
    if (!subscribers?.size) return;
    const payload = JSON.stringify(message);
    for (const client of subscribers) {
      if (client.socket.readyState === client.socket.OPEN) {
        try {
          client.socket.send(payload);
        } catch {
          /* the heartbeat will reap this socket */
        }
      }
    }
  }

  send(client: Client, message: ServerMessage): void {
    if (client.socket.readyState !== client.socket.OPEN) return;
    try {
      client.socket.send(JSON.stringify(message));
    } catch {
      /* ignore */
    }
  }

  get stats() {
    return { clients: this.clients.size, channels: this.byChannel.size };
  }

  /** Ping/pong reaper — drops sockets that stopped answering. */
  startHeartbeat(intervalMs = 30_000): NodeJS.Timeout {
    const timer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          try {
            client.socket.terminate();
          } catch {
            /* ignore */
          }
          this.remove(client);
          continue;
        }
        client.alive = false;
        try {
          client.socket.ping();
        } catch {
          /* ignore */
        }
      }
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}

export const hub = new RealtimeHub();
export type { Client as RealtimeClient };

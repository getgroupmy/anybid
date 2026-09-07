import type { WebSocket } from 'ws';
import type { ServerMessage } from '@anybid/shared';

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

  subscribe(client: Client, channels: string[]): string[] {
    const accepted: string[] = [];
    for (const raw of channels.slice(0, 50)) {
      const channel = String(raw).slice(0, 120);
      // Private channels are only readable by their owner.
      if (channel.startsWith('user:') && channel !== `user:${client.userId}`) continue;
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

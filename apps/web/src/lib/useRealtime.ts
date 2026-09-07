'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '@anybid/shared';
import { WS_URL } from './config';

type Handler = (message: ServerMessage) => void;

/**
 * Subscribes to realtime channels for the lifetime of the component.
 *
 * Reconnects with capped exponential backoff and re-subscribes on the way
 * back, so a laptop waking from sleep rejoins the auction it was watching.
 */
export function useRealtime(channels: string[], onMessage: Handler) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onMessage);
  const channelsKey = channels.join(',');

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (channels.length === 0) return;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let closedByUs = false;
    let retryTimer: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;

    const send = (msg: ClientMessage) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    };

    const connect = () => {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        send({ t: 'subscribe', channels: channelsKey.split(',') });
        heartbeat = setInterval(() => send({ t: 'ping' }), 25_000);
      };

      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data as string) as ServerMessage);
        } catch {
          /* ignore malformed frames */
        }
      };

      socket.onclose = () => {
        setConnected(false);
        clearInterval(heartbeat);
        if (closedByUs) return;
        attempt++;
        retryTimer = setTimeout(connect, Math.min(30_000, 500 * 2 ** attempt));
      };

      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closedByUs = true;
      clearInterval(heartbeat);
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [channelsKey]);

  return { connected };
}

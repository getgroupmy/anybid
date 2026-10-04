import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '@anybid/shared';
import { WS_URL } from './config';
import { currentAccessToken } from './api';

/**
 * Live auction socket for the app. Reconnects with backoff — a phone loses the
 * connection every time it changes network or the screen sleeps, so rejoining
 * cleanly matters more here than on the web.
 */
export function useRealtime(channels: string[], onMessage: (m: ServerMessage) => void) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onMessage);
  const channelsKey = channels.join(',');

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!channelsKey) return;
    let socket: WebSocket | null = null;
    let closedByUs = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;

    const send = (msg: ClientMessage) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    };

    const connect = async () => {
      // The token goes in a message, not the URL. A URL reaches every request
      // log between here and the API, and an access token is live for fifteen
      // minutes in each of them.
      const token = await currentAccessToken();
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        if (token) send({ t: 'auth', token });
        send({ t: 'subscribe', channels: channelsKey.split(',') });
        heartbeat = setInterval(() => send({ t: 'ping' }), 25_000);
      };

      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(String(event.data)) as ServerMessage);
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

    void connect();
    return () => {
      closedByUs = true;
      clearInterval(heartbeat);
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [channelsKey]);

  return { connected };
}

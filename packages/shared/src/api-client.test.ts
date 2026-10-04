/**
 * What the client does when the API accepts a request and never answers.
 *
 * `fetch` rejects when a connection fails, but waits for ever on one that is
 * accepted and left hanging — an API that is slow rather than down. The client
 * sent no signal, so the app sat on a spinner with nothing to show and nothing
 * to retry, and a server render held its request open until the platform killed
 * it. The website's own calls were bounded separately; this is the bound for
 * everyone who uses the client, which is the app.
 *
 * Tested against a real server that accepts and stays silent, because that is
 * the failure — a refused connection was never the problem.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { AnyBidClient, DEFAULT_TIMEOUT_MS } from './api-client.ts';

let server: Server;
let baseUrl: string;
/** Sockets held open on purpose; closing the server must not wait for them. */
const hanging: { destroy: () => void }[] = [];

before(async () => {
  server = createServer((req, res) => {
    hanging.push(res.socket ?? { destroy: () => undefined });
    // Deliberately no response.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  for (const socket of hanging) socket.destroy();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('a request to an API that never answers', () => {
  it('gives up rather than waiting for ever', { timeout: 5_000 }, async () => {
    const client = new AnyBidClient({ baseUrl, timeoutMs: 300 });
    const started = Date.now();
    await assert.rejects(
      () => client.request('/v1/stats', { auth: false }),
      'a request with no answer must reject, not hang',
    );
    const waited = Date.now() - started;
    assert.ok(waited < 3_000, `it waited ${waited}ms, which is not a bound`);
  });

  it('lets the caller\'s own signal win, so a cancelled request still cancels', { timeout: 5_000 }, async () => {
    // An abandoned render or a superseded search aborts its own request, and
    // that must take precedence over the bound rather than being replaced by it.
    const client = new AnyBidClient({ baseUrl, timeoutMs: 60_000 });
    const controller = new AbortController();
    const pending = client.request('/v1/stats', { auth: false, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    await assert.rejects(() => pending, 'the caller aborted, so the request must reject');
    assert.ok(Date.now() - started < 3_000, 'and it must not wait for the longer bound');
  });

  it('has a default long enough for a phone and short enough to be a bound', () => {
    // Too eager fails a slow mobile network for no reason; too patient is the
    // indefinite spinner this exists to prevent.
    assert.ok(DEFAULT_TIMEOUT_MS >= 10_000, 'a mobile round trip can be slow');
    assert.ok(DEFAULT_TIMEOUT_MS <= 30_000, 'but not this slow');
  });
});

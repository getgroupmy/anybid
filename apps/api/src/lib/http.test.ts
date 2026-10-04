/**
 * What may be written to a request log.
 *
 * The realtime socket accepts the access token as `?token=`, because a browser
 * cannot put an Authorization header on a WebSocket. That puts a live bearer
 * credential in the URL, and a URL is the one part of a request that gets
 * logged by default — kept, shipped and read long after the token's fifteen
 * minutes are up.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Set before http.ts is loaded, because env.ts reads it once at import. Node's
// test runner gives each file its own process, so this affects nothing else.
const PROXY_SECRET = 'p'.repeat(64);
process.env.PROXY_SHARED_SECRET = PROXY_SECRET;

const { redactUrl, clientIp, CLIENT_IP_HEADER, PROXY_SECRET_HEADER } = await import('./http.ts');

/** Just enough of a request for clientIp: the headers and the peer address. */
function request(headers: Record<string, string>, ip = '10.0.0.1') {
  return { headers, ip } as unknown as Parameters<typeof clientIp>[0];
}

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.sQ8LROtZistSnCHYDXSChT3nWkswrjf36Zt';

describe('redactUrl', () => {
  it('keeps the token out of a logged realtime connect', () => {
    const logged = redactUrl(`/realtime?token=${encodeURIComponent(JWT)}`);
    assert.ok(!logged.includes(JWT), `the token survived redaction: ${logged}`);
    assert.ok(!logged.includes('eyJ'), 'not even the first segment may remain');
    assert.equal(logged, '/realtime?token=[redacted]');
  });

  it('redacts the credential and keeps the rest of the query readable', () => {
    assert.equal(
      redactUrl(`/realtime?listing=abc&token=${JWT}&debug=1`),
      '/realtime?listing=abc&token=[redacted]&debug=1',
    );
  });

  it('covers the other names a credential travels under', () => {
    for (const name of ['token', 'access_token', 'refresh_token', 'refresh', 'secret', 'password', 'signature', 'sig', 'api_key', 'apikey']) {
      const logged = redactUrl(`/x?${name}=supersecretvalue`);
      assert.ok(!logged.includes('supersecretvalue'), `${name} was logged in full: ${logged}`);
    }
  });

  it('ignores case, because a query string is not normalised for us', () => {
    assert.equal(redactUrl('/x?Token=abc'), '/x?Token=[redacted]');
    assert.equal(redactUrl('/x?ACCESS_TOKEN=abc'), '/x?ACCESS_TOKEN=[redacted]');
  });

  it('leaves an ordinary URL exactly as it was', () => {
    // Logs are read by people and diffed by tooling; rewriting URLs that hold
    // no secret would be a cost with no benefit.
    for (const url of [
      '/v1/listings',
      '/v1/listings?page=2&perPage=24&sort=ending_soon',
      '/v1/listings?q=rolex%20submariner&state=Selangor',
      '/v1/listings/abc/bids',
      '/realtime',
      '/x?',
      '/x?flag',
    ]) {
      assert.equal(redactUrl(url), url, url);
    }
  });

  it('is not fooled by a name that merely contains a secret word', () => {
    // `tokenCount` is not a credential; redacting it would hide real data.
    assert.equal(redactUrl('/x?tokenCount=5'), '/x?tokenCount=5');
    assert.equal(redactUrl('/x?my_token_name=5'), '/x?my_token_name=5');
  });
});

/**
 * Who the API believes is calling.
 *
 * This used to be the first entry of X-Forwarded-For — the entry furthest from
 * us, and the one any caller can invent. Rate limits and the audit trail both
 * key on it, so eight registrations went through a limit of five by naming a
 * different address each time, and the audit log recorded addresses that were
 * never involved.
 */
describe('clientIp', () => {
  it('ignores X-Forwarded-For entirely', () => {
    // Deciding how far to trust this header is Fastify's job, bounded by
    // TRUST_PROXY_HOPS, and it shows up here already resolved as req.ip.
    assert.equal(
      clientIp(request({ 'x-forwarded-for': '203.0.113.9' }, '10.0.0.1')),
      '10.0.0.1',
    );
    assert.equal(
      clientIp(request({ 'x-forwarded-for': '203.0.113.9, 198.51.100.4' }, '10.0.0.1')),
      '10.0.0.1',
    );
  });

  it('believes our own proxy when it proves who it is', () => {
    const ip = clientIp(
      request({ [CLIENT_IP_HEADER]: '203.0.113.9', [PROXY_SECRET_HEADER]: PROXY_SECRET }),
    );
    assert.equal(ip, '203.0.113.9', 'the website must be able to state the visitor’s address');
  });

  it('ignores the claim when the secret is wrong or missing', () => {
    assert.equal(clientIp(request({ [CLIENT_IP_HEADER]: '203.0.113.9' })), '10.0.0.1');
    assert.equal(
      clientIp(request({ [CLIENT_IP_HEADER]: '203.0.113.9', [PROXY_SECRET_HEADER]: 'guess' })),
      '10.0.0.1',
    );
    assert.equal(
      clientIp(
        request({
          [CLIENT_IP_HEADER]: '203.0.113.9',
          // Right length, wrong value: a length check alone is not a check.
          [PROXY_SECRET_HEADER]: 'q'.repeat(PROXY_SECRET.length),
        }),
      ),
      '10.0.0.1',
    );
  });

  it('stores an address or nothing at all', () => {
    // This value reaches the audit log and a rate-limit key, so it must not
    // become a place to put arbitrary text.
    for (const claimed of ['not an ip', '<script>alert(1)</script>', '', ' ', 'a'.repeat(200)]) {
      assert.equal(
        clientIp(request({ [CLIENT_IP_HEADER]: claimed, [PROXY_SECRET_HEADER]: PROXY_SECRET })),
        '10.0.0.1',
        `accepted ${JSON.stringify(claimed)} as an address`,
      );
    }
  });

  it('accepts IPv6, since that is most of the mobile traffic', () => {
    assert.equal(
      clientIp(
        request({
          [CLIENT_IP_HEADER]: '2001:db8::8a2e:370:7334',
          [PROXY_SECRET_HEADER]: PROXY_SECRET,
        }),
      ),
      '2001:db8::8a2e:370:7334',
    );
  });
});

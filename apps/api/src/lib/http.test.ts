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
import { redactUrl } from './http.ts';

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

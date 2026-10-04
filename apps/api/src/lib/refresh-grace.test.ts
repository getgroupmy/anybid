/**
 * One rotation per refresh token, shared by every caller that presents it at
 * the same moment — and nothing shared with one that turns up later.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { REFRESH_GRACE_MS, refreshOnce, resetRefreshGraceForTest } from './refresh-grace.ts';

const HASH = 'a'.repeat(64);

beforeEach(() => resetRefreshGraceForTest());

/** A rotation that takes a moment, like the real one's database writes. */
function slowIssue(label: string, calls: { n: number }) {
  return async () => {
    calls.n += 1;
    await new Promise((r) => setTimeout(r, 20));
    return { token: `${label}-${calls.n}` };
  };
}

describe('refreshOnce', () => {
  it('rotates once however many callers arrive together', async () => {
    const calls = { n: 0 };
    const issue = slowIssue('tok', calls);

    const answers = await Promise.all(
      Array.from({ length: 12 }, () => refreshOnce(HASH, issue)),
    );

    assert.equal(calls.n, 1, `the token was rotated ${calls.n} times for one presentation`);
    assert.equal(
      new Set(answers.map((a) => a.token)).size,
      1,
      'every caller must be told about the same session',
    );
  });

  it('does not make a late caller wait on work it never saw', async () => {
    const calls = { n: 0 };
    const first = await refreshOnce(HASH, slowIssue('first', calls));
    // Inside the window: the same answer, no second rotation.
    const second = await refreshOnce(HASH, slowIssue('second', calls));
    assert.deepEqual(second, first);
    assert.equal(calls.n, 1);
  });

  it('stops handing the answer out once the window closes', async () => {
    const calls = { n: 0 };
    const now = 1_700_000_000_000;
    await refreshOnce(HASH, slowIssue('a', calls), now);

    // Past the window the caller does the work itself, which is what makes a
    // replayed token fail on its own merits rather than succeed from here.
    const later = Date.now() + REFRESH_GRACE_MS + 1;
    await refreshOnce(HASH, slowIssue('b', calls), later);
    assert.equal(calls.n, 2, 'a token presented after the window must not be served from memory');
  });

  it('does not remember a failure', async () => {
    let attempt = 0;
    const flaky = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('claim lost');
      return { token: 'second-try' };
    };

    await assert.rejects(() => refreshOnce(HASH, flaky), /claim lost/);
    // Otherwise one failed rotation would keep answering for twenty seconds,
    // and a token that is genuinely refusable would be refused from memory
    // instead of being checked.
    assert.deepEqual(await refreshOnce(HASH, flaky), { token: 'second-try' });
  });

  it('gives every token its own answer', async () => {
    const calls = { n: 0 };
    const a = await refreshOnce('a'.repeat(64), slowIssue('x', calls));
    const b = await refreshOnce('b'.repeat(64), slowIssue('x', calls));
    assert.notDeepEqual(a, b, 'two different tokens must not share one session');
    assert.equal(calls.n, 2);
  });

  it('rejects every waiting caller when the rotation fails', async () => {
    const issue = async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('claim lost');
    };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => refreshOnce(HASH, issue)),
    );
    assert.ok(
      results.every((r) => r.status === 'rejected'),
      'a refusal must reach the siblings too, not just the caller that asked first',
    );
  });
});

/**
 * Counting sign-in failures against the account, not just the address.
 *
 * The per-IP limit counts how fast one address is trying, and addresses are
 * cheap — a botnet has thousands, and until the client IP stopped being a
 * header a caller could simply name a new one per attempt. Neither case slows
 * down a password list worked through one known email.
 *
 * Deliberately a counter and not a lockout: these tests pin that the window
 * expires on its own, because a lockout would hand anyone who knows an email
 * address a way to keep its owner out.
 */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  ACCOUNT_FAILURE_WINDOW_MS,
  MAX_ACCOUNT_FAILURES,
  accountRetryAfterSec,
  clearAccountFailures,
  recordAccountFailure,
  resetAccountFailuresForTest,
} from './throttle.ts';

const NOW = 1_700_000_000_000;
const EMAIL = 'target@example.invalid';

beforeEach(() => resetAccountFailuresForTest());

describe('per-account sign-in failures', () => {
  it('lets an honest fumble through and stops a run of them', () => {
    for (let i = 0; i < MAX_ACCOUNT_FAILURES - 1; i += 1) {
      recordAccountFailure(EMAIL, NOW);
      assert.equal(
        accountRetryAfterSec(EMAIL, NOW),
        null,
        `attempt ${i + 1} must still be allowed — people mistype passwords`,
      );
    }
    recordAccountFailure(EMAIL, NOW);
    const retry = accountRetryAfterSec(EMAIL, NOW);
    assert.ok(retry && retry > 0, 'the run should now be refused, with a wait');
  });

  it('counts each account separately', () => {
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i += 1) recordAccountFailure(EMAIL, NOW);
    assert.ok(accountRetryAfterSec(EMAIL, NOW), 'the attacked account is throttled');
    assert.equal(
      accountRetryAfterSec('someone-else@example.invalid', NOW),
      null,
      'everyone else must be unaffected, or this is a way to take the site down',
    );
  });

  it('never locks an account — the window expires by itself', () => {
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i += 1) recordAccountFailure(EMAIL, NOW);
    assert.ok(accountRetryAfterSec(EMAIL, NOW));

    const later = NOW + ACCOUNT_FAILURE_WINDOW_MS + 1;
    assert.equal(
      accountRetryAfterSec(EMAIL, later),
      null,
      'the owner must get back in without anyone unlocking anything',
    );
  });

  it('measures the window from the first failure, not the last', () => {
    // Otherwise a slow trickle of attempts holds the counter open for ever,
    // which is the lockout this deliberately is not.
    recordAccountFailure(EMAIL, NOW);
    for (let i = 1; i < MAX_ACCOUNT_FAILURES; i += 1) {
      recordAccountFailure(EMAIL, NOW + i * 60_000);
    }
    const afterFirstWindow = NOW + ACCOUNT_FAILURE_WINDOW_MS + 1;
    assert.equal(accountRetryAfterSec(EMAIL, afterFirstWindow), null);
  });

  it('forgets the run once the password is right', () => {
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i += 1) recordAccountFailure(EMAIL, NOW);
    clearAccountFailures(EMAIL);
    assert.equal(accountRetryAfterSec(EMAIL, NOW), null);
  });

  it('treats one account as one account however the email is written', () => {
    for (let i = 0; i < MAX_ACCOUNT_FAILURES; i += 1) {
      recordAccountFailure(i % 2 ? `  ${EMAIL.toUpperCase()} ` : EMAIL, NOW);
    }
    assert.ok(
      accountRetryAfterSec(EMAIL, NOW),
      'varying the capitalisation must not buy a fresh allowance',
    );
  });

  it('does not grow without bound when sprayed', () => {
    // The keys are whatever a caller submits, so this is a memory bound.
    for (let i = 0; i < 25_000; i += 1) recordAccountFailure(`spray-${i}@example.invalid`, NOW);
    // The accounts being hammered now are the ones worth remembering, so the
    // most recent entry must have survived the eviction.
    recordAccountFailure(EMAIL, NOW);
    for (let i = 1; i < MAX_ACCOUNT_FAILURES; i += 1) recordAccountFailure(EMAIL, NOW);
    assert.ok(accountRetryAfterSec(EMAIL, NOW), 'spraying must not evict the account under attack');
  });
});

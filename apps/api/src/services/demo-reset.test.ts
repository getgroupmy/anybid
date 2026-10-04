/**
 * The demo rebuild timer.
 *
 * What is tested here is the scheduling and the guards, with the seed itself
 * replaced by a counter — because the real one TRUNCATEs every table, and a
 * test suite that wipes the developer's database to prove a timer works would
 * be a poor trade.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_DEMO_RESET_INTERVAL_MS,
  startDemoResetIfConfigured,
  startDemoResetLoop,
} from './demo-reset.ts';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves once the counter reaches `n`, rather than after a stretch of wall
 * clock.
 *
 * "It fired three times in 90ms" is not a claim this code makes. `node --test`
 * runs test files in parallel, so these 20ms timers compete with the
 * database-heavy suites next door; on a two-core CI runner with Postgres
 * alongside, three of the four possible ticks do not fit, and the test failed
 * for the scheduler's reasons while the loop was behaving perfectly. What is
 * being tested is that the timer repeats and survives, so wait for the third
 * rebuild however long it takes and let the test's own timeout be the bound on
 * a timer that has genuinely stopped.
 */
function counter(n: number) {
  let count = 0;
  let reached: () => void;
  const done = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return {
    get count() {
      return count;
    },
    hit() {
      count += 1;
      if (count >= n) reached();
    },
    /**
     * Waits for the nth hit, or rejects saying how far it got.
     *
     * The one refd timer does two jobs. It bounds the wait, so a timer that has
     * genuinely stopped fails here, naming the shortfall. And it holds the
     * event loop open: `startDemoResetLoop` unrefs its interval — correctly, so
     * the timer never keeps a process alive by itself — so awaiting the promise
     * alone leaves nothing refd pending and node:test cancels the test with
     * "Promise resolution is still pending but the event loop has already
     * resolved". The original wall-clock sleep was doing that second job
     * incidentally.
     *
     * Bounding it here rather than leaning on the test's own timeout matters.
     * node:test reports a timeout but does not cancel the async function, so a
     * keep-alive cleared in a `finally` that is never reached keeps running and
     * the whole suite hangs instead of failing — measured, while writing this:
     * the run never printed a summary and had to be killed.
     */
    async wait(timeoutMs = 2_000) {
      let bound: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          done,
          new Promise<never>((_resolve, reject) => {
            bound = setTimeout(
              () => reject(new Error(`only ${count} of ${n} rebuilds ran within ${timeoutMs}ms`)),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(bound);
      }
    },
  };
}

describe('the demo reset loop', () => {
  it('rebuilds on the interval and keeps going', { timeout: 5_000 }, async () => {
    const runs = counter(3);
    const loop = startDemoResetLoop(20, async () => {
      runs.hit();
    });
    await runs.wait();
    loop.stop();
    await loop.idle();
    assert.ok(runs.count >= 3, `expected repeated rebuilds, got ${runs.count}`);
  });

  it('does not start a rebuild while one is still running', async () => {
    // The seed takes a while. A second TRUNCATE landing in the middle of the
    // first would leave the demo with half a marketplace.
    let started = 0;
    let concurrent = 0;
    let worstConcurrent = 0;
    const loop = startDemoResetLoop(10, async () => {
      started += 1;
      concurrent += 1;
      worstConcurrent = Math.max(worstConcurrent, concurrent);
      await tick(60);
      concurrent -= 1;
    });

    await tick(150);
    loop.stop();
    await loop.idle();

    assert.equal(worstConcurrent, 1, `${worstConcurrent} rebuilds overlapped`);
    assert.ok(started >= 1, 'it should have run at least once');
  });

  it('keeps the timer alive when a rebuild fails', { timeout: 5_000 }, async () => {
    // A demo left half-built is worse than one rebuilt late, so one failure
    // must not be the end of the schedule.
    const attempts = counter(3);
    const loop = startDemoResetLoop(20, async () => {
      attempts.hit();
      throw new Error('seed blew up');
    });
    await attempts.wait();
    loop.stop();
    await loop.idle();
    assert.ok(attempts.count >= 3, `the timer stopped after a failure (${attempts.count} attempts)`);
  });

  it('stops when told to, and runs nothing after', async () => {
    let runs = 0;
    const loop = startDemoResetLoop(15, async () => {
      runs += 1;
    });
    await tick(50);
    loop.stop();
    await loop.idle();
    const atStop = runs;
    await tick(60);
    assert.equal(runs, atStop, `${runs - atStop} rebuilds ran after the loop was stopped`);
  });

  it('refuses an interval short enough to be a typo', () => {
    // Three seconds where three hours was meant would wipe the database
    // continuously, so that reads as a mistake rather than an instruction.
    assert.throws(
      () => startDemoResetIfConfigured(3_000),
      /below the \d+ms floor/,
      'a tiny interval must be refused rather than obeyed',
    );
  });

  it('is off unless asked for', () => {
    // The default everywhere, including production, is that nothing is wiped.
    assert.equal(
      startDemoResetIfConfigured(0),
      null,
      'a deployment that did not ask for a demo reset must not get one',
    );
  });

  it('puts the floor somewhere sensible', () => {
    assert.ok(
      MIN_DEMO_RESET_INTERVAL_MS >= 60_000,
      'a floor under a minute would not catch the mistake it exists for',
    );
  });
});

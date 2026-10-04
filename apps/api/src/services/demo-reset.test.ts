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

describe('the demo reset loop', () => {
  it('rebuilds on the interval and keeps going', async () => {
    let runs = 0;
    const loop = startDemoResetLoop(20, async () => {
      runs += 1;
    });
    await tick(90);
    loop.stop();
    await loop.idle();
    assert.ok(runs >= 3, `expected repeated rebuilds, got ${runs}`);
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

  it('keeps the timer alive when a rebuild fails', async () => {
    // A demo left half-built is worse than one rebuilt late, so one failure
    // must not be the end of the schedule.
    let attempts = 0;
    const loop = startDemoResetLoop(20, async () => {
      attempts += 1;
      throw new Error('seed blew up');
    });
    await tick(90);
    loop.stop();
    await loop.idle();
    assert.ok(attempts >= 3, `the timer stopped after a failure (${attempts} attempts)`);
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

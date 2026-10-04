import { env } from '../env.ts';
import { seedDemoData } from '../../prisma/seed.ts';
import { invalidateSettings } from './settings.ts';

/**
 * Puts the demo marketplace back to a known state on a timer.
 *
 * A public demo drifts: people bid things up to silly numbers, buy the
 * interesting listings, and leave the front page looking picked over. Rebuilding
 * it periodically keeps what a visitor lands on worth looking at.
 *
 * This destroys everything. The seed TRUNCATEs every table, so every account,
 * listing and order goes with it — which is why it is off unless
 * DEMO_RESET_INTERVAL_MS is set, and why the floor below exists: a typo that
 * meant to say three hours and said three seconds would otherwise wipe the
 * database continuously.
 */

/** Below this, an interval is far more likely to be a mistake than an intent. */
export const MIN_DEMO_RESET_INTERVAL_MS = 15 * 60_000;

export interface DemoResetLoop {
  stop: () => void;
  /** Resolves once any reset in progress has finished. For tests and shutdown. */
  idle: () => Promise<void>;
}

/**
 * `run` is injectable so the loop's behaviour can be tested without wiping a
 * database — the thing being tested here is the scheduling and the overlap
 * guard, not the seed.
 */
export function startDemoResetLoop(
  intervalMs: number,
  run: () => Promise<unknown> = seedDemoData,
): DemoResetLoop {
  let inFlight: Promise<unknown> | null = null;
  let stopped = false;

  const tick = async () => {
    // One reset at a time. The seed takes a while and a slow one must not have
    // a second TRUNCATE land in the middle of it.
    if (stopped || inFlight) return;
    const started = Date.now();
    inFlight = (async () => {
      try {
        console.log('[demo-reset] rebuilding the demo marketplace');
        await run();
        // The settings cache holds rows that no longer exist; it would expire
        // on its own within ten seconds, but there is no reason to serve a
        // stale fee schedule in the meantime.
        invalidateSettings();
        console.log(`[demo-reset] done in ${Date.now() - started}ms`);
      } catch (err) {
        // A failed reset must not stop the timer: the next one may well work,
        // and a demo left half-built is worse than one rebuilt late.
        console.error('[demo-reset] rebuild failed, leaving the data as it is', err);
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    idle: async () => {
      await inFlight;
    },
  };
}

/**
 * Starts the loop if this deployment asked for one, and says plainly what it
 * will do. Returns null when the feature is off, which is the default.
 *
 * The interval is a parameter defaulting to the environment, so the guard
 * below can be tested without depending on which module loaded first.
 */
export function startDemoResetIfConfigured(
  intervalMs: number = env.demoResetIntervalMs,
): DemoResetLoop | null {
  if (intervalMs <= 0) return null;

  if (intervalMs < MIN_DEMO_RESET_INTERVAL_MS) {
    throw new Error(
      `DEMO_RESET_INTERVAL_MS is ${intervalMs}ms, below the ${MIN_DEMO_RESET_INTERVAL_MS}ms floor. ` +
        'This wipes every account, listing and order each time it runs, so a value that small is ' +
        'treated as a mistake rather than an instruction.',
    );
  }

  const hours = (intervalMs / 3_600_000).toFixed(2).replace(/\.?0+$/, '');
  console.warn(
    `[demo-reset] DEMO MODE: every account, listing and order in this database will be ` +
      `destroyed and rebuilt every ${hours}h (DEMO_RESET_INTERVAL_MS=${intervalMs}). ` +
      'Unset it if this deployment holds data anyone cares about.',
  );
  return startDemoResetLoop(intervalMs);
}

import { env } from '../env.ts';
import { prisma } from '../db.ts';
import { startSettlementLoop } from '../services/settlement.ts';
import { startDemoResetIfConfigured } from '../services/demo-reset.ts';

/**
 * Standalone settlement worker. The API also runs this loop in-process for
 * single-node development; in production run exactly one of these instead.
 *
 * SETTLEMENT_TICK_MS=0 is how API instances opt out of settling, so it is set
 * process-wide in deployments that run this worker. That must not disable the
 * worker itself — settling is its entire job — so a non-positive value falls
 * back to the default interval here.
 */
const tickMs = env.settlementTickMs > 0 ? env.settlementTickMs : 5000;
const loop = startSettlementLoop(tickMs);
console.log(`[worker] settlement loop running every ${tickMs}ms`);

/**
 * The demo rebuild lives here rather than in the API, because there is exactly
 * one worker and a TRUNCATE must not race another TRUNCATE. Off unless
 * DEMO_RESET_INTERVAL_MS is set.
 */
const demoReset = startDemoResetIfConfigured();

const shutdown = async () => {
  loop.stop();
  demoReset?.stop();
  // A rebuild halfway through leaves the demo with no categories and no
  // users, so let one in progress finish before the process goes away.
  await demoReset?.idle();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

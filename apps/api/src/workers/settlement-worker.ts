import { env } from '../env.ts';
import { prisma } from '../db.ts';
import { startSettlementLoop } from '../services/settlement.ts';

/**
 * Standalone settlement worker. The API also runs this loop in-process for
 * single-node development; in production run exactly one of these instead.
 */
const loop = startSettlementLoop(env.settlementTickMs);
console.log(`[worker] settlement loop running every ${env.settlementTickMs}ms`);

const shutdown = async () => {
  loop.stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

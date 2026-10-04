import type { Money } from '@anybid/shared';
import { prisma } from '../db.ts';

/**
 * Where an organisation stands against its monthly budget.
 *
 * One definition, in one place, because there are now two callers: the
 * corporate console, which shows the figure, and the bid path, which enforces
 * it. Two computations of the same number drift, and this repository has
 * already paid for that once — a seat's "spend this month" was a column
 * settlement incremented while the spend report derived the same figure from
 * orders, and the two disagreed by every sale the member had ever won.
 *
 * `spent` is the organisation's orders this month. `committed` is money it has
 * promised but not yet paid: the current price of the live auctions its members
 * are leading, which it owes if nobody outbids them. Together they are what the
 * console's progress bar has always meant by "used".
 */
export interface OrgBudgetState {
  /** 0 means the organisation has set no budget, and nothing is enforced. */
  budget: Money;
  spent: Money;
  committed: Money;
  remaining: Money;
  /** The live listings counted in `committed`, so a caller can net one out. */
  leading: { listingId: string; currentPrice: Money }[];
}

function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function orgBudgetState(orgId: string): Promise<OrgBudgetState> {
  const [org, members] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { monthlyBudget: true },
    }),
    prisma.orgMember.findMany({ where: { orgId }, select: { userId: true } }),
  ]);
  const userIds = members.map((m) => m.userId);

  const [orders, leading] = await Promise.all([
    prisma.order.aggregate({
      where: { orgId, createdAt: { gte: monthStart() } },
      _sum: { total: true },
    }),
    prisma.listing.findMany({
      where: { status: 'LIVE', leaderId: { in: userIds } },
      select: { id: true, currentPrice: true },
    }),
  ]);

  const spent = orders._sum.total ?? 0;
  const committed = leading.reduce((sum, l) => sum + l.currentPrice, 0);
  return {
    budget: org.monthlyBudget,
    spent,
    committed,
    remaining: Math.max(0, org.monthlyBudget - spent - committed),
    leading: leading.map((l) => ({ listingId: l.id, currentPrice: l.currentPrice })),
  };
}

/**
 * What a bid would add to the organisation's commitment.
 *
 * Not simply the bid: if this organisation already leads the listing, its
 * current price is counted in `committed` already, so raising a maximum on a
 * listing you are winning only commits the difference. Charging the whole
 * amount again would refuse bids that cost the organisation nothing new.
 */
export function additionalCommitment(
  state: OrgBudgetState,
  listingId: string,
  maxAmount: Money,
): Money {
  const held = state.leading.find((l) => l.listingId === listingId)?.currentPrice ?? 0;
  return Math.max(0, maxAmount - held);
}

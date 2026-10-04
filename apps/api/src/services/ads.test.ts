/**
 * What an ad event costs, and what it is allowed to cost.
 *
 * Two separate questions. A CPM bid is a price per thousand impressions, so
 * one impression is worth a fraction of a sen, and where that fraction goes is
 * the first half of this file. The second half is the ceiling: the ad wallet is
 * prepaid, so a price nobody has the money for must not be taken anyway.
 *
 * The billing cases run against a real PostgreSQL, because the thing that
 * breaks is how the charge reads and writes the wallet under concurrency, not
 * any arithmetic.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../db.ts';
import { chargeableCost, cpmImpressionCost, recordClick } from './ads.ts';

/** What a run of impressions actually costs, one at a time. */
function chargedOver(bidAmount: number, impressions: number): number {
  let total = 0;
  for (let n = 1; n <= impressions; n++) total += cpmImpressionCost(bidAmount, n);
  return total;
}

describe('cpmImpressionCost', () => {
  it('charges exactly the bid for a thousand impressions, at any bid', () => {
    // The old code rounded each impression on its own, which is not a rounding
    // error but the wrong price: RM5 CPM billed 1 sen an impression, RM10 per
    // thousand. Anything under RM5 rounded to nothing and was never charged at
    // all — so the campaign's spend never grew, never met its budget, and
    // served free for ever. A bid only has to be above zero, so every one of
    // these was reachable.
    for (const bid of [1, 7, 99, 1_00, 3_00, 4_00, 5_00, 7_00, 10_00, 15_00, 25_00, 999_00]) {
      assert.equal(
        chargedOver(bid, 1000),
        bid,
        `a thousand impressions at ${bid} sen CPM should cost ${bid} sen`,
      );
    }
  });

  it('charges something for a cheap campaign rather than nothing', () => {
    // RM4 CPM, the case that used to serve free.
    assert.equal(chargedOver(4_00, 1000), 4_00);
    assert.ok(chargedOver(4_00, 500) > 0, 'half a thousand impressions must cost something');
  });

  it('never charges more than the bid part way through a thousand', () => {
    for (const bid of [5_00, 15_00, 25_00]) {
      for (const n of [1, 10, 100, 499, 500, 999]) {
        const charged = chargedOver(bid, n);
        assert.ok(
          charged <= Math.ceil((bid * n) / 1000),
          `${n} impressions at ${bid} overcharged: ${charged}`,
        );
        assert.ok(charged >= 0, 'cost cannot be negative');
      }
    }
  });

  it('stays exact across many thousands, so nothing drifts', () => {
    assert.equal(chargedOver(5_00, 10_000), 5_000);
    assert.equal(chargedOver(4_00, 10_000), 4_000);
    assert.equal(chargedOver(1, 10_000), 10);
  });

  it('is never negative and ignores nonsense', () => {
    assert.equal(cpmImpressionCost(0, 5), 0);
    assert.equal(cpmImpressionCost(-100, 5), 0);
    assert.equal(cpmImpressionCost(5_00, 0), 0);
    assert.equal(cpmImpressionCost(5_00, -1), 0);
  });
});

describe('chargeableCost', () => {
  it('charges the asking price when nothing is in the way', () => {
    assert.equal(
      chargeableCost(2_00, { balance: 100_00, dailyRemaining: 50_00, totalRemaining: 500_00 }),
      2_00,
    );
    assert.equal(
      chargeableCost(2_00, { balance: 100_00, dailyRemaining: 50_00, totalRemaining: null }),
      2_00,
      'no total budget is no ceiling, not a zero one',
    );
  });

  it('never takes more than the wallet holds', () => {
    // The wallet is prepaid: past the balance there is no money, only debt the
    // advertiser never agreed to.
    assert.equal(
      chargeableCost(2_00, { balance: 1_00, dailyRemaining: 50_00, totalRemaining: 500_00 }),
      1_00,
    );
    assert.equal(
      chargeableCost(2_00, { balance: 0, dailyRemaining: 50_00, totalRemaining: 500_00 }),
      0,
    );
  });

  it('never takes more than the budgets left', () => {
    assert.equal(
      chargeableCost(2_00, { balance: 100_00, dailyRemaining: 50, totalRemaining: 500_00 }),
      50,
      'the daily budget is a ceiling too',
    );
    assert.equal(
      chargeableCost(2_00, { balance: 100_00, dailyRemaining: 50_00, totalRemaining: 30 }),
      30,
      'so is the total budget',
    );
  });

  it('is never negative, however far past a ceiling things already are', () => {
    // Spend can land past a budget — several events finishing at once each see
    // room. What must not happen is a refund invented out of the overshoot.
    for (const limits of [
      { balance: -500, dailyRemaining: 50_00, totalRemaining: 500_00 },
      { balance: 100_00, dailyRemaining: -1, totalRemaining: 500_00 },
      { balance: 100_00, dailyRemaining: 50_00, totalRemaining: -900 },
    ]) {
      assert.equal(chargeableCost(2_00, limits), 0, JSON.stringify(limits));
    }
  });

  it('ignores a nonsense asking price', () => {
    const ample = { balance: 100_00, dailyRemaining: 50_00, totalRemaining: 500_00 };
    assert.equal(chargeableCost(0, ample), 0);
    assert.equal(chargeableCost(-5, ample), 0);
  });
});

/* ---------------- billing, against a real database ---------------- */

const RUN = randomBytes(4).toString('hex');
const madeUsers: string[] = [];

interface Fixture {
  advertiserId: string;
  campaignId: string;
  userId: string;
  /** An impression already served, ready to be clicked. */
  slot: () => Promise<string>;
}

async function makeAdvertiser(tag: string, balance: number) {
  const name = `${tag}-${RUN}`;
  const user = await prisma.user.create({
    data: {
      email: `${name}@ads.test.invalid`,
      passwordHash: 'not-a-real-hash',
      displayName: name,
      handle: name,
    },
    select: { id: true },
  });
  madeUsers.push(user.id);

  const advertiser = await prisma.advertiser.create({
    data: {
      userId: user.id,
      companyName: name,
      contactEmail: `${name}@ads.test.invalid`,
      balance,
      approved: true,
    },
    select: { id: true },
  });
  return { advertiserId: advertiser.id, userId: user.id };
}

async function addCampaign(
  owner: { advertiserId: string; userId: string },
  opts: { tag: string; bidAmount: number; dailyBudget: number; totalBudget: number | null },
): Promise<Fixture> {
  const name = `${opts.tag}-${RUN}`;
  const advertiser = { id: owner.advertiserId };
  const user = { id: owner.userId };

  const campaign = await prisma.adCampaign.create({
    data: {
      advertiserId: advertiser.id,
      name,
      status: 'ACTIVE',
      pricingModel: 'CPC',
      bidAmount: opts.bidAmount,
      dailyBudget: opts.dailyBudget,
      totalBudget: opts.totalBudget,
      startsAt: new Date(Date.now() - 60_000),
      placements: ['HOME_FEED'],
      targetKeywords: [],
      targetStates: [],
      creatives: {
        create: {
          headline: name,
          imageUrl: 'https://example.invalid/a.png',
          ctaUrl: 'https://example.invalid/go',
        },
      },
    },
    include: { creatives: { select: { id: true } } },
  });

  // Impressions are written straight in rather than served through the ad
  // auction: what is under test is the charge, and going through `serveAds`
  // would make the fixture depend on outranking whatever else is active.
  const slot = async () => {
    const slotId = randomUUID();
    await prisma.adEvent.create({
      data: {
        campaignId: campaign.id,
        creativeId: campaign.creatives[0]!.id,
        type: 'IMPRESSION',
        placement: 'HOME_FEED',
        cost: 0,
        slotId,
      },
    });
    return slotId;
  };

  return { advertiserId: advertiser.id, campaignId: campaign.id, userId: user.id, slot };
}

async function makeCampaign(opts: {
  tag: string;
  balance: number;
  bidAmount: number;
  dailyBudget: number;
  totalBudget: number | null;
}): Promise<Fixture> {
  return addCampaign(await makeAdvertiser(opts.tag, opts.balance), opts);
}

before(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    throw new Error(
      'These tests need a migrated PostgreSQL at DATABASE_URL. ' +
        'Run `npm run db:up && npm run db:migrate`.\nCause: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
});

after(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: madeUsers } } });
  // Advertiser, campaigns, creatives, events, daily stats and wallet rows all
  // hang off the user by cascade.
  await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
  await prisma.$disconnect();
});

describe('what a click is allowed to charge', () => {
  it('never bills past the wallet, however many slots are still out there', async () => {
    // Every impression served is a slot that can be clicked later, and nothing
    // stops those clicks arriving after the money has gone. Twenty clicks at
    // RM2 against RM1 of balance used to bill RM40 and leave the wallet at
    // minus RM39 — money the advertiser never deposited.
    const f = await makeCampaign({
      tag: 'wallet',
      balance: 1_00,
      bidAmount: 2_00,
      dailyBudget: 10_00,
      totalBudget: 20_00,
    });
    const slots = await Promise.all(Array.from({ length: 20 }, () => f.slot()));

    let delivered = 0;
    for (const slotId of slots) {
      if (await recordClick(slotId, null)) delivered += 1;
    }

    const wallet = await prisma.advertiser.findUniqueOrThrow({
      where: { id: f.advertiserId },
      select: { balance: true, lifetimeSpend: true },
    });
    assert.equal(wallet.balance, 0, 'the wallet must stop at empty, not go negative');
    assert.equal(wallet.lifetimeSpend, 1_00, 'only what was deposited can be spent');
    // The visitor is not the one at fault for arriving late, so they still go.
    assert.equal(delivered, 20, 'every click must still deliver the visitor');
  });

  it('cannot be overdrawn by clicks landing at the same moment', async () => {
    // Twelve clicks on one campaign, all at once: RM5 of wallet used to bill
    // RM60 and leave minus RM55 behind. These serialise on the campaign row —
    // the counter increment that opens the charge locks it — so each one reads
    // the balance the one before it left. The cross-campaign case below is the
    // one where the reads genuinely overlap.
    const f = await makeCampaign({
      tag: 'race',
      balance: 5_00,
      bidAmount: 5_00,
      dailyBudget: 500_00,
      totalBudget: null,
    });
    const slots = await Promise.all(Array.from({ length: 12 }, () => f.slot()));

    const results = await Promise.allSettled(slots.map((s) => recordClick(s, null)));
    const failed = results.filter((r) => r.status === 'rejected');
    assert.deepEqual(failed, [], 'no click should error');

    const wallet = await prisma.advertiser.findUniqueOrThrow({
      where: { id: f.advertiserId },
      select: { balance: true },
    });
    assert.equal(wallet.balance, 0, 'concurrent clicks must not overdraw the wallet');

    const billed = await prisma.adEvent.aggregate({
      where: { campaignId: f.campaignId, type: 'CLICK' },
      _sum: { cost: true },
    });
    assert.equal(billed._sum.cost, 5_00, 'the events must add up to what was actually taken');
  });

  it('cannot be overdrawn by two campaigns spending the same wallet at once', async () => {
    // One wallet, two campaigns. Nothing serialises these: each charge locks
    // its own campaign row, so both read the same balance and both think they
    // can afford it. Clamping to what was read is not enough here — the taking
    // itself has to be conditional on the money still being there.
    // Four campaigns rather than two: the other way this used to break is a
    // deadlock, and a deadlock is a timing accident. Widening the fan-out is
    // what makes it show up every run instead of one in three.
    const owner = await makeAdvertiser('shared', 5_00);
    const budget = { bidAmount: 5_00, dailyBudget: 500_00, totalBudget: null };
    const campaigns = await Promise.all(
      ['a', 'b', 'c', 'd'].map((n) => addCampaign(owner, { tag: `shared-${n}`, ...budget })),
    );

    const slots = (
      await Promise.all(campaigns.map((c) => Promise.all(Array.from({ length: 6 }, c.slot))))
    ).flat();
    const results = await Promise.allSettled(slots.map((s) => recordClick(s, null)));
    assert.deepEqual(
      results.filter((r) => r.status === 'rejected'),
      [],
      'no click should error',
    );

    const wallet = await prisma.advertiser.findUniqueOrThrow({
      where: { id: owner.advertiserId },
      select: { balance: true, lifetimeSpend: true },
    });
    assert.ok(wallet.balance >= 0, `the wallet went to ${wallet.balance}`);
    assert.equal(wallet.lifetimeSpend, 5_00 - wallet.balance, 'spend must match what left the wallet');

    const billed = await prisma.adEvent.aggregate({
      where: { campaignId: { in: campaigns.map((c) => c.campaignId) }, type: 'CLICK' },
      _sum: { cost: true },
    });
    assert.equal(
      billed._sum.cost,
      5_00 - wallet.balance,
      'the events must add up to what was actually taken',
    );
  });

  it('stops the campaigns one row at a time, so the sweep cannot deadlock', async () => {
    // Emptying the wallet stops every campaign the advertiser runs. Done as one
    // statement over all of them, that sweep crosses with anything holding one
    // of those rows and wanting another: each waits for the other, and Postgres
    // settles it by killing one — which in production aborted a charge and
    // handed the visitor whose click it was an error.
    //
    // The invariant that makes the cycle impossible is that the sweep never
    // holds two of these locks at once. So hold one row, let the sweep run, and
    // check it has already committed the row it could take rather than sitting
    // on it waiting for both. A deadlock is a timing accident; this is not.
    const owner = await makeAdvertiser('sweep', 5_00);
    const budget = { bidAmount: 5_00, dailyBudget: 500_00, totalBudget: null };
    const pair = await Promise.all([
      addCampaign(owner, { tag: 'sweep-a', ...budget }),
      addCampaign(owner, { tag: 'sweep-b', ...budget }),
    ]);
    // The sweep takes them in id order, so the one it reaches last is the one
    // to hold — otherwise it blocks before reaching the other and proves nothing.
    const order = [...pair].sort((x, y) => (x.campaignId < y.campaignId ? -1 : 1));
    const firstTaken = order[0]!;
    const heldBack = order[1]!;
    const slotId = await firstTaken.slot();

    let pending: Promise<string | null> | undefined;
    let seen = '';
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AdCampaign" WHERE id = ${heldBack.campaignId} FOR UPDATE`;
      // This click takes the whole wallet, so the sweep follows it.
      pending = recordClick(slotId, null);
      // Long enough for the charge to commit and the sweep to get to work.
      await new Promise((resolve) => setTimeout(resolve, 400));
      seen = (
        await prisma.adCampaign.findUniqueOrThrow({
          where: { id: firstTaken.campaignId },
          select: { status: true },
        })
      ).status;
    });

    assert.ok(await pending, 'the click must still deliver the visitor');
    assert.equal(
      seen,
      'OUT_OF_BUDGET',
      'the sweep held a row it had taken while waiting for another — that is the deadlock',
    );
    const stopped = await prisma.adCampaign.count({
      where: { advertiserId: owner.advertiserId, status: 'OUT_OF_BUDGET' },
    });
    assert.equal(stopped, 2, 'and once the held row is free, it finishes the job');
  });

  it('stops at the total budget even when the wallet could cover more', async () => {
    // The budget is the advertiser's own ceiling, so passing it is the same
    // kind of wrong as overdrawing. Eight clicks at RM5 against a RM5 total
    // budget used to spend RM40 of a wallet that had plenty.
    const f = await makeCampaign({
      tag: 'budget',
      balance: 10_000_00,
      bidAmount: 5_00,
      dailyBudget: 500_00,
      totalBudget: 5_00,
    });
    const slots = await Promise.all(Array.from({ length: 8 }, () => f.slot()));
    await Promise.allSettled(slots.map((s) => recordClick(s, null)));

    const campaign = await prisma.adCampaign.findUniqueOrThrow({
      where: { id: f.campaignId },
      select: { spend: true, totalBudget: true, status: true },
    });
    assert.equal(campaign.spend, 5_00, 'spend must stop at the total budget');
    assert.equal(campaign.status, 'OUT_OF_BUDGET', 'and the campaign must stop serving');
  });

  it('tells the advertiser once that a campaign stopped, not once per click', async () => {
    // The stop was a read-check-write outside a transaction: several clicks
    // finishing together all saw it still ACTIVE, so the advertiser got one
    // message per click that happened to notice.
    const f = await makeCampaign({
      tag: 'notice',
      balance: 10_000_00,
      bidAmount: 5_00,
      dailyBudget: 500_00,
      totalBudget: 5_00,
    });
    const slots = await Promise.all(Array.from({ length: 8 }, () => f.slot()));
    await Promise.allSettled(slots.map((s) => recordClick(s, null)));

    const notices = await prisma.notification.count({
      where: { userId: f.userId, type: 'CAMPAIGN_BUDGET_EXHAUSTED' },
    });
    assert.equal(notices, 1, `one campaign stopping once sent ${notices} notifications`);
  });
});

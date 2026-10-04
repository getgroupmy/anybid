/**
 * The auction engine under random play, rather than chosen examples.
 *
 * auction.test.ts covers the cases someone thought of. These assert the
 * invariants that must hold for *every* sequence of bids, and then look for a
 * counterexample by playing thousands of random auctions: random start prices
 * and reserves, random proxy maximums from several bidders in random order,
 * anti-snipe on and off, fixed increments and tiered ones.
 *
 * The generator is a seeded PRNG rather than a property-testing library, so
 * this adds no dependency and any failure reproduces exactly — every assertion
 * message carries the seed that produced it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_FEES,
  MAX_BID,
  computeFees,
  minimumAcceptableBid,
  placeBid,
  settleAuction,
  type AuctionRules,
  type AuctionState,
  type BidResult,
} from './auction.ts';

/** Deterministic PRNG (mulberry32) so a failing seed can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  rules: AuctionRules;
  start: AuctionState;
  bids: { bidderId: string; maxAmount: number; at: number }[];
}

/**
 * One random auction.
 *
 * Prices are drawn across the whole tier table, including the boundaries
 * between tiers and the very small amounts where the commission floor bites,
 * because those are where arithmetic tends to go wrong.
 */
function scenario(seed: number): Scenario {
  const r = rng(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
  const money = () =>
    pick([
      1,
      99,
      1_00,
      4_99,
      5_00,
      5_01,
      499_99,
      500_00,
      500_01,
      999_99,
      1_000_00,
      4_999_99,
      5_000_00,
      9_999_99,
      10_000_00,
      49_999_99,
      50_000_00,
      249_999_99,
      250_000_00,
      1_000_000_00,
      Math.floor(r() * 2_000_000_00),
    ]);

  const startPrice = money();
  const openedAt = 1_700_000_000_000;
  const closesAt = openedAt + Math.floor(r() * 3_600_000) + 1_000;

  const rules: AuctionRules = {
    kind: pick(['AUCTION', 'AUCTION_WITH_BUY_NOW']),
    startPrice,
    reservePrice: pick([null, 0, startPrice, startPrice * 2, money()]),
    bidIncrement: pick([null, 0, 1, 1_00, 5_00, 1_000_00]),
    antiSnipeWindowMs: pick([0, 30_000, 120_000]),
    antiSnipeExtensionMs: pick([0, 30_000, 120_000]),
    maxExtensionMs: pick([null, 0, 60_000, 600_000]),
    sellerId: 'seller',
  };

  const bidderCount = 1 + Math.floor(r() * 4);
  const bidCount = 1 + Math.floor(r() * 10);
  const bids = Array.from({ length: bidCount }, () => ({
    bidderId: pick([
      ...Array.from({ length: bidderCount }, (_, i) => `bidder-${i}`),
      // Occasionally the seller, so the self-bid guard is exercised too.
      ...(r() < 0.1 ? ['seller'] : []),
    ]),
    maxAmount: money(),
    at: openedAt + Math.floor(r() * (closesAt - openedAt + 60_000)),
  }));

  return {
    rules,
    start: {
      currentPrice: startPrice,
      leaderId: null,
      leaderMax: 0,
      bidCount: 0,
      endsAt: closesAt,
      originalEndsAt: closesAt,
    },
    bids,
  };
}

const SEEDS = 4000;

describe('the auction engine, over random play', () => {
  it('never moves the price down, and never above what the leader committed', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      let state = start;

      for (const bid of bids) {
        const before = state;
        const result: BidResult = placeBid(rules, state, bid);
        if (!result.ok) {
          assert.deepEqual(state, before, `seed ${seed}: a rejected bid changed the state`);
          continue;
        }
        state = result.state;

        assert.ok(
          state.currentPrice >= before.currentPrice,
          `seed ${seed}: price fell from ${before.currentPrice} to ${state.currentPrice}`,
        );
        assert.ok(
          state.currentPrice <= state.leaderMax,
          `seed ${seed}: price ${state.currentPrice} exceeds the leader's maximum ${state.leaderMax}`,
        );
        assert.ok(
          state.currentPrice >= rules.startPrice,
          `seed ${seed}: price ${state.currentPrice} fell below the start price ${rules.startPrice}`,
        );
        assert.equal(
          state.bidCount,
          before.bidCount + 1,
          `seed ${seed}: an accepted bid moved the count by more than one`,
        );
      }
    }
  });

  it('leaves the lead with the highest maximum anyone committed', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      let state = start;
      /** The highest max actually accepted, and who got there first. */
      let best: { bidderId: string; maxAmount: number } | null = null;

      for (const bid of bids) {
        const result = placeBid(rules, state, bid);
        if (!result.ok) continue;
        state = result.state;
        if (!best || bid.maxAmount > best.maxAmount) {
          best = { bidderId: bid.bidderId, maxAmount: bid.maxAmount };
        }
      }

      if (best) {
        assert.equal(
          state.leaderId,
          best.bidderId,
          `seed ${seed}: ${best.bidderId} committed the highest maximum (${best.maxAmount}) ` +
            `but ${state.leaderId} holds the lead with ${state.leaderMax}`,
        );
        assert.equal(state.leaderMax, best.maxAmount, `seed ${seed}: the leader's maximum is wrong`);
      }
    }
  });

  it('only ever asks for an amount that would actually be accepted', () => {
    // A rejection tells the bidder what to offer instead, and the website puts
    // that number in front of them. Offering exactly it has to work, or the
    // UI is sending people into a refusal.
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      let state = start;

      for (const bid of bids) {
        const result = placeBid(rules, state, bid);
        if (result.ok) {
          state = result.state;
          continue;
        }
        if (!['BELOW_START_PRICE', 'BELOW_MINIMUM_INCREMENT', 'ALREADY_LEADING_LOWER'].includes(result.reason)) {
          continue;
        }

        const retry = placeBid(rules, state, { ...bid, maxAmount: result.minimumAcceptable });
        assert.ok(
          retry.ok,
          `seed ${seed}: refused with ${result.reason} and told the bidder to offer ` +
            `${result.minimumAcceptable}, which is itself refused with ` +
            `${retry.ok ? '' : retry.reason}`,
        );
      }
    }
  });

  it('never moves the close time backwards, or past the extension ceiling', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      let state = start;

      for (const bid of bids) {
        const before = state;
        const result = placeBid(rules, state, bid);
        if (!result.ok) continue;
        state = result.state;

        assert.ok(
          state.endsAt >= before.endsAt,
          `seed ${seed}: the close time moved back from ${before.endsAt} to ${state.endsAt}`,
        );
        if (rules.maxExtensionMs != null) {
          assert.ok(
            state.endsAt <= state.originalEndsAt + rules.maxExtensionMs,
            `seed ${seed}: extended ${state.endsAt - state.originalEndsAt}ms past a ceiling of ` +
              `${rules.maxExtensionMs}ms — an auction that can be kept open for ever`,
          );
        }
        assert.equal(
          result.extendedByMs,
          state.endsAt - before.endsAt,
          `seed ${seed}: the reported extension does not match the clock that moved`,
        );
      }
    }
  });

  it('settles to a price the winner agreed to, and only with the reserve met', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      let state = start;
      for (const bid of bids) {
        const result = placeBid(rules, state, bid);
        if (result.ok) state = result.state;
      }

      const outcome = settleAuction(rules, state);
      if (outcome.result === 'SOLD') {
        assert.ok(
          outcome.salePrice <= state.leaderMax,
          `seed ${seed}: sold at ${outcome.salePrice}, above the winner's maximum ${state.leaderMax}`,
        );
        assert.ok(
          outcome.salePrice >= rules.startPrice,
          `seed ${seed}: sold at ${outcome.salePrice}, below the start price`,
        );
        if (rules.reservePrice && rules.reservePrice > 0) {
          assert.ok(
            state.leaderMax >= rules.reservePrice,
            `seed ${seed}: sold without meeting the reserve of ${rules.reservePrice}`,
          );
        }
      } else if (outcome.result === 'RESERVE_NOT_MET') {
        assert.ok(
          rules.reservePrice && state.leaderMax < rules.reservePrice,
          `seed ${seed}: reported the reserve unmet when it was met`,
        );
      }
    }
  });

  it('accounts for every sen of a settled sale', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      let state = start;
      for (const bid of bids) {
        const result = placeBid(rules, state, bid);
        if (result.ok) state = result.state;
      }
      const outcome = settleAuction(rules, state);
      if (outcome.result !== 'SOLD') continue;

      const f = computeFees(outcome.salePrice, DEFAULT_FEES);
      assert.equal(
        f.sellerPayout + f.sellerCommission,
        f.hammerPrice,
        `seed ${seed}: the payout and the commission do not add up to the hammer price ` +
          `at ${outcome.salePrice} sen`,
      );
      assert.equal(
        f.buyerTotal,
        f.hammerPrice + f.buyerPremium,
        `seed ${seed}: the buyer's total is not the hammer price plus the premium`,
      );
      assert.ok(f.sellerPayout >= 0, `seed ${seed}: a negative payout at ${outcome.salePrice} sen`);
      assert.ok(
        f.sellerCommission >= 0 && f.sellerCommission <= f.hammerPrice,
        `seed ${seed}: commission ${f.sellerCommission} is not within the sale price`,
      );
      assert.ok(
        Number.isInteger(f.sellerPayout) && Number.isInteger(f.paymentFee),
        `seed ${seed}: a fractional sen appeared at ${outcome.salePrice}`,
      );
    }
  });

  it('keeps the payout rising with the price', () => {
    // Otherwise there is a sale price a seller would rather not reach, which
    // is the kind of thing nobody notices until a seller does the sums.
    let previous = -1;
    for (let hammer = 0; hammer <= 2_000_00; hammer += 1) {
      const { sellerPayout } = computeFees(hammer, DEFAULT_FEES);
      assert.ok(
        sellerPayout >= previous,
        `the payout fell from ${previous} to ${sellerPayout} as the price rose to ${hammer} sen`,
      );
      previous = sellerPayout;
    }
  });

  it('refuses a bid over the ceiling without pretending one is possible', () => {
    const rules: AuctionRules = {
      kind: 'AUCTION',
      startPrice: 1_00,
      antiSnipeWindowMs: 0,
      antiSnipeExtensionMs: 0,
    };
    const state: AuctionState = {
      currentPrice: 1_00,
      leaderId: null,
      leaderMax: 0,
      bidCount: 0,
      endsAt: 2_000_000_000_000,
      originalEndsAt: 2_000_000_000_000,
    };
    const over = placeBid(rules, state, { bidderId: 'a', maxAmount: MAX_BID + 1, at: 1 });
    assert.ok(!over.ok && over.reason === 'BID_TOO_LARGE');
    // And the minimum it reports must not be a number it would itself refuse.
    if (!over.ok && over.minimumAcceptable > 0) {
      const retry = placeBid(rules, state, { bidderId: 'a', maxAmount: over.minimumAcceptable, at: 1 });
      assert.ok(retry.ok, 'the ceiling rejection suggested an amount that is also refused');
    }
  });

  it('is unaffected by how the same bids are replayed', () => {
    // A pure engine must give the same answer twice, which is what lets the
    // bid path retry a transaction without changing the auction.
    for (let seed = 1; seed <= 500; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      const play = () => {
        let state = start;
        for (const bid of bids) {
          const result = placeBid(rules, state, bid);
          if (result.ok) state = result.state;
        }
        return state;
      };
      assert.deepEqual(play(), play(), `seed ${seed}: replaying the same bids diverged`);
    }
  });
});

describe('minimumAcceptableBid', () => {
  it('rises with the price and never sits below it', () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { rules, start, bids } = scenario(seed);
      let state = start;
      for (const bid of bids) {
        const result = placeBid(rules, state, bid);
        if (!result.ok) continue;
        state = result.state;

        const minimum = minimumAcceptableBid(rules, state);
        assert.ok(
          minimum > state.currentPrice || state.leaderId === null,
          `seed ${seed}: the next bid may equal the current price ${state.currentPrice}, ` +
            'which would allow a bid war in one-sen steps',
        );
      }
    }
  });
});

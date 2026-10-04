import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeBid,
  settleAuction,
  computeFees,
  minimumAcceptableBid,
  DEFAULT_FEES,
  type AuctionRules,
  type AuctionState,
} from './auction.ts';
import { effectiveIncrement, minimumBid, tierIncrement } from './increments.ts';
import { applyBps, formatMoney, formatMoneyCompact, toMinor } from './money.ts';
import { can, consolesFor, permissionsFor } from './roles.ts';

const T0 = new Date('2026-01-01T00:00:00Z').getTime();
const HOUR = 3_600_000;

function rules(over: Partial<AuctionRules> = {}): AuctionRules {
  return {
    kind: 'AUCTION',
    startPrice: 100_00,
    reservePrice: null,
    buyNowPrice: null,
    bidIncrement: null,
    antiSnipeWindowMs: 2 * 60_000,
    antiSnipeExtensionMs: 2 * 60_000,
    maxExtensionMs: null,
    sellerId: 'seller',
    ...over,
  };
}

function fresh(over: Partial<AuctionState> = {}): AuctionState {
  return {
    currentPrice: 100_00,
    leaderId: null,
    leaderMax: 0,
    bidCount: 0,
    endsAt: T0 + 24 * HOUR,
    originalEndsAt: T0 + 24 * HOUR,
    ...over,
  };
}

describe('money', () => {
  it('converts and formats without float drift', () => {
    assert.equal(toMinor('1,234.56'), 123456);
    assert.equal(toMinor(0.1) + toMinor(0.2), toMinor(0.3));
    assert.equal(formatMoney(123456), 'RM1,234.56');
    assert.equal(formatMoneyCompact(1_500_00), 'RM1.5k');
    assert.equal(formatMoneyCompact(2_400_000_00), 'RM2.4m');
  });

  it('applies basis points with half-up rounding', () => {
    assert.equal(applyBps(100_00, 600), 600);
    assert.equal(applyBps(333_33, 220), 733);
  });
});

describe('increments', () => {
  it('picks the tier for the current price', () => {
    assert.equal(tierIncrement(0), 5_00);
    assert.equal(tierIncrement(750_00), 10_00);
    assert.equal(tierIncrement(20_000_00), 100_00);
    assert.equal(tierIncrement(9_999_999_00), 1_000_00);
  });

  it('never lets a seller increment go below the tier floor', () => {
    assert.equal(effectiveIncrement(750_00, 1), 10_00);
    assert.equal(effectiveIncrement(750_00, 50_00), 50_00);
  });

  it('allows an opening bid equal to the start price', () => {
    assert.equal(minimumBid(100_00, false), 100_00);
    assert.equal(minimumBid(100_00, true), 105_00);
  });
});

describe('proxy bidding', () => {
  it('opens at the start price, not at the bidder max', () => {
    const r = rules();
    const res = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(res.ok);
    assert.equal(res.state.currentPrice, 100_00);
    assert.equal(res.state.leaderId, 'alice');
    assert.equal(res.state.leaderMax, 500_00);
    assert.equal(res.isLeading, true);
  });

  it('keeps the standing proxy winning and only raises the price one increment', () => {
    const r = rules();
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(a.ok);
    const b = placeBid(r, a.state, { bidderId: 'bob', maxAmount: 200_00, at: T0 + 1000 });
    assert.ok(b.ok);
    assert.equal(b.isLeading, false);
    assert.equal(b.state.leaderId, 'alice');
    // bob 200.00 + 5.00 increment = 205.00, under alice's 500.00 max
    assert.equal(b.state.currentPrice, 205_00);
  });

  it('caps the price at the leader max when the challenger comes close', () => {
    const r = rules();
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(a.ok);
    const b = placeBid(r, a.state, { bidderId: 'bob', maxAmount: 499_00, at: T0 + 1000 });
    assert.ok(b.ok);
    assert.equal(b.state.currentPrice, 500_00); // not 499_00 + 5_00 = 504_00
    assert.equal(b.state.leaderId, 'alice');
  });

  it('hands the lead over when the challenger outbids the hidden max', () => {
    const r = rules();
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(a.ok);
    const b = placeBid(r, a.state, { bidderId: 'bob', maxAmount: 900_00, at: T0 + 1000 });
    assert.ok(b.ok);
    assert.equal(b.isLeading, true);
    assert.equal(b.state.leaderId, 'bob');
    assert.equal(b.outbidUserId, 'alice');
    assert.equal(b.state.currentPrice, 510_00); // alice max + one RM10 tier increment
  });

  it('gives ties to the earlier bidder', () => {
    const r = rules();
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(a.ok);
    const b = placeBid(r, a.state, { bidderId: 'bob', maxAmount: 500_00, at: T0 + 1000 });
    assert.ok(b.ok);
    assert.equal(b.state.leaderId, 'alice');
    assert.equal(b.isLeading, false);
    assert.equal(b.state.currentPrice, 500_00);
  });

  it('rejects a bid under the minimum increment', () => {
    const r = rules();
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(a.ok);
    const b = placeBid(r, a.state, { bidderId: 'bob', maxAmount: 102_00, at: T0 + 1000 });
    assert.ok(!b.ok);
    assert.equal(b.reason, 'BELOW_MINIMUM_INCREMENT');
    assert.equal(b.minimumAcceptable, 105_00);
  });

  it('rejects a first bid below the start price', () => {
    const b = placeBid(rules(), fresh(), { bidderId: 'bob', maxAmount: 50_00, at: T0 });
    assert.ok(!b.ok);
    assert.equal(b.reason, 'BELOW_START_PRICE');
  });

  it('rejects the seller bidding on their own listing', () => {
    const b = placeBid(rules(), fresh(), { bidderId: 'seller', maxAmount: 500_00, at: T0 });
    assert.ok(!b.ok);
    assert.equal(b.reason, 'SELF_BID');
  });

  it('rejects bids after the close', () => {
    const b = placeBid(rules(), fresh(), { bidderId: 'bob', maxAmount: 500_00, at: T0 + 25 * HOUR });
    assert.ok(!b.ok);
    assert.equal(b.reason, 'AUCTION_ENDED');
  });

  it('lets the leader raise their own maximum but not lower it', () => {
    const r = rules();
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(a.ok);
    const lower = placeBid(r, a.state, { bidderId: 'alice', maxAmount: 400_00, at: T0 + 100 });
    assert.ok(!lower.ok);
    assert.equal(lower.reason, 'ALREADY_LEADING_LOWER');

    const higher = placeBid(r, a.state, { bidderId: 'alice', maxAmount: 800_00, at: T0 + 100 });
    assert.ok(higher.ok);
    assert.equal(higher.state.leaderMax, 800_00);
    assert.equal(higher.state.currentPrice, 100_00, 'raising your own max must not move the price');
  });

  it('refuses bids on fixed-price listings', () => {
    const b = placeBid(rules({ kind: 'BUY_NOW' }), fresh(), {
      bidderId: 'bob',
      maxAmount: 500_00,
      at: T0,
    });
    assert.ok(!b.ok);
    assert.equal(b.reason, 'NOT_AN_AUCTION');
  });

  it('reports the minimum acceptable bid for the UI', () => {
    const r = rules();
    assert.equal(minimumAcceptableBid(r, fresh()), 100_00);
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 500_00, at: T0 });
    assert.ok(a.ok);
    assert.equal(minimumAcceptableBid(r, a.state), 105_00);
  });
});

describe('reserve price', () => {
  it('holds the price below an unmet reserve', () => {
    const r = rules({ reservePrice: 800_00 });
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 300_00, at: T0 });
    assert.ok(a.ok);
    assert.equal(a.reserveMet, false);
    assert.equal(a.state.currentPrice, 100_00);
    assert.deepEqual(settleAuction(r, a.state), {
      result: 'RESERVE_NOT_MET',
      highestBidderId: 'alice',
      highestBid: 100_00,
    });
  });

  it('jumps the price to the reserve once it is met', () => {
    const r = rules({ reservePrice: 800_00 });
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 1_200_00, at: T0 });
    assert.ok(a.ok);
    assert.equal(a.reserveMet, true);
    assert.equal(a.state.currentPrice, 800_00);
    assert.deepEqual(settleAuction(r, a.state), {
      result: 'SOLD',
      winnerId: 'alice',
      salePrice: 800_00,
    });
  });

  it('clears the reserve when the leader raises their own max', () => {
    const r = rules({ reservePrice: 800_00 });
    const a = placeBid(r, fresh(), { bidderId: 'alice', maxAmount: 300_00, at: T0 });
    assert.ok(a.ok);
    const raise = placeBid(r, a.state, { bidderId: 'alice', maxAmount: 900_00, at: T0 + 60_000 });
    assert.ok(raise.ok);
    assert.equal(raise.reserveMet, true);
    assert.equal(raise.state.currentPrice, 800_00);
  });
});

describe('anti-snipe', () => {
  it('extends the close when a bid lands inside the window', () => {
    const r = rules();
    const state = fresh({ endsAt: T0 + 60_000, originalEndsAt: T0 + 60_000 });
    const res = placeBid(r, state, { bidderId: 'bob', maxAmount: 500_00, at: T0 + 30_000 });
    assert.ok(res.ok);
    assert.equal(res.extended, true);
    assert.equal(res.state.endsAt, T0 + 30_000 + 120_000);
  });

  it('leaves the close alone for an early bid', () => {
    const res = placeBid(rules(), fresh(), { bidderId: 'bob', maxAmount: 500_00, at: T0 });
    assert.ok(res.ok);
    assert.equal(res.extended, false);
    assert.equal(res.state.endsAt, T0 + 24 * HOUR);
  });

  it('honours the total extension ceiling', () => {
    const r = rules({ maxExtensionMs: 5 * 60_000 });
    let state = fresh({ endsAt: T0 + 60_000, originalEndsAt: T0 + 60_000 });
    let at = T0 + 30_000;
    let max = 200_00;
    for (let i = 0; i < 10; i++) {
      const res = placeBid(r, state, { bidderId: i % 2 ? 'a' : 'b', maxAmount: max, at });
      if (res.ok) state = res.state;
      max += 100_00;
      at += 30_000;
    }
    assert.ok(state.endsAt <= T0 + 60_000 + 5 * 60_000);
  });
});

describe('settlement', () => {
  it('reports no bids on an empty auction', () => {
    assert.deepEqual(settleAuction(rules(), fresh()), { result: 'NO_BIDS' });
  });
});

describe('fees', () => {
  it('splits a sale between seller payout and platform revenue', () => {
    const f = computeFees(1_000_00, DEFAULT_FEES);
    assert.equal(f.sellerCommission, 60_00);
    assert.equal(f.sellerPayout, 940_00);
    assert.equal(f.buyerTotal, 1_000_00);
    assert.equal(f.paymentFee, applyBps(1_000_00, 220) + 1_00);
  });

  it('applies the commission floor and cap', () => {
    assert.equal(computeFees(5_00).sellerCommission, 1_00);
    assert.equal(computeFees(100_000_00).sellerCommission, 500_00);
  });

  it('accounts for every sen the buyer pays, at any price', () => {
    // What the buyer hands over is exactly what the seller receives, plus what
    // the platform keeps, plus what the processor takes. Nothing appears and
    // nothing vanishes.
    //
    // This used to fail under the commission floor. At a one sen hammer price
    // the floor made the commission a ringgit, the payout clamped to zero, and
    // the platform still booked the whole ringgit — so the breakdown accounted
    // for 100 sen of a 1 sen sale. Reachable by default: minCommission is
    // RM1.00 and a starting price only has to be above zero.
    for (const hammer of [1, 2, 50, 99, 1_00, 1_01, 5_00, 100_00, 1_000_00, 100_000_00]) {
      const f = computeFees(hammer, DEFAULT_FEES);
      assert.equal(
        f.sellerPayout + f.platformRevenue + f.paymentFee,
        f.buyerTotal,
        `fees do not reconcile at ${hammer} sen`,
      );
      assert.ok(f.sellerCommission <= hammer, `commission exceeded the sale at ${hammer} sen`);
      assert.ok(f.sellerPayout >= 0, `negative payout at ${hammer} sen`);
    }
  });

  it('never charges more commission than the item sold for', () => {
    const f = computeFees(1, DEFAULT_FEES);
    assert.equal(f.sellerCommission, 1, 'the floor must not overtake the sale price');
    assert.equal(f.sellerPayout, 0);
    // And it says so rather than pretending otherwise: a sale this small does
    // not cover the processor's flat fee, so the platform is out of pocket.
    assert.ok(f.platformRevenue < 0, 'a sale below the flat payment fee is a loss');
  });
});

describe('roles', () => {
  it('unions permissions across roles and org seat', () => {
    const p = permissionsFor({ roles: ['USER', 'ADVERTISER'], orgRole: 'APPROVER' });
    assert.ok(p.has('bid:place'));
    assert.ok(p.has('campaign:manage:own'));
    assert.ok(p.has('org:approve'));
    assert.ok(!p.has('user:suspend'));
  });

  it('grants super admins everything', () => {
    assert.ok(can({ roles: ['SUPER_ADMIN'], orgRole: null }, 'admin:manage'));
  });

  it('lists only the consoles a principal can reach', () => {
    assert.deepEqual(
      consolesFor({ roles: ['USER'], orgId: null }).map((c) => c.key),
      ['user'],
    );
    assert.deepEqual(
      consolesFor({ roles: ['USER', 'ADVERTISER', 'ADMIN'], orgId: 'o1' }).map((c) => c.key),
      ['user', 'advertiser', 'corporate', 'admin'],
    );
  });
});

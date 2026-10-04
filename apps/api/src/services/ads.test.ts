/**
 * What a CPM impression costs.
 *
 * A CPM bid is a price per thousand impressions, so one impression is worth a
 * fraction of a sen. Money here is whole sen, so the fraction has to go
 * somewhere, and where it goes is the whole question.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cpmImpressionCost } from './ads.ts';

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

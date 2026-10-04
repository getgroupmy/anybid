/**
 * Where zero is not an amount.
 *
 * A reserve, a buy-now price, a bid increment and a campaign's total budget are
 * all read as "none" when they are zero: `isReserveMet` returns true for a
 * reserve of zero, and `serialize.ts` reports `hasReserve: Boolean(reservePrice)`.
 * So a zero arriving from a caller that meant to set a number is not a small
 * mistake — it is the silent removal of a seller's floor or an advertiser's
 * ceiling.
 *
 * It arrives easily. The website's money inputs are text (`inputMode="decimal"`,
 * no `type`), and `moneyInputToMinor` turns anything `Number()` cannot read into
 * zero, so letters or a second decimal point in the reserve box send exactly
 * this. Measured before the fix: `POST /v1/listings` with `reservePrice: 0`
 * answered 201, stored 0, and reported `hasReserve: false` back to the seller.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMoneyInput } from './money.ts';
import {
  createCampaignSchema,
  createListingSchema,
  moneySchema,
  optionalMoneySchema,
  updateListingSchema,
} from './schemas.ts';

/** A listing that passes everything except what a case is testing. */
function listing(overrides: Record<string, unknown> = {}) {
  return {
    title: 'A perfectly ordinary item for sale',
    description: 'Long enough to satisfy the description minimum, which is twenty characters.',
    categoryId: 'ckpqrstuvwxyz0123456789ab',
    kind: 'AUCTION',
    condition: 'GOOD',
    images: ['https://example.invalid/a.png'],
    startPrice: 100_00,
    durationHours: 72,
    ...overrides,
  };
}

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    name: 'A campaign',
    pricingModel: 'CPC',
    bidAmount: 2_00,
    dailyBudget: 50_00,
    startsAt: new Date(),
    placements: ['HOME_FEED'],
    ...overrides,
  };
}

function issuePaths(result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) {
  return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('optionalMoneySchema', () => {
  it('takes an amount, and takes nothing', () => {
    assert.equal(optionalMoneySchema.parse(1_00), 1_00);
    assert.equal(optionalMoneySchema.parse(null), null);
    assert.equal(optionalMoneySchema.parse(undefined), undefined);
  });

  it('refuses zero, because zero reads as nothing', () => {
    const result = optionalMoneySchema.safeParse(0);
    assert.equal(result.success, false, 'zero must not pass as an amount');
    assert.match(
      result.error?.issues[0]?.message ?? '',
      /blank/i,
      'and it should say to leave the field blank instead',
    );
  });

  it('still refuses what moneySchema refuses', () => {
    for (const bad of [-1, 1.5, 2_000_000_000_00, '100', Number.NaN]) {
      assert.equal(
        optionalMoneySchema.safeParse(bad).success,
        false,
        `${String(bad)} should not be accepted`,
      );
    }
  });
});

describe('a listing whose reserve is zero', () => {
  it('is refused rather than sold with no floor', () => {
    // Before: 201, stored 0, hasReserve false, and isReserveMet true at any
    // price — the seller's floor gone with nothing said.
    const result = createListingSchema.safeParse(listing({ reservePrice: 0 }));
    assert.equal(result.success, false, 'a zero reserve must not be accepted');
    assert.deepEqual(issuePaths(result), ['reservePrice']);
  });

  it('is still allowed to have no reserve at all', () => {
    assert.equal(createListingSchema.safeParse(listing()).success, true, 'omitted is fine');
    assert.equal(
      createListingSchema.safeParse(listing({ reservePrice: null })).success,
      true,
      'and null is how you say there is none',
    );
  });

  it('is accepted with a real reserve', () => {
    assert.equal(createListingSchema.safeParse(listing({ reservePrice: 150_00 })).success, true);
  });

  it('still catches a reserve below the starting price', () => {
    // The old check read `if (v.reservePrice && ...)`, so zero skipped it
    // entirely. A real reserve below the start price must still be caught.
    const result = createListingSchema.safeParse(listing({ reservePrice: 50_00 }));
    assert.equal(result.success, false);
    assert.deepEqual(issuePaths(result), ['reservePrice']);
  });
});

describe('the other fields where zero means absent', () => {
  it('refuses a zero buy-now price, on create and on update', () => {
    assert.equal(createListingSchema.safeParse(listing({ buyNowPrice: 0 })).success, false);
    assert.equal(updateListingSchema.safeParse({ buyNowPrice: 0 }).success, false);
    assert.equal(
      updateListingSchema.safeParse({ buyNowPrice: null }).success,
      true,
      'clearing it is still allowed',
    );
  });

  it('refuses a zero bid increment', () => {
    assert.equal(createListingSchema.safeParse(listing({ bidIncrement: 0 })).success, false);
    assert.equal(createListingSchema.safeParse(listing({ bidIncrement: 5_00 })).success, true);
  });

  it('refuses a zero total budget on a campaign', () => {
    // `serveAds` reads `c.totalBudget && c.spend >= c.totalBudget`, so a zero
    // total budget is an unlimited one.
    assert.equal(createCampaignSchema.safeParse(campaign({ totalBudget: 0 })).success, false);
    assert.equal(
      createCampaignSchema.safeParse(campaign({ totalBudget: null })).success,
      true,
      'no total budget is a legitimate campaign',
    );
    assert.equal(createCampaignSchema.safeParse(campaign({ totalBudget: 500_00 })).success, true);
  });

  it('leaves a zero starting price and shipping cost alone', () => {
    // These are not the same shape: shipping of zero means free, and a zero
    // start price is already refused by its own rule with its own message.
    assert.equal(createListingSchema.safeParse(listing({ shippingCost: 0 })).success, true);
    const result = createListingSchema.safeParse(listing({ startPrice: 0 }));
    assert.equal(result.success, false);
    assert.match(result.error?.issues[0]?.message ?? '', /above zero/);
  });
});

/* ---------------- the parser that feeds those fields ---------------- */

describe('parseMoneyInput', () => {
  it('reads what people actually type', () => {
    // Tolerant about presentation: these are all the number they mean.
    assert.equal(parseMoneyInput('1500'), 1500_00);
    assert.equal(parseMoneyInput('1500.00'), 1500_00);
    assert.equal(parseMoneyInput('1,500.00'), 1500_00);
    assert.equal(parseMoneyInput('RM1,500'), 1500_00);
    assert.equal(parseMoneyInput('1 500'), 1500_00);
    assert.equal(parseMoneyInput('0.50'), 50);
    assert.equal(parseMoneyInput('0'), 0, 'a deliberate zero is still a zero');
  });

  it('rounds to the sen rather than truncating', () => {
    // Floats: 19.99 * 100 is 1998.9999999999998.
    assert.equal(parseMoneyInput('19.99'), 1999);
    assert.equal(parseMoneyInput('0.29'), 29);
    assert.equal(parseMoneyInput('0.005'), 1, 'half a sen rounds up, not away');
  });

  it('says it cannot read text that is not an amount', () => {
    // The whole point. The website's parser used to answer 0 here, and zero is
    // how this codebase spells "none" — no reserve, no commission cap — so
    // letters in a money field removed the thing they were meant to set.
    for (const bad of ['abc', '1.2.3', '', '  ', '.', 'RM', '--', 'one thousand']) {
      assert.equal(parseMoneyInput(bad), null, `${JSON.stringify(bad)} should not read as an amount`);
    }
  });

  it('is refused by moneySchema when it could not be read', () => {
    // How the failure reaches the person: NaN at the API, 400 with the field
    // named, rather than a silent zero stored as a value.
    const result = moneySchema.safeParse(parseMoneyInput('abc') ?? Number.NaN);
    assert.equal(result.success, false);
    assert.equal(
      result.error?.issues[0]?.message,
      'Enter an amount',
      'and the message is one a person can act on',
    );
  });
});

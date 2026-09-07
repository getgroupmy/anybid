/**
 * End-to-end smoke test against a running API.
 *
 *   npm run dev:api    # terminal 1
 *   npm run smoke      # terminal 2 — reseeds, then runs
 *
 * It places real bids, buys the fixed-price listing and spends approval
 * requests, so it expects a FRESHLY SEEDED database. Running it twice without
 * reseeding fails on the state the first run left behind — that is the test
 * being honest, not a defect. `npm run smoke` reseeds for you.
 *
 * Exercises the paths that matter: auth, browsing, proxy bidding, outbidding,
 * anti-snipe, buy-now, corporate approval, the ad auction and admin metrics.
 */
const BASE = process.env.SMOKE_API_URL ?? 'http://localhost:4000';
const PASSWORD = 'Password123';

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
    if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`);
  }
}

async function api(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<{ status: number; body: any }> {
  const { token, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((rest.headers as Record<string, string>) ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email: string): Promise<string> {
  const res = await api('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.tokens.accessToken;
}

async function main() {
  console.log(`\nAnyBid smoke test → ${BASE}\n`);

  console.log('auth');
  const health = await api('/health');
  check('health endpoint responds', health.status === 200 && health.body.ok);

  const aisha = await login('aisha@example.com');
  const daniel = await login('daniel@example.com');
  const admin = await login('admin@anybid.my');
  const advertiser = await login('advertiser@brandco.my');
  const orgOwner = await login('procurement@megacorp.my');
  const orgBuyer = await login('buyer2@megacorp.my');
  const approver = await login('finance@megacorp.my');
  check('all console accounts sign in', true);

  const me = await api('/v1/auth/me', { token: aisha });
  check('session carries roles', me.status === 200 && me.body.user.roles.includes('USER'));

  const badLogin = await api('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'aisha@example.com', password: 'wrong-password' }),
  });
  check('wrong password is rejected', badLogin.status === 401);

  const anon = await api('/v1/auth/me');
  check('unauthenticated /me is 401', anon.status === 401);

  console.log('\nmarketplace');
  const cats = await api('/v1/categories');
  check('category tree has children', cats.body.categories?.[0]?.children?.length > 0);

  const live = await api('/v1/listings?status=LIVE&perPage=50');
  check('live listings are returned', live.body.items.length > 0, live.body.total);

  const search = await api('/v1/listings?q=rolex');
  check('text search finds the Rolex', search.body.items.some((i: any) => /rolex/i.test(i.title)));

  const sorted = await api('/v1/listings?sort=ending_soon&perPage=5');
  const ends = sorted.body.items
    .filter((i: any) => i.endsAt)
    .map((i: any) => new Date(i.endsAt).getTime());
  check(
    'ending-soon sort is ordered',
    ends.every((v: number, i: number) => i === 0 || ends[i - 1] <= v),
  );

  console.log('\nbidding');
  // Pick a live auction neither test bidder is selling.
  const candidates = live.body.items.filter(
    (i: any) => i.kind !== 'BUY_NOW' && i.status === 'LIVE' && i.seller.handle === 'meiling',
  );
  const target = candidates[0];
  if (!target) throw new Error('no suitable listing found in seed data');
  const detailBefore = await api(`/v1/listings/${target.id}`, { token: aisha });
  const startPrice = detailBefore.body.listing.currentPrice;
  const minimum = detailBefore.body.listing.minimumBid;

  const lowBid = await api(`/v1/listings/${target.id}/bids`, {
    method: 'POST',
    token: aisha,
    body: JSON.stringify({ maxAmount: Math.max(1, minimum - 1_00) }),
  });
  check('a bid under the increment is rejected', lowBid.status === 400, lowBid.body?.error);

  const bigBid = await api(`/v1/listings/${target.id}/bids`, {
    method: 'POST',
    token: aisha,
    body: JSON.stringify({ maxAmount: minimum + 5_000_00 }),
  });
  check('a valid proxy bid is accepted', bigBid.status === 200 && bigBid.body.accepted);
  check('the proxy does not pay the full maximum', bigBid.body.currentPrice < minimum + 5_000_00);
  check('bidder takes the lead', bigBid.body.isLeading === true);

  const under = await api(`/v1/listings/${target.id}/bids`, {
    method: 'POST',
    token: daniel,
    body: JSON.stringify({ maxAmount: bigBid.body.currentPrice + 500_00 }),
  });
  check('a challenger under the hidden max loses', under.status === 200 && !under.body.isLeading);
  check('the price rises for the leader', under.body.currentPrice > bigBid.body.currentPrice);

  const over = await api(`/v1/listings/${target.id}/bids`, {
    method: 'POST',
    token: daniel,
    body: JSON.stringify({ maxAmount: minimum + 20_000_00 }),
  });
  check('a challenger over the hidden max takes the lead', over.body.isLeading === true);

  const sellerBid = await api(`/v1/listings/${target.id}/bids`, {
    method: 'POST',
    token: await login('mei@example.com'),
    body: JSON.stringify({ maxAmount: minimum + 90_000_00 }),
  });
  check('the seller cannot bid on their own listing', sellerBid.status === 403);

  const history = await api(`/v1/listings/${target.id}/bids`);
  check('bid history is masked', history.body.bids.every((b: any) => /\*/.test(b.bidder.masked)));

  console.log('\nanti-snipe');
  // The Nintendo lot closes in ~2h; make a listing that closes in 30s instead.
  const snipeListing = await api('/v1/listings', {
    method: 'POST',
    token: aisha,
    body: JSON.stringify({
      title: 'Smoke test anti-snipe widget with a long enough title',
      description: 'A listing created by the smoke test to prove anti-snipe extends the clock.',
      categoryId: cats.body.categories[0].children[0].id,
      kind: 'AUCTION',
      images: ['https://picsum.photos/seed/smoke/800/600'],
      startPrice: 10_00,
      // Backdate the start so the auction is already inside its closing window.
      startsAt: new Date(Date.now() - 55 * 60_000).toISOString(),
      durationHours: 1,
      antiSnipeWindowSec: 1800,
      antiSnipeExtensionSec: 600,
    }),
  });
  check('a listing can be created', snipeListing.status === 201, snipeListing.body);
  const snipeId = snipeListing.body?.listing?.id;
  if (snipeId) {
    const before = new Date(snipeListing.body.listing.endsAt).getTime();
    const snipeBid = await api(`/v1/listings/${snipeId}/bids`, {
      method: 'POST',
      token: daniel,
      body: JSON.stringify({ maxAmount: 50_00 }),
    });
    const after = new Date(snipeBid.body.endsAt).getTime();
    check('a bid inside the window extends the close', snipeBid.body.extended === true && after > before);
  }

  console.log('\nbuy now');
  const buyNowItem = live.body.items.find((i: any) => i.buyNowPrice && i.kind === 'BUY_NOW');
  if (buyNowItem) {
    const bought = await api(`/v1/listings/${buyNowItem.id}/buy-now`, {
      method: 'POST',
      token: daniel,
      body: JSON.stringify({ quantity: 1 }),
    });
    check('buy-now creates an order', bought.status === 201, bought.body?.message);
    const orderId = bought.body?.order?.id;
    if (orderId) {
      check('the order total includes fees and shipping', bought.body.order.total >= bought.body.order.hammerPrice);
      const paid = await api(`/v1/orders/${orderId}/pay`, {
        method: 'POST',
        token: daniel,
        body: JSON.stringify({
          shippingName: 'Daniel Tan',
          shippingPhone: '+60125551234',
          addressLine1: '88 Lebuh Chulia',
          city: 'George Town',
          state: 'Penang',
          postcode: '10200',
          method: 'FPX',
        }),
      });
      check('checkout marks the order paid', paid.body?.order?.status === 'PAID', paid.body);
      const shipped = await api(`/v1/orders/${orderId}/ship`, {
        method: 'POST',
        token: aisha,
        body: JSON.stringify({ courier: 'Pos Laju', trackingNumber: 'PL123456789MY' }),
      });
      check('the seller can ship it', shipped.body?.order?.status === 'SHIPPED', shipped.body);
      const done = await api(`/v1/orders/${orderId}/confirm`, { method: 'POST', token: daniel });
      check('the buyer confirms delivery', done.body?.order?.status === 'COMPLETED');
    }
  } else {
    check('a buy-now listing exists in the seed', false);
  }

  console.log('\nwatchlist & notifications');
  const watch = await api(`/v1/listings/${target.id}/watch`, { method: 'POST', token: daniel });
  check('watching a listing works', watch.body.watching === true);
  const watchlist = await api('/v1/me/watchlist', { token: daniel });
  check('the watchlist contains it', watchlist.body.items.some((i: any) => i.id === target.id));
  const unwatch = await api(`/v1/listings/${target.id}/watch`, { method: 'DELETE', token: daniel });
  check('unwatching works', unwatch.body.watching === false);

  const notes = await api('/v1/notifications', { token: aisha });
  check('outbid notifications are delivered', notes.body.items.some((n: any) => n.type === 'OUTBID'));

  console.log('\ncorporate console');
  const org = await api('/v1/corporate/organization', { token: orgOwner });
  check('the organisation loads', org.body.organization?.name?.includes('MegaCorp'));
  const members = await api('/v1/corporate/members', { token: orgOwner });
  check('the team has seats', members.body.members.length >= 4);

  // Grace's threshold is RM10,000 — a bid above it must be held for approval.
  const bigItem = live.body.items.find((i: any) => i.title.includes('Rolex'));
  if (bigItem) {
    const held = await api(`/v1/listings/${bigItem.id}/bids`, {
      method: 'POST',
      token: orgBuyer,
      body: JSON.stringify({ maxAmount: 46_000_00, reference: 'PO-SMOKE-1' }),
    });
    check('a bid over the seat threshold is held', held.body.pendingApproval === true, held.body);

    const pending = await api('/v1/corporate/approvals?status=PENDING', { token: approver });
    const mine = pending.body.items.find((a: any) => a.id === held.body.approvalId);
    check('the approver sees the request', Boolean(mine));

    if (mine) {
      const selfApprove = await api(`/v1/corporate/approvals/${mine.id}/decide`, {
        method: 'POST',
        token: orgBuyer,
        body: JSON.stringify({ decision: 'APPROVE' }),
      });
      check('a requester cannot approve their own bid', selfApprove.status === 403);

      const decided = await api(`/v1/corporate/approvals/${mine.id}/decide`, {
        method: 'POST',
        token: approver,
        body: JSON.stringify({ decision: 'APPROVE', note: 'Within Q3 capex.' }),
      });
      check('approval places the bid', decided.body?.approval?.status === 'APPROVED', decided.body);
      check('the approved bid is live', decided.body?.bid?.accepted === true);
    }
  }

  const spend = await api('/v1/corporate/spend', { token: orgOwner });
  check('spend reporting adds up', typeof spend.body.totals?.remaining === 'number');

  console.log('\nadvertiser console');
  const overview = await api('/v1/advertiser/overview', { token: advertiser });
  check('the ad wallet balance loads', typeof overview.body.balance === 'number');

  const campaigns = await api('/v1/advertiser/campaigns', { token: advertiser });
  check('campaigns are listed', campaigns.body.items.length >= 1);

  const created = await api('/v1/advertiser/campaigns', {
    method: 'POST',
    token: advertiser,
    body: JSON.stringify({
      name: 'Smoke test campaign',
      pricingModel: 'CPC',
      bidAmount: 80,
      dailyBudget: 50_00,
      startsAt: new Date().toISOString(),
      placements: ['HOME_FEED'],
      targetKeywords: ['smoke'],
    }),
  });
  check('a campaign can be created', created.status === 201, created.body);

  const noCreative = await api(`/v1/advertiser/campaigns/${created.body?.campaign?.id}/status`, {
    method: 'POST',
    token: advertiser,
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
  check('a campaign without a creative cannot go live', noCreative.status === 409);

  await api(`/v1/advertiser/campaigns/${created.body?.campaign?.id}/creatives`, {
    method: 'POST',
    token: advertiser,
    body: JSON.stringify({
      headline: 'Smoke test creative',
      imageUrl: 'https://picsum.photos/seed/smokead/1200/400',
      ctaUrl: 'https://example.com',
      ctaLabel: 'Go',
    }),
  });
  const activated = await api(`/v1/advertiser/campaigns/${created.body?.campaign?.id}/status`, {
    method: 'POST',
    token: advertiser,
    body: JSON.stringify({ status: 'ACTIVE' }),
  });
  check('with a creative it goes live', activated.body?.campaign?.status === 'ACTIVE', activated.body);

  const servedAds = await api('/v1/ads/serve?placement=HOME_HERO&q=iphone&limit=1');
  check('the ad auction serves a winner', servedAds.body.ads.length > 0, servedAds.body);
  if (servedAds.body.ads.length > 0) {
    const click = await api('/v1/ads/click', {
      method: 'POST',
      body: JSON.stringify({ slotId: servedAds.body.ads[0].slotId }),
    });
    check('a click resolves to the destination', click.status === 200 && Boolean(click.body.redirectUrl));
  }

  const report = await api('/v1/advertiser/report?days=14', { token: advertiser });
  check('the ad report returns a series', Array.isArray(report.body.rows) && report.body.rows.length > 0);

  console.log('\nadmin console');
  const metrics = await api('/v1/admin/metrics', { token: admin });
  check('metrics load', metrics.status === 200 && metrics.body.users.total > 0);
  check('the timeseries covers 14 days', metrics.body.timeseries.length >= 14);
  check('GMV is counted', metrics.body.gmv.allTime > 0, metrics.body.gmv);

  const nonAdmin = await api('/v1/admin/metrics', { token: aisha });
  check('a normal user cannot reach the admin console', nonAdmin.status === 403);

  const users = await api('/v1/admin/users?q=aisha', { token: admin });
  check('admin user search works', users.body.items.length >= 1);

  const audit = await api('/v1/admin/audit', { token: admin });
  check('the audit log has entries', audit.body.items.length > 0);

  const settings = await api('/v1/admin/settings', { token: admin });
  check('platform settings load', typeof settings.body.settings.sellerCommissionBps === 'number');

  const moderated = await api(`/v1/admin/listings/${target.id}/moderate`, {
    method: 'POST',
    token: admin,
    body: JSON.stringify({ action: 'FEATURE' }),
  });
  check('an admin can feature a listing', moderated.status === 204);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nsmoke test crashed:', err);
  process.exit(1);
});

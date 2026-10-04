/**
 * What a corporate customer may decide for itself, and what it may not.
 *
 * The console mixes two kinds of setting in one route. A monthly budget and an
 * approval threshold are the customer's own policy, theirs to set. A credit
 * limit and payment terms are the platform's risk: they decide whether this
 * organisation can take goods now and pay later, and how much of that the
 * platform is willing to carry. Only one of those should be self-service.
 *
 * Requires DATABASE_URL to point at a migrated database.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../db.ts';
import { hashPassword, signAccessToken } from '../lib/crypto.ts';
import { buildServer } from '../server.ts';

const RUN = randomBytes(4).toString('hex');
const HOUR = 60 * 60 * 1000;

let app: Awaited<ReturnType<typeof buildServer>>;
let categoryId: string;
const made = { users: [] as string[], orgs: [] as string[], listings: [] as string[] };

async function makeUser(tag: string): Promise<string> {
  const name = `${tag}-${RUN}`;
  const { id } = await prisma.user.create({
    data: {
      email: `${name}@corp.test.invalid`,
      passwordHash: await hashPassword('irrelevant'),
      displayName: name,
      handle: name,
      roles: ['USER', 'CORPORATE'],
    },
    select: { id: true },
  });
  made.users.push(id);
  return id;
}

function tokenFor(userId: string, orgId: string, orgRole: string): string {
  return signAccessToken({ sub: userId, roles: ['USER', 'CORPORATE'], orgId, orgRole }).token;
}

/** An organisation on prepaid terms with no credit, which is the default. */
async function makeOrg(tag: string, overrides: { monthlyBudget?: number; defaultApprovalThreshold?: number } = {}) {
  const org = await prisma.organization.create({
    data: {
      name: `Org ${tag} ${RUN}`,
      slug: `org-${tag}-${RUN}`,
      registrationNo: `REG-${tag}-${RUN}`,
      billingEmail: `billing-${tag}-${RUN}@corp.test.invalid`,
      monthlyBudget: overrides.monthlyBudget ?? 100_000_00,
      defaultApprovalThreshold: overrides.defaultApprovalThreshold ?? 10_000_00,
    },
    select: { id: true },
  });
  made.orgs.push(org.id);
  return org.id;
}

/** A live auction closing in an hour, so anti-snipe never comes into it. */
async function makeLiveListing(tag: string, startPrice = 100_00) {
  const sellerId = await makeUser(`${tag}-seller`);
  const endsAt = new Date(Date.now() + HOUR);
  const listing = await prisma.listing.create({
    data: {
      slug: `${tag}-${RUN}`,
      title: `Budget probe ${tag} ${RUN}`,
      description: 'Fixture for the corporate budget suite.',
      status: 'LIVE',
      sellerId,
      categoryId,
      startPrice,
      currentPrice: startPrice,
      endsAt,
      originalEndsAt: endsAt,
    },
    select: { id: true },
  });
  made.listings.push(listing.id);
  return listing.id;
}

async function seat(orgId: string, tag: string, orgRole: 'OWNER' | 'ADMIN' | 'APPROVER' | 'BUYER') {
  const userId = await makeUser(`${tag}-${orgRole.toLowerCase()}`);
  const member = await prisma.orgMember.create({
    data: { orgId, userId, orgRole },
    select: { id: true },
  });
  return { userId, memberId: member.id, token: tokenFor(userId, orgId, orgRole) };
}

before(async () => {
  const cat = await prisma.category.create({
    data: { name: `Corp ${RUN}`, slug: `corp-${RUN}` },
    select: { id: true },
  });
  categoryId = cat.id;
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
  await prisma.approvalRequest.deleteMany({ where: { orgId: { in: made.orgs } } });
  await prisma.bid.deleteMany({ where: { listingId: { in: made.listings } } });
  await prisma.notification.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: made.users } } });
  const orders = await prisma.order.findMany({
    where: { listingId: { in: made.listings } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.invoiceLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.listing.deleteMany({ where: { id: { in: made.listings } } });
  await prisma.orgMember.deleteMany({ where: { orgId: { in: made.orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: made.orgs } } });
  await prisma.user.deleteMany({ where: { id: { in: made.users } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
});

describe('an organisation setting its own terms', () => {
  it('cannot grant itself credit with the platform', async () => {
    const orgId = await makeOrg('credit');
    const admin = await seat(orgId, 'credit', 'ADMIN');

    // paymentTerms is what makes an order invoiced rather than prepaid, and
    // creditLimit is the ceiling the invoice path checks against. Setting both
    // is the whole of "take the goods, pay never".
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/corporate/organization/budget',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { creditLimit: 1_000_000_00, paymentTerms: 'NET_60' },
    });

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { creditLimit: true, paymentTerms: true },
    });
    assert.equal(
      org.creditLimit,
      0,
      `the organisation set its own credit limit to ${org.creditLimit} sen (response ${res.statusCode})`,
    );
    assert.equal(
      org.paymentTerms,
      'PREPAID',
      `the organisation put itself on invoice terms (response ${res.statusCode})`,
    );
  });

  it('is granted credit by an admin, and the grant is recorded', async () => {
    const orgId = await makeOrg('granted');
    const adminId = await makeUser('granted-platform-admin');
    await prisma.user.update({ where: { id: adminId }, data: { roles: ['USER', 'ADMIN'] } });
    const adminToken = signAccessToken({
      sub: adminId,
      roles: ['USER', 'ADMIN'],
      orgId: null,
      orgRole: null,
    }).token;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/organizations/${orgId}/credit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { creditLimit: 50_000_00, paymentTerms: 'NET_30' },
    });
    assert.equal(res.statusCode, 200, res.body);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { creditLimit: true, paymentTerms: true },
    });
    assert.equal(org.creditLimit, 50_000_00, 'the capability has to exist somewhere');
    assert.equal(org.paymentTerms, 'NET_30');

    const trail = await prisma.auditLog.count({
      where: { targetType: 'organization', targetId: orgId, action: 'org.credit.update' },
    });
    assert.equal(trail, 1, 'extending credit is a decision worth a row in the audit log');
  });

  it('will not drop a credit limit below what is already owed', async () => {
    const orgId = await makeOrg('owing');
    await prisma.organization.update({
      where: { id: orgId },
      data: { creditLimit: 50_000_00, paymentTerms: 'NET_30', outstanding: 30_000_00 },
    });
    const adminId = await makeUser('owing-platform-admin');
    await prisma.user.update({ where: { id: adminId }, data: { roles: ['USER', 'ADMIN'] } });
    const adminToken = signAccessToken({
      sub: adminId,
      roles: ['USER', 'ADMIN'],
      orgId: null,
      orgRole: null,
    }).token;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/organizations/${orgId}/credit`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { creditLimit: 10_000_00 },
    });
    assert.equal(res.statusCode, 400, 'it should say so rather than silently leave them over');

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { creditLimit: true },
    });
    assert.equal(org.creditLimit, 50_000_00, 'and leave the limit where it was');
  });

  it('can still set its own budget and approval threshold', async () => {
    const orgId = await makeOrg('policy');
    const admin = await seat(orgId, 'policy', 'ADMIN');

    // These are the customer's internal policy, and refusing them would be
    // taking away the console's reason to exist.
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/corporate/organization/budget',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { monthlyBudget: 50_000_00, defaultApprovalThreshold: 2_000_00 },
    });
    assert.equal(res.statusCode, 200, res.body);

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { monthlyBudget: true, defaultApprovalThreshold: true },
    });
    assert.equal(org.monthlyBudget, 50_000_00);
    assert.equal(org.defaultApprovalThreshold, 2_000_00);
  });
});

describe('managing seats', () => {
  it('does not let an admin make themselves the owner', async () => {
    const orgId = await makeOrg('escalate');
    const owner = await seat(orgId, 'escalate', 'OWNER');
    const admin = await seat(orgId, 'escalate', 'ADMIN');

    // The guard refuses changing an existing owner, but said nothing about
    // becoming one — and an owner cannot be removed and can demote anyone, so
    // this is the whole organisation.
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/corporate/members/${admin.memberId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { orgRole: 'OWNER' },
    });

    const after = await prisma.orgMember.findUniqueOrThrow({
      where: { id: admin.memberId },
      select: { orgRole: true },
    });
    assert.equal(
      after.orgRole,
      'ADMIN',
      `an admin promoted themselves to ${after.orgRole} (response ${res.statusCode})`,
    );
    assert.equal(res.statusCode, 403);

    const stillOwner = await prisma.orgMember.findUniqueOrThrow({
      where: { id: owner.memberId },
      select: { orgRole: true },
    });
    assert.equal(stillOwner.orgRole, 'OWNER', 'the real owner must still be the owner');
  });

  it('lets an owner hand the role over', async () => {
    const orgId = await makeOrg('handover');
    const owner = await seat(orgId, 'handover', 'OWNER');
    const admin = await seat(orgId, 'handover', 'ADMIN');

    // Succession is a real thing an owner needs to do.
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/corporate/members/${admin.memberId}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { orgRole: 'OWNER' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const promoted = await prisma.orgMember.findUniqueOrThrow({
      where: { id: admin.memberId },
      select: { orgRole: true },
    });
    assert.equal(promoted.orgRole, 'OWNER');
  });
});

describe('deciding a bid request two ways at once', () => {
  it('does not record a rejection for a bid that was placed', async () => {
    // Whether the two interleave on any one run is luck, so this repeats and
    // asserts the invariant rather than an ordering. It can only fail when the
    // reject actually lands on top of a placed bid, never the other way.
    for (let attempt = 0; attempt < 30; attempt += 1) await oneContestedDecision(attempt);
  });

  async function oneContestedDecision(attempt: number) {
    const orgId = await makeOrg(`decide-${attempt}`);
    const buyer = await seat(orgId, `decide-${attempt}`, 'BUYER');
    const first = await seat(orgId, `decide-${attempt}-a`, 'APPROVER');
    const second = await seat(orgId, `decide-${attempt}-b`, 'APPROVER');

    const sellerId = await makeUser(`decide-seller-${attempt}`);
    const endsAt = new Date(Date.now() + HOUR);
    const listing = await prisma.listing.create({
      data: {
        slug: `decide-${attempt}-${RUN}`,
        title: `Decide probe ${attempt} ${RUN}`,
        description: 'Fixture for the corporate approval suite.',
        status: 'LIVE',
        sellerId,
        categoryId,
        startPrice: 100_00,
        currentPrice: 100_00,
        endsAt,
        originalEndsAt: endsAt,
      },
      select: { id: true },
    });
    made.listings.push(listing.id);

    // Over the org's threshold, so the bid is held for an approver.
    await prisma.orgMember.update({
      where: { userId: buyer.userId },
      data: { approvalThreshold: 500_00 },
    });
    const held = await app.inject({
      method: 'POST',
      url: `/v1/listings/${listing.id}/bids`,
      headers: { authorization: `Bearer ${buyer.token}` },
      payload: { maxAmount: 5_000_00 },
    });
    assert.equal(held.statusCode, 200, held.body);
    const { approvalId } = held.json() as { approvalId: string };
    assert.ok(approvalId, 'the bid should have been held for approval');

    const decide = (token: string, decision: 'APPROVE' | 'REJECT') =>
      app.inject({
        method: 'POST',
        url: `/v1/corporate/approvals/${approvalId}/decide`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision, note: decision },
      });

    await Promise.allSettled([decide(first.token, 'APPROVE'), decide(second.token, 'REJECT')]);

    const request = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approvalId },
      select: { status: true },
    });
    const bids = await prisma.bid.count({
      where: { listingId: listing.id, bidderId: buyer.userId },
    });

    // The reject path wrote the status unconditionally, so it could land on
    // top of an approval that had already put the bid on the live auction:
    // the record says declined while the organisation is committed to the bid.
    if (bids > 0) {
      assert.equal(
        request.status,
        'APPROVED',
        `a bid was placed but the request records a rejection (attempt ${attempt})`,
      );
    } else {
      assert.equal(
        request.status,
        'REJECTED',
        `no bid was placed, so it must read as rejected (attempt ${attempt})`,
      );
    }
  }
});

describe('what a seat has spent this month', () => {
  /** An order against this organisation, dated whenever. */
  async function makeOrder(orgId: string, buyerId: string, tag: string, createdAt: Date) {
    const sellerId = await makeUser(`${tag}-seller`);
    const listing = await prisma.listing.create({
      data: {
        slug: `spend-${tag}-${RUN}`,
        title: `Spend probe ${tag}`,
        description: 'Fixture.',
        status: 'SOLD',
        sellerId,
        categoryId,
        startPrice: 100_00,
        currentPrice: 100_00,
      },
      select: { id: true },
    });
    made.listings.push(listing.id);
    await prisma.order.create({
      data: {
        reference: `SPEND-${tag}-${RUN}`.toUpperCase().slice(0, 24),
        listingId: listing.id,
        buyerId,
        sellerId,
        orgId,
        hammerPrice: 100_00,
        buyerPremium: 5_00,
        shippingCost: 20_00,
        total: 125_00,
        sellerPayout: 94_00,
        platformFee: 6_00,
        paymentFee: 3_64,
        status: 'COMPLETED',
        createdAt,
        dueAt: new Date(createdAt.getTime() + 86_400_000),
      },
    });
  }

  it('counts this month and forgets last month, like the spend report beside it', async () => {
    // This was a column settlement incremented and nothing ever reset, so a
    // figure labelled "Spend this month" in the team table held every sale the
    // member had ever won — and disagreed with the spend report on the same
    // console, which has always derived it from the month's orders.
    const orgId = await makeOrg('spend');
    const owner = await seat(orgId, 'spend', 'OWNER');
    const lastMonth = new Date(Date.UTC(2026, 0, 15));
    await makeOrder(orgId, owner.userId, 'old', lastMonth);

    const read = async (url: string) =>
      JSON.parse(
        (await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${owner.token}` } }))
          .body,
      );

    let team = await read('/v1/corporate/members');
    let mine = team.members.find((m: { user: { id: string } }) => m.user.id === owner.userId);
    assert.equal(
      mine.spentThisMonth,
      0,
      `a sale from ${lastMonth.toISOString().slice(0, 7)} is still counted as this month`,
    );

    // And a sale this month is counted, at the same total the report uses.
    await makeOrder(orgId, owner.userId, 'new', new Date());
    team = await read('/v1/corporate/members');
    mine = team.members.find((m: { user: { id: string } }) => m.user.id === owner.userId);
    const report = await read('/v1/corporate/spend');
    const row = report.rows.find((r: { member: { id: string } }) => r.member.id === owner.userId);
    assert.equal(mine.spentThisMonth, 125_00, 'this month’s order total must be counted');
    assert.equal(
      mine.spentThisMonth,
      row.spend,
      'the team table and the spend report must agree on one number',
    );
  });
});

describe('an organisation that has set a monthly budget', () => {
  /** A seat whose own threshold is high, so the budget is the binding limit. */
  async function buyerWithHighThreshold(orgId: string, tag: string) {
    const buyer = await seat(orgId, tag, 'BUYER');
    await prisma.orgMember.update({
      where: { userId: buyer.userId },
      data: { approvalThreshold: 1_000_000_00 },
    });
    return buyer;
  }

  const bid = (listingId: string, token: string, maxAmount: number) =>
    app.inject({
      method: 'POST',
      url: `/v1/listings/${listingId}/bids`,
      headers: { authorization: `Bearer ${token}` },
      payload: { maxAmount },
    });

  it('holds a bid that would take the team past it, rather than letting it through', async () => {
    // monthlyBudget was read in the bid path and compared against nothing, so
    // a team could bid past it while the console showed a remaining figure and
    // a progress bar that implied otherwise.
    const orgId = await makeOrg('budget-over', { monthlyBudget: 1_000_00 });
    const buyer = await buyerWithHighThreshold(orgId, 'budget-over');
    const listingId = await makeLiveListing('budget-over');

    const res = await bid(listingId, buyer.token, 5_000_00);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { accepted: boolean; pendingApproval?: boolean; message?: string };
    assert.equal(body.accepted, false, 'the bid must not be placed');
    assert.equal(body.pendingApproval, true, 'it must be held for an approver');
    assert.match(
      body.message ?? '',
      /budget/i,
      'and say it was the budget, not the personal threshold',
    );

    const placed = await prisma.bid.count({ where: { listingId, bidderId: buyer.userId } });
    assert.equal(placed, 0, 'no bid should exist against the listing yet');
  });

  it('lets a bid within the budget straight through', async () => {
    const orgId = await makeOrg('budget-under', { monthlyBudget: 100_000_00 });
    const buyer = await buyerWithHighThreshold(orgId, 'budget-under');
    const listingId = await makeLiveListing('budget-under');

    const res = await bid(listingId, buyer.token, 5_000_00);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal((res.json() as { accepted: boolean }).accepted, true, 'it should be placed');
  });

  it('enforces nothing when no budget is set', async () => {
    // Zero means the organisation has not set one, so the bid path must not
    // start refusing every bid on the strength of it.
    const orgId = await makeOrg('budget-none', { monthlyBudget: 0 });
    const buyer = await buyerWithHighThreshold(orgId, 'budget-none');
    const listingId = await makeLiveListing('budget-none');

    const res = await bid(listingId, buyer.token, 500_000_00);
    assert.equal((res.json() as { accepted: boolean }).accepted, true, res.body);
  });

  it('still lets an approver spend past it on their own authority', async () => {
    // The budget gates the same way the threshold does, so the people who sign
    // off on spend are not locked out of their own decision.
    const orgId = await makeOrg('budget-owner', { monthlyBudget: 1_000_00 });
    const owner = await seat(orgId, 'budget-owner', 'OWNER');
    const listingId = await makeLiveListing('budget-owner');

    const res = await bid(listingId, owner.token, 50_000_00);
    assert.equal((res.json() as { accepted: boolean }).accepted, true, res.body);
  });

  it('counts only the difference when raising a maximum on a listing it already leads', async () => {
    // The current price of a led auction is already committed, so charging the
    // whole new maximum against the budget again would refuse a raise that
    // costs the organisation almost nothing.
    const orgId = await makeOrg('budget-raise', { monthlyBudget: 10_000_00 });
    const buyer = await buyerWithHighThreshold(orgId, 'budget-raise');
    const listingId = await makeLiveListing('budget-raise', 9_000_00);

    const first = await bid(listingId, buyer.token, 9_000_00);
    assert.equal((first.json() as { accepted: boolean }).accepted, true, first.body);

    // Leading at 9,000 of a 10,000 budget. A maximum of 9,500 adds only 500.
    const raise = await bid(listingId, buyer.token, 9_500_00);
    assert.equal(
      (raise.json() as { accepted: boolean }).accepted,
      true,
      `raising by 500 within a 1,000 remainder was refused: ${raise.body}`,
    );
  });

  it('agrees with the figure the console shows', async () => {
    // The console used to compute this itself. Two computations of one number
    // drift, and a console that disagrees with what refuses a bid is worse
    // than no figure at all.
    const orgId = await makeOrg('budget-agree', { monthlyBudget: 10_000_00 });
    const buyer = await buyerWithHighThreshold(orgId, 'budget-agree');
    const listingId = await makeLiveListing('budget-agree', 4_000_00);
    await bid(listingId, buyer.token, 4_000_00);

    const spend = await app.inject({
      method: 'GET',
      url: '/v1/corporate/spend',
      headers: { authorization: `Bearer ${buyer.token}` },
    });
    const totals = (spend.json() as { totals: { budget: number; committed: number; remaining: number } })
      .totals;
    assert.equal(totals.committed, 4_000_00, 'the led auction is committed money');
    assert.equal(totals.remaining, 6_000_00, 'and the remainder follows from it');

    // The enforcement must use that same remainder: 6,001 is over, 6,000 is not.
    const over = await makeLiveListing('budget-agree-2');
    const refused = await bid(over, buyer.token, 6_000_01);
    assert.equal((refused.json() as { accepted: boolean }).accepted, false, refused.body);
    const allowed = await bid(over, buyer.token, 6_000_00);
    assert.equal((allowed.json() as { accepted: boolean }).accepted, true, allowed.body);
  });
});

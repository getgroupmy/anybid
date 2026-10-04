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
async function makeOrg(tag: string) {
  const org = await prisma.organization.create({
    data: {
      name: `Org ${tag} ${RUN}`,
      slug: `org-${tag}-${RUN}`,
      registrationNo: `REG-${tag}-${RUN}`,
      billingEmail: `billing-${tag}-${RUN}@corp.test.invalid`,
      monthlyBudget: 100_000_00,
      defaultApprovalThreshold: 10_000_00,
    },
    select: { id: true },
  });
  made.orgs.push(org.id);
  return org.id;
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

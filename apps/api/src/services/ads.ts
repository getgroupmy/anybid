import { randomUUID } from 'node:crypto';
import type { ServedAd } from '@anybid/shared';
import { prisma } from '../db.ts';
import { notify } from './notifications.ts';

export interface AdRequest {
  placement: string;
  categoryId?: string | null;
  keywords?: string[];
  state?: string | null;
  userId?: string | null;
  limit?: number;
}

interface Candidate {
  campaignId: string;
  creativeId: string;
  /** effective CPM used to rank candidates, minor units */
  score: number;
  row: Record<string, any>;
}

/**
 * Serves ads by running a second-price-ish auction across eligible campaigns.
 *
 * Ranking is by effective CPM so CPC and CPM campaigns compete on one scale.
 * Relevance (category and keyword matches) multiplies the bid, so a well
 * targeted campaign beats a blunt one paying the same.
 */
export async function serveAds(req: AdRequest): Promise<ServedAd[]> {
  const limit = Math.min(req.limit ?? 1, 6);
  const now = new Date();

  const campaigns = await prisma.adCampaign.findMany({
    where: {
      status: 'ACTIVE',
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      placements: { has: req.placement as never },
      creatives: { some: { status: 'ACTIVE' } },
      advertiser: { approved: true },
    },
    include: {
      advertiser: { select: { id: true, companyName: true, balance: true } },
      creatives: { where: { status: 'ACTIVE' }, take: 5 },
      categories: { select: { categoryId: true } },
    },
    take: 60,
  });

  const today = startOfDay(now);
  const spendToday = await dailySpendMap(campaigns.map((c) => c.id), today);

  const candidates: Candidate[] = [];
  for (const c of campaigns) {
    if (c.advertiser.balance <= 0) continue;
    if (c.totalBudget && c.spend >= c.totalBudget) continue;
    if ((spendToday.get(c.id) ?? 0) >= c.dailyBudget) continue;

    // Targeting: an empty target list means "no restriction".
    if (c.categories.length > 0 && req.categoryId) {
      if (!c.categories.some((x) => x.categoryId === req.categoryId)) continue;
    }
    if (c.targetStates.length > 0 && req.state) {
      if (!c.targetStates.some((s) => s.toLowerCase() === req.state!.toLowerCase())) continue;
    }

    const relevance = relevanceMultiplier(c, req);
    if (relevance === 0) continue;

    const effectiveCpm = c.pricingModel === 'CPM' ? c.bidAmount : c.bidAmount * 10; // assume ~1% CTR
    const creative = c.creatives[Math.floor(Math.random() * c.creatives.length)];
    if (!creative) continue;

    candidates.push({
      campaignId: c.id,
      creativeId: creative.id,
      score: Math.round(effectiveCpm * relevance),
      row: { campaign: c, creative },
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const winners = candidates.slice(0, limit);

  const served: ServedAd[] = [];
  for (const w of winners) {
    const { campaign, creative } = w.row;
    const slotId = randomUUID();

    // Impressions are billed here; the client only confirms visibility.
    await recordEvent({
      type: 'IMPRESSION',
      campaign,
      creativeId: creative.id,
      placement: req.placement,
      userId: req.userId ?? null,
      slotId,
    });

    served.push({
      slotId,
      campaignId: campaign.id,
      creativeId: creative.id,
      headline: creative.headline,
      body: creative.body,
      imageUrl: creative.imageUrl,
      ctaLabel: creative.ctaLabel,
      ctaUrl: creative.ctaUrl,
      advertiserName: campaign.advertiser.companyName,
      listingId: creative.listingId,
      placement: req.placement,
    });
  }
  return served;
}

function relevanceMultiplier(campaign: Record<string, any>, req: AdRequest): number {
  let score = 1;
  if (campaign.categories.length > 0 && req.categoryId) {
    if (campaign.categories.some((x: any) => x.categoryId === req.categoryId)) score += 0.5;
  }
  const keywords: string[] = campaign.targetKeywords ?? [];
  if (keywords.length > 0) {
    const needles = (req.keywords ?? []).map((k) => k.toLowerCase());
    if (needles.length === 0) return 0.6; // untargeted context, still eligible
    const hits = keywords.filter((k) =>
      needles.some((n) => n.includes(k.toLowerCase()) || k.toLowerCase().includes(n)),
    ).length;
    if (hits === 0) return 0.4;
    score += Math.min(1, hits * 0.4);
  }
  return score;
}

interface RecordEventInput {
  type: 'IMPRESSION' | 'CLICK';
  campaign: Record<string, any>;
  creativeId: string;
  placement: string;
  userId: string | null;
  slotId: string;
}

/** Charges the advertiser wallet and keeps the daily rollup in step. */
/**
 * What one impression of a CPM campaign costs, in sen.
 *
 * A CPM bid is a price per thousand, so a single impression costs a fraction
 * of a sen and cannot be billed on its own. Rounding each one independently is
 * not a rounding error, it is the wrong price: at RM5 CPM it bills 1 sen a
 * time, which is RM10 per thousand — double the bid. Under RM5 it rounds to
 * nothing, so the campaign is never charged, its spend never reaches its
 * budget, and it serves free for ever.
 *
 * Charging the difference between the running totals is exact instead: at any
 * bid, a thousand impressions cost the bid, and nothing is lost or invented
 * along the way.
 *
 * `impressionsAfter` counts this impression, so the first one passes 1.
 */
export function cpmImpressionCost(bidAmount: number, impressionsAfter: number): number {
  if (bidAmount <= 0 || impressionsAfter <= 0) return 0;
  return (
    Math.floor((bidAmount * impressionsAfter) / 1000) -
    Math.floor((bidAmount * (impressionsAfter - 1)) / 1000)
  );
}

/**
 * What an event may actually be charged, once the advertiser's own limits are
 * taken into account.
 *
 * The eligibility filter in `serveAds` checks the wallet and both budgets, but
 * it checks them *before* the ad goes out, and every impression it serves is a
 * slot that can be clicked afterwards. Nothing stops those clicks arriving once
 * the money is gone, so the nominal price is a ceiling to be clamped, not an
 * amount to take.
 *
 * `balance` is the hard one: the ad wallet is prepaid, so there is no credit
 * line to draw on and charging past it bills money the advertiser never
 * deposited. The budgets are the advertiser's own stated ceilings, and
 * exceeding them is the same kind of wrong even when the wallet could cover it.
 *
 * A clamp to zero is not a refusal: the click still goes through and the
 * visitor is still delivered. The advertiser simply gets it for nothing, which
 * is the right way round — the platform served the slot, so the platform wears
 * the race.
 *
 * `totalRemaining` is null for a campaign with no total budget.
 */
export function chargeableCost(
  nominal: number,
  limits: { balance: number; dailyRemaining: number; totalRemaining: number | null },
): number {
  if (nominal <= 0) return 0;
  let cap = Math.min(nominal, limits.balance, limits.dailyRemaining);
  if (limits.totalRemaining !== null) cap = Math.min(cap, limits.totalRemaining);
  return Math.max(0, cap);
}

async function recordEvent(input: RecordEventInput): Promise<void> {
  const { campaign } = input;
  const date = startOfDay(new Date());

  const walletEmptied = await prisma.$transaction(async (tx) => {
    // The counters move first, because a CPM impression's price depends on how
    // many have been served. Taking the count back from the atomic increment
    // is what makes two impressions at once bill correctly: each sees its own
    // position in the sequence, with no lock and no lost fraction.
    const counted = await tx.adCampaign.update({
      where: { id: campaign.id },
      data: {
        impressions: input.type === 'IMPRESSION' ? { increment: 1 } : undefined,
        clicks: input.type === 'CLICK' ? { increment: 1 } : undefined,
      },
      select: { impressions: true },
    });

    const nominal =
      input.type === 'IMPRESSION'
        ? campaign.pricingModel === 'CPM'
          ? cpmImpressionCost(campaign.bidAmount, counted.impressions)
          : 0
        : campaign.pricingModel === 'CPC'
          ? campaign.bidAmount
          : 0;

    // The limits are read here rather than taken from the snapshot `serveAds`
    // passed in: that snapshot is as old as the impression, which for a click
    // may be hours, and what matters is what is left now.
    let cost = nominal;
    if (cost > 0) {
      const live = await tx.adCampaign.findUniqueOrThrow({
        where: { id: campaign.id },
        select: {
          spend: true,
          dailyBudget: true,
          totalBudget: true,
          advertiser: { select: { balance: true } },
        },
      });
      const todayStat = await tx.adDailyStat.findUnique({
        where: { campaignId_date: { campaignId: campaign.id, date } },
        select: { spend: true },
      });
      cost = chargeableCost(nominal, {
        balance: live.advertiser.balance,
        dailyRemaining: live.dailyBudget - (todayStat?.spend ?? 0),
        totalRemaining: live.totalBudget === null ? null : live.totalBudget - live.spend,
      });
    }

    // Charging comes before the event row, because the event records what was
    // charged and the claim below is what decides it. The claim is conditional
    // on the money still being there: two clicks arriving together both read
    // the same balance, so a plain decrement would take it twice and overdraw.
    // The one that loses charges nothing rather than going negative.
    if (cost > 0) {
      const claimed = await tx.advertiser.updateMany({
        where: { id: campaign.advertiserId, balance: { gte: cost } },
        data: { balance: { decrement: cost }, lifetimeSpend: { increment: cost } },
      });
      if (claimed.count === 0) cost = 0;
    }

    await tx.adEvent.create({
      data: {
        campaignId: campaign.id,
        creativeId: input.creativeId,
        type: input.type,
        placement: input.placement as never,
        cost,
        userId: input.userId,
        slotId: input.slotId,
      },
    });

    await tx.adCampaign.update({
      where: { id: campaign.id },
      data: { spend: { increment: cost } },
    });
    await tx.adCreative.update({
      where: { id: input.creativeId },
      data: {
        impressions: input.type === 'IMPRESSION' ? { increment: 1 } : undefined,
        clicks: input.type === 'CLICK' ? { increment: 1 } : undefined,
      },
    });

    await tx.adDailyStat.upsert({
      where: { campaignId_date: { campaignId: campaign.id, date } },
      create: {
        campaignId: campaign.id,
        date,
        impressions: input.type === 'IMPRESSION' ? 1 : 0,
        clicks: input.type === 'CLICK' ? 1 : 0,
        spend: cost,
      },
      update: {
        impressions: input.type === 'IMPRESSION' ? { increment: 1 } : undefined,
        clicks: input.type === 'CLICK' ? { increment: 1 } : undefined,
        spend: { increment: cost },
      },
    });

    const wallet = await tx.advertiser.findUniqueOrThrow({
      where: { id: campaign.advertiserId },
      select: { id: true, balance: true },
    });

    if (cost > 0) {
      await tx.adWalletTx.create({
        data: {
          advertiserId: wallet.id,
          type: 'SPEND',
          amount: -cost,
          balanceAfter: wallet.balance,
          note: `${input.type} · ${campaign.name}`,
        },
      });
    }

    // Out of money stops everything this advertiser is running — reported out
    // of the transaction rather than done inside it, see below.
    return wallet.balance <= 0;
  });

  /**
   * An empty wallet stops every campaign the advertiser runs — out here, one
   * row at a time, and both of those matter.
   *
   * Inside the transaction it deadlocked: the charge locks its own campaign's
   * row first, then the wallet, then reached for all of them, so two campaigns
   * billing one wallet at the same moment each waited for the other's row.
   * Postgres broke the tie by killing one, which aborted the whole charge and
   * handed the visitor whose click it was an error.
   *
   * Moving it out was not enough either, because one statement updating several
   * rows can still cross with another doing the same and deadlock on the
   * ordering. Taking one row per statement makes that impossible rather than
   * unlikely: no transaction here ever holds two of these locks, so there is no
   * cycle to be in. Each is a claim on ACTIVE, so running twice is harmless.
   *
   * Nothing is lost by the delay — `serveAds` reads the balance itself, so an
   * empty wallet stops serving whether or not the status has caught up.
   */
  if (walletEmptied) {
    const running = await prisma.adCampaign.findMany({
      where: { advertiserId: campaign.advertiserId, status: 'ACTIVE' },
      select: { id: true },
      // A fixed order is the other half of the rule: whoever takes these rows
      // takes them in the same sequence, so two sweeps queue instead of crossing.
      orderBy: { id: 'asc' },
    });
    for (const c of running) {
      await prisma.adCampaign.updateMany({
        where: { id: c.id, status: 'ACTIVE' },
        data: { status: 'OUT_OF_BUDGET' },
      });
    }
  }

  // Stop a campaign that just exhausted its total budget, and tell the
  // advertiser once. The stop is a claim rather than a plain update because
  // several events can finish at the same moment and all see it still ACTIVE;
  // whoever takes it is the one that notifies, so the advertiser gets one
  // message about one campaign stopping once.
  const fresh = await prisma.adCampaign.findUnique({
    where: { id: campaign.id },
    select: {
      id: true,
      name: true,
      spend: true,
      totalBudget: true,
      advertiser: { select: { userId: true } },
    },
  });
  if (fresh && fresh.totalBudget && fresh.spend >= fresh.totalBudget) {
    const stopped = await prisma.adCampaign.updateMany({
      where: { id: fresh.id, status: 'ACTIVE' },
      data: { status: 'OUT_OF_BUDGET' },
    });
    if (stopped.count === 1) {
      await notify({
        userId: fresh.advertiser.userId,
        type: 'CAMPAIGN_BUDGET_EXHAUSTED',
        title: 'Campaign budget spent',
        body: `${fresh.name} has used its total budget and stopped serving.`,
        link: '/advertiser/campaigns',
      });
    }
  }
}

/** Registers a click against a served slot and returns where to send the user. */
export async function recordClick(slotId: string, userId: string | null): Promise<string | null> {
  const impression = await prisma.adEvent.findUnique({
    where: { slotId },
    select: {
      id: true,
      type: true,
      placement: true,
      creativeId: true,
      campaignId: true,
      creative: { select: { ctaUrl: true } },
    },
  });
  if (!impression || impression.type !== 'IMPRESSION') return null;

  const clickSlot = `${slotId}:click`;

  // A click already recorded for this slot is not an error. The visitor
  // double-clicked, or their request was retried, and refusing the second one
  // left them on an error page: the advertiser had already paid for the click
  // and did not get the visit. Send them on instead.
  const already = await prisma.adEvent.findUnique({
    where: { slotId: clickSlot },
    select: { id: true },
  });
  if (already) return impression.creative.ctaUrl;

  const campaign = await prisma.adCampaign.findUnique({
    where: { id: impression.campaignId },
    include: { advertiser: { select: { id: true, companyName: true } } },
  });
  if (!campaign) return null;

  try {
    await recordEvent({
      type: 'CLICK',
      campaign,
      creativeId: impression.creativeId,
      placement: impression.placement,
      userId,
      slotId: clickSlot,
    });
  } catch (err) {
    // Two clicks arriving together both get past the check above; the unique
    // slot lets exactly one be billed and the other lands here. Billed once,
    // and both visitors still arrive.
    if ((err as { code?: string }).code !== 'P2002') throw err;
  }

  return impression.creative.ctaUrl;
}

export async function dailySpendMap(
  campaignIds: string[],
  date: Date,
): Promise<Map<string, number>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await prisma.adDailyStat.findMany({
    where: { campaignId: { in: campaignIds }, date },
    select: { campaignId: true, spend: true },
  });
  return new Map(rows.map((r) => [r.campaignId, r.spend]));
}

export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

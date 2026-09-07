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
async function recordEvent(input: RecordEventInput): Promise<void> {
  const { campaign } = input;
  const cost =
    input.type === 'IMPRESSION'
      ? campaign.pricingModel === 'CPM'
        ? Math.round(campaign.bidAmount / 1000)
        : 0
      : campaign.pricingModel === 'CPC'
        ? campaign.bidAmount
        : 0;

  const date = startOfDay(new Date());

  await prisma.$transaction(async (tx) => {
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
      data: {
        spend: { increment: cost },
        impressions: input.type === 'IMPRESSION' ? { increment: 1 } : undefined,
        clicks: input.type === 'CLICK' ? { increment: 1 } : undefined,
      },
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

    if (cost > 0) {
      const advertiser = await tx.advertiser.update({
        where: { id: campaign.advertiserId },
        data: { balance: { decrement: cost }, lifetimeSpend: { increment: cost } },
        select: { id: true, balance: true, userId: true },
      });
      await tx.adWalletTx.create({
        data: {
          advertiserId: advertiser.id,
          type: 'SPEND',
          amount: -cost,
          balanceAfter: advertiser.balance,
          note: `${input.type} · ${campaign.name}`,
        },
      });
      if (advertiser.balance <= 0) {
        await tx.adCampaign.updateMany({
          where: { advertiserId: advertiser.id, status: 'ACTIVE' },
          data: { status: 'OUT_OF_BUDGET' },
        });
      }
    }
  });

  // Pause a campaign that just exhausted its budget, and tell the advertiser.
  const fresh = await prisma.adCampaign.findUnique({
    where: { id: campaign.id },
    select: {
      id: true,
      name: true,
      spend: true,
      totalBudget: true,
      status: true,
      advertiser: { select: { userId: true } },
    },
  });
  if (fresh && fresh.totalBudget && fresh.spend >= fresh.totalBudget && fresh.status === 'ACTIVE') {
    await prisma.adCampaign.update({
      where: { id: fresh.id },
      data: { status: 'OUT_OF_BUDGET' },
    });
    await notify({
      userId: fresh.advertiser.userId,
      type: 'CAMPAIGN_BUDGET_EXHAUSTED',
      title: 'Campaign budget spent',
      body: `${fresh.name} has used its total budget and stopped serving.`,
      link: '/advertiser/campaigns',
    });
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

  const campaign = await prisma.adCampaign.findUnique({
    where: { id: impression.campaignId },
    include: { advertiser: { select: { id: true, companyName: true } } },
  });
  if (!campaign) return null;

  await recordEvent({
    type: 'CLICK',
    campaign,
    creativeId: impression.creativeId,
    placement: impression.placement,
    userId,
    slotId: `${slotId}:click`,
  });

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

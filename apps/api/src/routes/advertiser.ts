import type { FastifyInstance } from 'fastify';
import {
  adPlacementSchema,
  createCampaignSchema,
  createCreativeSchema,
  topUpSchema,
} from '@anybid/shared';
import { prisma } from '../db.ts';
import { requireAuth, requireRole, writeAudit } from '../lib/auth.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { clientIp, pageArgs, paginated, parseBody, parseQuery } from '../lib/http.ts';
import { dailySpendMap, recordClick, serveAds, startOfDay } from '../services/ads.ts';
import { campaignDto, creativeDto } from '../services/serialize.ts';
import { z } from 'zod';

const CAMPAIGN_INCLUDE = {
  creatives: true,
  categories: { select: { categoryId: true } },
} as const;

async function myAdvertiser(userId: string) {
  const advertiser = await prisma.advertiser.findUnique({ where: { userId } });
  if (!advertiser) {
    throw forbidden('Set up your advertiser profile before managing campaigns');
  }
  return advertiser;
}

export async function advertiserRoutes(app: FastifyInstance) {
  /* ---------------- public ad serving ---------------- */

  app.get('/v1/ads/serve', async (req) => {
    const q = parseQuery(
      req,
      z.object({
        placement: adPlacementSchema,
        categoryId: z.string().optional(),
        q: z.string().max(120).optional(),
        state: z.string().max(60).optional(),
        limit: z.coerce.number().int().min(1).max(6).default(1),
      }),
    );
    const ads = await serveAds({
      placement: q.placement,
      categoryId: q.categoryId ?? null,
      keywords: q.q ? q.q.split(/\s+/).filter(Boolean).slice(0, 8) : [],
      state: q.state ?? null,
      userId: req.auth?.id ?? null,
      limit: q.limit,
    });
    return { ads };
  });

  app.post('/v1/ads/click', async (req) => {
    const body = parseBody(req, z.object({ slotId: z.string().uuid() }));
    const url = await recordClick(body.slotId, req.auth?.id ?? null);
    if (!url) throw notFound('Ad slot');
    return { redirectUrl: url };
  });

  app.post('/v1/ads/impression', async (req, reply) => {
    // Impressions are billed at serve time; this endpoint exists so the client
    // can confirm viewability without being trusted to create billing events.
    reply.code(204);
    return null;
  });

  /* ---------------- advertiser console ---------------- */

  app.get('/v1/advertiser/overview', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const today = startOfDay(new Date());

    const [campaigns, totals, todayStats] = await Promise.all([
      prisma.adCampaign.count({ where: { advertiserId: advertiser.id, status: 'ACTIVE' } }),
      prisma.adCampaign.aggregate({
        where: { advertiserId: advertiser.id },
        _sum: { impressions: true, clicks: true, spend: true },
      }),
      prisma.adDailyStat.aggregate({
        where: { campaign: { advertiserId: advertiser.id }, date: today },
        _sum: { spend: true },
      }),
    ]);

    return {
      balance: advertiser.balance,
      spendToday: todayStats._sum.spend ?? 0,
      lifetimeSpend: advertiser.lifetimeSpend,
      campaigns,
      impressions: totals._sum.impressions ?? 0,
      clicks: totals._sum.clicks ?? 0,
      companyName: advertiser.companyName,
    };
  });

  app.get('/v1/advertiser/campaigns', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 20));

    const where = {
      advertiserId: advertiser.id,
      ...(query.status ? { status: query.status as never } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.adCampaign.findMany({
        where,
        include: CAMPAIGN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.adCampaign.count({ where }),
    ]);
    const spendToday = await dailySpendMap(rows.map((r) => r.id), startOfDay(new Date()));
    return paginated(rows.map((r) => campaignDto(r, spendToday.get(r.id) ?? 0)), total, args);
  });

  app.get<{ Params: { id: string } }>('/v1/advertiser/campaigns/:id', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const campaign = await prisma.adCampaign.findFirst({
      where: { id: req.params.id, advertiserId: advertiser.id },
      include: CAMPAIGN_INCLUDE,
    });
    if (!campaign) throw notFound('Campaign');
    const spendToday = await dailySpendMap([campaign.id], startOfDay(new Date()));
    return { campaign: campaignDto(campaign, spendToday.get(campaign.id) ?? 0) };
  });

  app.post('/v1/advertiser/campaigns', async (req, reply) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const body = parseBody(req, createCampaignSchema);

    const campaign = await prisma.adCampaign.create({
      data: {
        advertiserId: advertiser.id,
        name: body.name,
        objective: body.objective,
        pricingModel: body.pricingModel,
        bidAmount: body.bidAmount,
        dailyBudget: body.dailyBudget,
        totalBudget: body.totalBudget ?? null,
        startsAt: body.startsAt,
        endsAt: body.endsAt ?? null,
        placements: body.placements,
        targetKeywords: body.targetKeywords.map((k) => k.toLowerCase()),
        targetStates: body.targetStates,
        status: 'DRAFT',
        categories: {
          create: body.targetCategoryIds.map((categoryId) => ({ categoryId })),
        },
      },
      include: CAMPAIGN_INCLUDE,
    });

    await writeAudit({
      actorId: auth.id,
      action: 'campaign.create',
      targetType: 'campaign',
      targetId: campaign.id,
      ip: clientIp(req),
    });

    reply.code(201);
    return { campaign: campaignDto(campaign) };
  });

  app.patch<{ Params: { id: string } }>('/v1/advertiser/campaigns/:id', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const body = parseBody(req, createCampaignSchema.partial());

    const existing = await prisma.adCampaign.findFirst({
      where: { id: req.params.id, advertiserId: advertiser.id },
      select: { id: true },
    });
    if (!existing) throw notFound('Campaign');

    const { targetCategoryIds, ...rest } = body;
    const campaign = await prisma.adCampaign.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(rest.targetKeywords
          ? { targetKeywords: rest.targetKeywords.map((k) => k.toLowerCase()) }
          : {}),
        ...(targetCategoryIds
          ? {
              categories: {
                deleteMany: {},
                create: targetCategoryIds.map((categoryId) => ({ categoryId })),
              },
            }
          : {}),
      },
      include: CAMPAIGN_INCLUDE,
    });
    return { campaign: campaignDto(campaign) };
  });

  app.post<{ Params: { id: string } }>('/v1/advertiser/campaigns/:id/status', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const body = parseBody(req, z.object({ status: z.enum(['ACTIVE', 'PAUSED']) }));

    const existing = await prisma.adCampaign.findFirst({
      where: { id: req.params.id, advertiserId: advertiser.id },
      include: { creatives: true },
    });
    if (!existing) throw notFound('Campaign');
    if (body.status === 'ACTIVE') {
      if (existing.creatives.length === 0) throw conflict('Add a creative before going live');
      if (advertiser.balance <= 0) throw conflict('Top up your ad wallet before going live');
    }

    const campaign = await prisma.adCampaign.update({
      where: { id: existing.id },
      data: { status: body.status },
      include: CAMPAIGN_INCLUDE,
    });
    return { campaign: campaignDto(campaign) };
  });

  app.post<{ Params: { id: string } }>('/v1/advertiser/campaigns/:id/creatives', async (req, reply) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const body = parseBody(req, createCreativeSchema);

    const campaign = await prisma.adCampaign.findFirst({
      where: { id: req.params.id, advertiserId: advertiser.id },
      select: { id: true },
    });
    if (!campaign) throw notFound('Campaign');

    const creative = await prisma.adCreative.create({
      data: {
        campaignId: campaign.id,
        headline: body.headline,
        body: body.body ?? null,
        imageUrl: body.imageUrl,
        ctaLabel: body.ctaLabel,
        ctaUrl: body.ctaUrl,
        listingId: body.listingId ?? null,
      },
    });
    reply.code(201);
    return { creative: creativeDto(creative) };
  });

  app.get('/v1/advertiser/report', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const q = parseQuery(
      req,
      z.object({
        days: z.coerce.number().int().min(1).max(180).default(30),
        campaignId: z.string().optional(),
      }),
    );
    const since = startOfDay(new Date(Date.now() - q.days * 86_400_000));

    const rows = await prisma.adDailyStat.findMany({
      where: {
        date: { gte: since },
        campaign: {
          advertiserId: advertiser.id,
          ...(q.campaignId ? { id: q.campaignId } : {}),
        },
      },
      orderBy: { date: 'asc' },
    });

    const byDate = new Map<string, { impressions: number; clicks: number; spend: number }>();
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      const acc = byDate.get(key) ?? { impressions: 0, clicks: 0, spend: 0 };
      acc.impressions += r.impressions;
      acc.clicks += r.clicks;
      acc.spend += r.spend;
      byDate.set(key, acc);
    }

    const series = [...byDate.entries()].map(([date, v]) => ({
      date,
      ...v,
      ctr: v.impressions ? Number(((v.clicks / v.impressions) * 100).toFixed(2)) : 0,
    }));
    const totals = series.reduce(
      (acc, r) => ({
        impressions: acc.impressions + r.impressions,
        clicks: acc.clicks + r.clicks,
        spend: acc.spend + r.spend,
        ctr: 0,
      }),
      { impressions: 0, clicks: 0, spend: 0, ctr: 0 },
    );
    totals.ctr = totals.impressions
      ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2))
      : 0;

    return { rows: series, totals };
  });

  app.post('/v1/advertiser/wallet/top-up', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const body = parseBody(req, topUpSchema);

    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.advertiser.update({
        where: { id: advertiser.id },
        data: { balance: { increment: body.amount } },
      });
      await tx.adWalletTx.create({
        data: {
          advertiserId: a.id,
          type: 'TOP_UP',
          amount: body.amount,
          balanceAfter: a.balance,
          note: `Top-up via ${body.method}`,
        },
      });
      // A campaign parked for lack of funds can run again.
      await tx.adCampaign.updateMany({
        where: { advertiserId: a.id, status: 'OUT_OF_BUDGET' },
        data: { status: 'PAUSED' },
      });
      return a;
    });

    return { balance: updated.balance };
  });

  app.get('/v1/advertiser/wallet', async (req) => {
    const auth = requireRole(req, 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN');
    const advertiser = await myAdvertiser(auth.id);
    const transactions = await prisma.adWalletTx.findMany({
      where: { advertiserId: advertiser.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { balance: advertiser.balance, transactions };
  });
}

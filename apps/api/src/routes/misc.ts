import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.ts';
import { requireAuth } from '../lib/auth.ts';
import { notFound } from '../lib/errors.ts';
import { pageArgs, paginated } from '../lib/http.ts';
import { listingSummary, notificationDto, publicUser } from '../services/serialize.ts';

export async function miscRoutes(app: FastifyInstance) {
  app.get('/v1/categories', async () => {
    const rows = await prisma.category.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { listings: { where: { status: 'LIVE' } } } } },
    });

    const byId = new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          slug: r.slug,
          parentId: r.parentId,
          icon: r.icon,
          listingCount: r._count.listings,
          children: [] as unknown[],
        },
      ]),
    );
    const roots: unknown[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
      else roots.push(node);
    }
    return { categories: roots };
  });

  app.get<{ Params: { handle: string } }>('/v1/users/:handle', async (req) => {
    const user = await prisma.user.findFirst({
      where: { OR: [{ handle: req.params.handle }, { id: req.params.handle }] },
    });
    if (!user) throw notFound('User');
    const listings = await prisma.listing.findMany({
      where: { sellerId: user.id, status: { in: ['LIVE', 'SOLD'] } },
      include: { seller: true, category: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
    return { user: publicUser(user), listings: listings.map((l) => listingSummary(l)) };
  });

  app.get('/v1/notifications', async (req) => {
    const auth = requireAuth(req);
    const query = req.query as Record<string, string>;
    const args = pageArgs(Number(query.page ?? 1), Number(query.perPage ?? 30));
    const where = { userId: auth.id, ...(query.unread === 'true' ? { read: false } : {}) };

    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      prisma.notification.count({ where }),
    ]);
    return paginated(rows.map(notificationDto), total, args);
  });

  app.post<{ Params: { id: string } }>('/v1/notifications/:id/read', async (req, reply) => {
    const auth = requireAuth(req);
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: auth.id },
      data: { read: true },
    });
    reply.code(204);
    return null;
  });

  app.post('/v1/notifications/read-all', async (req, reply) => {
    const auth = requireAuth(req);
    await prisma.notification.updateMany({
      where: { userId: auth.id, read: false },
      data: { read: true },
    });
    reply.code(204);
    return null;
  });

  app.get('/v1/stats', async () => {
    const [liveListings, bids, users, gmv] = await Promise.all([
      prisma.listing.count({ where: { status: 'LIVE' } }),
      prisma.bid.count(),
      prisma.user.count(),
      prisma.order.aggregate({
        _sum: { hammerPrice: true },
        where: { status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'AWAITING_SHIPMENT'] } },
      }),
    ]);
    return {
      liveListings,
      bids,
      users,
      gmv: gmv._sum.hammerPrice ?? 0,
    };
  });
}

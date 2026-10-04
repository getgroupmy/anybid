import {
  maskHandle,
  minimumBid,
  type BidSummary,
  type ListingDetail,
  type ListingSummary,
  type PublicUser,
  type SessionUser,
} from '@anybid/shared';
import { listingPseudonym } from '../lib/crypto.ts';

type AnyRow = Record<string, any>;

export function publicUser(u: AnyRow): PublicUser {
  return {
    id: u.id,
    displayName: u.displayName,
    handle: u.handle,
    avatarUrl: u.avatarUrl ?? null,
    city: u.city ?? null,
    state: u.state ?? null,
    verified: Boolean(u.verified),
    ratingAvg: u.ratingCount ? Number((u.ratingSum / u.ratingCount).toFixed(2)) : 0,
    ratingCount: u.ratingCount ?? 0,
    createdAt: toIso(u.createdAt),
  };
}

export function sessionUser(u: AnyRow, unread = 0): SessionUser {
  return {
    ...publicUser(u),
    email: u.email,
    roles: u.roles,
    orgId: u.orgMembership?.orgId ?? null,
    orgRole: u.orgMembership?.orgRole ?? null,
    orgName: u.orgMembership?.org?.name ?? null,
    suspended: Boolean(u.suspended),
    kycStatus: u.kycStatus,
    balance: u.balance ?? 0,
    unreadNotifications: unread,
  };
}

export interface ViewerContext {
  userId?: string | null;
  watchedIds?: Set<string>;
  myMaxByListing?: Map<string, number>;
  approvalThreshold?: number | null;
}

export function listingSummary(l: AnyRow, viewer?: ViewerContext): ListingSummary {
  const summary: ListingSummary = {
    id: l.id,
    slug: l.slug,
    title: l.title,
    kind: l.kind,
    status: l.status,
    condition: l.condition,
    currency: l.currency,
    image: l.images?.[0] ?? null,
    currentPrice: l.currentPrice,
    startPrice: l.startPrice,
    buyNowPrice: l.buyNowPrice ?? null,
    bidCount: l.bidCount,
    watchCount: l.watchCount,
    endsAt: l.endsAt ? toIso(l.endsAt) : null,
    startsAt: l.startsAt ? toIso(l.startsAt) : null,
    createdAt: toIso(l.createdAt),
    reserveMet: Boolean(l.reserveMet),
    hasReserve: Boolean(l.reservePrice),
    featured: Boolean(l.featured),
    locationCity: l.locationCity ?? null,
    locationState: l.locationState ?? null,
    seller: l.seller ? publicUser(l.seller) : anonymousSeller(),
    category: l.category
      ? { id: l.category.id, name: l.category.name, slug: l.category.slug }
      : { id: l.categoryId, name: 'Uncategorised', slug: 'uncategorised' },
  };

  if (viewer?.userId) {
    const myMax = viewer.myMaxByListing?.get(l.id) ?? null;
    summary.viewer = {
      watching: viewer.watchedIds?.has(l.id) ?? false,
      isLeading: l.leaderId === viewer.userId,
      isSeller: l.sellerId === viewer.userId,
      myMaxBid: myMax,
      // What to compare the live feed's leaderRef against. Computed per
      // listing, so it tells the viewer about this auction and nothing else.
      myRef: listingPseudonym(l.id, viewer.userId),
      requiresApproval: Boolean(
        viewer.approvalThreshold && viewer.approvalThreshold > 0 &&
          l.currentPrice >= viewer.approvalThreshold,
      ),
    };
  }
  return summary;
}

export function listingDetail(l: AnyRow, viewer?: ViewerContext): ListingDetail {
  return {
    ...listingSummary(l, viewer),
    description: l.description,
    images: l.images ?? [],
    quantity: l.quantity,
    bidIncrement: l.bidIncrement ?? null,
    minimumBid: minimumBid(l.currentPrice, l.bidCount > 0, l.bidIncrement),
    shippingCost: l.shippingCost ?? 0,
    localPickup: Boolean(l.localPickup),
    tags: l.tags ?? [],
    antiSnipeWindowSec: l.antiSnipeWindowSec,
    antiSnipeExtensionSec: l.antiSnipeExtensionSec,
    viewCount: l.viewCount ?? 0,
    bids: (l.bids ?? []).map(bidSummary),
  };
}

export function bidSummary(b: AnyRow): BidSummary {
  return {
    id: b.id,
    amount: b.amount,
    createdAt: toIso(b.createdAt),
    status: b.status,
    /**
     * No bidderId here. The mask is the whole point of this shape, and
     * /v1/users/:handle resolves a user id as readily as a handle — so
     * shipping the id alongside the mask put every bidder's real name, city
     * and join date one unauthenticated request away. The bid history and the
     * listing page are both public, so that was every bidder on the site.
     *
     * Nothing in the web or mobile consoles reads it; they render `masked`.
     */
    bidder: {
      masked: maskHandle(b.bidder?.handle ?? ''),
      avatarUrl: b.bidder?.avatarUrl ?? null,
    },
    isAuto: Boolean(b.isAuto),
  };
}

export function orderDto(o: AnyRow) {
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    listing: o.listing ? listingSummary(o.listing) : null,
    buyer: o.buyer ? publicUser(o.buyer) : null,
    seller: o.seller ? publicUser(o.seller) : null,
    hammerPrice: o.hammerPrice,
    buyerPremium: o.buyerPremium,
    shippingCost: o.shippingCost,
    total: o.total,
    sellerPayout: o.sellerPayout,
    platformFee: o.platformFee,
    currency: o.currency,
    paymentMethod: o.paymentMethod ?? null,
    paidAt: o.paidAt ? toIso(o.paidAt) : null,
    shippedAt: o.shippedAt ? toIso(o.shippedAt) : null,
    courier: o.courier ?? null,
    trackingNumber: o.trackingNumber ?? null,
    createdAt: toIso(o.createdAt),
    dueAt: o.dueAt ? toIso(o.dueAt) : null,
  };
}

export function notificationDto(n: AnyRow) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
    read: n.read,
    createdAt: toIso(n.createdAt),
  };
}

export function campaignDto(c: AnyRow, spendToday = 0) {
  const ctr = c.impressions > 0 ? Number(((c.clicks / c.impressions) * 100).toFixed(2)) : 0;
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    objective: c.objective,
    pricingModel: c.pricingModel,
    bidAmount: c.bidAmount,
    dailyBudget: c.dailyBudget,
    totalBudget: c.totalBudget ?? null,
    spend: c.spend,
    spendToday,
    impressions: c.impressions,
    clicks: c.clicks,
    ctr,
    startsAt: toIso(c.startsAt),
    endsAt: c.endsAt ? toIso(c.endsAt) : null,
    placements: c.placements ?? [],
    targetKeywords: c.targetKeywords ?? [],
    targetCategoryIds: (c.categories ?? []).map((x: AnyRow) => x.categoryId),
    creatives: (c.creatives ?? []).map(creativeDto),
  };
}

export function creativeDto(c: AnyRow) {
  return {
    id: c.id,
    headline: c.headline,
    body: c.body ?? null,
    imageUrl: c.imageUrl,
    ctaLabel: c.ctaLabel,
    ctaUrl: c.ctaUrl,
    listingId: c.listingId ?? null,
    status: c.status,
    impressions: c.impressions,
    clicks: c.clicks,
  };
}

export function organizationDto(o: AnyRow, memberCount = 0, spentThisMonth = 0) {
  return {
    id: o.id,
    name: o.name,
    registrationNo: o.registrationNo,
    industry: o.industry ?? null,
    billingEmail: o.billingEmail,
    monthlyBudget: o.monthlyBudget,
    spentThisMonth,
    creditLimit: o.creditLimit,
    outstanding: o.outstanding,
    paymentTerms: o.paymentTerms,
    defaultApprovalThreshold: o.defaultApprovalThreshold,
    memberCount,
    createdAt: toIso(o.createdAt),
  };
}

/**
 * `spentThisMonth` is passed in, not read off the row. It used to be a column
 * that settlement incremented and nothing ever reset, so a field labelled "this
 * month" held every sale the member had ever won. The month's figure is derived
 * from their orders now, the same way the spend report has always done it.
 */
export function orgMemberDto(m: AnyRow, spentThisMonth = 0) {
  return {
    id: m.id,
    user: publicUser(m.user),
    orgRole: m.orgRole,
    approvalThreshold: m.approvalThreshold ?? null,
    active: m.active,
    spentThisMonth,
    joinedAt: toIso(m.joinedAt),
  };
}

export function approvalDto(a: AnyRow) {
  return {
    id: a.id,
    status: a.status,
    amount: a.amount,
    reference: a.reference ?? null,
    listing: {
      id: a.listing.id,
      slug: a.listing.slug,
      title: a.listing.title,
      image: a.listing.images?.[0] ?? null,
      endsAt: a.listing.endsAt ? toIso(a.listing.endsAt) : null,
      currentPrice: a.listing.currentPrice,
    },
    requestedBy: publicUser(a.requestedBy),
    decidedBy: a.decidedBy ? publicUser(a.decidedBy) : null,
    note: a.note ?? null,
    createdAt: toIso(a.createdAt),
    decidedAt: a.decidedAt ? toIso(a.decidedAt) : null,
    expiresAt: toIso(a.expiresAt),
  };
}

export function auditDto(a: AnyRow) {
  return {
    id: a.id,
    actor: a.actor ? publicUser(a.actor) : null,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    meta: a.meta ?? null,
    ip: a.ip ?? null,
    createdAt: toIso(a.createdAt),
  };
}

function anonymousSeller(): PublicUser {
  return {
    id: 'unknown',
    displayName: 'AnyBid seller',
    handle: 'anybid',
    avatarUrl: null,
    city: null,
    state: null,
    verified: false,
    ratingAvg: 0,
    ratingCount: 0,
    createdAt: new Date(0).toISOString(),
  };
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date().toISOString();
}

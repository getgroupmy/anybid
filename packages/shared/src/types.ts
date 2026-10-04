import type { Money } from './money.ts';
import type { ListingKind, ListingStatus } from './auction.ts';
import type { OrgRole, Role } from './roles.ts';

export interface PublicUser {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  city: string | null;
  state: string | null;
  verified: boolean;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
}

export interface SessionUser extends PublicUser {
  email: string;
  roles: Role[];
  orgId: string | null;
  orgRole: OrgRole | null;
  orgName: string | null;
  suspended: boolean;
  kycStatus: KycStatus;
  balance: Money;
  unreadNotifications: number;
}

export type KycStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  icon: string | null;
  listingCount?: number;
  children?: Category[];
}

export interface ListingSummary {
  id: string;
  slug: string;
  title: string;
  kind: ListingKind;
  status: ListingStatus;
  condition: string;
  currency: string;
  image: string | null;
  currentPrice: Money;
  startPrice: Money;
  buyNowPrice: Money | null;
  bidCount: number;
  watchCount: number;
  endsAt: string | null;
  startsAt: string | null;
  createdAt: string;
  reserveMet: boolean;
  hasReserve: boolean;
  featured: boolean;
  locationCity: string | null;
  locationState: string | null;
  seller: PublicUser;
  category: Pick<Category, 'id' | 'name' | 'slug'>;
  /** present when the request is authenticated */
  viewer?: ViewerListingState;
}

export interface ViewerListingState {
  watching: boolean;
  isLeading: boolean;
  isSeller: boolean;
  myMaxBid: Money | null;
  requiresApproval: boolean;
  /**
   * This viewer's pseudonym on this listing, so the live feed can be matched
   * against it. Null when nobody is signed in.
   */
  myRef: string | null;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  images: string[];
  quantity: number;
  bidIncrement: Money | null;
  minimumBid: Money;
  shippingCost: Money;
  localPickup: boolean;
  tags: string[];
  antiSnipeWindowSec: number;
  antiSnipeExtensionSec: number;
  viewCount: number;
  bids: BidSummary[];
}

export interface BidSummary {
  id: string;
  amount: Money;
  createdAt: string;
  status: 'ACTIVE' | 'OUTBID' | 'WON' | 'LOST' | 'RETRACTED' | 'PENDING_APPROVAL';
  /** Deliberately no id: see the note in the API's bidSummary. */
  bidder: { masked: string; avatarUrl: string | null };
  isAuto: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'AWAITING_SHIPMENT'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'DISPUTED';

export interface Order {
  id: string;
  reference: string;
  status: OrderStatus;
  listing: ListingSummary;
  buyer: PublicUser;
  seller: PublicUser;
  hammerPrice: Money;
  buyerPremium: Money;
  shippingCost: Money;
  total: Money;
  sellerPayout: Money;
  platformFee: Money;
  currency: string;
  paymentMethod: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  courier: string | null;
  trackingNumber: string | null;
  createdAt: string;
  dueAt: string | null;
}

export interface NotificationItem {
  id: string;
  type:
    | 'OUTBID'
    | 'AUCTION_WON'
    | 'AUCTION_LOST'
    | 'AUCTION_ENDING'
    | 'ITEM_SOLD'
    | 'PAYMENT_RECEIVED'
    | 'ORDER_SHIPPED'
    | 'APPROVAL_REQUESTED'
    | 'APPROVAL_DECIDED'
    | 'CAMPAIGN_BUDGET_EXHAUSTED'
    | 'KYC_UPDATE'
    | 'SYSTEM';
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

/* -------- advertiser -------- */

export interface Campaign {
  id: string;
  name: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'REJECTED' | 'OUT_OF_BUDGET';
  objective: string;
  pricingModel: 'CPC' | 'CPM';
  bidAmount: Money;
  dailyBudget: Money;
  totalBudget: Money | null;
  spend: Money;
  spendToday: Money;
  impressions: number;
  clicks: number;
  ctr: number;
  startsAt: string;
  endsAt: string | null;
  placements: string[];
  targetKeywords: string[];
  targetCategoryIds: string[];
  creatives: Creative[];
}

export interface Creative {
  id: string;
  headline: string;
  body: string | null;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  listingId: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'REJECTED';
  impressions: number;
  clicks: number;
}

export interface ServedAd {
  slotId: string;
  campaignId: string;
  creativeId: string;
  headline: string;
  body: string | null;
  imageUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  advertiserName: string;
  listingId: string | null;
  placement: string;
}

/* -------- corporate -------- */

export interface Organization {
  id: string;
  name: string;
  registrationNo: string;
  industry: string | null;
  billingEmail: string;
  monthlyBudget: Money;
  spentThisMonth: Money;
  creditLimit: Money;
  outstanding: Money;
  paymentTerms: string;
  defaultApprovalThreshold: Money;
  memberCount: number;
  createdAt: string;
}

export interface OrgMember {
  id: string;
  user: PublicUser;
  orgRole: OrgRole;
  approvalThreshold: Money | null;
  active: boolean;
  spentThisMonth: Money;
  joinedAt: string;
}

export interface ApprovalRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  amount: Money;
  reference: string | null;
  listing: Pick<ListingSummary, 'id' | 'slug' | 'title' | 'image' | 'endsAt' | 'currentPrice'>;
  requestedBy: PublicUser;
  decidedBy: PublicUser | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
}

/* -------- admin -------- */

export interface AdminMetrics {
  users: { total: number; new7d: number; suspended: number; pendingKyc: number };
  listings: { live: number; endingSoon: number; pendingReview: number; total: number };
  bids: { total: number; last24h: number };
  gmv: { allTime: Money; last30d: Money; last24h: Money };
  revenue: { commission: Money; ads: Money };
  orders: { awaitingPayment: number; disputed: number; completed: number };
  timeseries: { date: string; gmv: number; bids: number; newUsers: number }[];
}

export interface AuditEntry {
  id: string;
  actor: PublicUser | null;
  action: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

/** The JSON body the API returns for a failed request. */
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
  statusCode: number;
}

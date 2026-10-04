import { z } from 'zod';
import { ROLES, ORG_ROLES } from './roles.ts';

export const idSchema = z.string().min(1);
export const emailSchema = z.string().email().max(200).transform((v) => v.trim().toLowerCase());
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((v) => /[a-z]/i.test(v) && /[0-9]/.test(v), 'Include at least one letter and one number');

export const phoneSchema = z
  .string()
  .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number')
  .optional();

export const moneySchema = z
  // The message matters: the website sends NaN for a money field it could not
  // read, and "Expected number, received nan" is not something to show anyone.
  .number({ invalid_type_error: 'Enter an amount' })
  .int()
  .nonnegative()
  .max(1_000_000_000_00);

/**
 * A money field where zero is not a value, it is the absence of one.
 *
 * A reserve, a buy-now price and a bid increment are all read as "none" when
 * they are zero or null — `isReserveMet` returns true for a reserve of zero, so
 * an auction with one sells at any price. Accepting a zero from a caller that
 * meant to set a number is therefore the silent removal of a seller's floor:
 * the API answers 201, the listing reports `hasReserve: false`, and the item
 * can sell for the first bid above the start price.
 *
 * The website's money parser turns anything it cannot read into zero, so a
 * seller who types letters, or two decimal points, in the reserve box sends
 * exactly this. `null` stays the way to say there is none.
 */
export const optionalMoneySchema = moneySchema
  .refine((v) => v > 0, 'Leave this blank if there is none — zero is not an amount')
  .optional()
  .nullable();

/* ---------------- auth ---------------- */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(2).max(80),
  phone: phoneSchema,
  accountType: z.enum(['PERSONAL', 'BUSINESS']).default('PERSONAL'),
  /** requested extra consoles at sign-up; ADMIN is never self-granted */
  requestRoles: z.array(z.enum(['ADVERTISER', 'CORPORATE'])).default([]),
  organizationName: z.string().min(2).max(120).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  bio: z.string().max(500).optional(),
  phone: phoneSchema,
  avatarUrl: z.string().url().max(500).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  country: z.string().length(2).optional(),
});

/* ---------------- listings ---------------- */

export const listingKindSchema = z.enum(['AUCTION', 'BUY_NOW', 'AUCTION_WITH_BUY_NOW']);
export const conditionSchema = z.enum([
  'NEW',
  'LIKE_NEW',
  'GOOD',
  'FAIR',
  'FOR_PARTS',
  'REFURBISHED',
]);

export const createListingSchema = z
  .object({
    title: z.string().min(6).max(140),
    description: z.string().min(20).max(8000),
    categoryId: idSchema,
    kind: listingKindSchema.default('AUCTION'),
    condition: conditionSchema.default('GOOD'),
    quantity: z.number().int().min(1).max(9999).default(1),
    images: z.array(z.string().url().max(600)).min(1, 'Add at least one photo').max(12),
    startPrice: moneySchema,
    reservePrice: optionalMoneySchema,
    buyNowPrice: optionalMoneySchema,
    bidIncrement: optionalMoneySchema,
    startsAt: z.coerce.date().optional(),
    /** auction duration in hours */
    durationHours: z.number().int().min(1).max(24 * 30).default(72),
    antiSnipeWindowSec: z.number().int().min(0).max(1800).default(120),
    antiSnipeExtensionSec: z.number().int().min(0).max(1800).default(120),
    locationCity: z.string().max(80).optional(),
    locationState: z.string().max(80).optional(),
    shippingCost: moneySchema.default(0),
    localPickup: z.boolean().default(true),
    tags: z.array(z.string().min(1).max(30)).max(15).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== 'BUY_NOW' && v.startPrice <= 0) {
      ctx.addIssue({ code: 'custom', path: ['startPrice'], message: 'Starting price must be above zero' });
    }
    if (v.kind === 'BUY_NOW' && !v.buyNowPrice) {
      ctx.addIssue({ code: 'custom', path: ['buyNowPrice'], message: 'Fixed-price listings need a price' });
    }
    if (v.buyNowPrice && v.buyNowPrice <= v.startPrice && v.kind !== 'BUY_NOW') {
      ctx.addIssue({
        code: 'custom',
        path: ['buyNowPrice'],
        message: 'Buy-now price must be above the starting price',
      });
    }
    if (v.reservePrice && v.reservePrice < v.startPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['reservePrice'],
        message: 'Reserve cannot be below the starting price',
      });
    }
  });
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = z.object({
  title: z.string().min(6).max(140).optional(),
  description: z.string().min(20).max(8000).optional(),
  images: z.array(z.string().url().max(600)).min(1).max(12).optional(),
  buyNowPrice: optionalMoneySchema,
  shippingCost: moneySchema.optional(),
  localPickup: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(30)).max(15).optional(),
});

export const searchListingsSchema = z.object({
  q: z.string().max(120).optional(),
  categoryId: idSchema.optional(),
  categorySlug: z.string().max(120).optional(),
  kind: listingKindSchema.optional(),
  condition: conditionSchema.optional(),
  minPrice: moneySchema.optional(),
  maxPrice: moneySchema.optional(),
  state: z.string().max(80).optional(),
  sellerId: idSchema.optional(),
  status: z.enum(['LIVE', 'ENDED', 'SOLD', 'SCHEDULED', 'ALL']).default('LIVE'),
  endingWithinHours: z.coerce.number().int().min(1).max(720).optional(),
  sort: z
    .enum(['ending_soon', 'newest', 'price_asc', 'price_desc', 'most_bids', 'relevance'])
    .default('ending_soon'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(60).default(24),
});
export type SearchListingsInput = z.infer<typeof searchListingsSchema>;

/* ---------------- bidding ---------------- */

export const placeBidSchema = z.object({
  /** the bidder's proxy maximum, in minor units */
  maxAmount: moneySchema.refine((v) => v > 0, 'Enter a bid amount'),
  /** guards against bidding on a price that moved while the form was open */
  expectedPrice: moneySchema.optional(),
  /** corporate buyers can attach a purchase reference */
  reference: z.string().max(80).optional(),
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

export const buyNowSchema = z.object({
  quantity: z.number().int().min(1).max(99).default(1),
});

/* ---------------- orders ---------------- */

export const checkoutSchema = z.object({
  shippingName: z.string().min(2).max(120),
  shippingPhone: z.string().min(6).max(30),
  addressLine1: z.string().min(4).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  postcode: z.string().min(3).max(12),
  country: z.string().length(2).default('MY'),
  method: z.enum(['FPX', 'CARD', 'EWALLET', 'CORPORATE_INVOICE']).default('FPX'),
  notes: z.string().max(500).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const shipOrderSchema = z.object({
  courier: z.string().min(2).max(60),
  trackingNumber: z.string().min(3).max(60),
});

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

/* ---------------- advertiser ---------------- */

export const adPlacementSchema = z.enum([
  'HOME_HERO',
  'HOME_FEED',
  'SEARCH_INLINE',
  'LISTING_SIDEBAR',
  'MOBILE_FEED',
  'CATEGORY_BANNER',
]);
export type AdPlacement = z.infer<typeof adPlacementSchema>;

/** The campaign fields, before cross-field validation — `.partial()`-able. */
export const campaignFieldsSchema = z
  .object({
    name: z.string().min(3).max(120),
    objective: z.enum(['TRAFFIC', 'AWARENESS', 'LISTING_PROMOTION']).default('TRAFFIC'),
    pricingModel: z.enum(['CPC', 'CPM']).default('CPC'),
    /** what the advertiser pays per click (CPC) or per 1000 impressions (CPM) */
    bidAmount: moneySchema.refine((v) => v > 0, 'Set a bid'),
    dailyBudget: moneySchema.refine((v) => v > 0, 'Set a daily budget'),
    totalBudget: optionalMoneySchema,
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional().nullable(),
    placements: z.array(adPlacementSchema).min(1),
    targetCategoryIds: z.array(idSchema).max(20).default([]),
    targetKeywords: z.array(z.string().min(1).max(40)).max(50).default([]),
    targetStates: z.array(z.string().max(60)).max(20).default([]),
  })
;

export const createCampaignSchema = campaignFieldsSchema.superRefine((v, ctx) => {
  if (v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date must be after the start date' });
  }
  if (v.totalBudget && v.totalBudget < v.dailyBudget) {
    ctx.addIssue({
      code: 'custom',
      path: ['totalBudget'],
      message: 'Total budget cannot be below the daily budget',
    });
  }
});

export const updateCampaignSchema = campaignFieldsSchema.partial();
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const createCreativeSchema = z.object({
  headline: z.string().min(3).max(80),
  body: z.string().max(160).optional(),
  imageUrl: z.string().url().max(600),
  ctaLabel: z.string().min(2).max(24).default('Learn more'),
  ctaUrl: z.string().url().max(600),
  /** optionally promote an on-platform listing instead of an external URL */
  listingId: idSchema.optional().nullable(),
});

export const topUpSchema = z.object({
  amount: moneySchema.refine((v) => v >= 10_00, 'Minimum top-up is RM10.00'),
  method: z.enum(['FPX', 'CARD', 'BANK_TRANSFER']).default('FPX'),
});

/* ---------------- corporate ---------------- */

export const createOrgSchema = z.object({
  name: z.string().min(2).max(120),
  registrationNo: z.string().min(4).max(40),
  taxId: z.string().max(40).optional(),
  industry: z.string().max(80).optional(),
  billingEmail: emailSchema,
  addressLine1: z.string().min(4).max(200),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  postcode: z.string().min(3).max(12),
  country: z.string().length(2).default('MY'),
});

export const inviteMemberSchema = z.object({
  email: emailSchema,
  orgRole: z.enum(ORG_ROLES).default('BUYER'),
  /** per-bid spend ceiling before an approver is required, in minor units */
  approvalThreshold: moneySchema.optional().nullable(),
});

export const updateMemberSchema = z.object({
  orgRole: z.enum(ORG_ROLES).optional(),
  approvalThreshold: moneySchema.optional().nullable(),
  active: z.boolean().optional(),
});

/**
 * An organisation's own spending policy, which it sets for itself.
 *
 * Deliberately does not include creditLimit or paymentTerms. Those decide
 * whether this organisation may take goods now and pay later, and how much of
 * that the platform is willing to carry — the platform's risk, not the
 * customer's preference. They live in orgCreditSchema, behind the admin
 * console.
 */
export const orgBudgetSchema = z.object({
  /** period budget in minor units */
  monthlyBudget: moneySchema,
  /** bids above this need an approver, org-wide default */
  defaultApprovalThreshold: moneySchema,
});

/** What the platform is prepared to extend to an organisation. Admin only. */
export const orgCreditSchema = z.object({
  creditLimit: moneySchema.default(0),
  paymentTerms: z.enum(['PREPAID', 'NET_7', 'NET_14', 'NET_30', 'NET_60']).default('PREPAID'),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(500).optional(),
});

export const rfqSchema = z.object({
  title: z.string().min(6).max(140),
  description: z.string().min(20).max(4000),
  categoryId: idSchema,
  quantity: z.number().int().min(1).max(100000),
  targetUnitPrice: moneySchema.optional().nullable(),
  closesAt: z.coerce.date(),
  deliveryState: z.string().max(80).optional(),
});

/* ---------------- admin ---------------- */

export const moderateListingSchema = z.object({
  action: z.enum(['APPROVE', 'SUSPEND', 'CANCEL', 'FEATURE', 'UNFEATURE']),
  reason: z.string().max(500).optional(),
});

export const suspendUserSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().min(3).max(500),
  until: z.coerce.date().optional().nullable(),
});

export const setRolesSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1),
});

export const kycDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_MORE']),
  note: z.string().max(500).optional(),
});

export const platformSettingsSchema = z.object({
  sellerCommissionBps: z.number().int().min(0).max(5000).optional(),
  buyerPremiumBps: z.number().int().min(0).max(5000).optional(),
  paymentProcessingBps: z.number().int().min(0).max(2000).optional(),
  paymentFlatFee: moneySchema.optional(),
  minCommission: moneySchema.optional(),
  maxCommission: moneySchema.optional(),
  defaultAntiSnipeWindowSec: z.number().int().min(0).max(1800).optional(),
  defaultAntiSnipeExtensionSec: z.number().int().min(0).max(1800).optional(),
  maintenanceMode: z.boolean().optional(),
  newListingsRequireReview: z.boolean().optional(),
});

export const disputeSchema = z.object({
  orderId: idSchema,
  reason: z.enum(['NOT_RECEIVED', 'NOT_AS_DESCRIBED', 'DAMAGED', 'COUNTERFEIT', 'OTHER']),
  detail: z.string().min(10).max(2000),
});

export const disputeResolutionSchema = z.object({
  resolution: z.enum(['REFUND_BUYER', 'RELEASE_SELLER', 'PARTIAL_REFUND', 'REJECTED']),
  amount: moneySchema.optional(),
  note: z.string().max(1000),
});

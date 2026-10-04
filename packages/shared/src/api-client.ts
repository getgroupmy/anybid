import type {
  AdminMetrics,
  ApprovalRequest,
  AuditEntry,
  BidSummary,
  Campaign,
  Category,
  Creative,
  ListingDetail,
  ListingSummary,
  NotificationItem,
  Order,
  OrgMember,
  Organization,
  Paginated,
  PublicUser,
  ServedAd,
  SessionUser,
} from './types.ts';
import type { Money } from './money.ts';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface TokenStore {
  get(): Tokens | null | Promise<Tokens | null>;
  set(t: Tokens | null): void | Promise<void>;
}

export class ApiError extends Error {
  constructor(
    override readonly message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isAuth() {
    return this.statusCode === 401 || this.statusCode === 403;
  }
  /** Field-level messages keyed by form field, when the API returned zod issues. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const d = this.details as { issues?: { path: (string | number)[]; message: string }[] } | undefined;
    for (const issue of d?.issues ?? []) {
      const key = issue.path.join('.') || '_';
      if (!out[key]) out[key] = issue.message;
    }
    return out;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens?: TokenStore;
  /** static bearer token (server-side rendering with a cookie session) */
  token?: string | null;
  fetchImpl?: typeof fetch;
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

export class AnyBidClient {
  private readonly baseUrl: string;
  private readonly store?: TokenStore;
  private readonly staticToken?: string | null;
  private readonly doFetch: typeof fetch;
  private readonly onUnauthorized?: () => void;
  private refreshing: Promise<Tokens | null> | null = null;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.store = opts.tokens;
    this.staticToken = opts.token;
    this.doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.onUnauthorized = opts.onUnauthorized;
  }

  private qs(query?: Query): string {
    if (!query) return '';
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((item) => p.append(k, String(item)));
      else p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }

  private async authHeader(): Promise<Record<string, string>> {
    if (this.staticToken) return { authorization: `Bearer ${this.staticToken}` };
    const t = await this.store?.get();
    if (!t) return {};
    if (t.expiresAt - 30_000 < Date.now() && t.refreshToken) {
      const fresh = await this.refresh(t.refreshToken);
      if (fresh) return { authorization: `Bearer ${fresh.accessToken}` };
      return {};
    }
    return { authorization: `Bearer ${t.accessToken}` };
  }

  private async refresh(refreshToken: string): Promise<Tokens | null> {
    this.refreshing ??= (async () => {
      try {
        const res = await this.doFetch(`${this.baseUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) {
          await this.store?.set(null);
          this.onUnauthorized?.();
          return null;
        }
        const data = (await res.json()) as { tokens: Tokens };
        await this.store?.set(data.tokens);
        return data.tokens;
      } catch {
        return null;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async request<T>(
    path: string,
    init: RequestInit & { query?: Query; auth?: boolean } = {},
  ): Promise<T> {
    const { query, auth = true, ...rest } = init;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(rest.body && !(rest.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...((rest.headers as Record<string, string>) ?? {}),
    };
    if (auth) Object.assign(headers, await this.authHeader());

    const res = await this.doFetch(`${this.baseUrl}${path}${this.qs(query)}`, { ...rest, headers });

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
      const err = (data ?? {}) as { message?: string; error?: string; details?: unknown };
      if (res.status === 401) this.onUnauthorized?.();
      throw new ApiError(
        err.message ?? `Request failed (${res.status})`,
        res.status,
        err.error ?? 'REQUEST_FAILED',
        err.details,
      );
    }
    return data as T;
  }

  private get<T>(path: string, query?: Query, auth = true) {
    return this.request<T>(path, { method: 'GET', query, auth });
  }
  private post<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      query,
    });
  }
  private patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
  }
  private del<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }

  /* ---------------- auth ---------------- */
  auth = {
    register: (body: unknown) =>
      this.post<{ user: SessionUser; tokens: Tokens }>('/v1/auth/register', body),
    login: (body: unknown) => this.post<{ user: SessionUser; tokens: Tokens }>('/v1/auth/login', body),
    logout: () => this.post<void>('/v1/auth/logout'),
    me: () => this.get<{ user: SessionUser }>('/v1/auth/me'),
    updateProfile: (body: unknown) => this.patch<{ user: SessionUser }>('/v1/auth/me', body),
  };

  /* ---------------- marketplace ---------------- */
  categories = {
    tree: () => this.get<{ categories: Category[] }>('/v1/categories', undefined, false),
  };

  listings = {
    search: (query: Query) => this.get<Paginated<ListingSummary>>('/v1/listings', query, true),
    get: (idOrSlug: string) => this.get<{ listing: ListingDetail }>(`/v1/listings/${idOrSlug}`),
    bids: (id: string) => this.get<{ bids: BidSummary[] }>(`/v1/listings/${id}/bids`),
    create: (body: unknown) => this.post<{ listing: ListingDetail }>('/v1/listings', body),
    update: (id: string, body: unknown) =>
      this.patch<{ listing: ListingDetail }>(`/v1/listings/${id}`, body),
    publish: (id: string) => this.post<{ listing: ListingDetail }>(`/v1/listings/${id}/publish`),
    cancel: (id: string) => this.post<{ listing: ListingDetail }>(`/v1/listings/${id}/cancel`),
    mine: (query?: Query) => this.get<Paginated<ListingSummary>>('/v1/me/listings', query),
    watch: (id: string) => this.post<{ watching: boolean; watchCount: number }>(`/v1/listings/${id}/watch`),
    unwatch: (id: string) =>
      this.del<{ watching: boolean; watchCount: number }>(`/v1/listings/${id}/watch`),
    watchlist: (query?: Query) => this.get<Paginated<ListingSummary>>('/v1/me/watchlist', query),
    similar: (id: string) => this.get<{ items: ListingSummary[] }>(`/v1/listings/${id}/similar`),
  };

  bidding = {
    place: (listingId: string, body: { maxAmount: Money; expectedPrice?: Money; reference?: string }) =>
      this.post<{
        accepted: boolean;
        isLeading: boolean;
        currentPrice: Money;
        minimumBid: Money;
        endsAt: string;
        extended: boolean;
        reserveMet: boolean;
        pendingApproval?: boolean;
        approvalId?: string;
      }>(`/v1/listings/${listingId}/bids`, body),
    buyNow: (listingId: string, body?: { quantity?: number }) =>
      this.post<{ order: Order }>(`/v1/listings/${listingId}/buy-now`, body ?? {}),
    myBids: (query?: Query) =>
      this.get<Paginated<BidSummary & { listing: ListingSummary }>>('/v1/me/bids', query),
  };

  orders = {
    list: (query?: Query) => this.get<Paginated<Order>>('/v1/orders', query),
    get: (id: string) => this.get<{ order: Order }>(`/v1/orders/${id}`),
    checkout: (id: string, body: unknown) => this.post<{ order: Order }>(`/v1/orders/${id}/pay`, body),
    ship: (id: string, body: unknown) => this.post<{ order: Order }>(`/v1/orders/${id}/ship`, body),
    confirmDelivery: (id: string) => this.post<{ order: Order }>(`/v1/orders/${id}/confirm`),
    review: (id: string, body: unknown) => this.post<void>(`/v1/orders/${id}/review`, body),
    openDispute: (id: string, body: unknown) => this.post<void>(`/v1/orders/${id}/dispute`, body),
  };

  notifications = {
    list: (query?: Query) => this.get<Paginated<NotificationItem>>('/v1/notifications', query),
    markRead: (id: string) => this.post<void>(`/v1/notifications/${id}/read`),
    markAllRead: () => this.post<void>('/v1/notifications/read-all'),
  };

  users = {
    profile: (handle: string) =>
      this.get<{ user: PublicUser; listings: ListingSummary[] }>(`/v1/users/${handle}`, undefined, false),
  };

  /* ---------------- ads ---------------- */
  ads = {
    serve: (placement: string, query?: Query) =>
      this.get<{ ads: ServedAd[] }>('/v1/ads/serve', { placement, ...query }, true),
    click: (slotId: string) => this.post<{ redirectUrl: string }>('/v1/ads/click', { slotId }),
    impression: (slotIds: string[]) => this.post<void>('/v1/ads/impression', { slotIds }),
  };

  advertiser = {
    overview: () =>
      this.get<{ balance: Money; spendToday: Money; campaigns: number; impressions: number; clicks: number }>(
        '/v1/advertiser/overview',
      ),
    campaigns: (query?: Query) => this.get<Paginated<Campaign>>('/v1/advertiser/campaigns', query),
    campaign: (id: string) => this.get<{ campaign: Campaign }>(`/v1/advertiser/campaigns/${id}`),
    createCampaign: (body: unknown) => this.post<{ campaign: Campaign }>('/v1/advertiser/campaigns', body),
    updateCampaign: (id: string, body: unknown) =>
      this.patch<{ campaign: Campaign }>(`/v1/advertiser/campaigns/${id}`, body),
    setCampaignStatus: (id: string, status: 'ACTIVE' | 'PAUSED') =>
      this.post<{ campaign: Campaign }>(`/v1/advertiser/campaigns/${id}/status`, { status }),
    addCreative: (id: string, body: unknown) =>
      this.post<{ creative: Creative }>(`/v1/advertiser/campaigns/${id}/creatives`, body),
    report: (query?: Query) =>
      this.get<{
        rows: { date: string; impressions: number; clicks: number; spend: Money; ctr: number }[];
        totals: { impressions: number; clicks: number; spend: Money; ctr: number };
      }>('/v1/advertiser/report', query),
    topUp: (body: unknown) => this.post<{ balance: Money }>('/v1/advertiser/wallet/top-up', body),
  };

  /* ---------------- corporate ---------------- */
  corporate = {
    org: () => this.get<{ organization: Organization }>('/v1/corporate/organization'),
    create: (body: unknown) => this.post<{ organization: Organization }>('/v1/corporate/organization', body),
    updateBudget: (body: unknown) =>
      this.patch<{ organization: Organization }>('/v1/corporate/organization/budget', body),
    members: () => this.get<{ members: OrgMember[] }>('/v1/corporate/members'),
    invite: (body: unknown) => this.post<{ member: OrgMember }>('/v1/corporate/members', body),
    updateMember: (id: string, body: unknown) =>
      this.patch<{ member: OrgMember }>(`/v1/corporate/members/${id}`, body),
    removeMember: (id: string) => this.del<void>(`/v1/corporate/members/${id}`),
    approvals: (query?: Query) => this.get<Paginated<ApprovalRequest>>('/v1/corporate/approvals', query),
    decide: (id: string, body: unknown) =>
      this.post<{ approval: ApprovalRequest }>(`/v1/corporate/approvals/${id}/decide`, body),
    spend: (query?: Query) =>
      this.get<{
        rows: { member: PublicUser; bids: number; won: number; spend: Money }[];
        totals: { budget: Money; spent: Money; committed: Money; remaining: Money };
      }>('/v1/corporate/spend', query),
    orders: (query?: Query) => this.get<Paginated<Order>>('/v1/corporate/orders', query),
  };

  /* ---------------- admin ---------------- */
  admin = {
    metrics: () => this.get<AdminMetrics>('/v1/admin/metrics'),
    users: (query?: Query) => this.get<Paginated<SessionUser>>('/v1/admin/users', query),
    setRoles: (id: string, roles: string[]) => this.post<void>(`/v1/admin/users/${id}/roles`, { roles }),
    suspend: (id: string, body: unknown) => this.post<void>(`/v1/admin/users/${id}/suspend`, body),
    /** Credit limit and payment terms — the platform's exposure, not the customer's to set. */
    setOrgCredit: (id: string, body: unknown) =>
      this.patch<{ organization: Organization }>(`/v1/admin/organizations/${id}/credit`, body),
    listings: (query?: Query) => this.get<Paginated<ListingSummary>>('/v1/admin/listings', query),
    moderate: (id: string, body: unknown) => this.post<void>(`/v1/admin/listings/${id}/moderate`, body),
    campaigns: (query?: Query) => this.get<Paginated<Campaign>>('/v1/admin/campaigns', query),
    reviewCampaign: (id: string, body: unknown) => this.post<void>(`/v1/admin/campaigns/${id}/review`, body),
    orders: (query?: Query) => this.get<Paginated<Order>>('/v1/admin/orders', query),
    disputes: (query?: Query) => this.get<Paginated<Record<string, unknown>>>('/v1/admin/disputes', query),
    resolveDispute: (id: string, body: unknown) => this.post<void>(`/v1/admin/disputes/${id}/resolve`, body),
    kyc: (query?: Query) => this.get<Paginated<Record<string, unknown>>>('/v1/admin/kyc', query),
    decideKyc: (id: string, body: unknown) => this.post<void>(`/v1/admin/kyc/${id}/decide`, body),
    audit: (query?: Query) => this.get<Paginated<AuditEntry>>('/v1/admin/audit', query),
    settings: () => this.get<{ settings: Record<string, unknown> }>('/v1/admin/settings'),
    updateSettings: (body: unknown) => this.patch<{ settings: Record<string, unknown> }>('/v1/admin/settings', body),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/** In-memory token store — the default for server-side and test usage. */
export function memoryTokenStore(initial: Tokens | null = null): TokenStore {
  let value = initial;
  return {
    get: () => value,
    set: (t) => {
      value = t;
    },
  };
}

# API reference

Base URL `http://localhost:4000`. All responses are JSON. Money is always an
integer in minor units (sen) — `12345` is RM123.45.

Authenticate with `Authorization: Bearer <accessToken>`.

## Errors

```json
{ "statusCode": 400, "error": "BAD_REQUEST", "message": "Some fields need attention",
  "details": { "issues": [{ "path": ["startPrice"], "message": "Starting price must be above zero" }] } }
```

`details.issues` carries zod paths, which the clients map straight onto form
fields. Codes: `BAD_REQUEST` `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `CONFLICT`
`RATE_LIMITED` `INTERNAL`.

## Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/auth/register` | Returns `{ user, tokens }`. `requestRoles` may ask for `ADVERTISER`/`CORPORATE`; `ADMIN` is never self-granted |
| POST | `/v1/auth/login` | Same failure for unknown email and wrong password — no account enumeration |
| POST | `/v1/auth/refresh` | Rotates: the presented refresh token is revoked as the new pair is issued |
| POST | `/v1/auth/logout` | Revokes every live session for the user |
| GET | `/v1/auth/me` | Current session user, roles, org seat, unread count |
| PATCH | `/v1/auth/me` | Update profile |

## Marketplace

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/categories` | Category tree with live counts |
| GET | `/v1/listings` | Search. `q` `categorySlug` `kind` `condition` `minPrice` `maxPrice` `state` `status` `endingWithinHours` `sort` `page` `perPage` |
| GET | `/v1/listings/:idOrSlug` | Detail with recent bids and per-viewer state |
| GET | `/v1/listings/:id/bids` | Bid history, bidder handles masked |
| GET | `/v1/listings/:id/similar` | Same category, live |
| POST | `/v1/listings` | Create. Returns 201 |
| PATCH | `/v1/listings/:id` | Seller only; pricing is frozen once bidding starts |
| POST | `/v1/listings/:id/publish` | Draft → live or scheduled |
| POST | `/v1/listings/:id/cancel` | Seller only, and only with no bids |
| GET | `/v1/me/listings` | Your listings |
| GET | `/v1/users/:handle` | Public seller profile |
| GET | `/v1/stats` | Public counters for the home page |

`sort`: `ending_soon` (default, pure clock order) · `newest` · `price_asc` ·
`price_desc` · `most_bids` · `relevance` (featured first).

## Bidding

**`POST /v1/listings/:id/bids`**

```json
{ "maxAmount": 45000, "expectedPrice": 32000, "reference": "PO-2026-0417" }
```

`maxAmount` is the bidder's proxy maximum, not the price to bid at.
`expectedPrice` is optional and guards against the price moving while the form
was open.

Accepted:

```json
{ "accepted": true, "isLeading": true, "currentPrice": 33000, "minimumBid": 33500,
  "endsAt": "2026-09-08T12:00:00.000Z", "extended": false, "reserveMet": true, "bidId": "…" }
```

`isLeading: false` means the bid was valid but a standing proxy still beats it.

Held for corporate approval:

```json
{ "accepted": false, "pendingApproval": true, "approvalId": "…",
  "message": "Bids above RM10,000.00 need an approver…" }
```

Rejected — 400 with `details.reason` (`BELOW_MINIMUM_INCREMENT`,
`BELOW_START_PRICE`, `ALREADY_LEADING_LOWER`, `AUCTION_ENDED`, `SELF_BID`,
`NOT_AN_AUCTION`, `BID_TOO_LARGE`) and `details.minimumAcceptable`.

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/listings/:id/buy-now` | Creates an order, 201 |
| GET | `/v1/me/bids` | Your bids, one row per listing |
| POST/DELETE | `/v1/listings/:id/watch` | Watch / unwatch |
| GET | `/v1/me/watchlist` | Watched listings |

## Orders

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/orders` | `role=buying` (default) or `role=selling` |
| GET | `/v1/orders/:id` | Buyer, seller or admin only |
| POST | `/v1/orders/:id/pay` | Shipping address + method. `CORPORATE_INVOICE` checks the credit limit |
| POST | `/v1/orders/:id/ship` | Seller: courier + tracking |
| POST | `/v1/orders/:id/confirm` | Buyer: confirms delivery, **releases the seller payout** |
| POST | `/v1/orders/:id/review` | Once the order is complete |
| POST | `/v1/orders/:id/dispute` | Buyer only |

## Advertising

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/ads/serve` | `placement` (+ `categoryId`, `q`, `state`, `limit`). Impressions bill here |
| POST | `/v1/ads/click` | `{ slotId }` → `{ redirectUrl }`, bills the click |
| GET | `/v1/advertiser/overview` | Wallet, spend, delivery totals |
| GET/POST | `/v1/advertiser/campaigns` | List / create |
| GET/PATCH | `/v1/advertiser/campaigns/:id` | Detail / update |
| POST | `/v1/advertiser/campaigns/:id/status` | `ACTIVE` or `PAUSED`. Needs a creative and a funded wallet |
| POST | `/v1/advertiser/campaigns/:id/creatives` | Add a creative |
| GET | `/v1/advertiser/report` | Daily series, `days` and optional `campaignId` |
| GET | `/v1/advertiser/wallet` | Balance and transactions |
| POST | `/v1/advertiser/wallet/top-up` | Adds credit, reactivates budget-stopped campaigns |

Placements: `HOME_HERO` `HOME_FEED` `SEARCH_INLINE` `LISTING_SIDEBAR`
`CATEGORY_BANNER` `MOBILE_FEED`.

## Corporate

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/v1/corporate/organization` | Read / create (creator becomes owner) |
| PATCH | `/v1/corporate/organization/budget` | Budget, threshold, credit limit, terms. Owner/admin |
| GET/POST | `/v1/corporate/members` | List / invite. An unknown email gets a provisional account and a one-time password |
| PATCH/DELETE | `/v1/corporate/members/:id` | Seat, threshold, active. The owner seat cannot be removed |
| GET | `/v1/corporate/approvals` | Buyers see only their own requests |
| POST | `/v1/corporate/approvals/:id/decide` | `APPROVE` places the bid. You cannot approve your own request |
| GET | `/v1/corporate/spend` | Per-member spend, plus budget/committed/remaining |
| GET | `/v1/corporate/orders` | Organisation purchases |
| GET | `/v1/corporate/invoices` | Consolidated invoices |
| GET/POST | `/v1/corporate/rfqs` | Request for quote (reverse auction) |

## Admin

All require `ADMIN` or `SUPER_ADMIN`.

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/metrics` | GMV, revenue, listings, bids, orders, 14-day series |
| GET | `/v1/admin/users` | `q` `role` `suspended` |
| POST | `/v1/admin/users/:id/roles` | Only a super admin may grant admin |
| POST | `/v1/admin/users/:id/suspend` | Revokes live sessions. Super admins cannot be suspended |
| GET | `/v1/admin/listings` | Moderation queue |
| POST | `/v1/admin/listings/:id/moderate` | `APPROVE` `SUSPEND` `CANCEL` `FEATURE` `UNFEATURE` |
| POST | `/v1/admin/listings/:id/settle` | Close an auction out of band |
| GET | `/v1/admin/campaigns` · POST `…/:id/review` | Ad review |
| GET | `/v1/admin/orders` · `/v1/admin/disputes` · POST `…/:id/resolve` | Order and dispute handling |
| GET | `/v1/admin/kyc` · POST `…/:id/decide` | Identity verification |
| GET | `/v1/admin/audit` | Every privileged action, with actor and IP |
| GET/PATCH | `/v1/admin/settings` | Fees and auction defaults, live |

## Realtime

`GET /realtime` (WebSocket). Optional auth via `?token=<accessToken>` or the
`Authorization` header — anyone may watch a listing channel; `user:` channels
accept only their owner.

Client → server: `{ t: 'subscribe', channels }` · `{ t: 'unsubscribe', channels }`
· `{ t: 'auth', token }` · `{ t: 'ping' }`

Server → client:

| `t` | When |
|---|---|
| `ready` | On connect, with the resolved user id |
| `subscribed` | Channels actually joined |
| `bid` | Price, minimum, bid count, masked leader, reserve flag, close time |
| `extended` | Anti-snipe moved the close time |
| `closed` | Auction settled — `SOLD` or `UNSOLD`, final price, masked winner |
| `notification` | On the subscriber's own `user:` channel |
| `pong` / `error` | Heartbeat / protocol error |

Channels: `listing:<id>`, `user:<id>`, `org:<id>`. Server pings every 30s and
reaps sockets that stop answering; both clients reconnect with capped
exponential backoff and re-subscribe.

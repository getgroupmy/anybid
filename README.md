# AnyBid

A bidding-first marketplace for Malaysia — the Carousell/Mudah/Lelong/eBay shape,
but where **the auction is the default**, not an afterthought. One codebase, four
consoles, three client targets.

| Surface | Stack | Location |
|---|---|---|
| API + realtime | Fastify · Prisma · PostgreSQL · WebSocket | `apps/api` |
| Website | Next.js 15 (App Router) · Tailwind | `apps/web` |
| Mobile — iOS, Android, **Huawei** | Expo SDK 54 · Expo Router | `apps/mobile` |
| Domain engine | Pure TypeScript · Zod | `packages/shared` |

## The four consoles

| Console | Who | What it does |
|---|---|---|
| **User** (`/account`) | Buyers and sellers | Bids in play, watchlist, purchases, sales with payout, listings, notifications, profile |
| **Admin** (`/admin`) | Platform operations | GMV/bid/user metrics, listing moderation, user roles and suspension, orders, ad-campaign review, disputes, KYC, audit log, fee and auction settings |
| **Advertiser** (`/advertiser`) | Brands | Campaigns (CPC/CPM), creatives, placement and keyword targeting, delivery reporting, prepaid wallet |
| **Corporate** (`/corporate`) | Companies | Organisation, team seats, per-seat spend thresholds that hold a bid for approval, budget and credit limit, consolidated purchases, invoices |

A single account can hold several roles at once — a corporate buyer who also
advertises is one login and three consoles.

## Quick start

```bash
npm install
cp .env.example apps/api/.env          # defaults work with the compose file
npm run db:up                          # postgres + redis via docker compose
npm run db:push
npm run db:seed
npm run dev                            # api on :4000, web on :3000
npm run dev:mobile                     # expo dev server
```

Then open <http://localhost:3000> and sign in with any seeded account —
password `Password123`:

| Email | Console |
|---|---|
| `aisha@example.com` | User (buyer and seller) |
| `admin@anybid.my` | Admin (super admin) |
| `advertiser@brandco.my` | Advertiser |
| `procurement@megacorp.my` | Corporate (organisation owner) |
| `buyer2@megacorp.my` | Corporate buyer — bids over RM10,000 need approval |

No Docker? Any PostgreSQL 14+ works; point `DATABASE_URL` at it and skip
`db:up`.

## Verifying it works

```bash
npm test                # 29 engine unit tests
npm run smoke           # reseeds, then runs 53 end-to-end assertions (API must be running)
npm run typecheck       # all four packages
```

`npm run smoke` reseeds first on purpose: it places real bids, buys the
fixed-price listing and spends approval requests, so it needs a clean database.
Running the script directly twice over without reseeding will fail on the state
the first run left behind.

The smoke test exercises the real paths against a running API: proxy bidding
and outbidding, anti-snipe extension, reserve behaviour, buy-now through to
delivery confirmation, the corporate approval hold-and-release, the ad auction
with click billing, and admin metrics with role gating.

## How the bidding actually works

The auction rules live in `packages/shared/src/auction.ts` as pure functions, so
they are testable without a database and identical on every client.

- **Proxy bidding.** A bidder submits the maximum they will pay. The engine
  raises the visible price only far enough to beat the runner-up by one
  increment, capped at that maximum. You never pay your maximum unless someone
  pushed you there. Ties go to the earlier bid.
- **Tiered increments.** The minimum step scales with price (RM5 under RM500,
  up to RM1,000 above RM250,000). A seller may set a larger increment but never
  one below the tier floor, so nobody can enable one-sen bid wars.
- **Hidden reserves.** Bidders see only whether the reserve is met. Once a bid
  clears it, the visible price jumps to the reserve. Below it, nothing sells.
- **Anti-sniping.** A bid inside the closing window pushes the close out, so a
  last-second bid can always be answered — bounded by a total-extension ceiling
  so an auction cannot be held open forever.

Correctness under concurrency rests on one thing: the bid transaction takes a
`SELECT ... FOR UPDATE` row lock on the listing, so simultaneous bids are
serialised by PostgreSQL rather than racing in application memory. Settlement
claims each closing auction with a conditional update, so two workers can never
both create an order for the same listing.

See [docs/BIDDING.md](docs/BIDDING.md) for the walkthrough.

## Deploying

The website deploys to **Vercel**. Set the project's **Root Directory** to
`apps/web` and Next.js is detected automatically; the root `vercel.json` is a
fallback that makes a root-level deploy work too. Set `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_WS_URL` in the project or the deployed site will point at
`localhost`.

A push to `main` deploys to production; pull requests get previews. Both come
from Vercel's git integration and need no secrets.
`.github/workflows/deploy.yml` is a manual alternative for shipping a specific
commit through the Vercel CLI, and needs `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID` as repository secrets.

The API is **not** a Vercel workload: it holds WebSocket connections open for
live bidding and runs a settlement loop on an interval, so it needs a host that
runs a persistent process. `apps/api/Dockerfile` builds it and `fly.toml` is a
worked Fly.io example — one `app` process serving HTTP and the socket, one
`worker` process settling auctions, and `prisma migrate deploy` on release:

```bash
fly launch --no-deploy --copy-config
fly postgres create --name anybid-db && fly postgres attach anybid-db
fly secrets set JWT_SECRET="$(openssl rand -base64 48)" CORS_ORIGINS="https://anybid.my"
fly deploy
```

Then set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` in Vercel to point at
it. Full details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#deployment).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layout, data model, request path, deployment
- [docs/BIDDING.md](docs/BIDDING.md) — the auction engine in detail
- [docs/API.md](docs/API.md) — endpoint reference and the realtime protocol
- [docs/CONSOLES.md](docs/CONSOLES.md) — what each console does and who can reach it
- [docs/HUAWEI.md](docs/HUAWEI.md) — building for AppGallery without Google Mobile Services

## Repository layout

```
anybid/
├── apps/
│   ├── api/          Fastify API, Prisma schema, seed, settlement worker
│   ├── web/          Next.js marketplace + all four consoles
│   └── mobile/       Expo app (iOS · Android · Huawei)
├── packages/
│   └── shared/       Auction engine, money, roles, schemas, typed API client
└── docs/
```

## Status

Working end to end: auth, browse and search, proxy bidding over WebSocket,
buy-now, orders through payment/shipping/delivery, reviews, disputes, ads with
billing, corporate approvals, and admin moderation.

Deliberately stubbed behind one interface each, ready for a real provider:

- **Payments** — `apps/api/src/routes/orders.ts` records a `Payment` row and
  marks the order paid. Swapping in FPX/Stripe means implementing capture in
  that one handler.
- **Image uploads** — listings take image URLs. The mobile picker selects local
  files and substitutes placeholders; wire object storage and the flow is
  unchanged above it.
- **Push** — `apps/mobile/src/lib/push.ts` abstracts Expo push and Huawei Push
  Kit behind one call. Device-token registration needs an API endpoint.
- **Invoicing** — the corporate `Invoice`/`InvoiceLine` model and read paths
  exist; the monthly roll-up job does not.

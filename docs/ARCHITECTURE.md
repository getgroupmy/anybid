# Architecture

## Shape

```
                    packages/shared
        auction engine · money · roles · zod schemas · typed client
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   apps/web            apps/mobile          apps/api
   Next.js 15          Expo SDK 54          Fastify 5
   SSR + RSC           iOS/Android/Huawei   Prisma + PostgreSQL
        │                   │                   │
        └───── HTTPS ───────┴──── WebSocket ────┘
```

`packages/shared` is the reason the three clients agree. The auction rules, the
money type, the permission matrix, the request/response types and the API client
are written once. A bid rejected by the mobile app for being under the minimum
is rejected for exactly the same reason by the server, because it is the same
function.

## Why a shared engine, not just a shared type file

The auction rules are the product. Putting them in pure functions means:

- they are tested without a database (29 cases run in 240ms),
- the client can compute the minimum bid and quick-bid buttons without a round
  trip, and get the same answer the server will,
- the server holds the row lock for the shortest possible time — it locks, calls
  a pure function, writes, commits.

## Data model

28 Prisma models. The ones that matter:

- **Identity** — `User` (roles array, so one login carries several consoles),
  `Session` (hashed refresh tokens), `KycSubmission`.
- **Catalogue** — `Category` (self-referencing tree), `Listing`, `Bid`,
  `Watchlist`.
- **Commerce** — `Order`, `Payment`, `Review`, `Dispute`.
- **Advertising** — `Advertiser` (prepaid wallet), `AdCampaign`, `AdCreative`,
  `AdEvent`, `AdDailyStat`, `AdWalletTx`.
- **Corporate** — `Organization`, `OrgMember` (seat + spend threshold),
  `ApprovalRequest`, `Invoice`, `InvoiceLine`, `Rfq`, `RfqQuote`.
- **Platform** — `Notification`, `AuditLog`, `PlatformSetting`.

Two deliberate choices:

**Money is `Int` in minor units (sen), never `Float`.** `packages/shared/money.ts`
is the only place that converts. Basis points handle percentages so a 6%
commission on RM333.33 is one deterministic integer, not a float that drifts.

**The listing row carries denormalised leader state** — `currentPrice`,
`leaderId`, `leaderMax`, `bidCount`, `reserveMet`. This is what makes the bid
path a single-row lock instead of an aggregate over the bid table, and it is why
a listing page renders without touching `Bid` at all.

## Request path

**A bid.** Client → `POST /v1/listings/:id/bids` → corporate threshold gate →
transaction: `SELECT … FOR UPDATE`, load listing, run `placeBid`, write listing
+ bid + outbid markers, commit → publish `bid` (and `extended`) on the listing
channel → notify the displaced leader → respond.

**A page.** The web app renders on the server. Server components call the API
through a client bound to the session cookie; browser components call
`/api/proxy/*`, a route handler that attaches the access token server-side and
refreshes it transparently. The access token is httpOnly — browser JavaScript
never holds it.

**The mobile app** talks to the API directly with a bearer token in the device
keychain (`expo-secure-store`), refreshed by the shared client.

## Auth

- Passwords: scrypt via `node:crypto` — no native build step, no third-party
  dependency, no install-time compilation.
- Access tokens: HS256 JWT, 15 minutes, signed with `node:crypto` HMAC.
- Refresh tokens: opaque random, stored **hashed**, rotated on every use — a
  database leak cannot mint sessions, and a stolen refresh token is single-use.
- Suspension revokes every live session immediately.

Permissions come from `packages/shared/roles.ts`: a role→permission matrix
unioned with the organisation seat's permissions. `can(principal, permission)`
is the single check, used identically by the API guards and the console
navigation.

## Realtime

A `ws` hub keyed by channel (`listing:<id>`, `user:<id>`, `org:<id>`). Private
channels are enforced at subscribe time — a client can only join its own
`user:` channel. Auction pages subscribe to the listing channel and receive
`bid`, `extended` and `closed` events; authenticated sockets are auto-joined to
their notification channel.

The hub is deliberately single-node and in-process. `publish` is the only write
path, so putting Redis behind it later changes exactly one class.

## Ad serving

`serveAds` runs an auction of its own. Eligible campaigns (active, in budget, in
placement, matching targeting) are scored on effective CPM so CPC and CPM
campaigns compete on one scale, multiplied by a relevance factor for category
and keyword matches. The winner's impression is billed at serve time and written
to `AdEvent`, `AdDailyStat` and the advertiser's wallet in one transaction. A
campaign that exhausts its budget is flipped to `OUT_OF_BUDGET` and its owner is
notified. Clicks are billed through `/v1/ads/click`, which also resolves the
destination — the client is never trusted to create billing events.

## Deployment

### Website → Vercel

**Set the project's Root Directory to `apps/web`.** That is the supported
configuration: Vercel then detects Next.js on its own, installs from the
repository root because npm workspaces are declared there, and resolves
`@anybid/shared` through the workspace symlink. Keep "Include source files
outside of the Root Directory" enabled — the site imports `packages/shared`.

The root `vercel.json` is a fallback for when Root Directory is *not* set: it
builds only `@anybid/web` and serves `apps/web/.next`, so a root-level deploy
still produces the site. Vercel reads `vercel.json` from the Root Directory, so
once that is `apps/web` the root file is simply not read and can be deleted.

`.vercelignore` keeps `apps/api` and `apps/mobile` out of the upload. Excluding
those workspace directories is safe — npm tolerates a declared workspace whose
directory is absent.

Two environment variables must be set in the Vercel project, or the deployed
site will point at `localhost` and fail to load anything:

| Variable | Example |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.anybid.my` |
| `NEXT_PUBLIC_WS_URL` | `wss://api.anybid.my/realtime` |

Vercel Analytics is already mounted in the root layout and needs no
configuration — enable Analytics on the project and it starts collecting.

#### Deploying from CI rather than from Vercel's git trigger

`.github/workflows/deploy.yml` deploys production. It waits on the CI workflow
and runs only for a **successful** run on `main`, checking out the exact commit
CI verified rather than whatever `main` points at by then. It uses the Vercel
CLI — `vercel pull` to fetch the project's settings and environment variables,
`vercel build --prod`, then `vercel deploy --prebuilt --prod` — so the build
that ships is the one CI validated.

`vercel.json` sets `git.deploymentEnabled.main = false`, so Vercel does not
also deploy `main` itself. Pull-request previews still come from Vercel's git
integration; only production moved to CI. Without that flag you would get two
production deploys per push.

Three repository secrets are required (Settings → Secrets and variables →
Actions):

| Secret | Where to find it |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel project → Settings → General |
| `VERCEL_PROJECT_ID` | Vercel project → Settings → General |

Until they exist the job fails at `vercel pull`. `workflow_dispatch` is enabled
so a deploy can be triggered by hand.

### The API does not belong on Vercel

It is a long-lived Fastify process: a WebSocket hub holding open connections
for live bidding, and a settlement loop on an interval. Serverless functions
have neither. Deploy it to a host that runs a persistent process — Railway,
Fly.io, Render, or a container anywhere — and point `NEXT_PUBLIC_API_URL` at
it.

### Everything else

- **API** — any Node 20+ host. Run migrations with `npm run db:deploy -w
  @anybid/api`. Run exactly one settlement worker (`npm run worker -w
  @anybid/api`) and set `SETTLEMENT_TICK_MS=0` on the web-facing instances if
  you scale them out.
- **Web** — `npm run build -w @anybid/web`, then `next start` or any Node host.
  Needs `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL`.
- **Mobile** — EAS profiles in `apps/mobile/eas.json`: `production` (Play/App
  Store) and `huawei` (AppGallery). See [HUAWEI.md](HUAWEI.md).
- **Database** — PostgreSQL 14+. The compose file pins 16.

## What is stubbed

Each of these sits behind exactly one seam, named so it is obvious where a real
provider goes:

| Stub | Where | To make real |
|---|---|---|
| Payment capture | `routes/orders.ts` `/pay` | Call the gateway, keep the `Payment` row |
| Image upload | listings take URLs | Add an upload endpoint + object storage |
| Push delivery | `mobile/src/lib/push.ts` | Add a device-token endpoint and a sender |
| Invoice roll-up | `Invoice` model exists | A monthly job over corporate orders |
| Email | `services/notifications.ts` | Add a transport beside the in-app write |

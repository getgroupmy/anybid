# The four consoles

One account, several roles. `consolesFor(principal)` in
`packages/shared/roles.ts` decides which consoles appear in the navigation, and
the same permission matrix guards the API — the menu and the server never
disagree.

## User console — `/account`

Everyone gets this one. Mobile: the Account tab.

| Page | What it shows |
|---|---|
| Overview | Auctions you are winning, watch count, orders awaiting payment, store credit, recent activity |
| My bids | Every auction you have bid on, your hidden maximum, the current price, and whether you are winning or outbid |
| Watchlist | Watched auctions — you are alerted an hour before each closes |
| Purchases | Orders through payment, shipping and delivery confirmation |
| My listings | What you are selling, with bid and watch counts |
| Sales | Sold items with the payout after fees, and shipping entry |
| Notifications | Outbid alerts, wins, sales, approvals |
| Profile | Name, contact, location; roles and verification status |

## Admin console — `/admin`

`ADMIN` or `SUPER_ADMIN`. Mobile: a read-only metrics view.

| Page | What it does |
|---|---|
| Dashboard | GMV, commission and ad revenue, live auctions, bid volume, a 14-day activity chart, the order pipeline, recent admin actions |
| Listings | Moderation queue — approve, suspend, cancel, feature |
| Users | Search, edit roles, suspend and reinstate. Only a super admin can grant admin; super admins cannot be suspended |
| Orders | Every order with the platform fee |
| Ad campaigns | Review queue for campaigns awaiting approval, with delivery figures |
| Disputes | Buyer disputes — refund the buyer, release to the seller, or reject |
| Verification | KYC submissions; document numbers are masked in the list |
| Audit log | Every privileged action with actor, target, metadata and IP |
| Settings | Commission, buyer premium, processing fees, floors and caps, anti-snipe defaults, listing review and maintenance mode — with a live preview of the effect on a RM1,000 sale |

## Advertiser console — `/advertiser`

`ADVERTISER` (or an admin). Mobile: overview with pause/resume and top-up.

| Page | What it does |
|---|---|
| Overview | Wallet balance, spend today, impressions, clicks, CTR, 14-day delivery chart |
| Campaigns | CPC or CPM bid, daily and total budget, placements, category and keyword targeting, with per-campaign pause/resume |
| Campaign detail | Budget pacing, 30-day delivery, targeting summary, creative gallery with per-creative figures |
| Reporting | Daily breakdown with effective CPC |
| Wallet | Prepaid balance, top-up, full transaction ledger |

A campaign cannot go live without a creative and a funded wallet. Spending the
total budget flips it to `OUT_OF_BUDGET` and notifies the advertiser; a top-up
returns it to `PAUSED` so it does not silently resume.

## Corporate console — `/corporate`

Anyone with an organisation seat. Someone without one is offered the setup form.
Mobile: budget, approvals (approve/decline in place), and the team roster.

| Page | What it does |
|---|---|
| Overview | Spend against the monthly budget, money committed in live bids the team is leading, pending approvals, outstanding invoices, per-member spend |
| Approvals | Held bids with the requested maximum, the current price and a live countdown on the auction — approve and the bid is placed immediately |
| Team | Seats (`OWNER` `ADMIN` `APPROVER` `BUYER` `VIEWER`), per-member spend thresholds, activate/deactivate, invite by email |
| Purchases | Organisation orders, including those billed to invoice |
| Budget & billing | Monthly budget, default approval threshold, credit limit, payment terms, invoice history |

### How the approval hold works

1. A buyer bids above their threshold (their own, or the organisation default).
2. The bid **does not reach the auction**. It becomes an `ApprovalRequest` and
   every approver is notified.
3. An approver approves — the bid is placed at the requested maximum, right
   then, through the same engine.
4. Rejected or expired requests never touch the auction. A closing auction
   expires any request still pending against it.

A requester can never approve their own request. Owners, admins and approvers
are not gated on their own spend.

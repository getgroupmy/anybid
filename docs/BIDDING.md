# The bidding engine

Everything below lives in `packages/shared/src/auction.ts` and
`packages/shared/src/increments.ts` as pure functions — no clock, no database,
no I/O. The caller supplies the time, which makes the rules deterministic and
directly testable (`packages/shared/src/auction.test.ts`, 29 cases).

## Proxy bidding

A bidder submits the **maximum** they are willing to pay, not the price they
want to bid at. The engine keeps that maximum hidden and raises the visible
price only as far as it needs to.

Given a leader with maximum `L` and a challenger with maximum `M`:

| Case | Outcome | New visible price |
|---|---|---|
| No bids yet | Challenger leads | the start price (not `M`) |
| `M > L` | Challenger takes the lead | `min(M, L + increment(L))` |
| `M ≤ L` | Leader holds, challenger is immediately outbid | `min(L, M + increment(M))` |
| `M = L` | Earlier bid wins | `L` |

Worked example on an auction opening at RM100:

1. Aisha bids a maximum of RM500. The price shows **RM100** — her maximum is
   never revealed.
2. Daniel bids RM200. Aisha's proxy answers automatically: the price becomes
   **RM205** and Aisha still leads. Daniel is outbid the instant he bids.
3. Daniel bids RM900. That beats Aisha's hidden maximum, so the price becomes
   **RM510** — one RM10-tier increment above her RM500 — and Daniel leads.

Daniel pays RM510, not his RM900 maximum.

A leader may raise their own maximum. That does **not** move the visible price
(there is nobody new to beat), but it can clear a reserve, which does.

## Increments

`DEFAULT_INCREMENT_TIERS` scales the minimum step with the price:

| Current price | Increment |
|---|---|
| under RM500 | RM5 |
| RM500 – RM1,000 | RM10 |
| RM1,000 – RM5,000 | RM25 |
| RM5,000 – RM10,000 | RM50 |
| RM10,000 – RM50,000 | RM100 |
| RM50,000 – RM250,000 | RM500 |
| above RM250,000 | RM1,000 |

A seller may set a **larger** listing increment. A smaller one is ignored — the
tier is a floor, so no one can turn a listing into a one-sen bid war.

The first bid may equal the start price; every later bid must clear
`currentPrice + increment`.

## Reserve prices

A reserve is a hidden floor. While the highest maximum is below it, the price
climbs normally and the listing shows "reserve not met". The moment a maximum
clears the reserve, the visible price jumps to `min(reserve, leaderMax)`.

At close, an auction whose reserve was never met settles as `RESERVE_NOT_MET`:
no order is created, the highest bidder is told, and the seller can relist.

## Anti-sniping

A bid landing within `antiSnipeWindowMs` of the close pushes the end time out to
`now + antiSnipeExtensionMs`. A last-second bid can therefore always be
answered, so the winner is whoever wanted the item most rather than whoever had
the fastest connection.

`maxExtensionMs` caps total extension relative to the *original* close time, so
a determined pair of bidders cannot hold an auction open indefinitely. Sellers
choose the window per listing (off, 1, 2 or 5 minutes); admins set the default.

## Concurrency

Two people bidding in the same millisecond is the case that has to be right.

**Placing a bid** (`apps/api/src/services/bidding.ts`) runs inside one
transaction that opens with:

```sql
SELECT id FROM "Listing" WHERE id = $1 FOR UPDATE
```

The row lock means the second bidder waits for the first to commit and then
reads the price the first bid produced. Every value the engine decides —
current price, leader, leader maximum, bid count, reserve flag, extended close
time — is written back inside that same transaction, together with the new `Bid`
row and the `OUTBID` marker on the displaced leader. Nothing is computed from a
value read outside the lock.

**Closing an auction** (`apps/api/src/services/settlement.ts`) claims the
listing with a conditional update:

```ts
await prisma.listing.updateMany({
  where: { id, status: 'LIVE' },   // only the worker that flips LIVE proceeds
  data: { status: nextStatus, closedAt: new Date() },
});
```

If two workers race, exactly one gets `count === 1` and creates the order; the
other returns without doing anything. The settlement loop runs in-process for
single-node development and as a standalone worker (`npm run worker -w
@anybid/api`) in production, where you run exactly one.

## Fees

`computeFees` splits a sale: seller commission in basis points with a floor and
a cap, optional buyer premium, and payment processing. Defaults are 6% seller
commission (min RM1, max RM500) and 2.2% + RM1 processing. Admins change these
live in the Admin console, and the seller sees their net payout before they
publish.

## Corporate approvals

A corporate seat can carry a spend threshold. A bid above it never reaches the
auction: `checkCorporateApproval` intercepts it, stores an `ApprovalRequest`,
and notifies the organisation's approvers. When an approver releases it, the
same engine places the bid at the requested maximum with the gate skipped —
the approval *is* the authorisation. Owners, admins and approvers sign off
their own spend; a requester can never approve their own request.

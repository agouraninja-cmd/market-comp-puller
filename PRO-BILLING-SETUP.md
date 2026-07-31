# Pro Billing — Setup State & Resume Point

Written 2026-07-31. Read this first when picking the Pro tier back up.

**Everything below is TEST MODE.** Nothing here touches real money.

---

## Where things stand

| Step | Status |
|------|--------|
| 1–2. Stripe products + prices created | ✅ Done |
| 3. Customer portal configured | ✅ Done |
| 4. Webhook destination + 6 events | ✅ Done |
| 5. Supabase billing schema | ✅ Done, verified |
| 6. Render env vars | ✅ Done (saved, **not yet deployed** — see below) |
| **7. Front-end billing UI** | ❌ **NOT started — this is the next step** |
| 8. End-to-end test with a test card | ❌ Not started |
| 9. Flip `PRO_ENABLED=on` | ❌ Not until 7 and 8 pass |

---

## The price IDs (test mode)

Not secret — a price ID identifies a product, it does not authorize anything.

```
STRIPE_PRICE_PRO_MONTHLY          = price_1TzLBs2OE1gVYmmxOZGnk6zu   # $49/mo
STRIPE_PRICE_PRO_ANNUAL_FOUNDING  = price_1TzLCh2OE1gVYmmxbAwlCcSq   # $990/yr founding
STRIPE_PRICE_SINGLE_REPORT        = price_1TzLDE2OE1gVYmmxgtKfNgQG   # single report
```

The `sk_test_...` secret key and `whsec_...` webhook secret live **only in Render**.
They are not in this repo, not in `.env`, and were never pasted into a chat.
(The original secret key was exposed in a screenshot and has been **rotated** —
the old one is dead.)

---

## What was configured where

### Stripe — Customer portal
- Cancel subscriptions: **ON**, mode = *at end of billing period*
  (feeds `cancel_at_period_end` → the `cancelling` state in `entitlements.js`)
- Update payment method: **ON** (the rescue path during the 7-day grace window)
- Invoice history: **ON**
- **Plan switching: OFF** — deliberate. `foundingSlotsLeft()` only enforces the
  50-seat cap at *checkout*. A portal plan switch fires
  `customer.subscription.updated`, which upserts the new plan with **no cap
  check**, so someone on $49/mo could move themselves onto the $990 founding
  price and become founder #51. Keep it off until the offer closes.

### Stripe — Webhook destination
URL: `https://market-comp-puller.onrender.com/api/stripe/webhook`

Six events, matching the switch in `handleStripeEvent()`:
```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.payment_failed
```

Note: Render free tier sleeps, so the first webhook after idle can exceed
Stripe's 20s timeout and show as failed, then succeed on retry. That's expected
and safe — `claimStripeEvent()` makes duplicate deliveries a no-op via the
`stripe_events` primary key.

### Supabase — schema
Ran the DDL from the comment block above `findSubscription` (`server.js:762`).
Created: `subscriptions`, `branding_profiles`, `report_purchases`,
`export_usage`, `stripe_events`, plus `users.stripe_customer_id` and its
partial unique index.

Verification query returned zero rows = complete.

RLS was **not** enabled on the new tables. Not an exposure — `sbRequest()`
(`server.js:418`) only ever uses the `service_role` key from the server, and no
Supabase key reaches the browser. Optional cleanup to silence Supabase's
Security Advisor:
```sql
alter table subscriptions enable row level security;
alter table branding_profiles enable row level security;
alter table report_purchases enable row level security;
alter table export_usage enable row level security;
alter table stripe_events enable row level security;
```
`service_role` bypasses RLS, so no policies are needed.

### Render — environment
Five vars added, all with **"Save only"** — meaning they are stored but the
running instance does **not** have them yet. The next deploy picks them up.

```
STRIPE_SECRET_KEY                 (sk_test_...)
STRIPE_WEBHOOK_SECRET             (whsec_...)
STRIPE_PRICE_PRO_MONTHLY
STRIPE_PRICE_PRO_ANNUAL_FOUNDING
STRIPE_PRICE_SINGLE_REPORT
```

**`PRO_ENABLED` is deliberately unset.** Not `off`, not `false` — absent. While
unset, the app behaves exactly as it did before the tier existed: no comp
gating, no export cap, no lookback limit (`server.js:63`). All the billing
plumbing sits there dark.

---

## What already exists in code (don't rebuild it)

The **entire server side is done and committed**:

| Piece | Location |
|---|---|
| `POST /api/checkout` (+ founding seat check) | `server.js:6120` |
| `POST /api/billing-portal` | `server.js:6181` |
| `POST /api/stripe/webhook` (raw body, signature verify, ack-first) | `server.js:6210` |
| `handleStripeEvent()` — all six events, idempotent upserts | `server.js:1009` |
| `foundingSlotsLeft()` | `server.js:964` |
| `claimStripeEvent()` — replay protection | `server.js:979` |
| Entitlement rules (pure, unit-tested) | `entitlements.js` |
| Stripe HTTP + signature helpers | `stripe.js` |

Every one of those routes returns 503 while `PRO_ENABLED` is unset. That is not
a bug — it is the master switch working.

---

## Next step: the front-end (phase 7)

`index.html` has **no billing UI at all** — grep for `api/checkout` returns
nothing. What's needed:

1. A pricing surface — Pro monthly vs founding annual vs single report
2. An upgrade button that `POST`s to `/api/checkout` with
   `{ plan: "pro_monthly" | "pro_annual_founding" }` and redirects to
   `session.url`
3. A "Manage billing" link that `POST`s to `/api/billing-portal` and redirects
4. A founding-member counter ("N of 50 left") — needs a small read endpoint,
   `foundingSlotsLeft()` is not currently exposed to the client
5. Handling for the `?checkout=success` / `?checkout=cancelled` returns on
   `/desk` (the URLs `server.js:6155` already sends people back to)
6. The `founding_closed` 409 case — checkout returns
   `{ code: "founding_closed", fallbackPlan: "pro_monthly" }` and the UI should
   offer monthly rather than dead-ending

Locked/limited states can read from `/api/config`, which already ships
entitlements so the UI doesn't need a second round trip.

---

## Then: testing (phase 8)

1. Deploy (any deploy — the env vars go live with it)
2. Temporarily set `PRO_ENABLED=on` **in test mode only**
3. Sign up / sign in on the live site
4. Buy Pro monthly with Stripe test card `4242 4242 4242 4242`, any future
   expiry, any CVC
5. Confirm a row lands in Supabase `subscriptions` with `status = active`
6. Check the Stripe webhook log — deliveries should be 200 (a first failure
   then retry is normal on a cold instance)
7. Test the portal: cancel → confirm `cancel_at_period_end = true` and that
   access continues to period end
8. Test a failed payment with card `4000 0000 0000 0341` → confirm
   `status = grace` and `grace_until` ~7 days out
9. Buy the founding annual → confirm the counter decrements
10. Only after all of that: repeat the whole setup in **live mode** (new
    products, new prices, new webhook destination, new secrets) and flip
    `PRO_ENABLED=on` there

---

## Resume prompt

Paste this into a new chat:

> Picking up the Pro billing work on market-comp-puller. Read
> `PRO-BILLING-SETUP.md` in the project root. Stripe test mode, Supabase schema,
> and Render env vars are all done; the server side is already built. Next is
> phase 7 — the front-end billing UI. Don't flip `PRO_ENABLED` on.

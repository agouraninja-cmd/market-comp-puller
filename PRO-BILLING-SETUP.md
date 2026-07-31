# Pro Billing — Setup State & Resume Point

Written 2026-07-31, updated 2026-07-31 after phase 7. Read this first when
picking the Pro tier back up.

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
| 7. Front-end billing UI | ✅ Done, verified locally |
| **8. End-to-end test with a test card** | ❌ **NOT started — this is the next step** |
| 9. Flip `PRO_ENABLED=on` | ❌ Not until 8 passes |

---

## The price IDs (test mode)

Not secret — a price ID identifies a product, it does not authorize anything.

```
STRIPE_PRICE_PRO_MONTHLY          = price_1TzLBs2OE1gVYmmxOZGnk6zu   # $129/mo
STRIPE_PRICE_PRO_ANNUAL_FOUNDING  = price_1TzLCh2OE1gVYmmxbAwlCcSq   # $990/yr founding
STRIPE_PRICE_SINGLE_REPORT        = price_1TzLDE2OE1gVYmmxgtKfNgQG   # single report
```

⚠ **These amounts are comments, not truth. Stripe is the only source of
truth.** This block said `$49/mo` until 2026-07-31, when the owner pointed out
the catalog actually says **$129**. That wrong figure had already been copied
into the pricing modal. The tell was arithmetic: at $49/mo the $990 annual
would cost *more* than paying monthly.

Re-verification status against the dashboard, 2026-07-31:

| Price | Status |
|---|---|
| Monthly **$129** | ✅ confirmed by the owner (corrects the old `$49`) |
| Annual founding **$990** | ✅ confirmed by the owner |
| Single report **$39** | ✅ confirmed by the owner |

`$129` and `$990` are **hard-coded in the pricing modal in `index.html`**, along
with a derived "saves $558 a year" line. Nothing reconciles them against
Stripe, so changing a price in the dashboard silently makes the page lie.
Change both places, or serve the amounts from `/api/pricing` before live mode.

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
  check**, so someone on $129/mo could move themselves onto the $990 founding
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

`/api/checkout` and `/api/billing-portal` return 503 while `PRO_ENABLED` is
unset. That is not a bug — it is the master switch working.

**The webhook is the exception**, corrected 2026-07-31: `POST
/api/stripe/webhook` has **no** `PRO_ENABLED` check. Its gate is the Stripe
signature, and it records events whatever the flag says. That is deliberate and
load-bearing — it is what lets `PRO_AUDIENCE` scope a test to one account while
subscription rows still get written.

---

## Phase 7 — the front-end (DONE)

All six planned pieces shipped, plus two bugs the work uncovered.

| Piece | Where |
|---|---|
| Pricing modal (`#pricingModal`) — monthly + founding tiles | `index.html` |
| `startCheckout()` → `POST /api/checkout` → redirect | `index.html` |
| `openBillingPortal()` → `POST /api/billing-portal` → redirect | `index.html` |
| `GET /api/pricing` — founding counter, 60s memo | `server.js` |
| `handleCheckoutReturn()` — the `?checkout=` returns | `index.html` |
| `founding_closed` 409 → withdraw the tile, offer monthly | `index.html` |
| `refreshBillingUI()` — the single owner of every control's visibility | `index.html` |
| Plan card on My Desk + account-menu entries | `index.html` |

**Entry points.** Every locked surface (`.unlock-comps-btn` — the comp table's
locked notice and the corpus offer) routes through `openUpgradePrompt()`, which
opens the one pricing modal. There is deliberately no second upgrade prompt
anywhere; add new locked surfaces by giving them that class, not by writing
their own CTA.

**The sign-out rule.** Entitlements are per-user, so signing in, signing out,
deleting an account, and returning from checkout all call `refreshProConfig()`
to re-read `/api/config`. Without it a signed-out browser keeps rendering the
previous user's plan.

### Two things deliberately NOT built

1. **The single-report unlock has no button.** `/api/checkout` only maps
   `pro_annual_founding` → the founding price and *everything else* → monthly,
   so a `plan: "single_report"` request would silently sell a $129/mo
   subscription. The price ID exists but nothing reads it. The modal advertises
   the $39 unlock as coming (amount confirmed by the owner 2026-07-31);
   **wire the server before adding a button.**
2. **Export counting.** `exportsRemaining` rides on `/api/config` but nothing
   server-side tallies exports yet — `getExportUsage()` reads `export_usage` and
   no code ever writes a row — so free users are uncapped too and the UI shows
   no count it can't trust.

### The two Pro bullets to restore (owner's instruction, 2026-07-31)

The pricing tile deliberately sells only what ships: the full comp list and the
10-year lookback. Two entitlements that `entitlements.js` already grants are
**not advertised** because neither is built. **Put each bullet back in the same
change that builds the feature** — there is a comment in `index.html` marking
the spot:

| Bullet to restore | Blocked on |
|---|---|
| `Unlimited CSV, image and PDF exports` | a write path for `export_usage`, so the free 3/month cap is real |
| `Your logo and firm name on every report` | any branding UI at all — `index.html` has none; only `findBrandingProfile()` exists server-side |

A bullet that describes an unenforced limit is worse than no bullet: it invites
a founding member to ask where their logo is.

### Two bugs found and fixed on the way

- **`/desk?checkout=success` returned 404.** The static route compared
  `req.url` to `"/desk"` exactly, so any query string missed it — meaning the
  page Stripe returns to after a successful payment did not exist. Now matched
  on the path. Same fix un-404s `/?utm_source=…`.
- **"Custom…" lookback stayed locked for Pro.** It was treated as an infinite
  lookback, so it sat above Pro's 120-month ceiling too, and the `· Pro` suffix
  was append-only so it survived an upgrade. Gating is now reversible.

### Verifying it locally

The UI only appears when `/api/config` reports `pro.billing` — which is
`PRO_ENABLED && STRIPE_CONFIGURED`. To see it on a dev box without touching
`.env` or Render:

```bash
PORT=3100 PRO_ENABLED=on STRIPE_SECRET_KEY=sk_test_dummy STRIPE_PRICE_PRO_MONTHLY=price_dummy node server.js
```

Checkout will 502 at Stripe (the key is fake), which exercises the error path.
Without Supabase, `foundingSlotsLeft()` returns null and the founding tile
stays hidden by design — an offer that would 409 on click is never advertised.

---

## Testing privately: `PRO_AUDIENCE`

`PRO_ENABLED` is global. Turning it on for a test would gate **every** visitor
to 4 comps and a 12-month lookback, and put a working **test-mode** checkout in
front of them — and the test card numbers are public, so a stranger could take
a genuine `active` subscription row for free while a real customer's real card
gets declined. Any row they created would still be sitting in `subscriptions`
when you switch to live mode.

So `PRO_AUDIENCE` narrows who the switch applies to:

```
PRO_ENABLED=on
PRO_AUDIENCE=okb336@gmail.com          # comma-separated; unset = everyone
```

With it set, only those **signed-in** accounts are gated and only they can
reach `/api/checkout` and `/api/billing-portal` (everyone else gets the same
503 as a deployment with billing off). Everyone else — including every
anonymous visitor — takes the `enabled: false` path and sees the pre-Pro app
byte for byte. So phase 8 can run for days against the real deployment while
the public site is unchanged.

Three properties worth knowing:

- **`PRO_ENABLED` is still the master switch.** `PRO_AUDIENCE` alone enables
  nothing; `proEnabledFor()` is `PRO_ENABLED && inAudience()`.
- **The webhook is deliberately NOT audience-scoped.** It has no user, and it
  must keep writing subscription rows or the test proves nothing. (It has no
  `PRO_ENABLED` check either — signature verification is its gate.)
- **Anonymous never matches a non-empty audience**, so you must be signed in as
  a listed address to see the paid tier at all.

**Unsetting `PRO_AUDIENCE` is the launch.** Leaving it set ships a Pro tier
nobody can buy, and a deployment in that state looks completely healthy — which
is why the startup log shouts about it.

The rule lives in `entitlements.js` (`parseAudience` / `inAudience`), so it is
covered by `npm test` alongside the rest of the decision table.

---

## Next step: testing (phase 8)

1. Deploy (any deploy — the env vars go live with it)
2. Set `PRO_ENABLED=on` **in test mode only**, together with
   `PRO_AUDIENCE=<your email>` — then sign in as that account. Confirm in a
   private window that a signed-out visitor still sees the un-gated app before
   going further
3. Sign up / sign in on the live site
4. Confirm the **Pricing** link appears in the header and the modal shows both
   tiles with a live "N of 50 left" counter (if the founding tile is missing,
   `/api/pricing` is returning `foundingLeft: null` — a DB problem, not a UI one)
5. Buy Pro monthly with Stripe test card `4242 4242 4242 4242`, any future
   expiry, any CVC
6. **Watch the return to `/desk?checkout=success`** — it should say "Payment
   received — activating…" and flip to "You're on Pro" within a few seconds.
   If it sticks on "still activating", the webhook didn't land: check the
   Stripe webhook log before assuming the UI is at fault
7. Confirm a row lands in Supabase `subscriptions` with `status = active`
8. Check the Stripe webhook log — deliveries should be 200 (a first failure
   then retry is normal on a cold instance)
9. Confirm the Pricing link is now gone and the plan card on My Desk reads
   "Pro", with **Manage billing** in the account menu
10. Test the portal: cancel → confirm `cancel_at_period_end = true`, that
    access continues to period end, and that the plan card reads
    "Pro — cancelling"
11. Test a failed payment with card `4000 0000 0000 0341` → confirm
    `status = grace`, `grace_until` ~7 days out, and that the card reads
    "Pro — payment needs attention" with the right date
12. Buy the founding annual → confirm the counter decrements (allow up to 60s;
    `/api/pricing` memoizes, though the webhook refreshes the memo on a sale)
13. Cancel out of Stripe Checkout once → confirm `/desk?checkout=cancelled`
    says nothing was charged
14. Delete the test-mode rows you created from Supabase `subscriptions` and
    `stripe_events` — a test-mode `active` row still grants Pro in live mode
15. Only after all of that: repeat the whole setup in **live mode** (new
    products, new prices, new webhook destination, new secrets), flip
    `PRO_ENABLED=on` there, and **unset `PRO_AUDIENCE`** — that last step is
    the actual launch

---

## Resume prompt

Paste this into a new chat:

> Picking up the Pro billing work on market-comp-puller. Read
> `PRO-BILLING-SETUP.md` in the project root. Stripe test mode, Supabase schema,
> Render env vars, the server side and the front-end billing UI are all done.
> Next is phase 8 — the end-to-end test with a Stripe test card, which needs a
> deploy and `PRO_ENABLED=on` **in test mode only**.

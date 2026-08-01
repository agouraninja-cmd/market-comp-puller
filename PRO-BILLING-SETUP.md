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
| 6. Render env vars | ✅ Done and deployed |
| 7. Front-end billing UI | ✅ Done, deployed |
| 8. End-to-end test — Stages A, B, C | ✅ **Passed 2026-07-31 in test mode** |
| **8. Stage D — clean up the test data** | ❌ **NOT started — this is the next step** |
| 9. Stage E — live mode + unset `PRO_AUDIENCE` | ❌ Not until D is done |

**Live state right now:** `PRO_ENABLED=on` and `PRO_AUDIENCE=okb336@gmail.com`
are set in Render, in **test mode**. The paid tier is live for that one account
and invisible to everyone else. Verified repeatedly: an anonymous visitor gets
`enabled:false`, `maxComps:"all"`.

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

### Render — environment (current, as of 2026-07-31 evening)

All seven are set **and deployed**:

```
STRIPE_SECRET_KEY                 (sk_test_...)
STRIPE_WEBHOOK_SECRET             (whsec_...)
STRIPE_PRICE_PRO_MONTHLY
STRIPE_PRICE_PRO_ANNUAL_FOUNDING
STRIPE_PRICE_SINGLE_REPORT
PRO_ENABLED = on                  ← test mode
PRO_AUDIENCE = okb336@gmail.com   ← the allowlist; DELETING THIS IS THE LAUNCH
```

⚠ **Do not remove `PRO_AUDIENCE` until Stage D and Stage E are done.** While it
is set, the paid tier exists only for that one signed-in account and every
other visitor — including anonymous ones — takes the `enabled: false` branch
and sees the pre-Pro app. Remove it and the tier goes live for everyone,
against whatever Stripe keys are currently loaded (today: **test** keys, which
decline real cards).

A quick way to confirm the public is unaffected at any time:

```bash
curl -s https://market-comp-puller.onrender.com/api/config | python3 -m json.tool
```

Anonymous must show `"enabled": false` and `"maxComps": "all"`. If it shows
`true` / `4`, the allowlist is gone and real visitors are being paywalled.

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

## Phase 8 Stages A–C — PASSED 2026-07-31 (test mode)

Every customer path was exercised against real Stripe and real Supabase:

| Stage | Result |
|---|---|
| A — turn on privately (`PRO_ENABLED` + `PRO_AUDIENCE`) | ✅ public verified unaffected throughout |
| B — subscribe to Pro monthly, `4242 4242 4242 4242` | ✅ row written, webhooks 200, UI flipped |
| C1 — cancel via the customer portal | ✅ **after a bug fix — see below** |
| C2 — grace period (row set by hand; see note) | ✅ "Pro — payment needs attention", access retained |
| C3 — founding annual $990 | ✅ counter decremented 50 → 49 |
| C4 — abandon checkout | ✅ grey "Nothing was charged", URL self-cleans |

### The bug Stage C caught (fixed, `de91407`)

Cancelling through the portal left the app showing an active, renewing plan.
The webhook verified and wrote the row, but `cancel_at_period_end` stayed
`false`: **newer Stripe API versions report a portal cancel as a `cancel_at`
timestamp while the legacy flag stays false**, and `subscriptionRowFrom` only
read the flag. Every cancellation would have looked like a renewing
subscription and the subscriber would have hard-dropped to free at period end
with no warning. The mapper now reads `sub.cancel_at_period_end || sub.cancel_at`.

**This is why Stage C exists.** It only shows up against live Stripe traffic —
no unit test would have caught it, because the fixture was written from the
older shape.

### Two notes for whoever repeats this

- **A resend of an existing webhook event proves nothing.** `claimStripeEvent`
  treats a repeated event id as a duplicate and skips it, by design. To
  re-test a cancellation you must **resume the subscription and cancel again**,
  which generates a new event id — or delete the row from `stripe_events` first.
- **Direct Supabase edits take up to 60s to show.** `findSubscription` caches
  for 60s and only invalidates when *the app* writes. Editing the table by hand
  bypasses that. Wait a minute before concluding something is broken.
- **C2 is simulated deliberately.** Forcing a real failed renewal needs Stripe
  test clocks, which only work on subscriptions created on a clock from the
  start. The webhook→row mapping is unit-tested; what was untested was the UI
  reading a grace row, so the row was set by hand and the UI checked.

### Prices confirmed by real charges (not by reading a dashboard)

| Price | Confirmed |
|---|---|
| Pro monthly **$129.00** | ✅ succeeded charge, 2026-07-31 |
| Founding annual **$990.00** | ✅ succeeded charge, 2026-07-31 |
| Single report **$39** | owner-confirmed; no charge yet (nothing sells it) |

---

## NEXT STEP — Stage D: clean up the test data

**Nothing is launched until this is done.** Test-mode rows still grant Pro in
live mode, and a test-mode Stripe customer id will mis-map against live Stripe.

**Two accounts have test subscription rows**, not one — a second Claude session
was running phase 8 in parallel on 2026-07-31 and subscribed as
`agouraninja@gmail.com`, the site's public contact address. That row is inert
today only because that address sits outside `PRO_AUDIENCE`; the moment the
allowlist is removed it would grant free Pro to the business account.

```sql
-- Deliberately unqualified: clears BOTH test accounts' rows.
delete from subscriptions;
delete from stripe_events;
update users set stripe_customer_id = null where stripe_customer_id is not null;
```

That third statement is the one people miss. `userIdForStripeCustomer()` maps a
Stripe customer back to a user through `users.stripe_customer_id`; a leftover
**test-mode** customer id would mis-map against live-mode Stripe.

Then verify:

```sql
select count(*) from subscriptions;   -- expect 0
```

And confirm `GET /api/pricing` (signed in as the allowlisted account) reports
`"foundingLeft":50` — all founding seats restored.

Also check **Stripe → Billing → Subscriptions, filter status = active**. Any
still-active test subscription keeps firing renewal webhooks and would rewrite
the rows you just deleted. As of 2026-07-31 both known test subscriptions were
cancelled with "no future invoices", so this should come back empty.

---

## Then Stage E: going live

1. In Stripe, switch **off** test mode and recreate from scratch: products, the
   three prices, and a **new** webhook destination at the same
   `/api/stripe/webhook` URL with the same six events.
2. In Render, replace `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and all three
   `STRIPE_PRICE_*` with the **live-mode** values.
3. If any live amount differs from test, update **both** the price comments in
   this file **and** the hard-coded `$129` / `$990` / "saves $558" in
   `index.html` — nothing reconciles them against Stripe.
4. **Delete `PRO_AUDIENCE`. That is the launch.** Left set, the product is live
   but unbuyable, on a deployment that looks perfectly healthy.
5. Redeploy. In a private window confirm the Pricing link now appears for a
   signed-out visitor and reports are gated to 4 comps.

---

## Resume prompt

Paste this into a new chat:

> Picking up the Pro billing work on market-comp-puller. Read
> `PRO-BILLING-SETUP.md` in the project root first. Phases 1-7 are done and
> deployed, and phase 8 Stages A, B and C all passed in test mode on
> 2026-07-31. Next is **Stage D — cleaning up the test data** (two accounts
> have rows, not one), then Stage E, live mode. `PRO_ENABLED=on` and
> `PRO_AUDIENCE=okb336@gmail.com` are currently set in Render in test mode —
> leave both alone until Stage D is done. Pull before starting; another session
> has been committing to this repo.

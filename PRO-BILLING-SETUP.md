# Pro Billing — Setup State & Resume Point

Written 2026-07-31. **Last updated 2026-08-25**, adding the firm-seats
(`firm_monthly`) launch runbook. Read this first when picking the Pro tier
back up.

**⚠ 2026-08-21: the single-report unlock is RETIRED.** Every mention of it
below is HISTORY, kept because the setup record must not be rewritten — do
not follow it forward. `single_report` is deleted from `/api/checkout`'s
PLANS map (a source scan in `test/routes.test.js` fails the build if it
returns), `STRIPE_PRICE_SINGLE_REPORT` is no longer read and can be unset
in Render with the price archived in Stripe, and the free tier itemizes
every comp (`FREE_MAX_COMPS: "all"`, same date). Purchases already made
are honored forever — the webhook, `report_purchases`,
`/api/report-access` and the per-property entitlement all remain. The
current sellable plans are `pro_monthly`, `pro_annual_founding` and
`firm_monthly`. See CLAUDE.md's "single-report unlock — RETIRED" section.

**⚠ Stripe is in LIVE mode as of 2026-08-03.** Earlier revisions of this file
said "test mode"; that is no longer true and the difference is real money. See
the warning below before touching anything.

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
| 8. End-to-end test — Stages A, B, C | ✅ Passed 2026-07-31, test mode |
| 8. Stage D — clean up the test data | ✅ Done — 0 rows, 50 founding seats restored |
| 8. Stage E0–E6 — live mode rebuilt and proved | ✅ Done 2026-08-03 |
| 8. Stage E7 — reconcile hard-coded prices | ✅ N/A — live amounts match test |
| 9. Stage E8 — delete `PRO_AUDIENCE` | ✅ Done 2026-08-03 per the roadmap's shipped log ("Pro tier public launch") — this table was not updated at the time |
| 9. Stage E9 — verify after launch | ✅ Same — Pro has been selling publicly since 2026-08-03 |
| Export cap enforced (5 reports/mo free) | ✅ Shipped 2026-08-03 |
| Admins get Pro comped on sign-in | ✅ Shipped 2026-08-03 — see below |
| Report branding | ✅ Shipped 2026-08-08 (this table was not updated at the time; see the roadmap's shipped log) |
| $39 single-report unlock | ✅ Shipped 2026-08-03 — **RETIRED 2026-08-21**, see the warning above |
| **Firm seats (`firm_monthly`)** | ❌ **Code shipped + migration 033 applied 2026-08-19; `STRIPE_PRICE_FIRM_MONTHLY` unset — the runbook below is the launch** |

---

## ⚠️ READ THIS BEFORE TOUCHING ANYTHING

**Stripe is in LIVE mode. Real cards will be charged.** This document said
"test mode" until 2026-08-03; that is no longer true. Render holds an
`sk_live_` key, a live webhook secret, and live price IDs. A "quick test
purchase" now takes real money from a real card.

**The only thing between you and paying customers is one environment
variable:**

```
PRO_ENABLED  = on                  ← the tier is switched on
PRO_AUDIENCE = okb336@gmail.com    ← and reaches ONLY this account
```

Delete `PRO_AUDIENCE` and the product is live to the public, instantly, with
real billing. That is the launch, and it is deliberately the last step.

Check the public is still shielded at any time:

```bash
curl -s https://market-comp-puller.onrender.com/api/config | python3 -m json.tool
```

An anonymous visitor **must** show `"enabled": false` and `"maxComps": "all"`.
If it shows `true` / `4`, the allowlist is gone and real visitors are being
paywalled against live Stripe.

**To roll everything back:** set `PRO_ENABLED=off` (or delete it) and deploy.
Within minutes the site behaves exactly as it did before the tier existed. No
data is lost, no accounts are affected, and any real subscription stays valid in
Stripe and resumes the moment it is switched back on.

---

## The price IDs

Not secret — a price ID identifies a product, it does not authorize anything.

**⚠ 2026-08-25: the prices below are the ORIGINAL ones and three of the four
lines are superseded.** The repricing decision and the new values are in
"The 2026-08-25 repricing" further down; the price IDs created for it get
recorded there. This block is kept as the historical record, per the same
rule as the retired single-report entries.

**LIVE mode (created 2026-08-03):**

```
STRIPE_PRICE_PRO_MONTHLY          = price_1U0QKkRztxjkvpo57UcIq0uv   # $129/mo — superseded 2026-08-25 by $100
STRIPE_PRICE_PRO_ANNUAL_FOUNDING  = price_1U0QKmRztxjkvpo5mSa8uS9G   # $990/yr founding — superseded 2026-08-25 by $840
STRIPE_PRICE_SINGLE_REPORT        = price_1U0QKlRztxjkvpo5mK9VEvjJ   # $39, RETIRED 2026-08-21
```

Note the prefixes run `Kk`, `Kl`, `Km` but map to **Monthly, Single Report,
Annual** — not the order you would guess. Pasting them in listed order puts the
$39 one-time price where the $990 annual belongs.

**TEST mode (the sandbox, kept for reference):**

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

The secret key (now `sk_live_...`) and the webhook signing secret live **only in
Render**. They are not in this repo, not in `.env`, and were never pasted into a
chat. An earlier *test* key was exposed in a screenshot and has been **rotated**;
the old one is dead. The live key has never been shown anywhere — keep it that
way, and roll it from Stripe → Developers → API keys if it ever is.

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

Nine events, matching the switch in `handleStripeEvent()` — a test reads this
list out of this file and fails the build if the two disagree, so edit them
together:
```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.payment_failed
charge.refunded
```

**The last three are newer than the deployment — enable them in the Stripe
dashboard, or the code that handles them never runs.** What each one costs
while it is missing:

- `checkout.session.async_payment_succeeded` — a payment method that settles
  after checkout closes (bank debits, some wallets) charges the customer and
  never unlocks their report. It is the only follow-up event such a session
  ever gets. Rare on cards, ordinary on delayed methods.
- `checkout.session.async_payment_failed` — a bounced delayed payment leaves
  no trace on our side. Nothing to undo; this is a log line.
- `charge.refunded` — a refunded buyer keeps their report unlock forever.
  Only a FULL refund revokes; a partial one emails the owner and changes
  nothing. A refunded subscription invoice matches no unlock and is left to
  the subscription's own lifecycle events.

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

### Render — environment (current, as of 2026-08-03)

All seven are set **and deployed**, with **LIVE** Stripe values:

```
STRIPE_SECRET_KEY                 (sk_live_...)   ← real money
STRIPE_WEBHOOK_SECRET             (whsec_...)     ← the live destination's
STRIPE_PRICE_PRO_MONTHLY          price_1U0QKk...
STRIPE_PRICE_PRO_ANNUAL_FOUNDING  price_1U0QKm...
STRIPE_PRICE_SINGLE_REPORT        price_1U0QKl...
PRO_ENABLED = on
PRO_AUDIENCE = okb336@gmail.com   ← the allowlist; DELETING THIS IS THE LAUNCH
```

⚠ **Do not remove `PRO_AUDIENCE` until you intend to launch.** Stages D and
E0–E6 are complete, so removing it now would put a working, real-money product
in front of the public immediately. While it
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

### The single-report unlock — shipped 2026-08-03

Both of the things this section used to list as unbuilt now exist. Export
counting shipped earlier the same day; the $39 unlock is described here.

**✅ This migration has been applied** — verified 2026-08-03 against the live
project's PostgREST schema, which no longer lists `comp_snapshot` as required
on `report_purchases`. Kept here because it is the one migration that fails
*silently and expensively* if a future environment is built from the original
DDL. The webhook writes `report_purchases` with no `comp_snapshot`, so where
the column is still `not null` every purchase insert 400s — the customer is
charged and never unlocked. In that case, run:

```sql
alter table report_purchases alter column comp_snapshot drop not null;
```

Then confirm it took, **before** letting anyone buy one:

```sql
select is_nullable from information_schema.columns
where table_name = 'report_purchases' and column_name = 'comp_snapshot';
```

`YES` means it's safe. The column is deliberately kept and left empty: the
webhook carries a session and a payment intent but no report data (the report is
a client-side artifact), and `computeEntitlements` only ever tests whether the
ROW EXISTS. It's there for a future "the comps exactly as you bought them"
feature, which would need a pending row written at checkout creation instead.

**What changed.** `/api/checkout`'s plan map used to send
`pro_annual_founding` → the founding price and *everything else* → monthly. That
fallthrough is gone: `PLANS` is an explicit table and an unknown plan is a 400.
`single_report` opens a **payment**-mode session carrying `report_id` in both the
session and payment-intent metadata, with an idempotency key of
`single:<user>:<report>` so a double-click can't become two charges.

**What "a report" means.** `reportIdFor()` hashes `address|type|months` from the
request body — derived, never accepted as an id. It mirrors `exportReportKey()`
in index.html exactly, so the purchase key and the export-tally key are the same
string and a bought report never spends a free export. The unlock is therefore
**permanent for that address + type + lookback**; a different lookback is a
different report, by design.

**The return.** Lands on `/?purchase=success` (not `/desk` — the buyer wants the
report). The address rides in `localStorage.pendingUnlock.v1`, never the URL, and
`handlePurchaseReturn()` polls `POST /api/report-access` until the webhook lands
before re-running the search.

**Also fixed here.** A webhook that threw used to stay claimed in
`stripe_events` while Stripe already had its 200 — no automatic retry, and a
dashboard "Resend" would be skipped as a duplicate. A subscription survived that
(the next lifecycle event rewrites the row); a one-off purchase has no follow-up
event ever, so one DB blip meant paid-and-locked-out forever. Failures now
release the claim and email the owner.

### Comped Pro for admins — shipped 2026-08-03

Founder's instruction from the 2026-08-03 meeting: the team should not be the
one group that never sees Pro. Signing in now grants full Pro whenever the
browser carries admin credentials.

**Nothing to configure.** `ADMIN_KEY` is already set in Render and is the admin
identity — there is no admin user, no new env var and no migration. Unlocking
`/admin`, `/dev` or `/contacts` also sets an httpOnly `cn_admin` cookie (via
`POST /api/admin-access`) so the main app sees it in every tab, not just the one
where the dashboard was unlocked. Full rules under "Admin access" in `CLAUDE.md`.

Two things that matter for the launch specifically:

- **It changes nothing while `PRO_AUDIENCE` is set.** The admin branch is gated
  on `proEnabledFor(user)`, so an admin outside the allowlist still takes the
  `enabled: false` path and sees the pre-Pro app. Comped Pro starts mattering at
  Stage E8, which is exactly when it is needed.
- **Use "View as a free user" before shipping any paywall change.** It is on the
  plan card on My Desk and drops comped Pro for the session. Every internal
  account is otherwise permanently Pro, which means nobody internal renders the
  free tier by accident.

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
| Single report **$39** | owner-confirmed; sellable since 2026-08-03, no real charge yet |

---

## Phase 8 Stage D — DONE (2026-08-03)

Test-mode rows cleared from `subscriptions` and `stripe_events`, and
`users.stripe_customer_id` reset. Verified: `select count(*) from subscriptions`
returned **0**, and `/api/pricing` reported **`foundingLeft: 50`** — all founding
seats restored.

Two accounts held rows, not one: a second Claude session ran phase 8 in parallel
and subscribed as the site's public contact address. Both were cleared.

---

## Phase 8 Stage E — E0 to E6 DONE (2026-08-03)

Live mode was rebuilt from scratch, because nothing carries over from test:

| Step | What was done |
|---|---|
| E0 | Stripe account activated for live payments (EIN provided) |
| E1 | Three products/prices created live; IDs recorded above |
| E2 | Customer portal configured live — cancel at period end, update card, invoice history, **plan switching OFF** |
| E3 | Live webhook destination created, same six events, new `whsec_` |
| E4 | Live `sk_live_` secret key issued |
| E5 | All five values loaded into Render and deployed; allowlist kept in place |
| E6 | **Proved with a real card** — a temporary $1/month live price, bought, verified end to end, cancelled, refunded, price restored, $1 price archived |
| E7 | Not needed — live amounts match test, so nothing hard-coded changed |

E6 confirmed the whole live chain: checkout → webhook 200 → `subscriptions` row
→ plan card → customer portal. **Both live prices are now confirmed by real
succeeded charges** ($129 and $990 in test mode, $1 in live), rather than by
reading a dashboard — which is what the `$49` error earlier should have been.

---

## NEXT STEP — Stage E8: the launch

**One action.** Render → Environment → **delete `PRO_AUDIENCE`** → Save,
rebuild, and deploy.

Then E9, and note **every check inverts** — until now the correct answer has
always been `false`:

- Render logs: `⭐ Pro tier ENABLED` present, **`🔬 PRO_AUDIENCE` line gone**
- Anonymous `/api/config`: now `"enabled": true`, `"maxComps": 4`
- Private window: Pricing link visible, reports gated to 4 comps, lookback capped at 12 months

If it still reads `false` / `"all"`, the variable did not actually delete — the
product would be live but unbuyable, on a deployment that looks perfectly
healthy.

Held pending a founder conversation as of 2026-08-03. Nothing degrades while it
waits; the allowlist holds the current state indefinitely.

---

## What the tier actually sells (as of 2026-08-03)

| | Free | Pro |
|---|---|---|
| Comps itemized | **4** | all |
| Lookback | **12 months** | **10 years** |
| Exports | **5 reports/month** | unlimited |
| Valuation range | uses **every** comp | uses every comp |

That last row is the point: **a free report's valuation is identical to a Pro
one.** Withheld comps still ride along as anonymised basis rows, so the hero
range, chart median and stat tiles read the full set. The tier sells the
evidence, not a better answer.

**Export counting** (shipped 2026-08-03) is counted **per report**, so CSV,
image, PDF and Excel of the same analysis cost one. Exporting requires an
account — anonymous is 0, deliberately, because leaving it uncounted would have
made an account strictly worse to have. It is an honour system: exports are
generated in the browser, so the server can only be asked whether it may, never
withhold the file. Every failure path lets the export through.

### Still unbuilt, and deliberately not claimed anywhere

- **Report branding.** `branding_profiles` and `findBrandingProfile()` exist;
  there is **no UI at all** — nothing uploads a logo and nothing draws one. The
  bullet is withheld from the pricing tile, plan card and success banner, with a
  comment at each site marking where it goes back.
- ~~**The $39 single-report unlock.**~~ Built 2026-08-03 — see "The
  single-report unlock" above. Its `comp_snapshot` ALTER was verified applied
  on 2026-08-03, so nothing is outstanding. It has still never been exercised
  against a real card — see "Untested" below.

---

## Firm seats (`firm_monthly`) — launch runbook (written 2026-08-25)

The third sellable plan, and the only dark one. The code shipped 2026-08-16
(enterprise slice 4) and migration 033 (`org_subscriptions`) was applied and
verified on production 2026-08-19 — see `migrations/APPLIED.md`. All nine
webhook events are enabled on the live destination (2026-08-17), and the
webhook's firm branch already handles quantity, so **nothing below is a
deploy**. The entire launch is owner-console work: one Stripe price and one
Render env var.

**While `STRIPE_PRICE_FIRM_MONTHLY` is unset** (today's state): a
`firm_monthly` checkout answers 503 "That plan isn't configured", `canBill`
is false so the "Add seats" button never renders for anyone, and firms run on
hand-granted seats (`orgs.seats`, 200 by default at creation). That is the
designed dark state, and unsetting the var is also the rollback — existing
subscriptions stay valid in Stripe and resume when it returns.

### What the code already enforces (don't rebuild, don't re-check by hand)

- **Owner only.** Only the firm's owner sees the Buy and portal controls, and
  both routes re-check ownership server-side. Admins and members see the seat
  count and nothing to click.
- **Seats ≥ headcount.** Buying fewer seats than current members + pending
  invitations is refused by name (`seats_below_headcount`), because the
  webhook would otherwise drop named colleagues to free. There is
  deliberately **no minimum seat count in code** (decided 2026-08-25): the
  proposed 5-seat minimum is a pricing question for Chuck, and if it is ever
  wanted it lands as another named refusal beside `seats_below_headcount`.
- **Seats bought = seats enforced.** The webhook writes `orgs.seats` from the
  SUBSCRIPTION's quantity (`STRIPE.seatsOf`), so a portal quantity change
  updates the cap with no code in the loop. Corollary: a checkout on a
  hand-granted firm **replaces** its 200 seats with the bought number.
- **The firm is the customer.** Checkout creates (or reuses) the firm's own
  Stripe customer, never the buying owner's personal one, and `org_id` rides
  in the metadata of both the session and the subscription.
- **No dollar amount renders anywhere in the UI.** The seats prompt and plan
  card show counts only; Stripe's checkout page is the price surface. Unlike
  `$129`/`$990` (hard-coded in the pricing modal), the firm price can change
  in the dashboard without a repo edit.

### The 2026-08-25 repricing — what was decided and why

Chuck was unavailable for the price check, so it was done against the market
instead. Per-seat pricing for broker-facing CRE tools clusters hard at
**$129/user/mo** (Apto, Rethink CRM, ClientLook — ClientLook entry ~$89);
above that sit Crexi Pro at $249, Buildout at $85–249/broker **plus** a
$275/mo platform fee, and CoStar at $300–$1,200+/mo. Team plans in the 5–50
seat range conventionally run **10–25% off** the individual price.

The owner's call, taken 2026-08-25:

| | Was | Now |
|---|---|---|
| Pro monthly | $129/mo | **$100/mo** |
| Founding annual | $990/yr ("saves $558") | **$840/yr ("saves $360")** |
| Firm seats | not sold | **$79/seat/mo, minimum 2 seats** |

$79 against $100 is a 21% team discount, inside the conventional band. The
founding annual moved because $990 against $100/mo would have saved only
$210 — a visibly worse deal still wearing the word "founding".

**The 2-seat minimum is not a pricing preference, it closes a hole.**
`canUseOrg` gates *creating* a firm on already holding Pro, but
`getEntitlements` grants Pro from a firm **seat** as a fallback once a
personal subscription lapses (`server.js`, the `firmSeatSubscriptionFor`
branch). Without a minimum, one person could create a firm, buy a single
seat, cancel their own plan, and keep everything at the seat price — which
is below the individual price by construction, because a team discount is
the point. Two seats bill $158 against $100, so the cheap path back to Pro
is closed. **Keep that relation true if either price moves**: it works
because the seat price is above half the individual price. The rule lives in
`ORG.MIN_SEATS` (org-access.js), is refused by name at checkout
(`seats_below_minimum`), and is mirrored into index.html's seats prompt with
a test pinning the two.

New live price IDs — **record them here as they are created**:

```
STRIPE_PRICE_PRO_MONTHLY          = price_1U8iOORztxjkvpo5m6v1nAK0   # $100.00/mo
STRIPE_PRICE_PRO_ANNUAL_FOUNDING  = price_1U8iSERztxjkvpo5ReDQ2YCF   # $840.00/yr
STRIPE_PRICE_FIRM_MONTHLY         = price_1U8iViRztxjkvpo5mrjCONar   # $79.00/seat/mo  <- LIVE
                                    price_1U8iViRztxjkvpo5DIPhXbGL   # $1.00/seat/mo, ARCHIVED after the test
```

**Done, and proved on production 2026-08-26.** All three are set on Render and
the firm plan is selling at $79 a seat. What the live round trip established,
in order:

- A firm checkout for 1 seat is refused `seats_below_minimum` (minimum 2); 0
  and a non-number are refused with no code, which is the intended asymmetry.
- Two seats at the $1 test price billed $2.00 ("Qty 2, $1.00 each"), and the
  webhook wrote `org_subscriptions` AND set `orgs.seats` to 2 from the
  subscription quantity. The desk read "1 of 2 seats used - 1 free - active"
  and grew a working "Manage firm billing" button.
- Cancelling flowed back the same way: `status` went to `cancelled` on its own.
- After the env swap, a fresh session quotes **$158.00/mo, Qty 2, $79.00
  each**. The $1 price is archived.

**It also found that checkout had been broken for five days** -- the retired
$20 unlock left a dead `reportId` reference in the Stripe call, so every
successful checkout threw ReferenceError while the suite stayed green. Fixed
with the test that was missing (see STRIPE_API_URL in stripe.js and
test/checkout-run.test.js). That is the case for doing this round trip on a
real card rather than trusting a green build.

Left behind on purpose: the scratch firm `Seat Billing Test (scratch)`
(`5c1afe5f-e591-404c-b0a3-42ee5fbe381c`), which has a cancelled subscription
row and `seats = 2`. There is no delete-org route, so removing it is SQL:

```sql
delete from org_subscriptions where org_id = '5c1afe5f-e591-404c-b0a3-42ee5fbe381c';
delete from org_members     where org_id = '5c1afe5f-e591-404c-b0a3-42ee5fbe381c';
delete from orgs            where id     = '5c1afe5f-e591-404c-b0a3-42ee5fbe381c';
```

All four were created live on 2026-08-26. `CompNinja Firm` is a new product,
`prod_V90WpmtIrSm0Yg`; the two Pro prices were added to the existing products
(`prod_UzJpxsAE3jlkFD`, `prod_UzJqRs6PpYfqAI`), and the old $129/$990 prices are
left unarchived until the new ones are proved.

**The migration step turned out to be moot.** Account MRR was $0.00 and both old
prices showed **0 active subscriptions**, so nobody was on $129 or $990 to move.
The one live subscription is the E6 test from 2026-08-03 (okb336@gmail.com,
$1/mo against the archived Pro Monthly $1 price), already set to cancel
2026-09-03. Re-check before assuming that is still true.

No portal or webhook work: the existing destination and portal configuration
cover subscriptions generally, and the portal's plan-switching stays OFF (the
founding-cap reason, unchanged).

**Two ordering rules for the repricing**, both learned from what would go
wrong otherwise:

- **Env vars before the copy deploy.** Between the two the site advertises
  $129 while charging $100 — under-advertising, which is the safe direction.
  The reverse order advertises $100 and charges $129.
- **Existing subscribers do not move on their own.** A Stripe price change
  never touches live subscriptions, so anyone on $129 keeps paying it while
  the site says $100. They are migrated down by hand in the dashboard;
  founding annual members keep the $990 they bought.

### Step 2 — prove it with a $1 price first (the E6 pattern)

Stripe is live, so the round trip is proved the way E6 proved Pro: a
temporary price, a real card, a refund.

1. Create a second, temporary **$1.00/seat monthly** price on the same
   product.
2. Render → set `STRIPE_PRICE_FIRM_MONTHLY` to the $1 price ID → save,
   deploy.
3. Sign in as the owner of a **scratch firm** (create one — `kind` is
   required at creation). **Not a real hand-granted firm**: the webhook will
   set its seats to the bought quantity, replacing the hand-granted 200.
4. My Desk → firm section now shows "N of N seats used" and **Add seats**.
   Buy 2 seats ($2 real charge).
5. Verify, in order:
   - Stripe: checkout completed, subscription active, quantity 2, the
     customer is the firm's own (name/metadata), webhook deliveries 200.
   - Supabase: `select org_id, plan, status, current_period_end from
     org_subscriptions;` shows the row (`firm_monthly` / `active`), and
     `select seats from orgs where id = '<org id>';` reads **2**.
   - The plan card now also shows the **portal** button (it only renders once
     a subscription exists); open it and confirm it lands on the firm's
     customer.
   - A second browser signed in as a non-owner member of the firm sees the
     seat count and **no** buttons.
6. Cancel the subscription (portal or dashboard) and refund the $2 charge in
   Stripe. Note the refund alone changes nothing on our side by design (a
   refunded subscription invoice is left to the subscription's own lifecycle
   events) — the cancel is what ends it.
7. Swap `STRIPE_PRICE_FIRM_MONTHLY` to the real price ID, archive the $1
   price.
8. Clean up the scratch rows: `delete from org_subscriptions where org_id =
   '<org id>';` and `update orgs set seats = 200 where id = '<org id>';` (or
   delete the scratch firm outright — `org_subscriptions` cascades).

Timing note: the firm plan card reads `org_subscriptions` fresh on every
open, but a member's Pro-via-firm **entitlement** rides a 60-second seat
cache (`SEAT_CACHE_TTL_MS`) — wait a minute before concluding a colleague's
Pro didn't arrive, or that a hand-edited row didn't take.

### Done when

The done-when from the Aug 27 plan, verbatim: the firm plan card renders a
working Buy for an org owner, and a test checkout writes an
`org_subscriptions` row. Step 2 proves both.

---

## Resume prompt

Paste this into a new chat:

> Picking up the Pro billing work on market-comp-puller. Read
> `PRO-BILLING-SETUP.md` in the project root first.
>
> Everything is built and deployed. Phase 8 Stages A-D passed in test mode, and
> Stage E0-E6 rebuilt it in **live mode** and proved it with a real card. The
> export cap (5 reports/month free, per report) shipped 2026-08-03.
>
> **Stripe is LIVE. Real cards will be charged.** The only thing standing
> between the product and the public is `PRO_AUDIENCE=okb336@gmail.com` in
> Render, which limits the paid tier to that one account. `PRO_ENABLED=on`.
> Deleting `PRO_AUDIENCE` is the launch (Stage E8) and is being held pending a
> founder decision — do not remove it unless asked.
>
> Confirm the public is still shielded before anything else:
> `curl -s https://market-comp-puller.onrender.com/api/config`
> Anonymous must show `"enabled": false` and `"maxComps": "all"`.
>
> Pull before starting — four people commit to this repo and it moves during a
> session. Still unbuilt and deliberately unclaimed: report branding. The $39
> single-report unlock shipped 2026-08-03; its `comp_snapshot` ALTER is applied
> and verified, but no purchase has ever been made with a real card, so the
> live payment round-trip is still unproven.

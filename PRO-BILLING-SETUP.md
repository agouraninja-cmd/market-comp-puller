# Pro Billing — Setup State & Resume Point

Written 2026-07-31. **Last updated 2026-08-03**, after phase 8 Stages A–E6 and
the export cap. Read this first when picking the Pro tier back up.

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
| **9. Stage E8 — delete `PRO_AUDIENCE`** | ❌ **NOT done — this is the launch** |
| 9. Stage E9 — verify after launch | ❌ Not until E8 |
| Export cap enforced (5 reports/mo free) | ✅ Shipped 2026-08-03 |
| Admins get Pro comped on sign-in | ✅ Shipped 2026-08-03 — see below |
| Report branding | ❌ Not built — no UI exists |
| $39 single-report unlock | ✅ Shipped 2026-08-03 — `comp_snapshot` ALTER verified applied 2026-08-03 |

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

**LIVE mode (what production uses today, created 2026-08-03):**

```
STRIPE_PRICE_PRO_MONTHLY          = price_1U0QKkRztxjkvpo57UcIq0uv   # $129/mo
STRIPE_PRICE_PRO_ANNUAL_FOUNDING  = price_1U0QKmRztxjkvpo5mSa8uS9G   # $990/yr founding
STRIPE_PRICE_SINGLE_REPORT        = price_1U0QKlRztxjkvpo5mK9VEvjJ   # $39, sold since 2026-08-03
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

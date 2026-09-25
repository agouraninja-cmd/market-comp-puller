---
paths:
  - "entitlements.js"
  - "stripe.js"
  - "branding.js"
  - "logo-import.js"
  - "trial-notices.js"
  - "pricing-page.js"
  - "PRO-BILLING-SETUP.md"
  - ".github/workflows/trial-notices.yml"
  - "test/entitlements.test.js"
  - "test/stripe.test.js"
  - "test/branding.test.js"
  - "test/org-branding.test.js"
  - "test/logo-import*.test.js"
  - "test/checkout-run.test.js"
  - "test/price-check-run.test.js"
  - "test/pro-trial-run.test.js"
  - "test/report-limit-run.test.js"
  - "test/trial-notices*.test.js"
  - "test/pricing-page.test.js"
---
# Billing, entitlements and branding

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `TESTER_PASSKEY` — optional shared passkey that comps Pro to a **signed-in**
  account (the beta-tester door). Unset = `POST /api/redeem-passkey` 404s and
  the pricing modal's "Have a code?" row never renders, so this is inert on any
  deployment that never configured it. **It is not `ADMIN_KEY`**: that key also
  unlocks `/admin`, `/dev` and `/contacts`, so it can never be the thing handed
  to testers. Redeeming sets `users.pro_tester` (migration 022), so the grant
  follows the ACCOUNT across devices, survives a passkey rotation, and is
  revoked one tester at a time with a one-row `update users set pro_tester =
  false where email = …` rather than by rotating the code for everyone.
  Rules live in `entitlements.js`, so `npm test` covers them; four of them
  matter. It grants **everything Pro, the broker vault, firms and bulk
  valuation included** (owner's call, 2026-09-01). Until then it withheld all
  three — the vault as a private-data workspace with an upload endpoint, firms
  as an endpoint that emails any address typed in, bulk as a spend fan-out —
  on the argument that a shared passkey is a bigger surface than "try Pro's
  reports"; what that produced was testers opening `/vault` and `/bulk` and
  reading the product as the free tier. The bounds that remain are the ones
  that were always doing the work: `BULK_DAILY_ADDRESSES` caps bulk spend per
  member per day, and revoking one tester is still a one-row UPDATE. (The
  door for handing a broker the vault WITHOUT comping Pro is still
  `VAULT_PASSKEY` / `users.vault_beta` — see the next bullet; that direction
  is unchanged.) It **cannot switch
  a dark deployment on** (`PRO_ENABLED` still wins, same as the admin branch).
  Its `status` is `"tester"`, never `"active"`, so the UI never offers a
  billing portal to an account with no Stripe customer. And unlike the admin
  branch it is **checked as a fallback after the subscription**, not as an
  early short-circuit: a tester who later subscribes gets their real Stripe
  status and their billing portal, and comped access resumes if that
  subscription lapses. A tester is also NOT the `internal` bypass in
  `/api/comps`, which stays header-only.
- `VAULT_PASSKEY` — optional shared passkey that grants the **broker vault**
  (and only the vault) to a signed-in account. It exists because
  `users.vault_beta` was set by hand in the Supabase SQL editor, one broker at
  a time, which put the owner in the loop for every onboarding — "hand three
  brokers a vault at a meeting" was a note-to-self rather than something that
  happened in the room. Redeeming sets the same `users.vault_beta` column
  (migration 023), so everything already true of that grant stays true:
  entitlements gives `broker`/`canUseVault` and **not one Pro report feature**,
  it cannot switch a dark deployment on (`PRO_ENABLED` still wins), it does not
  ride the subscription lapse rules, and revoking is the one-row `update users
  set vault_beta = false where email = …`.
  **It is a SECOND secret, not a widening of `TESTER_PASSKEY`**, and the two
  are independent — either can be set alone. The tester grant excludes the
  vault deliberately (see the bullet above), so folding the vault into that
  code would open a private-data workspace with an upload endpoint to everyone
  ever handed a try-Pro code. Two codes also keep the two audiences separately
  revocable: rotating one does not lock the other out. Setting them to the
  same string is a configuration mistake and the startup banner says so
  loudly (it is not fatal — a rotation closes it).
  **Both codes redeem through the same `POST /api/redeem-passkey` and the same
  input**, because someone handed a code should not also have to know which
  kind it is; the route compares against both secrets and its `granted` array
  names which door opened. The route 404s only when NEITHER is set. One
  behavior deliberately changed to make room for the second code: the
  idempotency check used to run BEFORE the secret compare, so an existing
  tester typing a rotated code was told "already" rather than "incorrect". It
  now runs after (the route cannot know which grant is claimed until it
  compares) and asks whether the account holds *everything this deployment can
  give* — identical behavior on a tester-only deployment, and pinned by tests
  in both shapes.
- `LOGO_IMPORT_ALLOW_PRIVATE` — **test-only**, unset in production. Lets
  `POST /api/branding/logo-from-site` fetch a loopback or private address,
  which the route's DNS guard refuses by design; `test/logo-import-run.test.js`
  stands its stub firm website up on 127.0.0.1 and could not reach the fetch
  path without it (the link check's suites route around the same guard by
  citing bot-walled hosts, which this feature has no equivalent of). Not a
  secret and authorizes nothing, but it switches off an SSRF guard, so treat
  it as trusted config the way `RESEND_API_URL` is.
- `PRO_ENABLED` — optional `on`/`off`, **default OFF**. Master switch for the
  paid Pro tier. Off means the app behaves exactly as it did before the tier
  existed: no comp gating, no export cap, no lookback limit
  (`computeEntitlements`' `enabled: false` branch returns
  `maxComps: "all"` / `exportsRemaining: "unlimited"` and skips every billing
  read, so the flag costs nothing on the hot path). **Do not turn this on
  before running the Pro DDL** in `migrations/008-pro-billing.sql`
  — and note the billing tables have **no file fallback** by
  design, so `PRO_ENABLED=on` without Supabase configured resolves every
  visitor to the free tier and logs a `⛔` line at startup.
- `PRO_AUDIENCE` — optional comma-separated email allowlist narrowing **who**
  `PRO_ENABLED` applies to. Unset (the launch setting) means everyone. Set, it
  means only those *signed-in* accounts are gated and only they can reach
  `/api/checkout` and `/api/billing-portal`; every other visitor, anonymous
  included, takes `computeEntitlements`' `enabled: false` branch and sees the
  pre-Pro app. It exists so the paid tier can be proven against the live
  deployment without gating real traffic or exposing a test-mode checkout — the
  Stripe test card numbers are public, so an open test window lets a stranger
  take a genuine subscription row for free. Three rules: `PRO_ENABLED` is still
  the master switch (`proEnabledFor()` is the AND of both); the **webhook is
  deliberately not audience-scoped** (it has no user and must keep writing rows
  or a test proves nothing); and **unsetting it is the launch** — left set, the
  product is live but unbuyable and the deployment looks perfectly healthy,
  which is why startup logs it loudly. Rules live in `entitlements.js`
  (`parseAudience` / `inAudience`), so `npm test` covers them.
- `PRO_TRIAL_DAYS` / `PRO_TRIAL_START` — the **new-account Pro trial**
  (2026-09-25, owner's call; billing plan in the "CompNinja Billing &
  Retention Plan" doc). Every account gets full Pro — vault, bulk valuation and
  firms included — for `PRO_TRIAL_DAYS` (default **14**; `0` or `off` is the
  instant rollback lever), counted from the LATER of its own `created_at` and
  `PRO_TRIAL_START` (a `YYYY-MM-DD` launch date; unset = signup alone decides).
  That second setting is how accounts that predate the trial get their 14 days
  from launch day rather than none; a launch date still in the FUTURE is no
  trial yet, so setting it ahead of a deploy starts nothing early. Either value
  unreadable **exits at boot** (the `SEARCH_PROVIDER` rule). Rules in
  `entitlements.js` (`trialEndsAt` + the trial branch), tested in
  `test/entitlements.test.js` and wired end to end in
  `test/pro-trial-run.test.js`. Five rules:
  - **A dated grant, never a Stripe trial.** Stripe marks a trialling
    subscription `trialing`, which `subscriptionState()` reads as expired, so
    a Stripe trial would have locked every trial user out. It needs no card
    and **no migration**: `created_at` is on every users row, and
    `getSessionUser()` now carries it (the narrowing warning there applies —
    drop the field and every account silently reads as off-trial).
  - **It yields to anything real.** A live subscription wins (the `!pro`
    guard), the tester flag outranks it (it does not end), and
    `getEntitlements` still looks for a **firm seat** when the only grant is a
    trial (`if (own.pro && !own.trial) return own`), because a colleague whose
    firm pays must not be told to upgrade.
  - **Status `"trial"`, never `"active"`**, and `/api/config` carries `trial`
    + `trialEndsAt`. The UI reads them to keep the billing portal AWAY (no
    Stripe customer) and the upgrade ON: every upgrade control reads
    `offerUpgrade = live && (!pro || isTrialPro())` in index.html, restated in
    `ACCOUNT_NAV_JS`. The checkout-return poll waits for `isPro && !trial`, or
    a trial user would be told "You're on Pro" before the webhook landed.
  - **Not exempt from `DAILY_SEARCH_CAP`.** Accounts cost nothing to make, so
    `countsDailyCap` is `(!ent.pro || ent.trial === true) && !internal` — a
    scraper cannot sign up for a trial per burst and walk past the backstop.
    Bulk stays bounded by `BULK_DAILY_ADDRESSES` per member, as for everyone.
  - **Off in the test servers** (`test/helpers/boot.js` sets
    `PRO_TRIAL_DAYS=0`): dozens of suites sign up an account to prove what the
    FREE tier does, and a default-on trial would make them all Pro. A suite
    about the trial turns it on explicitly.
- `STRIPE_PRICE_*` — the price ids, and since 2026-09-25 **each may hold a
  comma-separated LIST**: the FIRST id is the one checkout sells, every id is
  still recognised by the webhook (`STRIPE_PRICE_IDS` vs `STRIPE_PRICES` in
  server.js, arrays accepted by `stripe.js`'s `planForPrice`). Stripe keeps an
  existing subscriber on the price they bought, so their renewals carry the OLD
  id; with one id per variable, pointing it at a new price made every renewal
  resolve to no plan, write no row, and lapse a paying subscriber at the end of
  their period. **A price change is `new_id,old_id`, never a swap**, and an old
  id leaves the list only when no subscription uses it. `STRIPE_PRICE_PRO_ANNUAL`
  is the standing yearly plan (`pro_annual`); `STRIPE_PRICE_PRO_ANNUAL_FOUNDING`
  is no longer SOLD (absent from `/api/checkout`'s `PLANS`) but stays set so
  founding members keep renewing. Unset `STRIPE_PRICE_PRO_ANNUAL` hides the
  yearly tile and band. The deploy ORDER for a price change is in
  PRO-BILLING-SETUP.md: the old code reads each variable as one id, so a list
  set before the new code is live breaks checkout and renewals.
- `STRIPE_PRICE_CHECK` — optional; `off` skips it. **At boot the server asks
  Stripe what each SOLD price charges** (`verifyStripePrices` in server.js,
  the pure comparison `priceMatches` in stripe.js) and compares it with
  `PRICING`. A confirmed mismatch (a readable amount or interval that does not
  agree) **pauses that plan's checkout** with a 503 `price_mismatch` and a ⛔
  boot line; anything unreadable (a tiered price, a failed read, a stub) is
  `unknown` and leaves checkout OPEN, because it is not evidence of a wrong
  charge. It exists because nothing tied the figure a visitor reads to the
  price id that bills them: deploy a price change before updating the env and
  the site says $49 while Stripe charges $100. With the check, that gap pauses
  instead of mischarging, in either deploy order. A failed read retries three
  times at growing intervals; a readable price never needs to, since Stripe
  prices are immutable. `test/price-check-run.test.js` runs it against a stub
  Stripe, and `test/checkout-run.test.js` waits for the check's reads before
  counting calls (they otherwise race the count under full-suite load).
- `FREE_REPORTS_PER_MONTH` — the **free report allowance** (2026-09-25),
  default **3**; `off` lifts it (the rollback lever); an unreadable value
  exits at boot. A signed-in FREE account runs that many distinct reports a
  month; Pro, a trial, admin, tester and a purchased report are unlimited, and
  an anonymous visitor stays the guest gate's business. Rules in
  `entitlements.js` (`reportsRemaining`, `reportCounted`, `canRunReport`).
  Counted PER REPORT PER MONTH exactly like downloads, in the SAME table
  (`export_usage`) under its own period key `reports-YYYY-MM`
  (`ENT.reportUsagePeriod`) — so no migration, and the export tally, which
  reads `period = YYYY-MM` exactly, can never count a report. One read serves
  both tallies (`getUsage`, an `in.` on the two periods). Four rules, all run
  in `test/report-limit-run.test.js`: the fourth distinct report is refused in
  `/api/comps` **before anything is searched** (403 `code: report_limit`,
  beside the guest gate); a **re-run of a report already counted this month is
  free**; a report is **spent only once it is served** (recorded after
  `gate()`, the guest gate's serialize-first rule); and a failed usage read
  **allows** the report (a cent lost beats a person refused). The count rides
  home on each served report as `reports_remaining`/`reports_cap` (read then
  deleted by index.html, the `exports_remaining` rule) and on `/api/config`,
  and the form states it BEFORE the first report (`#reportAllowanceHint`), so
  the refusal is never a surprise; the refusal opens the pricing window with
  the server's sentence (`openPricingFor`) rather than a red error card. The
  figure is stated on /pricing and /faq from `PRICING.freeReports` (the same
  setting), and typed into the pricing window's Free tile and compare row with
  a test pinning it to `ENT.FREE_REPORTS_PER_MONTH` — an override of the env
  leaves that static modal stating the default, which is the known cost.
### Admin access — comped Pro for the team

There is **no admin user** in this codebase: `ADMIN_KEY` is a shared secret
typed into `/admin`, `/dev` and `/contacts`, and `users` has no `is_admin`
column. So "is this an admin?" is answered by **possession of that key**, which
`isAdminRequest(req)` reads two ways:

1. the **`x-admin-key` header** — how machine callers have always identified
   themselves (`gen-market-seed.js`, the dashboards' own fetches); and
2. the **`cn_admin` cookie** — how a browser carries it. The dashboards keep the
   key in `sessionStorage`, which is scoped to **one tab**; `POST
   /api/admin-access` trades the key for this cookie, and all four dashboards
   (`/hq`, `/admin`, `/dev`, `/contacts`) plus `/admin/heroes` call it (`grantAdminAccess()`) the
   moment their own key check passes. Since 2026-08-04 **every dashboard
   endpoint accepts the cookie** (via `isAdminRequest`) as an alternative to
   the header, so a new tab within the 30-day cookie window opens unlocked
   without retyping the key — each page's loader silently tries a keyless
   fetch before showing the gate. In a cookie session `/hq`'s CSV links are
   plain hrefs (the cookie rides along); `?key=` survives on the CSV routes
   and `/api/stats`/`/api/admin/submissions` for machine callers only.

The cookie is **not the key**: it is `<expiry ms>.<HMAC-SHA256(expiry,
ADMIN_KEY)>`, httpOnly, 30 days. It cannot be turned back into the key, and
rotating `ADMIN_KEY` invalidates every cookie ever issued. `index.html` never
holds a secret to get Pro.

Four rules, all in `entitlements.js` and covered by `npm test`:

- **It requires a signed-in account.** A key identifies a machine, not a person,
  and the rule is that admins get Pro *when they sign in*. An anonymous request
  holding the key takes the ordinary free path.
- **It cannot switch a dark deployment on.** `getEntitlements` only takes the
  admin branch when `proEnabledFor(user)` is true, so `PRO_ENABLED=off` still
  means the pre-Pro app for everyone, staff included.
- **`status` is `"admin"`, never `"active"`.** The UI decides whether to offer
  the Stripe billing portal off `status !== "none"`; reporting a Stripe status
  would send a comped account to a portal that 400s. `/api/config` also carries
  `pro.admin` so the plan card can say "Pro — comped (team)".
- **It is NOT the `internal` bypass.** `/api/comps` has its own header-only
  `internal` check that skips comp gating, the lookback clamp and the daily
  search cap for the seed generator. That stays header-only on purpose — a
  cookie must never widen a bypass a browser was not meant to have.

`POST /api/admin-access {clear:true}` drops it again, which is what the "View as
a free user" button in the Settings panel's plan row does (it sat on the
workspace's plan card until that card went on 2026-09-03). Keep that button
working: the team is permanently on the far side of the paywall, so it is the
only way anyone internal ever renders one.

This is not the only comped-Pro door: `TESTER_PASSKEY` (above) comps Pro to a
signed-in account without any dashboard access, and stores the grant on the
user row rather than in a cookie. Admin wins outright and skips the billing
reads; a tester deliberately yields to a real subscription.

There is also one comped-VAULT door, **`users.vault_beta`** (migration 023,
2026-08-11) — the broker-onboarding grant. It exists because neither existing
door could ever be handed to a real broker: the tester passkey deliberately
excludes the vault, and `ADMIN_KEY` also unlocks the dashboards. Rules in
`entitlements.js`, covered by `npm test`, and deliberately narrow: it grants
the broker surfaces only (vault, lead inbox, blended comps —
`broker`/`canUseVault`), never Pro's report features; it cannot switch a dark
deployment on (`PRO_ENABLED` still wins); and unlike everything else
vault-shaped it does NOT ride the subscription lapse rules — the grant was
never billing, so only the one-row UPDATE revokes it, and a beta broker whose
trial subscription lapses keeps their book.

**Two ways to set it**, and the column is the same either way:

1. by hand, `update users set vault_beta = true where email = …` — still the
   right tool for one specific account, and the only tool for revoking; and
2. **`VAULT_PASSKEY`** (2026-08-13), a shared code the broker redeems
   themselves at `POST /api/redeem-passkey`. This is the one to reach for
   when access is being handed out in person: the SQL path made every
   onboarding wait on the owner opening the SQL editor later, which is the
   wrong shape for the channel the product actually grows through. See the
   `VAULT_PASSKEY` bullet under Configuration for why it is a separate secret
   from `TESTER_PASSKEY` and what changed about the redeem route's
   idempotency ordering to fit two codes on one input.

## Architecture

- `GET /api/config` — what the front-end needs before it can render:
  `{ authRequired, leadCapture, streetview, pro }`. The `pro` block carries
  this visitor's entitlements (`enabled`, `billing`, `isPro`, `plan`, `status`,
  `maxComps`, `maxLookbackMonths`, `exportsRemaining`, `graceUntil`) so locked
  states need no second round trip. **Presentation only** — every limit in it
  is enforced server-side, so editing the response unlocks nothing but the
  visitor's own greyed-out controls. `billing` is `PRO_ENABLED &&
  STRIPE_CONFIGURED`: the UI needs both, since checkout 503s without Stripe
  keys and a Buy button that can only fail is worse than no button.
- `GET /api/pricing` — what is on sale to this caller: `{ billing, annual }`.
  It carried the founding-member counter (a DB read, which is why it lived
  apart from `/api/config`) until 2026-09-25, when the founding offer stopped
  being SOLD and the standing yearly plan (`pro_annual`, $490) replaced it.
  Nothing here reads the database now; the pricing modal takes the same
  `annual` fact from `/api/config`. Founding members keep their plan and its
  label, and `/api/stats` still counts them.
- `POST /api/report-access` — "do I own this report yet?", answering
  `{ unlocked, pro }` for the `{ address, type, months }` in the body. Exists
  for the return from a $39 checkout: Stripe redirects the instant the card
  clears, routinely before the webhook writes the purchase row, so the client
  polls this instead of re-running the search and rendering a still-locked
  report at someone who just paid. Deliberately **not** folded into
  `/api/config`, which runs on every page load and would drag a purchase lookup
  along with it, and deliberately **POST** so the address never lands in a URL,
  a log, or a Referer header. Fails CLOSED — an error answers "not yet", which
  makes the client wait, where a false yes would render a locked report as paid.
- `GET /pricing` — the rate card, at a URL for the first time (2026-08-28).
  Body in **`pricing-page.js`**. Pricing had lived ONLY in index.html's modal,
  which cannot be linked, indexed or emailed — and that modal carried Free /
  Pro / Founding and **no firm tier**, while the /how-it-works FAQ had been
  quoting the seat price in prose for weeks. The figures come from one
  **`PRICING`** constant in server.js (`monthly`, `annual`, `firmSeat`,
  `minSeats` = `ORG.MIN_SEATS`; $49 / $490 / $39 since 2026-09-25, $100 /
  $840 founding / $79 before) which the FAQ answer also reads, and
  `test/pricing-page.test.js` pins index.html's modal to the same numbers —
  that modal's own comment conceded "nothing catches a drift", which was true
  of a figure typed into three files. **The page never buys anything**: every
  control hands off to `/?pricing=1` or signup, because checkout needs the
  session, the entitlements and — for a firm — an orgId and an ownership check
  a cached page cannot make. The Firm tile's CTA is "how a firm works" for the
  same reason: a firm subscription is bought by an owner for a firm that
  already exists.
- **The trial emails** (2026-09-25; migration `053-trial-notices.sql`; rules
  in the pure, tested **`trial-notices.js`**). `POST /api/trial/notices` mails
  each account on a Pro trial the one email it is due: "You have CompNinja Pro
  until <date>" once, and "Your CompNinja Pro trial ends on <date>" once, three
  days out (`ENDING_WINDOW_DAYS`). **The watchlist digest's design rule for
  rule**, because it is the same kind of mail: ADMIN_KEY-gated and driven from
  OUTSIDE by `.github/workflows/trial-notices.yml` (daily 16:00 UTC, needs the
  `ADMIN_KEY` repository secret the permit sweep already uses); refuses
  without a database and without outbound mail (`sendOutboundEmail` no-ops
  silently, and marking the ledger over a send that never happened would lose
  the email for good); `{ dryRun: true }` builds and sends nothing; marks the
  ledger AFTER the send; one bad account never stops the run; and an account
  with `digest_optout` gets none. Who is on a trial is `getEntitlements`'s
  answer, never a date guess here, so a subscriber or a firm seat is never
  mailed about a trial. When both are due at once, only the ENDING email goes.
  Every figure (price, free allowance, end date) is passed in from `PRICING`
  and the trial settings, never typed. `trial_notices` keys on
  `(user_id, kind)` and ONLY this route names it, so 053 can run after the
  deploy: until it does, the route 500s naming the table and the workflow goes
  red. `test/trial-notices.test.js` and `test/trial-notices-run.test.js`
  (who is mailed, once, the dry run, the refusals, a launch date reaching old
  accounts).
- `POST /api/redeem-passkey` — redeems `TESTER_PASSKEY` (comped Pro) or
  `VAULT_PASSKEY` (the broker vault) for the signed-in caller's account, on
  one route and one input: 401 if not signed in, rate-limited per IP, and the
  response's `granted` array names which door opened. 404s only when NEITHER
  passkey is configured. See both env bullets above for what each grant covers
  and why they are separate secrets.
- **Pro tier** (added 2026-07-31; launched to the public 2026-08-03). **Priced
  $49 a month, $490 a year, $39 a firm seat since 2026-09-25**, and every
  account starts on a 14-day Pro trial — see `PRO_TRIAL_DAYS` and
  `STRIPE_PRICE_*` under Configuration, and PRO-BILLING-SETUP.md for the
  runbook. Paid plan
  holding free reports to a **36-month** lookback ceiling, **3 reports a month**
  (since 2026-09-25, `FREE_REPORTS_PER_MONTH`) and
  **5 exports/month** (0 for anonymous visitors — exporting requires an
  account), against Pro's unlimited everything plus report branding.
  **The comp-list gate is GONE as of 2026-08-21**: `FREE_MAX_COMPS` is
  `"all"`, so a free account itemizes every comparable the search found,
  addresses and sources included. It went because the headline value range was
  already computed from the FULL comp set (comp-gate.js's `locked_basis`), so
  the gate was withholding the evidence for a number it had already published —
  and because the same "a crippled free report is not a demo of the paid one"
  argument had already widened the lookback. `gateReport()` is NOT dead code:
  it still caps whenever `maxComps` is a number, this tier just stops
  supplying one, and `test/comp-gate.test.js` keeps exercising the cap through
  an explicit `cappedEnt` so the machinery stays covered. **The consequence this had for the $20 single-report unlock resolved the same
  day**: with nothing locked its tile almost never surfaced, and the owner
  retired the sale outright (2026-08-21, see the single-report section below);
  purchases already made are honored forever.
  The free lookback was **12 months until 2026-08-04**. It was widened because
  at 12 months the free report often could not compute a valuation at all (the
  hero needs two priced sale comps and dense markets returned one), and because
  a window that short usually returned ≤4 comps, so the then-4-comp gate
  withheld nothing and the $39 tile never appeared. Not widened further: the window is
  clamped BEFORE the search and the model is asked for up to 12 comps
  regardless of plan, so a longer free window grows output — the cost and
  wall-clock driver — on the majority of traffic. The numbers live in
  `entitlements.js`; the pricing modal and both plan-card strings hard-code
  them in prose and must be edited together. The desk split belongs with
  those numbers: Free My Desk is an address list (cap 100), Pro is the book
  of values (cap 500), and the pricing compare table's Portfolio row restates
  it.
  **Bulk valuation** is Pro-only as well (`canBulkValue` / `bulkMaxAddresses`)
  — see its own section below.
  The **Address Explorer** is Pro-only too (`canExploreAddresses`) — see the
  amendment in its spec for why that gate needs a browser half AND a server
  half, and for the `proConfig` temporal-dead-zone trap that shapes the
  front-end code.
  **`entitlements.js`** holds the rules and is deliberately **pure** — no I/O,
  no clock reads (the caller passes `now`), no requires — which is what makes
  `npm test` able to exercise the whole decision table with no database.
  server.js owns the reads (`findSubscription`, `findReportPurchase`,
  `getExportUsage`, `findBrandingProfile`) and exposes the **only** sanctioned
  entry points: `getEntitlements(user, reportId)` and the request-shaped
  `entitlementsFor(req, reportId)`. **Never test a plan or subscription status
  anywhere else** — scattered plan checks are how a paywall grows holes.
  Everything **fails closed**: an unknown Stripe status, an unparseable
  period end, or a failed DB read resolves to the free tier, never to Pro.
  Two deliberate softenings of that, both tested: a **24h renewal slack** past
  `current_period_end` (Stripe renews at the boundary and the webhook lands
  seconds later — without slack a paying subscriber flickers to free), and a
  60s subscription cache that serves its last known answer if a DB read
  fails.
  **Comp gating** lives in **`comp-gate.js`** (also pure, also tested).
  `gateReport()` is applied at **serialization time only** — `/api/comps`
  gates at all three exits (cache hit, SSE `result`, plain JSON) while the
  cache, `harvestComps()`, and `maybePublishMarketSnapshot()` keep seeing
  **whole** reports, so one cached search serves free and Pro alike and the
  corpus never starves on free traffic. Selection is sales-before-leases
  (on a sales or mixed search the hero's range is sales-only, so a free list
  of leases would not support the number above it; a leases-only search
  headlines the rent range instead — see 3f) then best-first by a weight that **mirrors
  index.html's `compWeight()`** — a deliberate second copy that must stay in
  sync; there is a `⚠` comment on both.
  **`locked_basis`** is the load-bearing idea: one anonymized row per
  withheld comp carrying `date`/`transaction`/`size_sqft`/`price_per_sqft`/
  `source_type` (+`verified`, +`price_per_unit`/`price_per_acre`) and
  **nothing identifying**. Client-side `valuationComps()` =
  `includedComps()` + `lockedBasis()`, so the hero, the market comparison,
  the chart median and the stat tiles all read the FULL set — a free
  report's value range is identical to a Pro one (verified: the same report
  gated and ungated both produce $6,206,732–$6,529,080 from 14 sale comps).
  Basis rows must never reach the table, map, exports, or curation — they
  have no identity to render.
  Locked table rows are **redacted placeholders, not blurred real data**: a
  CSS blur would leave the values in the DOM, and the whole point is that
  the server never sent them.
  Two side doors are closed to match: `/api/corpus-comps` and
  `/api/watchlist/feed` return a `locked_count` instead of rows for free
  users (the feed keeps its aggregates — `new_count`, `median_psf`, trend —
  which are market figures, not comp data). `gen-market-seed.js` sends
  `x-admin-key` to bypass the gate and **throws if it gets a gated report
  back**, rather than silently seeding 4-comp market pages.
  **Billing (phases 3-7, done).** Stripe is spoken to over its REST API with
  plain fetch (`stripe.js`) — still zero npm deps. Server: `POST /api/checkout`,
  `POST /api/billing-portal`, `POST /api/stripe/webhook` (raw body, signature
  verified, acknowledged before the work), `handleStripeEvent()` for all six
  events with idempotent upserts, and `GET /api/pricing` (the founding counter,
  memoized 60s). Checkout, the portal and pricing all go dark while
  `PRO_ENABLED` is unset or the caller is outside `PRO_AUDIENCE`; **the webhook
  does not** — it carries no `PRO_ENABLED` check at all, because its gate is
  the Stripe signature and it must keep recording events regardless.
  Front-end, all in `index.html`: **one** pricing modal (`#pricingModal`), and
  every locked surface reaches it through the `.unlock-comps-btn` class →
  `openUpgradePrompt()`. Do not add a second upgrade prompt — give a new locked
  surface that class instead. `refreshBillingUI()` is the single owner of every
  billing control's visibility, driven entirely by `/api/config`; because
  entitlements are per-user, sign-in, sign-out, account deletion and the
  checkout return all call `refreshProConfig()` to re-read it. Checkout returns
  land on `/desk?checkout=success|cancelled` and the success banner **polls for
  the webhook** rather than assuming Pro is live, because Stripe redirects
  before the webhook arrives.
  **The `.pricing-buy` `data-plan` values must stay in step with the `PLANS`
  table in `/api/checkout`**, which is an explicit map with **no fallthrough** —
  an unrecognized plan is a 400. It used to map everything that wasn't the
  founding plan onto monthly, which is why a $39 button was unsafe to add;
  restoring any such default would re-arm exactly that mischarge.
  **The single-report unlock — RETIRED 2026-08-21** (shipped 2026-08-03 at
  $39, $20 from 2026-08-04). The one-off that bought every property-scoped Pro
  capability for one address + type. Retired by the owner the day
  `FREE_MAX_COMPS` went to `"all"`: with nothing locked inside the free
  window it was left selling only the ten-year window, and its tile — keyed on
  `lockedCount() > 0` — almost never surfaced. `single_report` is deleted
  from `/api/checkout`'s `PLANS` map, so buying it answers the same 400 as
  any unknown plan (the map's no-fallthrough design is what makes retirement
  one deletion, pinned by a source scan in `test/routes.test.js`), and
  `STRIPE_PRICE_SINGLE_REPORT` can be unset in Render and the price archived
  in Stripe. **Everything else stays, because purchases already made are
  honored FOREVER** — the unlock was sold as permanent for its address + type:
  - the `checkout.session.completed` and refund webhook branches still write
    and revoke `report_purchases` rows (an in-flight checkout can complete
    after the deploy, and a refund on an old purchase must still land);
  - `computeEntitlements` still grants per-property Pro (`reportUnlocked`:
    `maxComps: "all"`, `PRO_MAX_LOOKBACK_MONTHS`, unlimited exports,
    `canBrand`) when a purchase row matches;
  - `POST /api/report-access` still answers "do I own this report yet?", and
    `handlePurchaseReturn()` in index.html still handles a `?purchase=`
    return — with no seller writing `pendingUnlock.v1` these go quiet on
    their own, which is the point: the honoring side needs no trigger to
    remain correct;
  - `reportIdFor()` still **mirrors `exportReportKey()` byte for byte**
    (⚠ comment on both) — the purchase key and the export-tally key stay the
    same string, so an old buyer's report still never burns a free export;
  - `report_purchases.comp_snapshot` stays nullable and never written.
  Reselling a one-off later is an owner decision, not a merge accident: the
  source scan fails the build if `single_report` reappears in `PLANS`, so
  re-adding it means deleting that test deliberately. If it comes back,
  re-read this section first — the tile trigger (`lockedCount`), the
  `/?purchase` return path, and the id-excludes-lookback rule were each
  earned by a real mistake.
  **Report branding** (shipped 2026-08-08). `GET|PUT|DELETE /api/branding`
  lets a signed-in member save one profile (firm name, preparer, phone,
  email, license number, a short disclaimer, and a logo stored inline as a
  data URI — never a URL, because a cross-origin image taints the
  html2canvas canvas and silently breaks PNG export). Rules live in the
  pure, tested **`branding.js`**: `validateForSave` rejects an
  over-length field or a non-image logo rather than truncating it, and
  `brandForRender` decides what a given render is allowed to show. The mark
  appears everywhere a report does once entitled — the on-screen letterhead,
  the print footer, the PNG export, and the CSV, XLSX and PPTX exports — and
  the license number renders on all of those, not just the desk preview.
  **Co-branded, never white-label**: the surfaces (not `branding.js`) always
  add the CompNinja attribution and the automated-estimate line, on top of
  whatever the member's profile supplies; the owner is not a licensed
  broker, so a report carrying only a brokerage's mark would read as that
  brokerage's own appraisal. `/api/comps` carries `branding_allowed`
  (`ent.canBrand === true`) on every served report, computed per-report like
  `exports_remaining` — an existing $20 single-report buyer's `canBrand` is
  scoped to the property they bought (the sale is retired; the grants are
  not), not a live Pro subscription, so this cannot be folded into
  `/api/config`.
  **One profile, reused everywhere (2026-09-02).** The product asked for the
  same facts in five places — this card, the firm's branding, the vault's
  credit identity, the account, the comp-submission modal — and none read
  another. Now `GET /api/branding` also carries `suggested`
  (`BRANDING.suggestBrand`, pure: the vault's `broker_profiles` company,
  name and license first, then the member's oldest active firm's `orgs.name`,
  then the account's name and email; never `org_branding`, which already
  applies at render time and would freeze as a copy), and `fillBrandForm`
  pours it into EMPTY fields only, with `#brandSeedNote` saying where it
  came from and that it prints. The reverse door: `vaultReadPayload` sends
  `identitySuggest` from the member's saved branding ONLY while no credit is
  stated, and the identity form fills from it; the submission modal takes
  firm and phone from the saved branding; the create-a-firm box takes the
  firm name. **Every one of these is a prefill the member reads and saves,
  never a write** — that is what keeps the vault's "stated, never inherited"
  rule (`creditName`'s comment: a copied signup name was once published as
  somebody's firm) while the facts stop being retyped. Two honesty rules,
  test-pinned: the summary line reads "suggested, not saved yet" while the
  form holds a seed and no profile exists, and a delete blanks the form
  rather than re-seeding it.
  **A logo can be read off the firm's website (2026-09-02).** `POST
  /api/branding/logo-from-site { url }` fetches the page, picks its declared
  icon and answers a data URI; the branding card's "Import logo from website"
  control runs it through `resizeLogoDataUri` — the ONE resizer, which the
  chosen-file door now also calls — into the preview, kept only on Save.
  Rules in the pure `logo-import.js` (`test/logo-import.test.js`): the
  address must be public (localhost, IP literals, single-label hosts and
  embedded credentials are refused before any DNS); candidates are
  apple-touch-icon, then icons at least 64px, then the undeclared
  `/apple-touch-icon.png`, then og:image (measured on github.com: its declared
  icons are too small and its og:image is a homepage banner), then tiny
  icons, six at most, and
  `.ico`/`.svg`/`.gif` hrefs are never fetched; the BYTES decide, sniffed
  by account-avatar.js's `sniffImage`, a PNG narrower than 48px refused as a
  favicon, a PNG more than three times wider than tall refused as a banner,
  anything over 2MB skipped. server.js owns the fetch and it is the
  source-link check's discipline: every host resolved with
  `lookupWithTimeout` and refused on a private answer (`privateAddress`),
  redirects followed BY HAND with that guard re-run per hop, every body read
  under a byte cap (`readCapped`), a 6s timeout, our own UA. The site is
  fetched by our server only — no third-party logo service sees a firm's
  domain. `test/logo-import-run.test.js` runs it against a stub site
  (touch icon found; `.ico`-only and over-cap sites 404 naming the fix;
  redirect followed; unreachable 502; and, WITHOUT the test-only
  `LOGO_IMPORT_ALLOW_PRIVATE`, a loopback address refused before any fetch).
  **The firm fallback (2026-08-29; migration 041, `org_branding`).** A firm's
  owner/admin saves one profile for the org (`GET|PUT|DELETE
  /api/org/branding`, write gated on `ORG.canManageMembers`, validation
  shared with the personal editor), and a member's render falls back to it
  ONLY when their own profile normalizes to nothing — `brandForRender`'s
  `firmProfile` argument owns that ordering, own-always-wins, and
  `canBrand` still gates applying, so a free colleague stays unbranded.
  Oldest active membership wins if anyone is ever in two firms. The read is
  `findOrgBrandingFor` in server.js, deliberately fail-open (a failed org
  read must never cost a member their own letterhead or fail a share) and a
  SEPARATE table read by a separate function, never columns on `orgs` —
  `orgsByIds`/`findOrg` name their SELECT columns, the 030/036 hazard. It
  rides `GET /api/branding` as `firm` and the share snapshot inherits it
  (auto-share included). **The editor lives in the account menu's Firm &
  branding panel since 2026-09-03** (owner's call; it was the last card of
  a workspace "Account" deck whose other card, the plan card, duplicated the
  Settings row — both went, and the workspace is work only). ONE form, the
  mine/firm scope row for an owner/admin, shown in every firm state so a
  solo member edits their personal letterhead in the same place; the panel
  was renamed from "Firm account" for exactly that member. `#deskBranding`
  keeps its id (`loadBranding` reads it), and `loadBranding()` still runs
  at sign-in and in `renderDeskRest`, never on panel open — reports print
  `currentBranding` whether or not the panel was ever opened. Escape closes
  the panel (`MODAL_CANCELS` and both Escape guards name `firmModal`).
  Two rules a future editor will otherwise break:
  - **A shared report renders the sender's snapshot and never the viewer's
    own profile.** `POST /api/share` looks up the sender's saved profile at
    share time (only when `user && ent.canBrand`) and writes it into
    `meta.branding` as a point-in-time snapshot, not a pointer — the report
    should look the way it looked when it was sent, and a share outlives its
    owner's subscription and even their account. `brandForRender`'s
    `isShared` branch returns `normalizeBrand(sharedBranding)`
    unconditionally and never falls through to the viewer's own profile: a
    Pro member opening a report their broker sent them must not see their
    own logo on someone else's work. `index.html`'s `normalizeBrandBlock()`
    is a deliberately narrower mirror of `branding.js`'s `normalizeBrand()`
    (camelCase/`logo` only) and must stay in step with it.
  - **Saving a profile is not the entitlement, applying it is.** `PUT
    /api/branding` is deliberately NOT gated on `canBrand` — any signed-in
    member can save one, because an unsaved-but-inert profile costs nothing
    (`brandForRender` returns null without the entitlement). The gate is on
    APPLYING a profile to a report, checked server-side at serialization
    (`/api/comps`'s `branding_allowed`) and again at share time (`POST
    /api/share`'s `ent.canBrand` check before the snapshot). This is what
    keeps the retired $20 unlock's branding promise fulfillable for the
    people who bought one: the
    entitlement it grants is scoped to one address+type, so a buyer with no
    Pro subscription can still save a profile in advance and have it apply
    the moment they unlock a report, without the editor itself needing to
    know which case it is.

# Divide and conquer: the six blocks, two builders and a consultant, by August 27

**Date:** 2026-08-21 (Thursday). Six working days to Wednesday the 27th.
**People:** Jacob (owner — Render, Supabase SQL editor, DNS, Stripe, Google
Cloud, the Resend account), Owen (developer), and Chuck (consultant — no code;
his asks are in §4b).
**Split, as agreed:** Jacob takes four building blocks — **1 Archive,
3 Production, 5 Attribution & Accuracy, 6 Market Data Fill**. Owen takes two —
**2 Organization, 4 Delivery** — which is where his three tenant items and all
the firm-facing work live.

Blocks are the map; **features are the work units**. Each feature below names
its block, its owner, an estimate, and a "done when" so the 27th is a checklist
rather than a feeling.

---

## 1. What the 27th looks like if this plan holds

One demo, run start to finish on production:

1. A brokerage firm signs up, creates a firm, invites two employees, both
   accept. *(already shipped — migrations 030–033)*
2. Each employee shares reports and vault comps with the firm; the shelf
   answers "has anybody here valued this building." *(already shipped)*
3. The firm's **deal board** shows who shared what, by market and month, with
   a simple most-active leaderboard. *(Owen, new)*
4. A "Leases only" report headlines **rent per square foot**, not a sale
   range. *(Owen, new — fixes a production hole that exists today)*
5. A tenant-rep firm picks its own org type and is described in its own
   vocabulary. *(Owen — built, needs review + migration)*
6. A lease's expiry and notice deadline are stored, and the **renewal watch**
   emails ahead of the deadline with what comparable space rents for.
   *(Owen, new — the one feature that brings people back yearly)*
7. A broker opens a **hub** with a tenant, trades comps and messages.
   *(already LIVE, never driven by two people — QA it together, day 5)*
8. A report search consults the broker's **own vault before the public corpus
   before the web**, and is measurably cheaper when the vault has content.
   *(Jacob, new — the plan's §4.3 inversion)*
9. The **extraction verdict** exists: 20 real PDFs, scored, pass or fail
   declared in writing. *(Jacob, day 1–2 — gates the whole Archive block)*
10. **Firm seats are buyable** — `STRIPE_PRICE_FIRM_MONTHLY` set, the plan
    card renders. *(Jacob, ~1 hour — the code shipped in 033; the env var is
    the launch)*
11. A dev shop's **project dashboard v1**: costs, NOI, cap rate, DCF on the
    owner's own saved properties, CompNinja-branded. *(Jacob, stretch)*

## 2. Read this before writing anything: the wishlist is mostly built

The biggest risk this week is not speed — it is **building a second copy of
something that already shipped**. The wishlist, mapped:

| Wishlist item | Already exists | The actual gap |
|---|---|---|
| Firm adds employees | Org invites, accepts, seats, roles, removal (030–033); invite-is-not-membership rule | Nothing. Demo it. |
| See who's closing what | Org shelf (`shared_reports` with `visibility='org'`), firm-shared vault comps (`org_comps`, 032), each attributed with `shared_by` | A **view** over data already attributed — the deal board. No new tables. |
| Message employees | The **messaging hub is LIVE** (024; routes wired 2026-08-16): hubs, items with statuses, messages, participants | Hub is broker↔tenant per requirement, not intra-firm chat. See the cut list — drive the hub end-to-end first. |
| Share and analyze data | Shelf, firm shares, anonymized valuation basis, shared vault | Nothing structural. The deal board IS the analysis v1. |
| Best-performing employee | `broker_bovs` has won/lost and a win rate (`bov-log.js`) — but it is **vault-class private, per user, by design** | A leaderboard may count only what members **share to the firm**. See §5 — this is a privacy-wall decision, not a query. |
| Tenant list with emails | Hub participants already hold tenant emails per hub; lead anonymization rules exist | A firm-scoped contacts table, manual add + CSV import. Small, but see §5's consent rule. |
| Custom spreadsheets "like Excel" | The vault IS a spreadsheet (typed-into cells, Tab/Enter/Esc, spreadsheet mode); CSV/XLSX export everywhere | A formula engine is a product, not a feature. **Cut for this week** — §6. |
| Dev-shop dashboard (costs/NOI/cap/IRR) | NOI, cap rate, DCF, debt & refi, op-ex all computed client-side today; portfolio stores `meta.assumptions` per property | A deck that reads them across properties. **IRR needs cost inputs that do not exist yet.** v1 is single-user; firm-wide hits the §5 consent rule. |
| Tenant org type, lease report, renewal watch | Owen's three, already scoped | His week's core. |

## 3. Jacob's week (blocks 1, 3, 5, 6)

Jacob's list is deliberately front-loaded with the things **only the owner can
do** — accounts, DNS, Stripe, counsel, real PDFs — because every one of them
has latency, and two of them gate Owen.

### Day 1 (Friday 22) — the unblocking day. Do these in order.

- **C1 · Verify a Resend sending domain and set `EMAIL_FROM`** *(~1h + DNS
  propagation; blocks 4 and 5).* This single env change arms four dormant
  features at once: hub email invitations (written and waiting, per the hub
  spec's §11), the renewal watch's whole delivery channel (Owen, day 3–4),
  password-reset mail to real users, and the BOV lead follow-ups. **Owen's
  renewal watch cannot be demoed without it.** Start DNS first thing; verify
  by tailing for the absence of `Outbound email skipped`.
- **C2 · Send counsel the data-rights question** *(15 min to send; §9.1 of the
  transition plan; blocks 1).* The cleared paragraph is needed before the
  free audit — which is before email ingestion ships. Latency-bound, so it
  goes out day 1 even though nothing this week depends on the answer.
- **C3 · The extraction test** *(block 1's gate; the rest of day 1 + day 2).*
  Gather the 20 real comp PDFs (different brokerages; include 5 body-text-only
  emails per the spec's open question 3). Claude builds the scoring harness —
  recall, per-field precision, fabrication rate against a ground-truth file,
  in the `run-eval.js`/`eval-score.js` pattern; **the stopwatch half is
  Jacob's**: a real person correcting a 10-comp file, timed. Deliverable: the
  numbers and a written pass/fail in `docs/evals/`. Pass condition is already
  fixed in the archive spec §9 so it cannot be moved after the numbers arrive.
- **C4 · Launch firm seats** *(block 5's pricing step; ~1h).* Create the
  per-seat price in Stripe, set `STRIPE_PRICE_FIRM_MONTHLY` on Render. The
  $39 retirement — the other half of the transition plan's pricing step —
  shipped 2026-08-21, so this env var is all that is left of "new pricing
  live." Done when: the firm plan card renders a working Buy for an org
  owner, and a test checkout writes an `org_subscriptions` row.

### Days 2–4 — archive-first retrieval (blocks 6 + 1 bridged)

- **C5 · Vault → corpus → web** *(2–2.5 days, tests first).* The transition
  plan's §4.3 inversion, and the highest-leverage engineering item of the
  week: extend `corpusIsStrong()` / `searchBudgetFor()` so a strong hit in
  the broker's OWN vault cuts the web budget the way corpus strength already
  does. Constraints, restated from the plan and the codebase:
  - **Blending stays at serialization only.** The retrieval read is a
    *budget* input; comps still join the report inside `gate()`, downstream
    of the cache write and the harvest, or one broker's book is served to the
    next visitor or written permanently into the public corpus.
  - The search budget and the analytics tag read the **same threshold** —
    one function, the `corpusIsStrong` precedent.
  - The floor stays 2–3, never 0.
  - The vault read is `user_id`-scoped (`vaultCompsForReport` already takes a
    `user`) and its coverage count must never move `corpusIsStrong` for
    anyone else.
  Done when: an A/B on a vault-seeded account shows a smaller `max_uses` in
  the `Anthropic call` log line and an identical valuation, and
  `test/routes.test.js` pins the serialization ordering by name.

### Days 4–6 — production surfaces (block 3)

- **C6 · Dev-shop project dashboard v1** *(1.5–2 days; stretch — cut first
  if C5 runs long).* A branded deck reading what the portfolio already
  stores per property: NOI, cap rate, the DCF's four assumptions, debt terms,
  op-ex. **Single-user only this week** — a firm-wide financials dashboard
  requires the explicit consent surface in §5, because `meta.assumptions`
  are exactly the private finances every share path strips today. IRR
  proper needs cost/draw inputs that do not exist; v1 shows the DCF the app
  already computes and labels it as such. Before/after screenshots per the
  standing rule.
- **C7 · Email ingestion plumbing, flag-off** *(only if C3 passed and time
  remains; otherwise nothing).* `svix-verify.js` + the webhook route
  answering 200-and-discard, behind an unset env var, per PR #152's spec.
  **Not the extraction leg, not DNS MX, not the pending inbox** — those wait
  on counsel and on the verified webhook payload question. Shipping zero of
  C7 this week is fine; shipping a half-verified sender rule is not.

## 4. Owen's week (blocks 2 and 4)

### Days 1–2

- **O1 · Tenant rep shop type** *(~1h; built — review + hand Jacob the
  migration).* Third org type beside broker shop and development shop.
  Migration file goes to Jacob to run **before** the deploy (018/030's
  ordering rule — if any read selects the new column by name, deploy-first
  breaks existing reads).
- **O2 · Lease report headlines rent** *(~0.5 day).* "Leases only" reports
  stop headlining a sale range; `rentFromComps` in `market-snapshot.js`
  already does the math and is tested — wire it into the report hero path.
  Fixes a live production hole regardless of everything else. Done when: a
  leases-only report's hero quotes $/SF/yr (or /mo where the market quotes
  monthly — the vault's `rent_basis` lesson), and a mixed or sales report is
  byte-identical to before.
- **O3 · Deal board** *(~1 day).* One view on the firm page: everything
  shared to the firm — shelf reports + `org_comps` — grouped by member, by
  market, by month. Every row is already attributed (`shared_by`, `firm`);
  this is presentation over existing reads, **no new tables and no widened
  `user_id=eq.` read** (the org test suite fails the build on that pattern).
  The "leaderboard" v1 is the same data sorted: most shared to the firm this
  month/quarter. Honest labeling: it counts *contribution to the firm*, not
  closings — see §5 for why that is the only number available, and why that
  is actually the right incentive.

### Days 3–5

- **O4 · Renewal watch** *(2–3 days; the week's biggest single feature).*
  Store a lease's expiry date and option-notice deadline; email ahead of the
  deadline with what comparable space is renting for. Owen's scoping is
  right and three repo rules make it safe:
  - **It rides the watchlist digest**, not a second mailer — same
    high-water-mark discipline, same "when in doubt, send nothing" bar,
    same ADMIN_KEY-triggered manual send with a Preview. The digest is the
    only self-initiated email this product sends, and this becomes the
    second; it must inherit that file's rules, not fork them.
  - Copy and the "is this worth sending?" rule live in a **pure module**
    (`watchlist-digest.js`'s shape: build returns null when there is
    nothing to say), so `npm test` covers every judgment.
  - **Gated on C1.** If the Resend domain is not verified, the send path is
    a silent no-op and the digest's own rule applies: refuse (503), never
    advance a marker for mail nobody received.
  Migration (lease fields) goes to Jacob to run before deploy. Done when: a
  seeded lease 60 days from notice produces a Preview email quoting the
  market's current rent figures, and a second run sends nothing.
- **O5 · Tenant contacts v1** *(~0.5–1 day; after O4, cut second if O4 runs
  long).* A firm-scoped contacts table: name, email, company, notes; manual
  add + CSV import through the vault's own `parseCsv`. **Never
  auto-populated from CompNinja leads** — lead routing is owner-mediated and
  anonymized by standing rule, and a firm's own tenant list must be data the
  firm typed or imported, not data our funnel collected. Linking a contact
  to a hub is a nicety, not this week.

### Day 5–6, together

- **O6 + C: drive the messaging hub end to end as two people** *(half a
  day).* The hub spec's own status block says nobody ever has: production
  holds one hub, one comp still at `new`, zero messages, and the tenant
  write half has never been used by a person. Jacob plays the tenant, Owen
  the broker: open a hub, invite by email (now armed by C1), trade comps,
  message both ways, close it. File and fix what breaks. This is the
  cheapest possible version of "message people through CompNinja" — proving
  the messaging that exists before building messaging that does not.


## 4b. Chuck's asks (consultant — no code)

Chuck's role this week is the work the transition plan itself put in his
column, none of which is engineering:

- **Source the 20 comp PDFs for the extraction test (feeds C3, needed Friday
  morning).** Different brokerages, real files, the messier the better — his
  network is exactly where they live, and the same twenty files open the
  free-audit conversations later. Jacob supplies the 5 body-text-only emails.
- **Drive the counsel conversation (C2).** Jacob sends the intro day 1 to
  start the clock; Chuck owns the follow-up and brings back the cleared
  data-rights paragraph. It gates the free audit, not this week's code.
- **Sanity-check the firm seat price before C4 sets it in Stripe.** Pricing
  is Chuck's open question on the roadmap; the transition plan proposes
  ~$79/seat with a 5-seat minimum. Fifteen minutes on the phone beats
  archiving a wrong price in Stripe next week.
- **Review the extraction verdict and the free-audit pitch** once C3's
  numbers exist — the audit is his channel argument, so he should see the
  evidence before anyone pitches with it.

## 5. Two privacy-wall decisions this plan forces — settle them Friday, together

These are the only two places the wishlist collides with rules the codebase
enforces on purpose. Fifteen minutes each, decided out loud, before either
person builds the surface.

1. **The leaderboard can only count shared work.** A member's vault and BOV
   log (won/lost, win rate) are private to the *user*, not the firm — separate
   tables, user-scoped reads, the wall the whole broker product rests on. So
   "who is closing what" has exactly one honest v1: what members **choose to
   share to the firm**, which the auto-share setting (031) already makes
   nearly frictionless, veto included. If the firm wants real closing stats
   later, that is a per-member opt-in ("share my win/loss counts with my
   firm"), nullable three-state like `auto_share`, disclosed before accept —
   a 032-shaped feature for a later week. **Do not** widen a `user_id=eq.`
   read to get a better number; the test suite will catch it, and it would be
   the leak the vault promises cannot happen.
2. **A firm financials dashboard needs consent that does not exist yet.**
   NOI, debt, rent roll and gross income are stripped from every share today;
   the one exception is the owner's own portfolio row. A dashboard that shows
   a firm its members' NOI is a *new consent surface* — per-report, default
   off, disclosed like auto-share. That is why C6 is single-user this week.

## 6. Cut list — said now, out loud, so the 27th is not a negotiation

- **Formula-engine spreadsheets.** A calculation engine with cell references
  is a multi-month product. This week's honest substitutes: the vault's
  typed-into table, XLSX/CSV export everywhere, and (later) saved views. If
  custom grids stay a priority, spec it as its own document in September.
- **Intra-firm chat.** The hub is broker↔tenant per requirement. Firm-internal
  messaging is real but is not six-days-real alongside everything above; O6
  proves the messaging machinery first and tells us what a firm thread
  actually needs.
- **IRR on development costs.** Needs a cost/draw schedule the product has no
  inputs for. The dashboard v1 ships the DCF that already exists, labeled as
  what it is.
- **Email ingestion end-to-end.** Gated on the extraction test (C3), counsel
  (C2), and the unverified Resend webhook payload. C7 ships plumbing at most,
  dark. The forwarding address demo is a September milestone, honestly.
- **Enterprise anything.** The transition plan's own target is 5–40-person
  independent shops; nothing this week aims above that.

## 7. Working agreements for a two-person week

- **Worktrees, always.** `node scripts/worktree.js <name>` — this checkout
  has already filed one person's work under the other's branch once
  (2026-08-20). `git log origin/main..HEAD` before every push.
- **Migration numbers are assigned here, now:** Owen takes **037–039**
  (tenant rep type, renewal-watch lease fields, contacts). Jacob takes
  **040+** (archive tables, when they unlock). Both people renumbering at
  merge time is how 036 got renumbered; assigned ranges make it not happen.
- **Jacob runs all SQL** in the Supabase editor and logs each in
  `migrations/APPLIED.md` with the verification query — the existing
  convention. **Migrate before deploy** for any column a read selects by
  name (018's rule; it has bitten twice).
- **Small PRs, CI green, `npm test` locally before push.** A red X means fix
  or revert now; no result is not green (the 2026-08-06 Actions incident).
- **Before/after screenshots** (`node scripts/shot.js`) on anything visual —
  the deal board, the lease hero, the dashboard. Standing rule.
- **Devlog entry per shipped feature**, same commit, clean UTF-8.
- **Fifteen minutes daily**, same time: yesterday, today, blocked-on. The
  only standing agenda item: is anything on the cut list trying to crawl
  back in?

## 8. Risks, and what each one costs

| Risk | Likelihood | If it bites |
|---|---|---|
| Extraction test **fails** (fabrication or correction time) | Real — it is why the gate exists | C7 dies, C5 survives untouched (it reads validated vault rows, not extractions). The week's story becomes organization + retrieval, which still demos. The transition plan's own words: then "CompNinja stays a report business" until extraction improves. |
| Resend DNS verification drags | Low, but DNS | O4 builds against Preview/dry-run (the digest pattern makes that first-class); the live send demo slips days, not the feature. |
| C5 overruns | Medium — it touches the search pipeline | Cut C6 first, C7 second. C5 itself does not slip past the 27th; it is the week's one must-ship engineering item. |
| Counsel is slow | Certain, effectively | Costs nothing this week (nothing shipping depends on the answer); it gates the *free audit*, so it was sent day 1 to start the clock. |
| Two-person merge collisions | Medium | Worktrees + assigned migration numbers + the daily sync naming files each person is inside. |

## 9. After the 27th (so this week's cuts have a home)

September's queue, in the order the transition plan's own sequence implies:
the free-audit motion (opened by C3's twenty PDFs), email ingestion proper
(unlocked by C3 + counsel), canonical property identity and the dossier
(block 2's core — deliberately deferred until real vault books exist to
design the matcher against), the firm-consent surfaces from §5, and the
custom-views spec if the spreadsheet ask is still alive.

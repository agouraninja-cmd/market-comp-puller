# CompNinja Roadmap

The one place the product direction lives in the repo. Before this file,
the roadmap was split across Claude session memories, the Ecosystem Plan
docx in OneDrive, and the owner's head; now anyone (including any Claude
session) reads it here. The `/dev` ideas list remains the owner's personal
notepad and is deliberately not mirrored here.

Update rule: when something ships, move its line to the Shipped log at the
bottom with the date. When priorities change, reorder; this file states
intent, the devlog states history.

## Now

- **Re-check Search Console in a few days** (no code, ~5 minutes). Checked
  2026-08-09: **both `/` and `/how-it-works` are indexed** — but `/` was last
  crawled **2026-07-30**, before both the wall and the fix, so Google has seen
  neither and is holding pre-wall content. Indexing was requested for `/` that
  day (priority crawl queue), and the sitemap was resubmitted — Google re-read
  it immediately, 42 → 44 pages, so `/` now has a referring sitemap. Page
  Indexing had no data yet. **Both levers are pulled; what is left is waiting.**
  The re-check is: has `/`'s last-crawl date moved past 2026-08-08, and does
  its canonical now read `/` rather than `/how-it-works`? Then read Page
  Indexing across all 44 URLs. Full findings in `docs/SEO.md` item 3.
  Still above every engineering item: as of 2026-08-06 the product had **zero
  real outside users**, so "can anyone find this" is the binding constraint,
  and a thin report is a real answer — evidence to stop investing in SEO, not
  a reason to do more of it.

- **The import confirm table is where the remaining cost is, and it has not
  been designed yet** (measured 2026-08-28, full record in
  `docs/evals/extract-2026-08-28-verdict-final.md`). Spec §9's correction-time
  condition was finally timed: **4m 51s to verify 12 extracted rows, with zero
  corrections needed** — 4x over the 60-second bar, on rows that were all
  correct. The extraction took 9.9 seconds; the person took 291. Every cause
  the reviewer named is presentation:
  1. **Rows are not in source order**, so verifying row 4 means hunting for it
     page by page. Biggest single lever, and nothing requires reordering.
  2. **Figures render raw** (`410000` against a page printing `$410,000.00`).
     `/vault`'s comps table already solved this — formatted to read, raw on
     focus to edit (`cellDisplay`/`data-raw`) — and the confirm table should
     reuse that rather than invent a second convention.
  3. **No business name beside the type.** The row says Retail; the page says
     Altitude Tire and Alignment. That name is how a person knows which
     property they are looking at.
  4. **A fixed column set regardless of the document**, so reviewers scan past
     columns the source never had.
  **The measurement that actually decides the archive is still missing**, and
  it is now the cheapest one left: nobody has timed a broker keying 12 comps
  BY HAND. The whole gate is whether correcting beats typing, and only one
  side of that comparison has ever been measured.

- **Two decisions before ingestion ships, neither an extraction problem**
  (the extraction test is DONE and the two prompt defects it found are fixed
  and verified — final verdict in
  `docs/evals/extract-2026-08-28-verdict-final.md`: cap rates went 0 of 8
  correct to 8 of 8, invented sale dates 3 to 0, field precision 99.6%).
  What the measurement surfaced that a prompt cannot fix:
  1. **The `deal_date` and `rent_basis` refusals cost 13 real deals** in a
     16-document set. A brokerage capital-markets report whose transactions
     table has no date column loses all 9 rows; lease sheets that state a
     rate but never the word "annual" lose 4 more. Both refusals are correct
     — `rent_basis` exists because guessing is 12x wrong — but the honest
     options are a dateless-deal sentinel (the `Active` precedent) and a
     per-import rent basis, not a relaxed parser.
  2. **Address completion versus the dedupe key.** The model now completes
     addresses the page abbreviates ("Atlanta" to "Atlanta, GA", measured on
     5 of 5 rows of one sheet). The completion is correct, but `addressKey`
     is the vault's dedupe key, so the same sheet imported either side of
     that behaviour yields duplicate properties.
  And one thing no prompt fixes: **image quality produces silent wrong
  numbers.** On a synthetic 60dpi grayscale render — not even a photograph —
  one page returned nothing at all and another silently misread $566,000 as
  $560,000. A confirm step the broker actually reads is not optional for
  photographed input. Still owed on the test itself: a stopwatch on
  correction time (§9's first condition; two exercises are staged by
  `scripts/make-correction-exercise.js`) and a real photographed scan.

## Next

- **Archive ingestion: forward an email into the vault** (building block 1 of
  the Business Model Transition Plan; design and migration plan in
  `docs/superpowers/specs/2026-08-21-archive-email-ingestion-design.md`).
  Design only as of 2026-08-21 — no product code and no migration file, both
  deliberately gated on the extraction test above. The storage half has
  existed since migration 013; what is missing is the front door. Three things
  worth knowing before picking it up. **The plan document is wrong about the
  vendor in a way that changes the design**: Resend's inbound webhook carries
  metadata only, and the body and attachments are fetched back afterwards, so
  the handler makes outbound calls of its own and can fail halfway. **Sender
  verification is the privacy wall's weakest new surface**, and an SMTP
  envelope sender is spoofable by anyone who learns the address, so the rule
  is the envelope check AND the provider's SPF/DKIM verdict, with a missing
  verdict quarantining rather than passing — and whether Resend exposes one at
  all is the spec's first open question, to be settled against one real
  message. **The commit path is a refactor, not new architecture**: pulling
  `commitVaultBatch()` out of `POST /api/vault/upload` the way `runCompSearch`
  came out of `/api/comps` for bulk valuation is what makes the existing
  cascading undo work on a forwarded email with no new code.
- **Import-time geocoding for vault comps** (step 2 of
  `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`; the other
  follow-on from that spec, the `/api/geocode` POST move Owen ranked above
  this one, shipped 2026-08-17 and is in the log below).
  Deferred 2026-08-06, and the reason is worth keeping: section 7's premise —
  what fraction of broker exports already carry coordinates — could not be
  answered because there were **no vault uploads at all** yet. It is work that
  should be bought with evidence from the first real broker book, not
  estimated. Nothing is wasted by waiting: `geo_source` already allows
  `'census'`, so step 2 lands as a pure addition with no migration change.
  **Unblocked 2026-08-10** by the CSV column mapper: real broker exports can
  now be imported, and `lat`/`lng` are mappable columns, so section 7's
  premise is finally measurable rather than estimated. Read it off the first
  few real books before deciding.
- **Corpus browse page** (the deferred half of friend-feedback #9). Gated
  on the density milestone: 10+ market/type buckets holding 8+
  provenance-good comps from organic traffic; the `corpus_offer` events on
  /admin are the gauge.
- **Rent-roll-drives-DCF**: renewal, market-rent and downtime modeling so
  the rent roll feeds the DCF cash flows instead of sitting beside them.
- **White-label exports**, riding on the branding profile once its UI
  exists.
- **Bulk valuation follow-ons** (the feature shipped 2026-08-21; spec
  `docs/superpowers/specs/2026-08-21-bulk-valuation-design.md` §7). Three
  questions the first real run should answer rather than a design should:
  whether 50 is the right cap, whether a firm should be able to share a run
  (which is exactly the case the enterprise shelf's own note says makes an
  `org_shelf_items` table worth building), and whether per-address property
  type is worth the mixed-list case it keeps being asked for.
- **Market digest pages**, once the corpus holds 2+ quarters of history.

## Later (broker-tier phases, in order)

v4 is complete: the gut check (slice 1), the BOV tracker (slice 2), and
the 1031 exchange guide (slice 3) all shipped 2026-08-08. Hub ratings
remain, last. Hub monetization is gated on the attorney's referral-fee
answer; the fallback if fees are barred is lead visibility as a
subscription benefit.

## Engineering track (no product decisions needed)

- Deploy-checklist project skill (tests → tailwind regen if needed →
  pending migrations → push → verify live → devlog). **Shipped 2026-08-04**
  (`96bab16`): `.claude/skills/deploy/SKILL.md`, which carries the whole
  chain plus the two things this line did not think to ask for — the
  shared-checkout rules (stage explicit paths, never amend) and the Supabase
  project to run migrations against.
- Extract tested pure modules out of server.js as they're touched. Shipped
  2026-08-08: `marketOf` → market.js (+ the Canada fix); the ENTIRE
  /api/comps parse pipeline → report-parse.js (parse, salvage, compact-key
  expansion, all three normalizers, the $/SF reconciliation and its strict
  money parsers); and `reportIdFor` → report-id.js with the
  `exportReportKey` mirror pinned by test. New candidates earn a module the
  same way: when touched, with tests first.
- Branch protection on main once PR flow feels routine (CI is live but
  advisory today).
- Market pages restyle onto the `rd-*` Research Desk tokens. Still
  outstanding: `MARKET_CSS` is the older skin, and `HOW_CSS` says so in its
  own header — /how-it-works took the `rd-*` system "rather than the older
  market-page skin". (The og-image half of this line is done: regenerated
  from the cut-card mark 2026-07-15 in `660b563`, and byte-identical today,
  the Sliced Tower attempt having been reverted whole in `017f2c5`.)
- Re-measure `PARALLEL_SEARCH` on real traffic before ever flipping it on.
- Fix `marketOf()` yielding "Canada" for Canadian addresses before non-USD
  reports are ever harvested. **Shipped 2026-08-08** (`fb190aa`), in the same
  commit as the `marketOf` extraction the bullet above already credits —
  which is why it sat here unnoticed. `market.js` reads Canadian
  provinces, so "123 King St W, Toronto, ON, Canada" keys as "Toronto, ON"
  rather than collapsing to the literal "Canada"; pinned by
  `test/market.test.js`.
- Market page `<h1>`/`<title>` disagreement: shipped 2026-08-09 with the
  owner's yes — both now say "Comps in". See the Shipped log.

## Open business questions (not code)

For the attorney: referral fees, MLS re-share terms, and broker-data
privacy — processing limits, deletion rights, and liability for data a
broker was not licensed to hold. **The last of these gates launch, not
development.** As of 2026-08-06 it is no longer hypothetical: brokers'
private comps are live in storage (`broker_comps`, `broker_properties`)
and flow into that broker's own valuation reports. **Enterprise accounts
sharpen the same question** (2026-08-16): when a broker uploads their book as
an employee and then leaves the firm, whose comps are they? The design
recommends the uploader keeps their vault and the firm keeps whatever was
published to its shelf — a recommendation, not an agreement, and the first
time it matters is the worst time to decide it.

For Chuck: the gut-check benchmark, pricing, day-one dashboard
views. Details in Section 8 of the Ecosystem Plan docx.

## Parked (decided, not forgotten)

- `origin/ledger` branch: Owen's in-repo financial ledger tooling. Parked
  2026-08-04 by the owner; its data files are already protected on main.
- Per-type recommended lookbacks: Industrial moved to 24 months on
  measurement 2026-08-04; the others stay until measured the same way
  (count priced SALE comps per window, not total comps).
- Explorer/seed pipeline stays pinned at 8 comps.
- Plus-tier packaging ideas from the 2026-07-16 tiering draft.

## Principles that bind everything above

Customer-first, daily-use tool growing toward
Director-of-Asset-Management-level analysis. Favor client-side
deterministic finance math ($0 marginal cost) and recurring-engagement
loops. Calm UI; brand-identity changes need an explicit named yes. The
brand is CompNinja, never Adler. The owner is not a licensed broker:
"connect you with a local broker," never brokerage. Don't market
"analyst-grade" before the comp audit scores 90%+.

## Shipped log (roadmap-level items only)

- **2026-08-28: §9's last unmeasured condition is measured.** Correction time
  finally has a number: 4m 51s for 12 rows, zero corrections required. It
  fails the 60-second bar 4x and the failure is entirely in the review UI —
  rows out of source order, unformatted figures, no business name, a fixed
  column set. The extraction itself produced 12 correct rows in 9.9 seconds.
  Recorded rather than smoothed over, along with the fact that the other half
  of the comparison — a person typing 12 comps by hand — has still never been
  timed, so "correcting beats typing" remains inference.

- **2026-08-28: the extraction verdict is answered, and its two defects are
  fixed.** The 2026-08-27 verdict found the capability sound but the prompt
  broken in two ways, both of the silent-wrong-number kind `normalizeRow`
  cannot catch: every cap rate returned as a decimal fraction (a page reading
  5.10% became 0.051, storable as a cap rate of 0.051%), and three active
  listings on a lender BOV reported as closed sales dated from the list date.
  Both were unstated conventions rather than model failures. Fixed in
  `EXTRACT_PROMPT`, pinned by tests, and re-measured against production on
  16 documents and 144 hand-keyed deals: **cap rates 0 of 8 to 8 of 8,
  invented dates 3 to 0, field precision 98.7% to 99.6%**, one wrong value in
  the whole run. Raw recall reads lower (76.4%) because the fix makes the
  extractor refuse three listings it used to invent; counting only deals the
  vault would accept it is 94.5%.

- **2026-08-27: the extraction verdict exists.** Step 1 of the Business Model
  Transition Plan's sequence, and the gate on the whole Archive block, is
  answered in writing: `docs/evals/extract-2026-08-27-verdict.md`. 14 public
  documents from 11 organizations (6 broker-produced), 132 hand-keyed deals,
  one run against production. Recall 85.6%, field precision 98.7%, fabrication
  1.3%, zero omitted fields. Two blocking prompt defects found and named, both
  one-line fixes, now the 'Now' item above. Two scope limits stated rather than
  hidden: no proprietary broker files were available, and no true scans, so a
  pass is an upper bound. The run's own first scoring said 4.2% fabrication and
  was wrong — 21 of 27 'fabrications' were correct reads the truth file had
  omitted, the pilot's lesson repeating on a bigger set. Truth is keyed from
  rendered pages now, never a text extraction.

- **2026-08-21: the pricing model simplified to one decision per customer.**
  Two owner calls on one day, in order. First, `FREE_MAX_COMPS` went from 10
  to `"all"` (PR #55's decision, rebuilt on current main — the branch had
  drifted 1045 commits): the free report's value range was always computed
  from the full comp set, so the list gate withheld the evidence for a number
  already published. Second, the $20 single-report unlock was RETIRED the
  same day, because with nothing locked its tile — keyed on
  `lockedCount() > 0` — no longer surfaced and it was left selling only the
  lookback. Purchases already made are honored forever (webhook,
  `report_purchases`, `/api/report-access`, per-property entitlement all
  kept); a source scan fails the build if `single_report` re-enters the
  PLANS map. What remains: free = full report at 3 years; Pro = the ten-year
  window, unlimited exports, the vault, Address Explorer, branding; firms =
  per-seat. The landing-page FAQ was caught still selling both retired claims
  and is now test-pinned against them (public-pages.test.js).
- **2026-08-19: only a licensed broker may publish a vault comp.** Decided
  2026-08-12 and built now: `broker_profiles.license_number` (migration 034,
  NOT NULL DEFAULT ''), and one pure gate `VAULT.canPublishAs(profile)` that
  both `POST /api/vault/publish` and `POST /api/vault/publish-many` call, so
  the two cannot drift. Credit name is still refused first, so an existing
  broker's refusal keeps its shape. Optional to SAVE an identity, required to
  PUBLISH: a broker setting up a vault rarely has the number to hand, and
  refusing the whole save would block the credit name too. Never rendered
  publicly, and `publicBrokerRow`'s allowlist is now test-pinned against it.
  **Needs migration 034 applied before it does anything on production**, and
  until then every publish refuses, so apply it with the merge.
- **2026-08-19: enterprise (firm) accounts, all four slices.** From Chuck's
  email of 2026-08-16; design in
  `docs/superpowers/specs/2026-08-16-enterprise-team-accounts-design.md`.
  A firm is an account with a shelf on it: colleagues share reports to it
  (manually, or automatically if an owner switches that on), search the
  firm's whole record, and opt individual vault comps into each other's
  reports. Migrations 030-033, run and verified on production the same day.
  Slice 2 landed WITHOUT the `org_shelf_items` table the design assumed —
  reports already live in `shared_reports` with `visibility='org'`, and a
  second copy would have been two sources of truth. Slice 3 is opt-in per
  COMP rather than per import, narrower than the spec proposed and the
  version worth defending. Slice 4 (per-seat billing) is live but DARK:
  `STRIPE_PRICE_FIRM_MONTHLY` is unset, so checkout 503s, the buy control
  never renders, and seats stay hand-granted at 200 per firm. Standing
  recommendation: leave that price unset until a firm asks to pay.
  **What has NOT happened: a real firm.** Everything is proved against a
  stand-in PostgREST and in a real browser, and the live database has never
  held one. The first outside firm is the evidence that decides whether the
  shelf or the shared vault earns further work — and the attorney question
  below (whose comps are they when the broker who uploaded them leaves) is
  now sharper, because a departing broker's comps can sit in colleagues'
  reports as well as on the shelf.

- **2026-08-17: `/api/geocode` takes a POST, and the GET form is gone.** The
  higher-ranked of the two follow-ons from the private-comp geocoding work
  (Owen's section 7 ordering: above import-time geocoding, which stays in
  "Next"). Every comp's address used to travel in a query string, so it landed
  in Render's access logs and in any outbound Referer; it rides in the body
  now, the same reasoning `POST /api/report-access` and `POST /api/hub/access`
  already carry. It matters most for the comps that are not public — a vault
  comp is geocoded through this proxy and deliberately nowhere else (GUARD 2),
  so logging its address in a URL undid part of what that guard bought.
  Both callers moved (index.html's `geocodeAddress`, `MARKET_MAP_JS`); the
  Explorer turned out not to be one. **The GET alias was removed, not
  deprecated** — an open door is one stale caller away from putting the
  addresses back, and nothing detects that. The bounded cost is market pages
  cached `public, max-age=3600` before the deploy, which geocode nothing for
  up to an hour and hide the map card rather than showing a broken one;
  index.html is `no-store` and updates at once. Four tests pin it, including
  a source check that neither caller ever rebuilds a query string.

- **2026-08-13/14: five changes aimed at the acquisition constraint, plus two
  money-path holes.** None of these were on this roadmap, which is the point:
  the list above is engineering the product needs, and every item here answers
  "nobody arrives, and the few who do are told things we cannot back up."
  - **A refund takes the report back** (#61). `charge.refunded` and the
    async-payment pair had no handlers, so a refunded buyer kept their unlock
    forever and a payment settling after checkout charged the card and never
    unlocked anything. **Closed 2026-08-17**: the three events are ticked on
    the live destination (`empowering-legacy`), which now reports all nine,
    matching `PRO-BILLING-SETUP.md`. The handlers were inert for two weeks.
  - **The market pages stop promising a broker nobody has** (#62). All 38
    offered "a no-cost Broker Opinion of Value from a licensed local broker"
    while the broker card above rendered nothing. The promise now reads the
    same list that card reads; uncovered markets sell the report instead.
  - **A covered market leads with the broker** (#62). Where somebody does
    cover the market, the introduction offer sits above the tiles rather than
    in the last sentence. Anonymous visitors only, since the CTA below already
    splits and a member is here to work.
  - **A forwarded report asks the reader for their own building** (#63).
    `/r/<id>` is the only page the wall lets a stranger through to, and it
    greeted them with a generic signup card plus a line telling them to "enter
    an address above" while that card stood where the field would be.
  - **Report-first outreach** (#68). `node outreach.js` runs real reports on
    real buildings in one market, publishes share links and drafts a message
    per building. It sends nothing and bills nothing without `--confirm`.
    `--warm-only` is the bounded cache pre-warm. **Never run live yet.**
  - **A saved property says what its market did while its owner was away**
    (#70). The desk's only figure that moves without the owner re-running
    anything, drawn from comps other people's searches already harvested.
- **2026-08-09: market pages agree with themselves.** The `<title>`s said
  "Comps in" and the `<h1>`s said "Property Values in" on all 38 pages, so
  each one gave Google a mixed signal about its own subject. `marketTitle()`
  now returns the same string as `marketPageTitle()`'s base, aligning the h1,
  the JSON-LD name, the breadcrumb leaf and `/markets`' hasPart in one change.
  Shipped with the owner's explicit yes, since it edits visible copy; the
  trade — "property values" reads more plainly than "comps" — was taken
  knowingly. Related-market link text is unchanged on screen. Route tests pin
  the h1/title agreement and the trimming needle that silently depends on the
  wording.
- **2026-08-08: the homepage is a page again.** Logged-out `/` serves the
  landing content with a 200 (was a 302 the index never followed);
  /how-it-works canonicalizes to `/` while the wall is up; `/` is back in
  the sitemap. Every market-page CTA that points at `/` now lands on a
  real page.
- **2026-08-08: Address Explorer follow-ups closed.** Market pages link
  into the explorer via the wall-safe `/?auth=signup&explore=` door, and
  cached addresses carry an "Instant" badge (presence recorded per address
  by migration 020, failure-safe, approximation by design).
- **2026-08-08: deploys gated on the checks.** `npm start` runs
  `prestart` (syntax check + full suite), so a red build exits before
  listening and Render keeps the previous green deploy — works even when
  GitHub Actions is down. CI on GitHub stays advisory.
- **2026-08-06: private comps stopped being geocoded by address.** Both
  halves shipped same-day (storage: migration 017 + CSV coordinates;
  display: the skip + no-third-party guards in `renderMap()`). This line
  sat in "Now" until 2026-08-08 — it was already done.

- **2026-08-14: /1031-exchange is an identification worksheet.** The
  education page stays on the same URL, underneath: selling property,
  closing date → 45/180 calendar dates, three replacement slots, each
  valued through the existing report handoff. Shareable via the URL
  fragment so addresses never hit a server log. Not a written
  identification, not an exchange, dates only — the 2026-08-08
  compliance pins still hold.
- **2026-08-08: v4 slice 3, the 1031 exchange guide.** Public education
  page at /1031-exchange: the exchange workflow in order, a client-side
  45/180-day deadline-dates widget (dates only, never taxes), the
  identification rules, common failure modes, and a FAQ with FAQPage
  JSON-LD. One page for both audiences — owners researching a sale find
  it, brokers hand it to clients. Education, never advice, test-pinned.
  Worksheet layer added 2026-08-14 (see above).
- **2026-08-08: v4 slice 1, the gut check.** A broker's book, sanity-checked
  against the public market layer on /vault: per-bucket median $/SF and cap
  rates vs corpus quartiles + model market figures (the owner's blended-
  benchmark answer to Chuck's §8 question), plain-English verdicts, and
  outlier markers on comps priced >25% outside the band. Pure dual-export
  `gut-check.js`; the benchmarks endpoint reads no vault rows. No migration.
- **2026-08-08: report branding.** The last unbuilt Pro entitlement now has a
  UI: a saved profile (logo, firm name, preparer, phone, email, license
  number, a short note) renders on every report a member's entitlement
  covers, on screen, in print, in the PNG, and in both the CSV and XLSX
  exports. A shared report carries the sender's mark as a snapshot taken at
  share time, never the viewer's own profile. Co-branded, not white-label:
  CompNinja stays named as the author of the valuation and the
  automated-estimate line survives every configuration. Rules live in the
  pure, tested `branding.js`. The pricing tile and plan card now advertise it.
- **2026-08-06: v3 client sharing.** A share now carries an owner, an
  audience and an off switch instead of only a public link: invited
  visibility with a per-report viewer list keyed by email
  (`report_viewers`, migration 018), revocation, and a broker's private
  vault comps traveling as anonymized `locked_basis` rows so an invited
  client's valuation matches the broker's to the dollar without an
  off-market address ever leaving the vault. Full private detail is a
  per-share opt-in gated on `canUseVault`. Rules live in the pure, tested
  `report-access.js`. Live — migration 018 applied 2026-08-06 (see
  `migrations/APPLIED.md`) and the sharing routes are serving in production.
- **2026-08-06: a private comp's address stops leaving the broker's browser.**
  The first piece of work after v2, and it is done on both sides. Spec and
  Owen's section 7 answer in
  `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`. Storage half
  (#45): migration 017 puts `lat`/`lng`/`geo_source` on `broker_properties` —
  one row per building, so a broker with three deals on it is located once —
  plus `lat`/`lng` in the vault CSV with both-or-neither validation,
  `attachPropertyCoords()` stitching them on, and `toApiComp()` carrying them
  out. 017 recorded applied in `migrations/APPLIED.md` (#46; note it is NOT
  idempotent). Display half (#43): a private comp that already knows where it
  is is never geocoded, and one that still needs locating goes only to our own
  Census proxy, never browser-direct to Nominatim, which would otherwise
  receive the address *and* the broker's IP.
  Verified end to end after both halves merged, since neither of us had run
  them together: coordinates survive `attachPropertyCoords` →`toApiComp` →
  `blendPrivateComps` → the browser guard, which then skips geocoding.
  Import-time geocoding is deliberately deferred; see Next for it and for the
  `/api/geocode` POST change that Owen ranked above it.
- **2026-08-06: CI can be started by hand** (#44). GitHub had a seven-hour
  Actions incident that throttled webhooks to ~15%, so pushes and PRs stopped
  creating workflow runs at all — four branches merged with no CI result while
  Render deployed each one. `workflow_dispatch` adds a Run workflow button on
  any branch, which is a direct API call rather than a webhook and so still
  works when pushes are being dropped. It gave `main` a green verdict in 17
  seconds the same day. Note it only works on branches whose own copy of
  `ci.yml` carries the trigger, so cut branches from an up-to-date `main`.
- **2026-08-06: v2 closed.** Broker tier v1 is done and live — the private
  vault, the star schema behind it (migration 016), blended private comps in a
  broker's own reports (server half #28, display half #30), the vault
  dashboard's market rollup + price trend + repeat properties (#34), the
  empty-vault first run (#40), the broker lead inbox, and one product rather
  than two in every place that described it (#39, #41). Live schema verified
  against the code the same day. Organic acquisition also went from invisible
  to measurable (#32, #36) — see `docs/SEO.md`.

- 2026-08-06: organic acquisition made legible (PR #32) — all 38 market
  page titles were 68–82 chars against Google's ~60 and were being
  truncated mid-phrase; Search Console verified by HTML file, sitemap
  resubmitted after going unread since 2026-07-14. State + what's left in
  `docs/SEO.md`.
- 2026-08-04: migrations/ folder + CI on every push; upstream-error leak
  fixed (PR #9); ledger data protected on public main (PR #10).
- 2026-08-03: Pro tier public launch, $39 single-report unlock, guest
  search cap, Address Explorer, live report preview, compact comp
  encoding + narrative caps.
- 2026-07-19: all four ecosystem directions (accounts/My Desk, broker
  network, pro analysis toolkit + phase 2, market intelligence).
- 2026-07-14: Research Desk landing redesign; compninja.co live.

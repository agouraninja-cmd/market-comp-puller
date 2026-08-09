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
  day (priority crawl queue). Page Indexing had no data yet.
  The re-check is: has `/`'s last-crawl date moved past 2026-08-08, and does
  its canonical now read `/` rather than `/how-it-works`? Then read Page
  Indexing across all 43 URLs. Full findings in `docs/SEO.md` item 3.
  Still above every engineering item: as of 2026-08-06 the product had **zero
  real outside users**, so "can anyone find this" is the binding constraint,
  and a thin report is a real answer — evidence to stop investing in SEO, not
  a reason to do more of it.

## Next

- **`/api/geocode` should take a POST, not a query string.** The two
  follow-ons left by the private-comp geocoding work, in the order Owen set
  when he answered section 7 — this one ABOVE import-time geocoding, not
  below it. Today every comp's address travels in a URL, which means the
  platform's access logs and any Referer. `POST /api/report-access` is already
  POST for exactly this reason (CLAUDE.md says so). It is the same class of
  fix at a wider blast radius, because it covers *every* comp rather than only
  private ones. Scoped out of the original change deliberately: it touches
  every caller (the report map, the market pages, the Explorer).
- **Import-time geocoding for vault comps** (step 2 of the same spec).
  Deferred 2026-08-06, and the reason is worth keeping: section 7's premise —
  what fraction of broker exports already carry coordinates — could not be
  answered because there were **no vault uploads at all** yet. It is work that
  should be bought with evidence from the first real broker book, not
  estimated. Nothing is wasted by waiting: `geo_source` already allows
  `'census'`, so step 2 lands as a pure addition with no migration change.
- **Corpus browse page** (the deferred half of friend-feedback #9). Gated
  on the density milestone: 10+ market/type buckets holding 8+
  provenance-good comps from organic traffic; the `corpus_offer` events on
  /admin are the gauge.
- **Rent-roll-drives-DCF**: renewal, market-rent and downtime modeling so
  the rent roll feeds the DCF cash flows instead of sitting beside them.
- **White-label exports**, riding on the branding profile once its UI
  exists.
- **Market digest pages**, once the corpus holds 2+ quarters of history.

## Later (broker-tier phases, in order)

v4 is complete: the gut check (slice 1), the BOV tracker (slice 2), and
the 1031 exchange guide (slice 3) all shipped 2026-08-08. Hub ratings
remain, last. Hub monetization is gated on the attorney's referral-fee
answer; the fallback if fees are barred is lead visibility as a
subscription benefit.

## Engineering track (no product decisions needed)

- Deploy-checklist project skill (tests → tailwind regen if needed →
  pending migrations → push → verify live → devlog).
- Extract tested pure modules out of server.js as they're touched. Shipped
  2026-08-08: `marketOf` → market.js (+ the Canada fix); the ENTIRE
  /api/comps parse pipeline → report-parse.js (parse, salvage, compact-key
  expansion, all three normalizers, the $/SF reconciliation and its strict
  money parsers); and `reportIdFor` → report-id.js with the
  `exportReportKey` mirror pinned by test. New candidates earn a module the
  same way: when touched, with tests first.
- Branch protection on main once PR flow feels routine (CI is live but
  advisory today).
- Market pages restyle onto the `rd-*` Research Desk tokens; regenerate
  og-image.png from the cut-card logo.
- Re-measure `PARALLEL_SEARCH` on real traffic before ever flipping it on.
- Fix `marketOf()` yielding "Canada" for Canadian addresses before
  non-USD reports are ever harvested.
- Market page `<h1>`s still say "Property Values in" while the `<title>`s
  now say "Comps in" — the two disagree about what the page is about, and
  Google weights both. Small change, but it edits copy people see, so it
  wants a yes rather than a drive-by. Context in `docs/SEO.md`.

## Open business questions (not code)

For the attorney: referral fees, MLS re-share terms, and broker-data
privacy — processing limits, deletion rights, and liability for data a
broker was not licensed to hold. **The last of these gates launch, not
development.** As of 2026-08-06 it is no longer hypothetical: brokers'
private comps are live in storage (`broker_comps`, `broker_properties`)
and flow into that broker's own valuation reports.

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

- **2026-08-08: v4 slice 3, the 1031 exchange guide.** Public education
  page at /1031-exchange: the exchange workflow in order, a client-side
  45/180-day deadline-dates widget (dates only, never taxes), the
  identification rules, common failure modes, and a FAQ with FAQPage
  JSON-LD. One page for both audiences — owners researching a sale find
  it, brokers hand it to clients. Education, never advice, test-pinned.
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

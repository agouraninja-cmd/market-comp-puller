---
paths:
  - "corpus-*.js"
  - "blend-corpus.js"
  - "backtest.js"
  - "market.js"
  - "deal-date.js"
  - "test/corpus-*.test.js"
  - "test/blend-corpus.test.js"
  - "test/backtest.test.js"
  - "test/market.test.js"
  - "test/deal-date.test.js"
  - "test/archive-first.test.js"
---
# The comp corpus and retrieval

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Architecture

- `GET /api/corpus-comps?address=&type=` — the in-report "From CompNinja's
  records" offer: provenance-good corpus rows for the subject's market+type
  (never estimate/news, priced, deduped, max 20), served from the same
  `corpusRowsForMarket` read corpus-first retrieval uses. Pure DB read — no
  Anthropic call, no cap interaction. Rate-limited per IP. Logs a PII-free
  `corpus_offer` analytics event when rows are returned. Failure-safe: any
  error returns an empty list, never an error page.
- **Comp corpus** (not a route — a persistence layer): every search response
  (billed AND cached) has its comps harvested by `harvestComps()` into the
  Supabase `comp_corpus` table (file fallback `comp-corpus.jsonl`, git-ignored),
  deduped by a normalized address|date|price key (unique constraint +
  ignore-duplicates upsert; in-memory seen-set for the file path). Harvest
  keeps only `public_record` and `listing`; `estimate` and `news` stay in the
  report that found them and are not stored; an empty listing date is stored
  as `"Active"`. Fire-and-
  forget — a corpus failure never affects the request. This is the permanent
  raw-data layer that broker verification and future retrieval features build
  on; the DDL lives in `migrations/001-comp-corpus.sql` (+ `004` for the
  per-type columns).
  `GET /api/comp-corpus` downloads it as CSV (requires `ADMIN_KEY`).
  **Radius blend (2026-08-14).** At serialization, inside `gate()` and
  **before** `gateReport()`, `blendNearbyComps` folds in harvested deals of
  the same property type whose date is inside the lookback, that have
  coordinates, and that sit within **10 miles** of the subject for CRE —
  **1 mile for Residential** unless the market note names a radius in miles
  (a typed "2.5 miles" is the neighborhood for that search; shrinking it to
  one mile would fight the instruction the owner just gave). Houses trade by
  neighborhood; the 10-mile CRE circle priced a $2M home off cheaper sales
  from the next pocket over (19 comps, ~$1M headline). When the 19 comps
  already sit inside that named circle, distance cannot separate them —
  Residential extras more than 1.5× the subject's implied $/SF (ask ÷ size)
  are dropped, and `compWeight` floors the same miss so the IQR cannot be
  outvoted by the cheaper majority. Missing ask is neutral. They join
  the table and the Low / Likely / High math; a free report turns extras
  into `locked_basis` so the dollar range still matches Pro.
  Harvest Census-geocodes new rows before the insert (fire-and-forget with
  the rest of harvest); unlocated existing rows backfill up to 8 per request
  and join the *next* search. A deal with no point is skipped, not guessed as
  same-city. Cache, harvest, and market snapshots still see the search-only
  report, so a later search in the area picks up deals saved after the cache
  write. Rollback is `CORPUS_RADIUS=off`. Vault rows are never read. Spec:
  `docs/superpowers/specs/2026-08-14-radius-corpus-blend-design.md`.
  **Corpus health (`CORPUS_HEALTH` + `noteCorpusFailure()`).** Fire-and-forget
  means both the write (`harvestComps`) and the read (`corpusRowsForMarket`)
  swallow their errors, which once hid a total outage: ten per-comp columns
  were missing because the `ALTER TABLE` was never run, so every insert 400'd
  into the ephemeral file and every read returned empty. The corpus sat frozen
  at 65 rows for **weeks** while the log said `Comp corpus +8` on each search
  and `/admin` showed a 0% corpus hit rate with no explanation. So failures now
  accumulate in `CORPUS_HEALTH` (write fallbacks, read failures, last error +
  timestamp, and a `schemaMismatch` flag set when the message names a column or
  the schema cache — PostgREST's `PGRST204`). `/api/stats` returns it as
  `corpus.health` and `/admin` renders a red banner above the tiles whenever
  anything is non-zero, naming the missing-column case specifically because it
  has one concrete fix. Counters are in-memory and reset on restart — a smoke
  alarm, not accounting. The harvest log also distinguishes a durable insert
  from the ephemeral fallback; **a console line alone was not the fix** (one was
  already logged on every failure and nobody tails Render's logs), which is why
  this surfaces in the dashboard instead.
- **Corpus-first retrieval** (the cost saver, not a route): on a cache *miss*,
  before paying for a fresh web search, `retrieveCorpusComps()` pulls comps
  already harvested for that market+type. Rows count as *usable* when the
  provenance is better than `estimate`/`news`, a price parses, and
  `parseDealDate()` puts the deal inside the requested lookback.
  `corpusIsStrong()` — the single threshold shared by the search budget and the
  analytics tag so the two can't disagree — is `coverage >= 4 && fresh`, where
  fresh means the newest harvest for that market is under 75 days old
  (45 until 2026-07-31 — widened as a cost lever; see the comment above the
  constant before touching it again). When
  strong, the model is handed those comps and `searchBudgetFor()` cuts
  `max_uses` to a floor of 3 (or 2 when the subject size was supplied), vs
  10/8 for a full-budget 12-comp search — a
  deliberate floor rather than 0/1 — and the search is tagged
  `source: "corpus"` in `analytics_events`. Failure is always safe: any error
  returns zero coverage, i.e. today's normal full search.
  Because the key is `marketOf(address)` and matched with a **case-sensitive**
  `eq`, the write side (`harvestComps` files each comp under
  `marketOf(comp.address)`) and the read side (`marketOf(subject.address)`) must
  agree exactly — `marketOf()` canonicalizes to title-case city + uppercase
  state for precisely this reason; see the note above it before touching that
  parse. Verified end-to-end 2026-07-27 on both a 24-month and the default
  12-month lookback. Note the threshold is per market **and** property type, so
  it only pays off when traffic repeats in the same market.
  **Archive-first (2026-08-21).** Above the corpus sits the searcher's OWN
  vault: 4+ usable rows for the market+type (priced, or a lease with a rent —
  `archiveCoverage`/`archiveIsStrong` in blend-comps.js, threshold mirrors
  `corpusIsStrong`) floor the web budget exactly as corpus strength does.
  Three rules, all pinned by `test/archive-first.test.js` against a real
  server and a stub provider: **nothing vault-derived reaches the prompt**
  (the strength flag rides on the corpus object; `buildPrompt` only ever
  receives `corpus.comps`/`nearby`/`listed`); the budget and the
  `source: "archive"` analytics tag read ONE flag, set once in
  `runCompSearch`; and **a vault-subsidized report is never written to the
  shared cache** — `search_cache` is keyed by property, so a later visitor
  would be served the thinner report without the private rows that justified
  it (corpus-strong entries stay cacheable, because the comps that shrank
  THAT budget are in the cached body). Firm-shared comps deliberately do not
  count, and internal callers pass no vault rows. **It is also gated on
  `PROVIDER.capabilities.searchBudget`**, which means it is INERT on the
  default provider: Gemini's `google_search` takes no `max_uses`, so the
  floored budget is ignored and setting the flag would skip the cache write
  for no saving at all — worse than not having the feature, and invisible.
  It becomes a cost lever under `SEARCH_PROVIDER=anthropic`. Rollback is
  `ARCHIVE_FIRST=off`.
  **Metro matching (2026-08-10).** Corpus-first retrieval, and ONLY it, also
  reads the subject market's immediate neighbors from `market.js`'s curated
  `METRO_GROUPS`, so a Meridian search can draw on Boise's rows. Those come
  back as a separate `nearby` list and get their own prompt block, worded more
  narrowly than the exact-market one (use only when the target's own city is
  thin, report the address exactly as given, prefer a same-city comp when both
  are comparable). The exact-market block's "never include one clearly in a
  different city" rule stays intact and absolute. **`coverage` remains
  exact-market only**, so `corpusIsStrong` and the search budget cannot be
  moved by a nearby row; that is the whole safety property, and it is why the
  two counts are kept separate rather than summed. `corpusRowsForMarket` itself
  returns the same rows for its four other callers (watchlist feed, vault gut
  check, `/api/corpus-comps`, Address Explorer), now also carrying their own
  market value; retrieval calls the new `corpusRowsForMarkets` directly
  instead. Rollback is `CORPUS_METRO=off`. Adding
  a metro group is a data edit in `market.js`; the rule is adjacent suburbs
  sharing one submarket, never a whole statistical area, and a test pins every
  entry against `marketOf` because an exact-match key that never matches is
  invisible.
  **On-market listings (2026-08-13).** Unparseable listing dates (`Active`,
  `Listed Mar 2025`) come back as `listed` extra candidates with their own
  prompt block; they do not count toward `coverage` or shrink the budget;
  dated listing comps still do. Rollback is `CORPUS_LISTED=off`. The harvest
  filter has no flag.
  **An asking price is not a comparable sale, and `comp_corpus` now holds
  both** — so EVERY aggregate over corpus rows must exclude the on-market
  ones, and the test for "is this a closed deal" is that `parseDealDate`
  returns non-null (`Active` and `Listed Mon YYYY` are both deliberately
  unparseable). Most consumers got this free because they already required a
  parseable date — the radius blend (`blend-corpus.js`), the backtest, the
  market-page trend, and portfolio movement all filter on one, so the
  VALUATION was never exposed. **Two did not, and both were fixed in the
  shipping commit rather than found later**: `gut-check.js`'s `corpusStats`
  (the broker's own benchmark — measured, one listing at $160 against four
  closed sales near $100 moved the median 101 → 102 and Q3 102.5 → 104, so
  every book looked cheap against it) and `buildWatchlistFeed`'s
  `median_psf`, which windows on `ts` — when the row was HARVESTED, not when
  the deal closed — and so had nothing at all to exclude an asking price
  with; that median is quoted on My Desk and in the digest email. Both are
  test-pinned, and the gut-check gate only trusts an INJECTED parser because
  its fallback returns null for everything and would otherwise empty every
  benchmark. `/api/corpus-comps` deliberately still offers these rows: they
  carry a visible `date` of `Active`, and a comp a visitor reads and chooses
  to add is not a silent aggregate. This is the cost of one table holding two
  kinds of row — CLAUDE.md's own separate-tables rule (the vault privacy
  wall) is the alternative that was not taken here, so a new corpus reader
  must be checked against this rule by hand.
- `GET /api/accuracy` — the valuation-accuracy backtest card on `/admin`
  (added 2026-08-06; spec in
  `docs/superpowers/specs/2026-08-06-valuation-backtest-design.md`). Gated
  exactly like `/api/stats` (`isAdminRequest`: the `x-admin-key` header or the
  `cn_admin` cookie), and it is a full-corpus read, so it is kept OFF
  `/api/stats`'s critical path and memoized 15 minutes in-process
  (`?refresh=1` busts the memo). It hold-one-out scores every usable,
  ground-truth-provenance corpus sale against its own market+type peers using
  `valuation.js`'s real math (`backtest.js` — pure, requires nothing but
  `valuation.js`, so the harness can never quietly drift from what a customer's
  report actually computes) and reports median absolute error, band coverage,
  band width, and a per-type breakdown, with a skip-reason breakdown
  (`unusable`, `notGroundTruth`, `thinPeers`, `duplicateAddress`) so the
  figure is never read as more solid than its sample. Below a floor of 20
  scored subjects the card shows progress toward the floor instead of a
  number — a median over a handful of subjects swings too much to trust.
  **Fails safe with a 200** on any error or a missing corpus, same as
  `/api/corpus-audit`: `/admin` is the page opened when something else is
  already wrong, and this panel must never be what breaks it further. It
  measures the reconciliation MATH only (comps already in the corpus, not a
  fresh search) and runs untrended (corpus rows do not store the market trend
  a live search used), and the card says both of those things next to the
  numbers. Not a public accuracy claim — nothing from this ships to a
  marketing surface.

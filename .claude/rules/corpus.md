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
  - "scripts/accuracy-lab.js"
  - "test/accuracy-lab.test.js"
  - "scripts/truth-test.js"
  - "scripts/truth-set.json"
  - "test/truth-test.test.js"
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
  `GET /api/comp-corpus` downloads it as CSV (requires `ADMIN_KEY`); its last
  two columns are each deal's `lat`, `lng` (since 2026-11-16, for the
  accuracy lab's distance variants).
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
  outvoted by the cheaper majority. Missing ask is neutral.
  **Manufactured homes and houses stay apart (2026-11-16).** A Residential
  extra whose kind differs from the search's is skipped, ask or no ask. The
  kind is `isManufacturedHome` (a trailer or space number in the address, or
  the words manufactured, mobile home, single- or double-wide; not "Lot",
  which names land parcels too) and the search's is `searchIsManufactured`:
  the subject's address, else most of the search's own comps, else unknown,
  which filters nothing. A mobile home in a park usually sells without its
  lot, so its $/SF is a different figure: Boise's run $61-$158 a mile from
  houses at $300-$600. The live search never mixed the two in any harvested
  report; the mile circle was where they met, and the price-tier test above
  needs an ask an owner's valuation rarely has. Lab figures are under "The
  accuracy lab". Commercial blends never read the kind.
  **A saved sale of the subject's own building is never blended in as one
  of its comps (2026-11-27).** `blendNearbyComps` skips a non-lease row whose
  address is the subject's (`VALUATION.sameBuilding`, against the typed
  address and `subject_address_corrected`). The search's own copy of that
  sale is taken out of the comps by the server (search-pipeline.md, "The
  building's own sale"), and without this the radius blend laid the saved
  copy straight back in: a building valued against itself, and then again
  through its own sale. A LEASE at the subject's address still blends (a
  suite lease in the building is a real lease comp), and so does the
  neighbour one street number over. The row is not hidden from anything
  else: it is still harvested, still in the corpus and still the next
  building's comp. Blended extras join
  the table and the Low / Likely / High math; a free report turns extras
  into `locked_basis` so the dollar range still matches Pro.
  Harvest Census-geocodes new rows before the insert (fire-and-forget with
  the rest of harvest); unlocated existing rows backfill up to 8 per request
  and join the *next* search. A deal with no point is skipped, not guessed as
  same-city. Cache, harvest, and market snapshots still see the search-only
  report, so a later search in the area picks up deals saved after the cache
  write. Rollback is `CORPUS_RADIUS=off`. Vault rows are never read. Spec:
  `docs/superpowers/specs/2026-08-14-radius-corpus-blend-design.md`.
  **The blended set is fitted (2026-11-27).** Right after the blend, and
  before the paywall, `COMPFIT.refitBlended` applies the comp-fit rules the
  search's own comps were already held to: a saved deal this report's search
  set aside cannot come back through the corpus, a saved condo-unit sale or a
  sale whose notes say its price is not a market price is not blended, and a
  far deal is dropped when four near ones exist. NOT the size-class cut (a
  measured decision; see "The accuracy lab" and search-pipeline.md). For
  this `corpusRowsForType` selects `notes`, which the blend's own
  manufactured-home words can now match too; the notes are taken off a saved
  deal before it is served (`COMPFIT.withoutSavedNotes`), since they were
  written about another search's subject. `COMP_FIT=off` rolls the fit back
  and leaves the blend.
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
  **It feeds the math year built (2026-11-15).** The live report weights by
  vintage whenever it knows the subject's year, corpus rows carry one, and the
  backtest passed neither, so the card graded a weighting no customer's report
  runs. Passing it moved the headline 19.1% -> 17.9% with no change to the
  product; read any figure from before that date with that in mind.
- **The accuracy lab** (`scripts/accuracy-lab.js`, not a route; added
  2026-11-15) is the bench the backtest was built for: the "second project"
  its spec ends on. `node scripts/accuracy-lab.js <corpus.csv>` (the export is
  HQ's **Comp corpus CSV** link, `/api/comp-corpus`) scores about thirty
  candidate versions of the math over the same held-out sales and the same
  peers as today's, through `BACKTEST.score`'s `valueFn` door (never passed by
  `/api/accuracy`), and prints each against the baseline pair for pair.
  `--by-type` breaks a change out per property type, `--only <text>` picks
  variants, `--facts` prints the within-bucket size and time slopes the data
  itself shows. Four things to know before trusting a line of its output:
  - **A variant must beat the noise, and the noise is measured by market.**
    Subjects in one market share peers, so the interval beside each change
    resamples whole MARKETS; one that straddles zero is a coin flip. On the
    2026-11-15 corpus (678 rows, 242 scored, 128 of them Boise houses) the
    recency half-life, the size penalty's shape, the source weights, the
    weight floor, a trend read off the comps and a different "Likely"
    statistic ALL sat inside it. Only the size restatement cleared it, and
    only for commercial buildings (report-and-valuation.md, flow 3g). Those
    settings are not proven right; the corpus is too small and too
    concentrated to say they are wrong.
  - **Nothing is reimplemented.** A variant either wraps the production
    composition or patches valuation.js's SOURCE TEXT, and a patch that does
    not match exactly once throws, so a refactor cannot leave an experiment
    quietly scoring the baseline under a new name (`test/accuracy-lab.test.js`
    runs every patch).
  - **The answer key is weaker than it looks.** Most `listing` rows from
    July and August 2026 are asking or last-list prices dated as sales (the
    `Active` / `Listed Mon YYYY` convention arrived 2026-08-13 and rows since
    then are clean), Idaho is a non-disclosure state, and the whole corpus
    holds fewer than ten `public_record` sales. So the lab can rank two
    versions of the math against each other; it cannot yet say how far either
    is from a closed price, and it cannot measure what an asking price is
    worth as a comp. That needs closed sales, which means broker-verified or
    public-record rows.
  - **Band coverage was a product question, and the owner answered it
    (2026-11-16).** Low to High was the weighted middle half of the comps by
    construction, so a held-out price landed inside it a little under half the
    time (48%). It is now the 15th-85th percentile, which catches 62% at half
    again the width (45% of Likely against 31%); 10th-90th would catch 70% at
    57%. See report-and-valuation.md, flow 3h, for what had to move with it.
  - **The worst misses are the market pool, not the math (2026-11-16).** The
    backtest's peers are every sale of the type in the MARKET, where a live
    report's are the search's own comps plus saved deals inside a mile (houses)
    or ten (commercial). So its biggest misses are pairings no report makes:
    all seven above +200% were Boise manufactured homes valued off Boise
    houses, and Austin's +57% to +166% are one neighborhood's $264-$310/SF
    houses valued off another's $486-$653. The 2026-11-15 export carried no
    lat/lng, so the lab could not pool by distance the way production does.
    What the 2026-11-16 session tried, all on the 2026-11-15 corpus and none clearing the noise:
    manufactured homes and houses kept apart, -1.2 points (90%: -1.6 to 0.0),
    better on 64% of the 121 sales it moved, mean miss 23.9% -> 21.7%, ADOPTED
    in the radius blend on principle (see "Manufactured homes" above);
    leased vs vacant commercial matched, -0.3 on the 15 it moved, not adopted;
    cap-rate-priced sales kept apart, worse for Industrial, not adopted; and
    every harvested copy of a building counted, which scored no worse, if
    anything a point better: collapsing re-dated copies in the blend is NOT an
    accuracy fix, though it would tidy the comp table (both variants stay in
    the lab so the next session does not re-run the question as new).
  - **The comp fit and the comp count are on the bench (2026-11-27), and
    neither has been run on a real export.** Group `fit` puts the pool
    through `COMPFIT.applyCompFit` itself (so the lab scores the rule a
    report runs, not a copy; a peer's notes are put back from its row):
    "as blended" is what `refitBlended` does to saved deals (unit sales,
    price basis, and distance when the export has map points), "PLUS the
    size-class cut" asks whether saved deals should be size-cut as well, and
    "only the price-basis rule" isolates that one. Group `count` values each
    sale from only its 3, 4, 6 or 8 best-weighted peers: the price of a thin
    report, and so the case for searching again.
    **The lab reads `market-seed.json` directly** (`seedRows`: the market
    pages' own comps as corpus rows) for a session with no export to hand.
    It is a weak stand-in (241 rows, 34 scored, pools of four to seven, no
    notes, no map points) and everything below is from it, so read it as a
    direction, never a size. On it: the size-class cut on the pool moved 15
    sales, nearly all down to the three-comp floor, and made 60% of them
    worse (median miss 22.7% to 27.8%, the market-resampled interval 0.0 to
    +11.0 points), which is why `refitBlended` leaves size alone; nothing
    else in the lab's standard set cleared the noise on it either (the
    comp-count variants included, though with pools this small they barely
    move). **The first thing to do with a real export** is
    `node scripts/accuracy-lab.js <export> --only fit --by-type` and
    `--only "how much"`. If the size cut is no better there, the same
    question is owed to the search's own size cut (comp-fit.js's first pass,
    2026-11-17), which was the owner's call from one report and has never
    been measured: it leaves three comps wherever the wider search finds
    nothing.
  - **Distance needs an export from 2026-11-16 on.** `/api/comp-corpus` now
    ends with `lat`, `lng` (appended, so no earlier column moves; both are in
    migration 001, so naming them cannot 400 the read into the file-only
    fallback; `test/comp-corpus-export-run.test.js`). Two variants use them:
    "distance weighting on" stamps `distance_mi` from the two points, the
    field and rounding `attachCompDistances` writes, so valuation.js's own
    distance term runs; "peers inside the radius blend's circle" then keeps
    only peers within `radiusMilesFor` (1 mile houses, 10 commercial), or all
    of them when fewer than three are inside, standing in for the search's own
    comps. The run prints "Rows with a map point: N of M"; on an older export
    that is 0 and both variants move nothing. Not yet run on a real export:
    re-download from HQ once this is deployed. If the circle variant clears
    the noise, the backtest itself (and so `/admin`'s figure) should pool that
    way too, the same argument as feeding it year built on 2026-11-15; the
    `/api/accuracy` read would then have to select lat/lng as well.
- **The truth test** (`scripts/truth-test.js`, not a route; 2026-11-17, two
  scores since 2026-11-27) is the one instrument that measures the WHOLE
  product: a real search on a building that has already sold, valued the way
  a member's report is, against the price it sold for. The backtest and the
  lab above score the math over comps already saved. Its header is the
  manual. What to know before quoting a line of its output:
  - **It prints two scores and they are never one figure.** COMPS ONLY
    hides the building's own sale (every row at its address out of the comps,
    `subject_last_sale` deleted): that is the accuracy figure, and the only
    one. AS SHOWN applies the rule a member's page applies, the own sale used
    where the server found and vetted one (report-and-valuation.md, "The
    building's own sale leads its value"), split into the buildings that
    leaned on their sale and those that did not. Every building in the set
    has sold and the answer key IS that sale, so the "leaned" half lands near
    the answer because it starts from the answer. Read it for how often a
    sale is found and for anything far from zero (a wrong sale leaned on).
    **It is an echo. Never quote it as accuracy, in a report, a page, an
    email or a pitch.**
  - **What it has measured.** On the 45 real sales in the set, COMPS ONLY:
    median miss 33.0%, 16% within 10%, the sold price inside Low to High 49%
    of the time; on the 30 confirmed sales, 28.0%. That is one draw of each
    building (the same address landed +48%, -12% and +29% in one afternoon),
    so compare two settings only on the same buildings run at least twice.
    More comps did not help (two lanes, or two whole searches averaged), and
    neither did dropping unsold listings or duplicate rows.
  - **The answer key carries its own audit** (`scripts/truth-set.json`,
    `check` on every row; all 47 were checked against the web on
    2026-11-27): 30 `confirmed`, 15 `unverified` (the price is only what our
    own corpus row says) and 2 `asking` (an asking price dated as a sale:
    kept in the file so older runs line up, never scored, not run unless
    `--all`). Every summary prints the confirmed rows beside all of them.
    `caveat`, `web_price`, `web_size` and `sale_type` say what a row is when
    it is not a plain sale of that one building. `sold` is never edited: add
    rows, do not change them.
  - **The set came from the corpus, and that flatters the search.** 41 of
    the 47 buildings are in `comp_corpus`. Until 2026-11-27 the prompt handed
    the model the target's own saved row, and 21 reports gave it straight
    back as the building's "last sale". The prompt no longer offers a target
    its own rows (search-pipeline.md), but a hit rate measured on this set is
    still not the hit rate on a stranger's building. Measure that on
    addresses the corpus has never held.
  - **`--replay <dir>` re-scores saved reports with no request** (`--raw
    <dir>` on a live run writes them). A change to the MATH needs nothing
    else. A report saved before the server stamped its sale leans on nothing,
    so on those the two scores are the same number: replaying old reports
    cannot measure the own-sale rule, only a fresh run can.
  - **It spends real money on the account every member's search runs on.**
    Two at a time by default, it stops after three refusals in a row, and it
    skips nothing silently. On 2026-11-27 four passes in ninety minutes
    tripped the provider's spend-rate limit and every search on the site
    failed for three minutes (search-pipeline.md, `PARALLEL_SEARCH`).
  - Tests: `test/truth-test.test.js` (the pure half; requiring the script
    runs nothing).

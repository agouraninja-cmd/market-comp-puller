# v4 slice 1: the gut check — a broker's book vs the public market layer

**Date:** 2026-08-08
**Status:** AGREED (owner-approved section by section in session)
**Source:** "CompNinja Ecosystem Plan" (2026-07-31) §3 v4, §8; `docs/ROADMAP.md`
"Later" broker-tier line (owner's explicit reprioritization ahead of the
"Now" items). Builds on the vault (v1), blended comps (v2), and client
sharing (v3), all shipped.

## Scope decision

Ecosystem v4 is three candidate features: the gut check, BOV tracking, and
1031 workflow education. The owner chose to slice it and ship the **gut
check first**; BOV tracking and 1031 education follow in later cycles with
their own specs. This spec covers only the gut check.

Two of Chuck's §8 open questions brushed against this slice:

- **The benchmark definition** ("what should a broker's private numbers be
  scored against?") was answered by the **owner in session, 2026-08-08**:
  a blended benchmark — public corpus peer aggregates AND model-supplied
  market figures, each shown separately with its own provenance and date,
  never merged into one unlabeled number.
- **Pricing** is untouched: the gut check ships inside the existing Pro
  tier (`canUseVault`), no new plan, no new price.

## What the feature is

On `/vault`, for each market + property-type bucket where the broker has
priced sale comps, a **"Gut check" panel** compares their private numbers
against the public market layer:

- bucket-level: the broker's median $/SF (and median cap rate where they
  record one) against the public corpus quartile band and the market
  page's model figures, with a plain-English verdict;
- comp-level: individual vault sale comps priced far outside the market
  band get a quiet outlier marker in the existing comps table.

The comparison reads public data against the broker's own book. **Nothing
flows the other way** — see Privacy below.

## Architecture (approach A: browser compute, public-data endpoint)

Three pieces:

1. **`gut-check.js`** — a new pure module holding every rule, with the
   same dual Node/global export as `valuation.js`, so `npm test` exercises
   the whole decision table and the browser runs the same copy. Served as
   a static file **with `max-age: 0`**, for the same reason `valuation.js`
   is: the vault page's inline script calls into it, and a cached copy
   stale relative to the page is a silent break.
2. **`POST /api/vault/benchmarks`** — a new server route answering public
   market benchmarks for a list of buckets. It never reads vault rows.
3. **The `/vault` panel** — rendering only, in `vault-page.js`. The page
   already fetches the broker's whole book (`?limit=1000`) and filters in
   the browser; it feeds those comps plus the benchmarks response into
   `gutCheck()` and draws the result.

Rejected alternatives: a server-computed `GET /api/vault/gut-check`
(second user-scoped vault read; a response mixing private and public
data); client-only against existing surfaces (`/api/corpus-comps` returns
rows not aggregates, capped at 20, wrong filters — wrong shape).

**No migration.** The feature reads three stores that already exist
(`broker_comps` via the page's existing fetch, `comp_corpus`,
`market_pages`). Next migration number stays 019 for whoever needs it.

## The endpoint

`POST /api/vault/benchmarks`, body `{ buckets: [{ market, type }, ...] }`.

- **POST, not GET**: market names contain commas ("Boise, ID"); a JSON
  body beats query-string escaping. Bucket list capped at **50** per
  request (a broker's own bucket list; the vault dashboard itself tops out
  around there in practice).
- **Gate**: the same `openVault()` refusal ladder as every vault route —
  401 not signed in → 403 not `ent.canUseVault` → 503 no database — for
  consistency and testability, even though the response is public data
  only. Entitlements resolve through `entitlementsFor(req)` and the route
  tests `canUseVault`, never a plan name.
- **Rate-limited per IP** like every other route.
- Response, per bucket (either half may be `null`; echoes the bucket key):

```json
{
  "buckets": [{
    "market": "Boise, ID",
    "type": "Industrial",
    "corpus": {
      "count": 14,
      "median_ppsf": 142,
      "q1_ppsf": 121,
      "q3_ppsf": 168,
      "newest_deal_date": "2026-03-15",
      "cap_rate_median": 6.1,
      "cap_rate_count": 5
    },
    "snapshot": {
      "ppsf": { "median": 138, "low": 118, "high": 161, "count": 9 },
      "cap_rate_low": "5.8%",
      "cap_rate_high": "6.5%",
      "market_trend": "...",
      "generatedAt": "2026-08-02"
    }
  }]
}
```

- **`corpus`** is computed server-side by `gut-check.js`'s
  `corpusStats(rows)` from rows fetched by the existing corpus read path
  for that market+type, filtered by the same usability rules corpus-first
  retrieval and the backtest already trust: provenance better than
  `estimate`/`news`, transaction is a sale (not lease), price parses.
  Cap-rate aggregates parse the text `cap_rate` column defensively;
  unparseable values are skipped, and `cap_rate_median` is null under 3
  parseable values.
- **`snapshot`** comes from the in-memory market-pages store
  (`getMarketPage(slugifyMarket(type, city, state))`) — no extra DB read.
  Null when no page exists for the bucket.
- **Failure is safe per bucket**: a failed corpus read yields
  `corpus: null` for that bucket, never an error — the same swallow-and-
  degrade stance as every corpus read. The route only errors on the gate
  or malformed input.
- One PII-free `logEvent` per call, `kind: "gut_check"`, so `/admin` can
  see adoption. No market field (a call covers many buckets).

## The rules (`gut-check.js`)

Pure: no I/O, no clock reads (callers pass anything time-shaped), and no
requires at all. Dual export (`module.exports` + browser global
`GUTCHECK`), mirroring `valuation.js`'s pattern.

**`corpusStats(rows)`** → the `corpus` block above. Server-side use, but
it lives here so the aggregation is tested.

**`gutCheck(vaultComps, benchmarks)`** → per-bucket results + outlier
flags. Rules:

- **Broker stats per bucket**: median $/SF from the **stored**
  `price_per_sqft` only — never derived in this module. The vault writes
  that column for sales only and leaves it null on leases (an annual rent
  ÷ size is $/SF/yr and would corrupt the median), so leases are excluded
  by construction. Also: count of priced sales, median `cap_rate` where
  present. A bucket with **no priced sales gets no verdict** — there is
  nothing to check.
- **The market band**: the corpus q1–q3 band counts when `corpus.count`
  ≥ **4** (mirroring `corpusIsStrong`'s coverage floor); the snapshot's
  low–high band counts whenever a snapshot exists (stored pages already
  passed the ≥ 3 priced-sale publish gate). When both are present the
  verdict runs against their **union**; the card always shows the two
  halves separately, each labeled with provenance and date.
- **Verdicts**, four values, plain English:
  - `in_line` — broker median inside the band;
  - `above` / `below` — outside the band, with the % delta from the
    nearest band edge stated;
  - `no_data` — neither half clears its floor.
- **Cap-rate verdicts** run against the snapshot's low–high range only —
  a range is required for in/above/below to mean anything, and the
  corpus side only yields a median (a point, not a band). The corpus
  cap-rate median (≥ 3 parseable values) renders as a labeled supporting
  figure on the card, never as the verdict's basis. Cap-rate verdicts
  only render when the broker has ≥ **2** comps carrying a cap rate.
- **Outliers**: an individual vault **sale** comp is flagged when its
  $/SF sits more than **25% outside the market band** — a deliberately
  wide, explainable threshold ("this comp is 40% above the market band"),
  not a statistical test. Flags only fire when the bucket's verdict has
  real data (`in_line`/`above`/`below`); no benchmark, no flags. Leases
  are never flagged.
- **Malformed input** (missing fields, unparseable numbers, unknown
  buckets in either direction) degrades to `no_data`/no flag, never
  throws — this runs in the vault page, and the page must never break on
  odd data.

**Honesty rules** (carried from the `/api/accuracy` backtest card):

- Every verdict names its sample sizes and dates on the card.
- The comparison is **untrended** (corpus rows do not store the market
  trend a live search used) and the panel says so.
- Divergence is framed as **"worth a look," never "your data is wrong"**
  — the broker's private comps may well be the better data. The gut check
  is a flashlight, not a grade.
- Nothing here is a valuation; no appraisal-adjacent language, and
  nothing from this panel ships to a marketing surface.

## UI on `/vault`

All rendering in `vault-page.js` (presentation only — data resolution and
the entitlement gate stay in server.js, per the standing split).

- A **"Gut check" panel** between the market rollup and the price-trend
  chart, honoring the existing filter row. One card per bucket where the
  broker has priced sales.
- Each card: broker median $/SF vs the two labeled benchmark halves, the
  verdict as a quiet chip (existing vault card styles, the page's own
  palette — calm UI, nothing flashy), the plain-English delta line, and
  counts/dates for every number shown.
- **Outlier flags**: a small marker on the affected rows in the existing
  comps table, plus a one-line count on the bucket's card. No new table.
- **Hidden states**: the panel is hidden in `applyFirstRun()` (empty
  vault), and hidden entirely when every bucket is `no_data` — an
  all-"not enough data" panel reads as broken, the same lesson as the
  first-run empty tables. A quiet one-line "market benchmarks unavailable
  right now" replaces the panel when the benchmarks fetch itself fails;
  the rest of the page renders fully without it.
- The page loads `/gut-check.js` via a script tag (added to
  `STATIC_FILES`, `max-age: 0`).
- The panel is inside the vault, so it needs no new upgrade prompt and no
  `.unlock-comps-btn` surface — the whole page is already behind
  `canUseVault`.

## Privacy

The standing rule — no vault row may ever reach `harvestComps()`,
`corpusRowsForMarket()`, a market snapshot, or another account's report —
is satisfied structurally:

- The new endpoint **never reads vault rows**; its response carries only
  public market figures. The broker's own numbers stay in their browser.
- No new server code touches `broker_comps` at all.
- The comparison output exists only in the broker's own page. It is not
  stored, not shared, not exported: `/api/share` strips private comps
  today and this feature adds no new share surface. Gut-check verdicts
  never ride on a report object.
- Analytics events stay PII-free (`kind` only, no market).

## Testing

- **`test/gut-check.test.js`** — the decision table: `corpusStats`
  aggregation (filters, quartiles, cap-rate parsing), band union, all
  four verdicts, both floors (corpus 4, cap-rate 3/2), the 25% outlier
  threshold, lease exclusion, no-priced-sales buckets, malformed input
  never throwing.
- **`test/routes.test.js`** — the endpoint is actually wired through the
  vault gate: 401/403/503 ladder, drift-checked the way `requireBroker`
  is pinned against `openVault`; plus the bucket cap and a happy-path
  shape check.
- **`test/vault-page.test.js`** — still compiles the emitted page JS (the
  one-template-literal hazard), extended to pin the panel's presence and
  its first-run hiding.
- `npm test` passes after every task. **No `index.html` edits in this
  slice**, so no inline-script extraction is needed.
- Final verification is a real browser drive of `/vault` (by the primary
  session, not a subagent — the last two features' browser passes caught
  bugs every static review missed).

## Rollout

- No migration, no env var, no Stripe change, no copy outside `/vault`.
- Devlog entry in the shipping commit; `docs/ROADMAP.md`'s v4 line
  updated to show the gut check shipped and BOV tracking + 1031 education
  remaining; CLAUDE.md gets a short gut-check section under the broker
  vault.
- Deferred, deliberately: BOV tracking (next slice — builds on the live
  broker lead inbox and `lead_intro_requests`), 1031 workflow education
  (content slice; education never advice), any trend-adjustment of corpus
  figures (corpus rows would need to store trend first), and any
  benchmark surface outside the vault.

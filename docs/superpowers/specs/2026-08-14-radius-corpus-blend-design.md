# Auto-include saved deals within 10 miles (design)

Date: 2026-08-14
Status: agreed (approach 1, in-session)

## Problem

Every search already harvests priced comps into `comp_corpus`, filed by the
comp's city and property type. Later searches in that market may reuse them
(corpus-first retrieval, model decides) or offer them under "From CompNinja's
records" (visitor clicks Add). Neither is "always in the math." A deal saved
from a nearby search can sit in the store while the next report's Low / Likely
/ High ignores it.

## Decision (owner, 2026-08-13/14)

1. **Auto-include.** Every saved deal that qualifies joins the report's `comps`
   array with no extra click. Exclude still works (existing curation).
2. **Lookback window.** Only deals whose date `parseDealDate`s inside the
   selected lookback. Active listings and other unparseable dates stay out.
3. **10-mile radius**, even across city lines. Same property type. Not "same
   city" and not metro-group membership as a distance proxy.
4. **Server merge at serialization** (approach 1). Same funnel as vault blend:
   cache, harvest, and market snapshots keep seeing the search-only public
   report. The extras are attached on the way out, then the paywall runs, then
   vault comps.

Rejected: auto-clicking Add in the browser (free visitors never receive those
rows; a cache hit would not pick up deals saved after the cache write).
Rejected: prompting the model to include them (cache hits never see new deals;
the model can still drop one).

## Mechanics

### `blend-corpus.js` (new pure module, covered by `npm test`)

No I/O, no clock reads (caller passes `now`), no Census. server.js owns the
read and the geocode.

- `RADIUS_MILES`: `10`.
- `milesBetween(a, b)`: haversine, earth radius 3959, matching `index.html`.
- `parseCoords(row)`: both lat and lng finite, in range, and not the
  `Number(null) === 0` trap. Null / "" / one-sided → `null`. A deal we cannot
  place is not "in range."
- `toReportComp(row)`: corpus columns onto the report's keys (`deal_date` →
  `date`). Allowlist, not a spread. Sets `from_corpus: true`. Drops empties.
- `blendNearbyComps(report, rows, opts)`:
  - `opts.subject`: `{ lat, lng }`. Prefer `report.subject_lat` / `subject_lng`
    when finite; else this. Missing both → return the same report object.
  - `opts.months`, `opts.now`, `opts.parseDealDate`, `opts.keyOf`,
    `opts.subjectAddress`, `opts.isAggregateAddress`.
  - Keep a row when: priced, not aggregate, parseable date `>=` lookback
    cutoff (same year-fraction math as `retrieveCorpusComps`), coords, `<= 10`
    miles, address is not the subject, key is not already in `report.comps`.
  - Estimate and news rows that pass those bars are included (owner chose
    auto-include over provenance filtering). Leases too: they join the table;
    the hero already ignores them.
  - Append, do not prepend. Empty extras return the **same object**, no
    `corpus_count` key (the vault blend's byte-identical empty case).

### Serialization order inside `gate()`

```
search / cache hit
  -> harvestComps()                  public report only
  -> cache write                     public report only
  -> maybePublishMarketSnapshot()    public report only
  -> blendNearbyComps()              saved public deals enter HERE
  -> gateReport()                    extras become locked_basis for free
  -> blendPrivateComps()             vault, after the paywall
  -> response
```

Corpus blend is **before** the paywall so a free report's dollar range still
matches Pro (locked_basis already exists for that). Vault blend stays **after**
the paywall: brokers are Pro, and a private row must never become a public
locked_basis row.

`gate()` becomes async only so a report missing `subject_lat` can Census-geocode
the search address. Cache hits almost always already have subject coords; that
path must not wait on Census when they do.

`internal` (seed generator) still returns the report untouched, so market pages
stay the search snapshot.

### Candidate read

`corpusRowsForType(property_type, limit)` — type only, not city. A 10-mile
circle from a city edge is a different city. Current corpus is hundreds of
rows; limit 2000. Select includes `lat`, `lng`, `dedupe_key`. Failure returns
`[]` (fail open: the search-only report still goes out).

Do not use `marketOf` or `METRO_GROUPS` as the distance filter. Rollback is
`CORPUS_RADIUS=off` (default ON).

### Coordinates

The model stopped returning per-comp lat/lng on 2026-07-31, so most harvested
rows cannot satisfy a 10-mile rule until they are geocoded.

- **Harvest:** before the insert, Census-geocode any new row missing coords
  (public addresses; fire-and-forget with the rest of harvest). The row is
  stored already located.
- **Backfill:** when the radius read sees unlocated rows, geocode up to 8
  fire-and-forget and PATCH `lat`/`lng` by `dedupe_key`. They join the **next**
  search, not this one. Never await Census on the cache-hit path.
- **This request:** blend skips unlocated rows. No city fallback. A 10-mile
  rule with no point would be a guess.

No migration. `lat`/`lng` are already text columns on `comp_corpus`. No
`geo_source` column; do not add one.

Vault `broker_comps` are never read. The privacy wall is unchanged.

### What deliberately does not change

- Harvest still writes on every billed and cached search. Dedupe is still
  `corpusKeyOf`. Non-USD reports still skip harvest.
- Corpus-first retrieval, `corpusIsStrong`, the search budget, and the
  "From CompNinja's records" panel. The panel keeps offering leftover
  same-market rows that did not pass radius or lookback; already-merged
  rows already drop out of that list via `compKeyOf`.
- Valuation math, `compWeight`, and `index.html`. Merged comps are ordinary
  comps with their stored `source_type`. Curation exclude keys them the same
  way as any other row.
- Market snapshots and the seed generator.

## Tests

`test/blend-corpus.test.js` (new) and a `test/routes.test.js` source grep:

- `parseCoords` is null for missing, one-sided, `""`, and `Number(null)` 0,0
  fakes; finite US points parse.
- `milesBetween` agrees with the 3959-mile haversine.
- In-range dated sale is appended with `from_corpus: true` and `date` (not
  `deal_date`).
- 15 miles out, outside lookback, unparseable date, unpriced, aggregate
  address, no coords, subject address, and duplicate key are all dropped.
- Empty extras return the same object with no `corpus_count`.
- Estimate/news/lease that pass the bars are kept.
- Inclusive boundary: `<= 10` in, `> 10` out.
- `gate()` source: `blendNearbyComps` before `gateReport` before
  `blendPrivateComps`. `harvestComps(` does not appear inside `gate`.

## Docs

CLAUDE.md, the harvest / `/api/comps` serialization paragraphs. `blend-corpus.js`
joins the tested-modules list. A `devlog.json` entry ships with the
implementation.

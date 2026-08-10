# Corpus metro matching (design)

Date: 2026-08-10
Status: AGREED

## Problem

`corpusRowsForMarket` matches `market` with an exact, case-sensitive `eq`
against `marketOf(address)`, which canonicalizes to "City, ST". So a
Meridian search sees none of the Boise comps harvested ten miles away, and
every suburb in a metro is its own cold-start market. Corpus-first
retrieval only ever pays off when traffic repeats in the *identical* city
and property type, which is the narrowest possible definition of a repeat.

The cost angle is real but secondary at current traffic. The bigger loss is
coverage in exactly the markets the product struggles with: a thin market
gets no help from the comps we already hold nearby.

## Decision (owner call, 2026-08-10)

Widen retrieval to neighboring markets in the same metro, and let those
rows be **candidates only**. Nearby coverage never shrinks the search
budget. A Meridian search gains Boise comps to work from; a Plano search
can never be answered by Fort Worth comps on a starved budget, because the
budget still keys on exact-market coverage alone.

## Why a curated table and not real distance

Per-comp `lat`/`lng` stopped being returned by the model on 2026-07-31 to
shrink the report-writing burst, so most corpus rows now carry no
coordinates. True radius matching would require geocoding the corpus, a
much larger feature with its own rate-limit and retry policy (the vault's
import-time geocoding was deferred for the same reasons). A curated table
is deterministic, costs nothing, and can be reviewed by reading it.

## Mechanics

### `market.js` (pure, already tested)

Gains a `METRO_GROUPS` table and two functions:

- `metroOf(marketKey)` returns the metro key for a "City, ST" market, or
  `null` when it belongs to no group.
- `siblingMarkets(marketKey)` returns the other members of that metro, or
  an empty array.

**The table's discipline, stated in its header:** group only adjacent
suburbs that genuinely share a CRE submarket, never a whole census
statistical area. It starts deliberately short — the Boise metro (Boise,
Meridian, Nampa, Caldwell, Eagle, Garden City, Star, Kuna), which is the
owner's home market and the case that demonstrably fails today, plus a
small number of equally tight groups among the already-seeded markets.
Adding a group is a data edit with a test behind it, so the table can grow
as traffic shows where it is needed.

**One test pins every entry by round-tripping it through `marketOf`**, so a
typo, a lowercase city, or a stray space can never silently fail to match.
That is precisely how this class of bug hides: the exact-match query simply
returns nothing and the feature looks like it works.

### `corpusRowsForMarket` (server.js)

A new `corpusRowsForMarkets(markets, property_type, limit)` does the widened
read (`market=in.(…)`, values quoted and percent-encoded because a market key
contains a comma), and `corpusRowsForMarket` becomes a one-line delegate so its
four other callers — the watchlist feed, the vault gut check, `/api/corpus-comps`,
and the Address Explorer — get the same rows, now also carrying their own
market value. The single-market path still emits the identical `market=eq.`
query, so the widened
form, which local dev cannot exercise without a database, can only ever cost the
nearby rows and never the existing behavior.

### `retrieveCorpusComps` (server.js)

Splits the usable rows: exact-market rows first, nearby rows appended to
top up toward the existing cap. Returns, in addition to today's shape:

- `coverage` — **unchanged meaning: exact-market usable rows only.**
- `nearby` — the nearby usable rows, offered separately.
- `nearbyCount` — for logging.

`corpusIsStrong` and `searchBudgetFor` are untouched. The budget cannot be
affected by nearby rows by construction rather than by anyone remembering
to check, which is the point of keeping `coverage` exact.

### The prompt (the load-bearing change)

Today's single `KNOWN RECENT COMPS` block ends with "Never include one that
is clearly in a different city or submarket than the target." Widening
retrieval without touching the prompt would hand the model rows and then
instruct it to discard them.

Nearby rows therefore get their own **separate labeled block**, so that
strict sentence stays intact for exact-market rows. The nearby block:

- names the cities the rows come from and says they are in the same metro
  as the target;
- says to include one only when it is genuinely comparable AND the
  target's own market is thin on results;
- requires the address to be reported exactly as given, so the report shows
  where the comp actually is (the table's distance note and the map then
  tell the reader the truth without any new UI).

### Rollback

`CORPUS_METRO=off` restores exact-match behavior in one environment change,
following the `PARALLEL_SEARCH` pattern. Default ON. The flag exists
because this touches the prompt, which is the highest-consequence surface
in the app.

## What deliberately does not change

- The search budget, `corpusIsStrong`, and the corpus floor.
- The `source: "corpus"` analytics tag. Redefining it would silently change
  what `/admin`'s corpus hit-rate tile has been measuring, and that tile is
  already hard to read (its denominator includes every billed search ever).
  The nearby count goes to the log line instead.
- The 75-day freshness gate and the provenance/priced/in-window filters.
  Nearby rows pass exactly the same usability bar as exact ones.
- `harvestComps`. Rows are still filed under their own `marketOf`, so the
  write side is untouched and no backfill or migration is needed.
- Any UI. A nearby comp renders as an ordinary comp with its real address.

## Measuring it

This is the first change the search-quality eval harness can score. The
spec makes no claim about whether nearby comps improve reports: run
`run-eval.js` before and after and compare. The metrics that would move if
this helps are `pricedSales`, `valuationPossible` and `comps`; the metric
that would expose the risk is `marketMatchRate`, which by design counts a
nearby-city comp as off-market, so a large drop there is the signal that
the table is grouping too aggressively. Note the eval's isolated server
starts with an empty corpus, so a single run cannot exercise this feature
at all; measuring it needs a corpus-seeded run, which is a separate
exercise and is NOT part of this work.

## Testing

- `test/market.test.js`: `metroOf` and `siblingMarkets` for a member city,
  a metro's anchor city, an ungrouped city, junk input, and case/spacing
  variants; plus the round-trip assertion that every table entry equals
  `marketOf(entry)`.
- A retrieval-level test is deliberately not added: `retrieveCorpusComps`
  is impure (it queries Supabase or the file fallback) and this repo has no
  harness for it. The split it performs is a filter over rows whose
  `market` field the pure functions decide, so the pure tests carry the
  logic and manual verification carries the wiring.
- Manual verification at implementation time, against a locally running
  server with a seeded local `comp-corpus.jsonl`: a Meridian Industrial
  search finds Boise rows offered in the nearby block, the log line reports
  the nearby count, `corpusIsStrong` stays false on exact coverage alone
  so the budget is not cut, and `CORPUS_METRO=off` restores the old
  behavior exactly.

Ship with a devlog entry and a CLAUDE.md update to the corpus-first
retrieval paragraph, which currently states the exact-match rule as
absolute.

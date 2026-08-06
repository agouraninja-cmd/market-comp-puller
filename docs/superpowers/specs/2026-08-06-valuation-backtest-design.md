# Valuation backtest: measuring the reconciliation math against known sales

Date: 2026-08-06
Status: approved (owner, in-session)

## Problem

Nothing has ever measured whether CompNinja's valuation is right.

The math is substantial. `compWeight()` (index.html:2969) multiplies three
factors: a two-year recency half-life, a size-match penalty of one halving
per octave beyond 0.5x-2x of the subject, and a source-tier weight running
from 1.0 for verified down to 0.5 for model estimates. `trendFactor()`
indexes older comps forward to the report date at the market's annual
trend. `robustPpsfRange()` takes weighted quartiles once four or more comps
are present and the raw spread below that. Each of those choices is
defensible and each was made by judgment. None has been tested against an
outcome.

That gap blocks three separate things:

1. **Tuning is guesswork.** Changing the half-life from two years to
   eighteen months, or the size penalty from one halving per octave to two,
   moves every valuation the product has ever produced. There is currently
   no way to tell whether such a change made the numbers better or worse.

2. **The adjustment grid cannot be built responsibly.** The natural next
   step is an appraisal-style grid showing per-comp adjustments and an
   explicit reconciliation. That surfaces the arithmetic to the customer,
   which makes it much harder to walk back, and it multiplies the number of
   coefficients that need to be right. Shipping it before anything measures
   accuracy would mean publishing arithmetic chosen by intuition.

3. **The accuracy claim has no evidence behind it.** The standing principle
   is not to market "analyst-grade" before the comp audit scores 90%+. The
   corpus audit shipped 2026-08-05 measures *citation integrity*, which is
   a different property: it asks whether a comp's source proves the comp,
   not whether the valuation built from those comps is close. No artifact
   in the repo measures the second thing.

The obvious backtest, comparing old reports against sales that happened
afterward, needs history the corpus almost certainly cannot supply at
current traffic. Hold-one-out over the corpus itself does not: any priced,
sized corpus row is a known outcome, and the rows around it are the comps a
search would have used.

Feasibility was checked against the 144 rows in the local
`comp-corpus.jsonl` on 2026-08-06. That file is the dev fallback, not
production, so treat the counts as shape rather than as the real sample:

- 85 rows are priced, sized sale comps; 80 of those have a parseable
  `deal_date`.
- 8 market/type buckets hold 5 or more such rows (Ontario CA Industrial 10,
  Boise ID Residential 8, Ontario CA Residential 8, Mesa AZ Multifamily 7).
- Restricting each subject to peers that sold on or before its own deal
  date cuts scoreable subjects from 80 to 30. Deal years skew hard to
  recent (57 of 80 are 2026), which is why the cut is steep and why it
  eases as the corpus fills.

## Goal

An internal accuracy instrument on `/admin`: hold each usable corpus row
out, value it from its peers using the production math, and report how far
off the prediction was. Watched over time, it says whether the
reconciliation is improving.

## Non-goals

- **Not a public accuracy claim.** No figure from this ships to a marketing
  surface in v1. That decision waits until the number has been watched long
  enough to stop moving.
- **Not coefficient tuning.** This project builds the instrument. Changing
  the half-life or the size penalty is the next project and is what this
  one exists to inform.
- **Not the adjustment grid.**
- **Not a measure of comp discovery.** See below; this is the single most
  important limit and the UI must state it.

## What is measured, and what is not

The harness measures **the math, not the comp-finding**. Given a set of
comps it can say whether the weighting and reconciliation produce the right
number. It cannot say whether the model found good comps, because it feeds
the math comps that are already in the corpus rather than running a search.

A second, smaller gap: `trendPct` is null in the harness. In production it
comes from the model's `annual_price_trend_pct` for that search, which is
not stored on corpus rows, so `trendFactor()` runs its identity path and
the harness scores the untrended math.

Both limits go in a line of text on the card, next to the numbers. The
temptation to read the headline as "CompNinja is accurate to X%" will be
strong, and unqualified it would be an overclaim.

## Subject and peer selection

A corpus row is usable as a **subject** when it is:

- a sale, not a lease;
- priced and sized, such that `salePsfOf` yields a figure;
- carrying a parseable `deal_date`;
- of provenance better than `estimate` or `news`, the same usability
  standard `corpusRowsForMarket` applies.

That last filter carries weight out of proportion to its size. Scoring
predictions against a model's own estimate measures agreement between two
guesses, not accuracy.

A subject's **peer set** is every other corpus row that is:

- in the same `market` and of the same `property_type`;
- dated on or before the subject's `deal_date`;
- not the subject itself, and not a same-address duplicate of it, where
  "same address" is the normalized form `harvestComps` already uses to
  build `dedupe_key`. The corpus dedupes on address plus date plus price,
  so one building harvested twice at slightly different figures survives as
  two rows and would otherwise let a subject help value itself.

Fewer than three peers and the subject is skipped, counted as unscored.

**As-of peers are forced, not preferred.** `trendFactor()` only indexes
comps forward, because in production every comp is older than the search.
Valuing a 2024 sale with 2026 peers would require a backward-indexing path
the product does not have, at which point the harness stops measuring the
product. The cost is the 80-to-30 drop measured above.

**The prediction runs in $/SF.** Predicted total is `mid_psf x size` and
actual total is `actual_psf x size` with the same size on both sides, so
the percentage error is identical either way, and staying in $/SF keeps
`heroRound`'s display rounding (up to 1.25% on a seven-figure total) out of
a measurement of math.

## Metrics

Four numbers, because any one alone misleads:

| Metric | Definition | Why |
|---|---|---|
| Median absolute error | median of `abs(psfMid - actual) / actual` | The headline. The figure a skeptic asks for, and comparable to what AVMs publish. |
| Band coverage | share of actuals falling within `psfLow`..`psfHigh` | The product sells a range. A midpoint being off and a range missing entirely are different failures. |
| Median band width | median of `(psfHigh - psfLow) / psfMid` | Coverage without width is gameable: zero to infinity scores 100%. |
| N scored, N skipped | counts, with the skip reason | So the figure is never read as more solid than its sample. |

Plus a breakdown by property type. Industrial and Residential will almost
certainly not perform alike, and that difference is directly actionable.

**Below a floor of 20 scored subjects the card shows no headline**, only
progress toward it ("12 of 20"). A median over 8 subjects swings enough
that tuning against it would be tuning against noise.

## Architecture

### `valuation.js` (new, pure)

The production valuation core, extracted from `index.html` so the browser
and the harness run one copy. Pure in the sense `entitlements.js`,
`comp-gate.js` and `corpus-audit.js` are pure: no DOM, no globals, no
`fetch`, no clock reads.

Moves out of `index.html`: `numericValue` (2115), `salePsfOf` (2126),
`robustPpsfRange` (2909), `heroRound` (2936), `compAgeYears`, `compWeight`,
`trendFactor` (2961-2995), `TIER_WEIGHT` (2959), and the tier-key half of
`compTier` (8116).

It also exports the **composition**, which is the actual deliverable:

```js
valueFromComps(comps, { subjectSF, asOf, trendPct })
  -> { psfLow, psfMid, psfHigh, low, mid, high, n, trimmed }
```

`subjectSF` accepts a number or a `{ min, max }` range. The range form is
load-bearing: `renderOwnerHero` today multiplies `rr.low x sizeR.min`,
`rr.mid x midSize` and `rr.high x sizeR.max` (index.html:3303-3305), so a
single scalar could not reproduce the current hero when the owner enters a
size range. A number is treated as `min === max`. The harness always passes
a number, since a corpus row's size is exact, and reads only the `psf*`
figures.

Extracting only the leaf helpers would leave the sequence (filter to sale
comps, `salePsfOf`, `trendFactor`, `compWeight`, `robustPpsfRange`,
multiply by size) inline in `renderOwnerHero`, and the harness would have
to re-compose it. That re-composition is precisely the drift this project
exists to prevent.

Two behavior-preserving changes fall out of purity:

- `compAgeYears` currently falls back to `Date.now()` internally. The
  module takes `asOf` from the caller; `index.html` passes
  `meta.generatedAt || Date.now()` at the call site, which is what it
  effectively does today.
- `compTier` splits. `valuation.js` owns `TIER_WEIGHT` and the tier keys;
  `index.html` keeps `SOURCE_TIERS` for badge labels and CSS classes. If
  the key sets ever diverge, `compWeight`'s existing
  `TIER_WEIGHT[tier] != null` guard makes the comp neutral rather than
  mis-weighted, so the failure direction is already safe.

It must load in both a browser and Node, which is new for this repo; every
existing pure module is Node-only. A dual export with no dependency:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VALUATION = api;
})(typeof self !== "undefined" ? self : this, function () { /* ... */ });
```

`index.html` loads it with a script tag. `/valuation.js` joins the
`STATIC_FILES` allowlist (server.js:10804), which matches `req.url`
exactly, so no query string, consistent with every other entry there.

### `backtest.js` (new, pure)

Same discipline as `corpus-audit.js`: no I/O, no clock reads (the caller
passes `now`), no `require`s other than `valuation.js`.

```js
score(rows, { now, minPeers = 3, minSubjects = 20 })
  -> { medianAbsError, bandCoverage, medianBandWidth,
       scored, skipped: { thinPeers, unusable }, byType, belowFloor }
```

**It requires `valuation.js` and never reimplements any of it.** That
constraint is the whole reason the extraction happens first, and it gets a
comment saying so. A harness carrying its own copy of the math would report
a healthy number for arithmetic no customer runs, and nothing would catch
it. The repo already carries this hazard twice (the `compWeight` and
`exportReportKey` pairs both wear a warning); a third copy inside the
module whose job is to verify the math would be self-defeating.

### `server.js`

Owns the read and the route, as it does for every other pure module. Reads
through the corpus's existing storage layer, so local dev scores off
`comp-corpus.jsonl` and production scores off Supabase.

`GET /api/accuracy`, gated by `isAdminRequest` so it accepts the
`x-admin-key` header and the `cn_admin` cookie alike.

**Deliberately not folded into `/api/stats`.** This is a full-corpus read,
`/api/stats` runs every time `/admin` opens, and putting a whole-table scan
on the dashboard's critical path would make the page feel broken. This is
the same reasoning that keeps `/api/pricing` out of `/api/config`. The card
fetches lazily after `/admin` renders.

Memoized 15 minutes, with a Recompute control that busts the memo. Traffic
is one person; nothing more elaborate earns its keep. Scoring is quadratic
within a market/type bucket, but buckets are small by construction, so the
cost is the read, not the math.

### The `/admin` card

Renders the four metrics, the per-type breakdown, and the limits line.
Server-rendered with the dashboard's own inline CSS, like every other
`/admin` surface, so it carries no `tailwind.css` dependency.

## Data flow

```
comp_corpus rows
  -> usable-subject filter (sale, priced, sized, dated, provenance > estimate)
  -> per subject: peers = same market + type, deal_date <= subject's,
     self and same-address duplicates removed, >= 3 remaining
  -> VALUATION.valueFromComps(peers, { subjectSF, asOf: deal_date, trendPct: null })
  -> compare psfMid / psfLow / psfHigh against the subject's actual $/SF
  -> aggregate: median abs error, band coverage, median band width, N, skips, by type
  -> memoized JSON -> GET /api/accuracy -> /admin card
```

## Failure handling

Every failure says so rather than reporting a number. No database, a read
error, or zero usable subjects each render "Unavailable" or "No scoreable
history yet", never `0%`, matching the rule `introRequests` already
follows. Below the 20-subject floor the card shows progress toward it
instead of a median.

A fabricated zero on an accuracy dashboard is worse than a blank one,
because it is the kind of number someone repeats.

## Testing, and how the extraction is pinned

The extraction must not move a single customer-visible figure, so the tests
come first:

1. Capture the current inline math's exact `low`/`mid`/`high` against
   fixture comp sets: two comps (untrimmed), four or more (trimmed),
   missing dates, missing sizes, each source tier, the 0.15 weight floor,
   an off-size outlier.
2. Write those as assertions in `test/`.
3. Extract into `valuation.js`.
4. The same assertions must still pass.

`backtest.js` gets its own cases: subject excluded from its own peer set,
the as-of filter, same-address dedupe, the min-peer skip, floor behavior,
and the metric arithmetic against a hand-computed fixture.

`test/routes.test.js` gets a case proving `/api/accuracy` refuses without a
key and accepts both the header and the cookie. That file exists precisely
to catch gates that are correct in isolation but unwired.

`index.html` gains a script tag and loses roughly a hundred lines. No new
Tailwind utilities, so the regen hook has nothing to do.

## Sequencing

This is the first of two projects. It builds the instrument; the second
uses it to tune the coefficients, and only after that does the adjustment
grid become a responsible thing to ship.

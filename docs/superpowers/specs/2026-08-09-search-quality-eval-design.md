# Search-quality eval harness (design)

Date: 2026-08-09
Status: AGREED

## Problem

`MODEL` is pinned to `claude-sonnet-4-6` and nothing measures what a live
search returns. The accuracy backtest (`/api/accuracy`, `backtest.js`)
scores the reconciliation MATH over comps already in the corpus; it says
nothing about whether a search found good comps in the first place. So:

- A model upgrade cannot be evaluated. Wall clock is dominated by the 40 to
  70 seconds of report writing, and a newer model is the largest available
  lever on both speed and comp quality, but flipping it is a blind risk on
  the product's core function.
- Every prompt change so far (the length caps, the compact comp encoding,
  the notes rules) shipped on judgment alone. Some were measured by hand
  once, on one report, and never again.

## Decision

A scorecard, not an assertion suite. A run puts a fixed golden set of 12
addresses through the real `/api/comps` pipeline and records what came
back. There are no expected answers and no pass/fail: one run of a
stochastic model over 12 addresses is noisy, and a harness that pretends
otherwise would produce confident nonsense. The value is the comparison
between two runs (baseline model or prompt vs candidate), reported as
per-metric deltas that a human reads.

Owner call, 2026-08-09: 12 addresses, about $4.30 per run at the measured
$0.36 per search, so a model comparison costs about $8.60.

## Isolation (the part that could silently ruin the exercise)

The runner points at a server started from an isolated git worktree with
`SUPABASE_URL` blank. Every fallback file (`SEARCH_CACHE_FILE`,
`COMP_CORPUS_FILE`, `ANALYTICS_FILE`, `DYNAMIC_MARKETS_FILE`) is
`path.join(__dirname, ...)`, so all writes land in that worktree and
production sees nothing: no corpus rows, no market pages published, no
analytics events, no shared cache entries.

A second consequence is deliberate: with no database, corpus-first
retrieval finds zero coverage, so every eval search runs at full search
budget. Runs are therefore comparable to each other rather than to
production behavior, which is what a controlled comparison needs.

## Two server changes, both necessary

1. **`MODEL` reads from the environment**, defaulting to the current
   `claude-sonnet-4-6`. It is a plain const used in exactly two places
   (both the Anthropic request body). Without this the harness cannot do
   the one thing it exists for. The startup banner logs the live model so a
   misconfigured deployment is visible immediately rather than at the first
   404 from the API.
2. **An internal-only `fresh: true` body flag on `/api/comps`** that skips
   the cache READ (it still writes), gated on the `internal` check that
   already exists (`ADMIN_KEY` via the `x-admin-key` header). Without it,
   run B on a candidate model hits run A's cache entries and scores the old
   model's reports as the new one's: a false "no difference," which is the
   most dangerous possible outcome for this tool. Varying a cache-key field
   instead is not an option, because every field in `cacheKeyFor` is also a
   prompt input, so any key change also changes what is being measured.

Both are small and gated. Neither changes behavior for any existing caller:
the flag is ignored without the admin key, and the env var is absent in
production until someone sets it.

## Metrics

All derivable from the response with no ground truth, in a pure, tested
`eval-score.js`:

- **`pricedSales`** and **`valuationPossible`** (2 or more priced sale
  comps). The business-critical pair: below 2 the hero cannot produce a
  range at all, and below 4 the band is the untrimmed spread.
- **Provenance score**, computed with `valuation.js`'s existing
  `TIER_WEIGHT`, plus the raw counts per tier. Reusing that table keeps one
  provenance vocabulary in the repo.
- **`estimateRate`** and **`aggregateRate`** (addresses that name a
  statistic or carry no street number), using `corpus-audit.js`'s exported
  `isAggregateAddress`.
- **`inWindowRate`**: comps whose parsed deal date falls inside the
  requested lookback.
- **`marketMatchRate`**: comps whose city and state match the subject's.
  The scorer parses the "City, ST" tail itself rather than importing
  server.js's `marketOf` (not exported, and server.js cannot be required
  without booting a server). An approximation, documented as one.
- **`sizeRate`**: priced sale comps that carry a size.
- **`subjectSizeFound`**: whether the model returned `subject_size_sqft`
  when none was supplied.
- **Narrative lengths**: `summary`, `value_drivers`, `market_trend`,
  `price_discovery.note` character counts, a regression watch on the
  2026-08-03 length caps.
- **`durationMs`**: measured by the runner around its own fetch.

Dead citations get no metric of their own: the source-link check shipped
2026-08-09 already demotes them to `estimate` before the report is served,
so they surface in the provenance score and `estimateRate`.

Server-side token counts (`out_tokens`, `searches`) are deliberately NOT
plumbed into the response for this. They are the cost driver and would be
useful, but they live in `logEvent` and the Render log, and adding a third
server change to fetch them is not worth it in v1. Wall clock is the
number that matters for the visitor's experience and the runner measures it
directly.

## Files

- **`eval-set.json`** (committed): the 12 targets. Composition covers a
  dense metro, a thin rural market, a mid market, every property type
  (Industrial, Office, Retail, Multifamily, Land, Residential), and one
  known-hard case. Each entry carries `address`, `type`, `months`,
  `maxComps`, and a one-line `why` so a future editor knows what a target
  is there to catch.
- **`eval-score.js`** (new, pure, tested by `npm test`): `scoreReport`,
  `summarize`, `compare`. No I/O, no clock reads (the caller passes `now`),
  no requires beyond `valuation.js` and `corpus-audit.js`.
- **`run-eval.js`** (new, the impure runner, zero deps like
  `gen-market-seed.js`): reads `eval-set.json`, POSTs each target with
  `x-admin-key` and `fresh: true`, times each call, scores it, writes a
  summary and the raw reports. Also runs `--compare a.json b.json`.
- **`docs/evals/<timestamp>-<label>.json`** (committed): the run summary.
  Small, and run-over-run history is the whole point.
- Raw per-target reports go to a git-ignored scratch directory, not the
  repo.

## Failure handling

A target that errors (timeout, upstream failure, HTTP error) is recorded as
a failed target with its message and excluded from the metric averages,
never scored as a zero. The count of failures is itself a headline number
in the summary: a model that times out on a third of the set has told you
something important, and averaging its successes would hide it. The runner
continues after a failure rather than aborting the run, so one bad target
does not waste the searches already paid for.

## Out of scope

- Any `/admin` card or dashboard surface.
- CI integration or an automated regression gate.
- Token-count plumbing.
- Scoring existing cached reports or corpus rows (that is the backtest's
  job, and it cannot measure a new model).
- Changing `MODEL` itself. This harness is what makes that decision
  measurable; the decision is a separate, owner-triggered change.

## Testing

- `test/eval-score.test.js` covers the pure module: a report with known
  comps produces known metrics; empty and malformed reports score without
  throwing; `valuationPossible` at 1 vs 2 priced sales; provenance
  weighting; window and market matching including the "City, ST" parse's
  documented limits; `compare` deltas including a metric missing from one
  side.
- The runner is exercised once by hand at implementation time against the
  isolated worktree server, on a 2-target subset (about $0.72) to prove the
  plumbing end to end without paying for a full run.
- The first full run is a deploy-time, owner-triggered activity, not part
  of the implementation.

Ship with a devlog entry and a CLAUDE.md paragraph describing the harness,
the two server changes, and the isolation requirement.

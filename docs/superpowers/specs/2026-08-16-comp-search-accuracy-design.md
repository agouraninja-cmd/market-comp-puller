# Comp search accuracy harness (design)

Date: 2026-08-16
Status: AGREED

## Problem

Three things in this repo have "accuracy" in their name or their job
description, and none of them answers whether a comp the search returns is
**true**:

- **`eval-score.js` / `run-eval.js`** (2026-08-09) scores the SHAPE of a
  report: how many priced sales, what provenance tier, how many addresses
  name a statistic, how many dates land inside the window. Its own spec says
  every metric is "derivable from the response with no ground truth". A
  report of twelve beautifully-tiered comps with the wrong prices scores
  perfectly.
- **`corpus-audit.js`** (2026-08-05) scores CITATION INTEGRITY and says so
  in its spec, at length, precisely so the number can never be read as an
  accuracy rate: "That claim needs ground truth this project does not have."
- **`backtest.js` / `/api/accuracy`** (2026-08-06) scores the reconciliation
  MATH over comps already harvested. Its own header states the limit: "the
  math, not the comp-finding."

So the product's core function - go find real transactions - is the one
thing measured by nothing. A model change, a prompt change, or a provider
change can degrade it invisibly, because every existing scorecard would keep
reporting green.

Two distinct failures hide in that gap, and they need different instruments:

1. **A comp that contradicts itself.** The model writes a price, a size, and
   a $/SF that do not divide. It writes "$1.2M" into a price field a
   downstream `numericValue` reads as `1.2` (a hazard `valuation.js`'s
   `salePsfOf` already guards against, which is how we know it happens). It
   writes a lease rate into a sale's price. It returns the same building
   twice under two spellings, so one deal votes twice in the median. Every
   one of these is provably wrong **using nothing but the report itself** -
   no answer key required, no cost, fully deterministic.
2. **A comp that disagrees with a known deal.** This needs an answer key.

## Decision

One pure module, `comp-accuracy.js`, with two families of check, and one
runner, `run-accuracy.js`, that can execute either.

**Family 1, self-consistency**, needs no ground truth, costs nothing, and
runs today over any report or corpus dump. This is the half that is usable
on day one.

**Family 2, ground-truth agreement**, scores a live search against
`truth-set.json`, a committed answer key of real deals.

Like `eval-score.js` this is a SCORECARD, not an assertion suite, and for
the same reason: a dozen stochastic searches is a noisy sample. Family 1 is
the exception worth noting - a comp whose own three numbers do not divide is
wrong deterministically, not probabilistically, so its findings are defects
rather than signals.

## What this does NOT duplicate

Deliberately disjoint from the three modules above, because a second copy of
a metric is a second thing to keep in step:

| Module | Question |
|---|---|
| `eval-score.js` | What shape did the search return? |
| `corpus-audit.js` | Does the citation identify a property? |
| `backtest.js` | Does the reconciliation math land near a known price? |
| `comp-accuracy.js` | Are the comp's own numbers self-consistent, and do they match a known deal? |

`comp-accuracy.js` never counts tiers, never counts aggregate addresses,
never scores narrative length, and never runs the valuation. Where it needs
an existing rule it **requires the existing module** rather than restating
it: `normAddress` from `backtest.js` (the cross-search building identity,
with the Red Label Lane bug already beaten out of it), `cityStateOf` from
`eval-score.js`, `numericValue` from `valuation.js`, `isAggregateAddress`
from `corpus-audit.js`.

## Family 1: self-consistency findings

Per comp, all deterministic. Tolerances are named exported constants.

- **`psf_mismatch`** - a sale's stated `price_per_sqft` disagrees with
  `price_or_rate / size_sqft` by more than 5%. Fires only when all three
  parse and both figures land in a sane per-SF band, so the shorthand hazard
  below cannot masquerade as a rounding complaint.
- **`alt_basis_mismatch`** - the same arithmetic for the per-type
  denominators the market actually quotes: `price_per_unit` against
  `price / units` (Multifamily), `price_per_acre` against
  `price / lot_acres` (Land). Nothing checks these today, and they are the
  headline figure for two of the six property types.
- **`rate_as_sale_price`** - a sale whose price parses below $10,000 while
  its size is over 1,000 SF. Catches both real failure modes at once: the
  "$1.2M" shorthand that `numericValue` reads as 1.2, and a lease rate
  written into a sale's price field.
- **`implausible_psf`** - a sale whose effective $/SF lands outside
  $1 to $20,000. The band is deliberately very wide: it is here to catch
  garbage, not to have an opinion about Manhattan retail.
- **`future_date`** - a deal dated after `now`. A sale that has not happened
  is not a comp.
- **`duplicate_comp`** - two comps that are the same building, by
  `normAddress` or by an exact size-and-price coincidence (the second test
  is `backtest.js`'s own belt-and-braces rule, and it exists because that
  harness was once fooled into scoring three spellings of one warehouse as
  three independent subjects). One building counted twice votes twice in
  every median above it.

Score is `clean / total`, mirroring `corpus-audit.js`.

## Family 2: ground-truth agreement

`truth-set.json` holds real deals. For one target, the **expected** set is
the truth deals in that market and property type whose date falls inside the
requested window: the deals a competent search should have found.

- **`recall`** - expected deals matched to a returned comp.
- **`priceAgreeRate` / `sizeAgreeRate` / `dateAgreeRate`** over matched
  pairs, at 2% / 5% / 31 days. The three tolerances differ on purpose: a
  sale price is an exact number and a real match should be near exact, while
  sizes legitimately differ between sources (gross vs rentable) and a
  recording date legitimately differs from a closing date.
- **`contradictions`** - matched pairs outside the price tolerance. This is
  the headline accuracy failure: we know the deal, the search reported it,
  and the number is wrong.
- **`unverified`** - returned comps with no truth row.

**`unverified` is NOT an error rate and the module must never let it become
one.** The answer key is partial by construction - it holds the deals we
happen to know, not every deal in the market - so a comp absent from it is
unproven, not false. Reporting it as a false-positive rate would produce a
confident accuracy number that is mostly a measure of how small the truth
set is. This is the same honesty rule `corpus-audit.js` carries about its
citation score, and it is pinned by a test.

## The answer key

`truth-set.json`, committed. Each deal carries `address`, `city_state`,
`type`, `transaction`, `date`, `price`, `size_sqft`, `basis`, `source_url`,
`added`, `note`.

**`basis` is what keeps this an answer key rather than a mirror.** Allowed:

- `broker_verified` - an approved broker submission. A named broker vouched.
  Independent of the model.
- `public_record` - hand-entered from a county recorder or assessor page.
- `news`, `listing` - hand-entered from a press release or a sold listing,
  with the URL.

Refused, by the validator, with a named error: **`model_corpus`**. A deal a
past search produced is not independent of the thing being measured;
scoring a new search against it measures agreement between two model runs
and would report a flattering number for a shared mistake. This is exactly
`backtest.js`'s rule that ground truth needs provenance better than a model
guess, restated for a different harness.

The validator also refuses an aggregate address (via
`corpus-audit.js`'s `isAggregateAddress`), an unparseable date or price, and
a non-broker basis with no `source_url`. `test/comp-accuracy.test.js`
validates the **committed file**, so a malformed answer key fails CI rather
than silently scoring nothing.

**Seeding from approved broker submissions** (`--seed-from-submissions`)
reads `GET /api/comp-submissions` with the admin key and merges approved
rows in as `broker_verified`. Two rules, both because **this repo is
public**: only `status === "approved"` rows are taken, because approval is
what already publishes a submission's deal facts into customer-facing
reports, and **no broker identity travels** - not name, not email, not
phone, not company. The vault is never a source, for the obvious reason.

## The runner

`run-accuracy.js`, four modes, only one of which spends money:

- `--validate` - validate the answer key. Free, no network.
- `--corpus` - pull `GET /api/comp-corpus` and run family 1 over every
  harvested comp. Free, and the mode that produces a real number on day one
  with an empty answer key.
- `--offline <dir>` - run family 1 (and family 2 where the key covers it)
  over raw reports already on disk, including `eval-runs/` output that
  earlier billed runs already paid for. Free.
- default - real searches over the targets derived from the answer key, one
  billed search per market and type pair.

## Isolation, and why `run-eval.js` is refactored

The billed mode carries exactly the contract `run-eval.js` documents at
length: an isolated server with `SUPABASE_URL` blank, a `/api/stats`
preflight that refuses a database-backed target, and the two pre-run wipes
(`comp-corpus.jsonl`, `subject-sizes.json`) that stop a previous run handing
the next one corpus coverage and a shrunken search budget.

A second copy of that contract is the one duplication this repo cannot
afford here: if someone tightened `run-eval.js`'s preflight and not the
copy, an accuracy run would quietly write into production. So the contract
moves to **`eval-isolation.js`** and both runners require it. `run-eval.js`
keeps its behavior byte for byte - same probe, same messages, same exit
codes, same wipe order and the same reasons in the comments.

## Out of scope

- Any `/admin` card. `/api/accuracy` already owns the dashboard's accuracy
  surface, and this measures a different thing; conflating them on one card
  is how a citation score becomes an accuracy claim.
- CI gating on family 2. The answer key starts empty and a gate on an empty
  denominator is noise. Family 1's validator check IS in CI, via the test.
- Any public or marketing accuracy claim. Same standing rule as
  `corpus-audit.js` and `/api/accuracy`: nothing here ships to a customer
  surface.
- Import-time verification of comps in the live pipeline. This is a
  measurement harness, not a gate on what customers see.

## Testing

`test/comp-accuracy.test.js`, `node --test`, no database:

- Each family-1 finding fires on a comp built to trip it and stays quiet on
  a clean one, including the rounding case that must NOT fire.
- The shorthand hazard: `"$1.2M"` on a 10,000 SF sale is caught by
  `rate_as_sale_price` rather than slipping through as a tiny $/SF.
- Duplicates fire on a spelling variant and on the size-and-price
  coincidence.
- Recall, the three agreement rates, and contradictions on a known pair.
- `unverified` never enters the score as an error.
- The validator refuses `model_corpus`, an aggregate address, a missing
  `source_url` on a cited basis, and accepts a well-formed deal.
- The committed `truth-set.json` validates.

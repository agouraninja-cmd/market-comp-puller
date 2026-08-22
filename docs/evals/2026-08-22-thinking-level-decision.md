# THINKING_LEVEL: measured, decided `low` (2026-08-22)

**Decision: production runs `THINKING_LEVEL=low`.** Set in Render's
environment, not in code — rollback is unsetting it, with no deploy.

## Why this was asked

Report generation was ~30-34s and the brief was to speed it up without
losing quality. The first pass trimmed the report JSON (field order, a
derivable `price_per_sqft`) and bought about 0.1s, because the report JSON
was never where the time went. On the default provider a measured call
generated **928 tokens of report against 6,473 of thinking**, and Gemini
bills and generates thought as output — so roughly seven of every eight
tokens the model produced were reasoning. That is the lever.

## What was measured

Four runs, `scripts/compare-thinking.js`, 10 targets each (`--per-type 2`
over the lopsided eval set), ~$1.36 total.

| | default (x2) | low (x2) |
|---|---:|---:|
| time | 29.8 - 34.3s | **8.7 - 11.6s** |
| cost / report | $0.0296 | **$0.0090 - 0.0102** |
| cost / 1,000 | $29.56 | **$9.01 - 10.17** |
| thinking tokens | 4,394 | **258** |
| priced sale comps | 6.3 - 6.7 | 4.3 - 4.5 |
| comps returned | 6.5 - 7.1 | 4.6 - 4.8 |
| provenance score | 0.739 - 0.770 | **0.797 - 0.801** |
| unsourced "estimate" rate | 5.4 - 14.0% | **2.0 - 2.5%** |
| market match rate | 87.2 - 94.4% | **94.2 - 98.0%** |
| valuation possible | 100% | **100%** |

**The deltas are real.** Replaying the default arm against the committed
2026-08-19 baseline put the run-to-run noise floor at roughly +/-9% on
comps, +/-6% on priced sales, +/-15% on duration. The low-vs-default moves
are 3-5x that.

## The finding that decided it

Thinking less did not find *worse* comps, it found *fewer* comps. The
shorter list was better on every provenance measure, and the unsourced
"estimate" rate — the tier meaning "could not tie this to a source" — fell
from as high as 14% to 2%, the best this eval has recorded. Strip estimates
out and the real drop is 6.11 -> 4.70 sourced comps, -23% rather than -33%.

The per-target distribution mattered more than the average, because the
hero's value band only trims to an interquartile range at 4+ sale comps:

    Land        Olathe KS        7      Retail      Los Angeles CA   4
    Industrial  Nampa ID         5      Retail      Ft Lauderdale    4
    Office      Chicago IL       5      Multifamily Austin TX        4
    Residential Boise ID         5      Multifamily Atlanta GA       3   <- was 4
    Office      Phoenix AZ       4      Industrial  Dallas TX        2   <- was 6

**8 of 10 keep the precise band.** Atlanta slipped by one from an already
borderline 4. Only Dallas genuinely collapsed.

## The trade, stated plainly

Bought: 3x faster, 3x cheaper, better-sourced comps, and every report still
valuable. Paid: ~2.2 fewer priced comps per report, and ~20% of reports fall
back to a full-spread value range instead of a trimmed one. A visibly
shorter comp table is the cost a customer actually sees.

## What was tried and rejected

`COMP_FLOOR` (kept in the tree, off) asked the model to keep hunting to six
comps while restating every anti-padding rule. Measured at the same
reasoning depth, both arms fresh in one session:

- comps 4.6 -> 4.8 and priced sales 4.3 -> 4.4, both **inside** the +/-4%
  the low arm wobbles by on its own. No effect.
- estimate rate 2.5% -> 5.8%, **+133%**. It bought its handful of comps with
  guesses, which is the trade this project must never make.
- time +20%, cost +17%, in-window rate -3.3%.
- `thoughtTokens` 0 -> 309. The mechanism is visible: the instruction made
  the model think harder about the instruction, not search harder for comps.
  Telling a model you have deliberately told to reason less to "try harder"
  spends the savings on deliberation.

## What to watch now that it is live

- **Estimate rate.** 2% is the prize here. If it climbs, the trade has
  changed and this decision should be re-run.
- **Comp counts.** They should drift UP without any change: the radius blend
  folds saved corpus deals within 10 miles into new reports, so coverage
  compounds with traffic.
- **Whether anyone remarks on shorter tables.** The one cost no metric here
  captures.

Re-measure with `node scripts/compare-thinking.js --dir <worktree>
--admin-key K --key K --per-type 2` (about $0.62, prints the bill and stops
without `--yes`).

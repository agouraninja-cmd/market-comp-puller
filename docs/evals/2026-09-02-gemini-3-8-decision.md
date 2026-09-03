# Gemini 3.8 Flash: measured, decided NOT to switch (2026-09-02)

**Decision: production stays on `gemini-3.7-flash` at `THINKING_LEVEL=low`.**
Owner's call after the comparison below. PR #270, which moved the provider
default to `gemini-3.8-flash`, was closed unmerged. `gemini-3.8-flash` is
live on the project's key and passes `scripts/verify-gemini-stream.js
--grounded`, so switching later is the one-line `defaultModel` change that
PR held, plus this measurement re-run on more targets.

## What was measured

Four arms over the same three eval targets (`--only 3`: Dallas TX, Nampa ID,
Pocatello ID — all Industrial), each search fresh (`fresh: true`), on an
isolated server with no database. `scripts/compare-thinking.js` ran two
pairs; the 3.8 high arm was re-run by hand after its first server died the
documented silent Windows child death before its first search completed.
About $0.60 total.

| per report | 3.7 low (prod) | 3.8 low | 3.8 medium | 3.8 high (2 of 3) |
|---|---:|---:|---:|---:|
| time | **12.9s** | 21.5s | 78.9s | 109s |
| cost | **$0.0084** | $0.0097 | $0.065 | $0.085 |
| cost / 1,000 | **$8.43** | $9.66 | $65 | $85 |
| thinking tokens | 0 | 0 | 12,951 | ~17,600 |
| comps returned | 4.3 | 5.7 | 9.3 | 10.0 |
| priced sale comps | 3.7 | 5.3 | 7.3 | 9.0 |
| provenance score | **0.850** | 0.782 | 0.842 | 0.808 |
| unsourced "estimate" rate | **0%** | 12.2% | 8.3% | 10% |
| in-window rate | 36.7% | 55.6% | 79.2% | 100% |
| valuation possible | 100% | 100% | 100% | 100% (of 2) |

Per address — comps / priced sales, and the mid $/SF the hero multiplies:

| | 3.7 low | 3.8 low | 3.8 medium | 3.8 high |
|---|---|---|---|---|
| Dallas | 7s, 4/4, $185 | 19s, 5/5, $201 | 84s, 8/8, $164 | 126s, 10/8, $285 |
| Nampa | 10s, 5/3, $294 | 23s, 6/6, $203 | 77s, 12/8, $242 | failed twice |
| Pocatello | 22s, 4/4, $177 | 23s, 6/5, $128 | 76s, 8/6, $114 | 92s, 10/10, $150 |

## What decided it

- **3.8 high is not usable as measured.** The Nampa search died on two
  separate attempts with Gemini's own `Internal error encountered` mid-stream,
  each after 70-90 grounded searches. The two that finished took 92s and
  126s. That is the vendor failing, reproducibly, at this depth.
- **3.8 medium** returns about twice production's comps and the best
  in-window rate, at six times the wall clock and seven times the cost — the
  86% thinking share the 2026-08-22 decision already chose to give up.
- **3.8 low**, the like-for-like candidate, returned more comps and priced
  sales but ran about twice as slow and let estimate-tier rows back in where
  3.7 low returned none. The 2026-08-22 record names the 2% estimate rate as
  "the prize" of running low, and 3.8 low gave it back.
- **The mid $/SF on the same building spread widely across arms** (Dallas:
  $164 to $285). Three searches cannot say which is right, only that the
  spread is wide.

## Caveats on the sample

- Three targets, all Industrial: small and noisy. Read direction, not
  decimals. `--per-type 2` (10 targets) is the shape to re-run at if 3.8 is
  reconsidered.
- The 3.7 low Dallas search reused a building size the 3.8 low arm had just
  looked up: `compare-thinking.js` wipes fallback files in ITS checkout
  (`run-eval.js`'s cwd) while the server writes them in `--dir`, so between
  arms the worktree's `subject-sizes.json` and `comp-corpus.jsonl` survive.
  Wipe them in `--dir` by hand between pairs, or fix the script to.
- "low" produced 0 thinking tokens on BOTH models here, against 258 in the
  2026-08-22 runs on 3.7.

## Files

- `2026-09-03-thinking-MODEL-gemini-3.7-flash-1788400188159-*.json` — 3.7 low
- `2026-09-03-thinking-low-1788400188159-*.json` — 3.8 low
- `2026-09-03-thinking-medium-1788400338311-*.json` — 3.8 medium
- `2026-09-03-thinking-high-1788400338311-*.json` — 3.8 high, first attempt
  (3/3 `fetch failed`: the server died, nothing was searched)
- `2026-09-03-thinking-high-rerun-1788400972530.json` — 3.8 high, re-run
  (2 scored, Nampa 502 from Gemini)

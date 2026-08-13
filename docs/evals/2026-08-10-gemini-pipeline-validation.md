# Gemini through the real pipeline: phase 2 validation gate

**Date:** 2026-08-10
**Verdict: GO for phases 3 to 5.**
**Run:** `docs/evals/2026-08-10-gemini-pipeline-1786402056384.json`
**Baseline:** `docs/evals/2026-08-10-sonnet-4-6-1786376928210.json`

This is the gate the multi-provider spec put before the expensive parity work.
It answers one question: does Gemini's advantage survive contact with the real
product, rather than the standalone scratch harness that first measured it?

It does, but smaller than the offline run claimed, and that correction is the
main value of this document.

## Result

| Metric | sonnet-4-6 | gemini, real pipeline | offline harness (for contrast) |
| --- | --- | --- | --- |
| Valuation possible | 82% | **100%** | 100% |
| Comps / report | 6.8 | **6.9** | 6.2 |
| Priced sales / report | 4.8 | **5.3** | 6.2 |
| Provenance score | 0.73 | **0.77** | 0.83 |
| In-window rate | 88% | **99%** | 99% |
| Market match rate | 82% | **92%** | 94% |
| Estimate rate | 19% | **8.5%** | 0.0% |
| Wall clock | 87s | **56s** | 37s |
| Cost / report | $0.36 | **$0.092** | $0.062 |
| Failures | 1 | **0** | 0 |

Gemini still wins on every scored metric. The honest multipliers are **3.9x
cheaper and 1.6x faster**, not the 6x and 2.4x the offline harness suggested.

Cost is computed from the run's own logged token counts through the provider's
`costOf`, not estimated: 12 billed calls, 7,300 input and 10,544 output tokens
per report on average, $1.099 for the whole run.

## The two things only the real pipeline could measure

### 1. Link-check demotions: real, and they explain the offline provenance gap

`applySourceLinkCheck` demoted **6 comps across 4 of the 12 targets**:

```
1 comp(s) demoted: source link dead at harvest (4 checked, 1 dead, 3 blocked-host, 3 unknown)
2 comp(s) demoted: source link dead at harvest (4 checked, 2 dead, 2 blocked-host, 1 unknown)
2 comp(s) demoted: source link dead at harvest (7 checked, 2 dead, 1 blocked-host, 2 unknown)
1 comp(s) demoted: source link dead at harvest (4 checked, 1 dead, 0 blocked-host, 3 unknown)
```

This is exactly the caveat the spec flagged. The offline harness reported an
`estimateRate` of **0.000**, which looked like flawless provenance. The real
pipeline reports **0.085**, because it actually checks whether the citations
resolve. The offline figure was an artifact of a harness that never ran the
check, not a property of the model.

Gemini's 8.5% is still less than half of sonnet-4-6's 19%, so the direction of
the finding holds. But anyone quoting the 0% from the offline run would be
quoting a measurement error.

### 2. Listing-versus-closed-sale risk: low, and lower than feared

Of **74 sale comps**, 3 are dated the current month, and **1** of those cites a
listing site. That is **1.4% of sale comps** at risk of being an active listing
reported as a closed sale:

```
Aug 2026 | 1901 S Federal Hwy, Fort Lauderdale, FL | https://www.loopnet.com
```

The offline run made this look worse: on the Dallas target alone, 3 of 7 comps
were current-month Crexi entries. Across the full real-pipeline set the pattern
does not hold. This does not need to block phases 3 to 5.

## Why the offline numbers were optimistic

Three causes, all now understood:

1. **No link check.** Worth the entire estimate-rate gap (0.000 to 0.085).
2. **A smaller prompt.** The scratch harness sent a simplified prompt. The real
   one carries corpus blocks, verified-comp offers and per-type guidance, so
   input rose from 4,207 to 7,300 tokens and output from about 7,400 to 10,544.
   That is the whole cost and wall-clock difference.
3. **A suspiciously clean comp set.** Offline, every target returned
   `comps == pricedSales` exactly, which is not how real markets behave. Through
   the real pipeline the numbers diverge properly (Atlanta 7 comps / 3 priced,
   Olathe Land 8 / 2). The normalization the product applies is doing its job.

## Known limits of this result

- **Single stochastic run.** Twelve searches are noisy. Read the direction, not
  the decimals.
- **`searches` is meaningless for Gemini.** The Interactions API does not report
  grounding query counts per call, so `parseResponse` honestly returns 0 rather
  than inventing a number. Phase 3's cost accounting cannot use it, and per-search
  metrics cannot be compared across providers.
- **Corpus-first retrieval no longer cuts cost on Gemini.** `google_search` takes
  no `max_uses`, so the corpus remains a quality lever only. Every figure above
  was measured with a cold corpus, so this run does not show what a corpus-strong
  Anthropic search would cost by comparison.
- **Grounding is free at this volume** (5,000 queries/month included) and is not
  modelled in `costOf`. That stops being true at scale.
- **This run had BOTH keys set, so it never tested a Gemini-only deployment.**
  The eval server carried `ANTHROPIC_API_KEY` alongside `GEMINI_API_KEY`. The
  final whole-branch review caught why that matters: `/api/comps` and
  `/api/explore-market` still gated on `ANTHROPIC_API_KEY`, so a deployment
  configured the way CLAUDE.md documents (Gemini plus only `GEMINI_API_KEY`)
  would have refused every search with a 500 naming the wrong variable. A
  12/12 scorecard is only possible *because* the Anthropic key happened to be
  present. Fixed after the gate, and separately verified by booting with no
  Anthropic key at all and confirming the request reaches the Gemini call.
  The lesson generalizes: a green validation run proves the configuration you
  ran, not the configuration you documented.
- **Not a decision to switch.** `SEARCH_PROVIDER` still defaults to `anthropic`.
  This gate authorizes building phases 3 to 5, nothing more.
- **The privacy policy names Anthropic as the sole AI processor.** Customer
  facing and unchanged by this branch. It needs a deliberate decision before any
  public Gemini-default deployment, and that is a content and legal call rather
  than a code change.

## Defects this phase caught

Five defects surfaced during implementation, and **all five were in the plan
rather than in the implementations**:

1. A usage spread that zeroed the token counters on every streamed search.
2. `parseResponse` using a flat join that could not satisfy its own two tests.
3. The API key selected by provider name, violating the plan's own constraint.
4. The call deadline reading `body.max_tokens` while the Gemini module emitted
   `max_output_tokens`, giving a NaN deadline that aborted every Gemini call
   after one millisecond.
5. `max_output_tokens` sent at the top level of the Interactions body, which
   that API rejects outright. The correct form is
   `generation_config: { max_output_tokens: N }`, verified live.

Numbers 4 and 5 were both invisible to `npm test`, because no unit test
exercises a real request body against a real endpoint. Number 5 was caught by a
single-target smoke test costing about six cents, which would otherwise have
failed all twelve targets and produced a scorecard reading "Gemini does not
work."

**Carry into phase 3:** `status: "incomplete"` is Gemini's truncation signal,
the analog of Anthropic's `stop_reason: "max_tokens"` that nearly faked the
Sonnet 5 verdict. It already surfaces through `parseResponse` as `stopReason`.
Watch it.

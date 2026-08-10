# Multi-provider comp search: design

**Date:** 2026-08-10
**Status:** Approved, not yet implemented
**Related:** `docs/evals/2026-08-10-sonnet-4-6-*.json`, `docs/evals/2026-08-10-gemini-3-6-flash-*.json`

## Why

Gemini 3.6 Flash was measured against the `sonnet-4-6` baseline on the standard
12-target eval set (`eval-set.json`) and beat it on every scored metric:

| Metric | sonnet-4-6 | gemini-3.6-flash |
| --- | --- | --- |
| Valuation possible | 82% | 100% |
| Priced sales / report | 4.8 | 6.2 |
| Provenance score | 0.73 | 0.83 |
| In-window rate | 88% | 99% |
| Market match rate | 82% | 94% |
| Estimate rate (aggregate padding) | 19% | 0% |
| Wall clock | 87s | 37s |
| Measured cost / report | $0.36 | $0.062 |

Roughly 6x cheaper and 2.4x faster, at better measured quality. Two skeptical
checks were run before believing it, and both passed. All 74 Gemini comps were
re-typed through the product's own `AUDIT.enforcedSourceType`: zero changed,
so the 0% estimate rate reflects genuinely street-numbered individual
properties rather than a scoring artifact. A live HTTP check of the
non-bot-walled deep links found one dead link (404) out of twelve; the 403s
are bot walls, which `link-check.js` already treats as alive.

That measurement came from a standalone scratch harness (`eval-gemini.js`),
not the product. It bypasses corpus-first retrieval, verified broker comps,
`applySourceLinkCheck`, gating, and the subject-size search-budget interplay,
and it uses a simplified prompt. **The purpose of this work is to make the
comparison real, and to make a provider switch an actual product capability
rather than a scratch experiment.**

Cost matters here beyond the immediate saving: the stated long-term product
direction is free comp reports funded by a growing Pro tier, so a 6x cut in
marginal report cost changes what that plan can afford.

## Decisions taken

Three questions were asked and answered before design:

1. **Scope: production multi-provider support**, not throwaway validation.
2. **Progress UX: full parity, phased in.** Phase 1 ships non-streaming so the
   validation signal arrives early; streaming parity lands later.
3. **Selection: a global env flag plus automatic fallback.**
   `SEARCH_PROVIDER=anthropic|gemini` picks the default, and a provider that
   fails at the transport level falls through to the other.

## Architecture

### The seam

`callAnthropicOnce` is the only genuinely provider-specific function in the
search path. It is called from exactly one place (`getComps`). Everything
downstream of `getComps` already operates on the parsed report object and is
provider-agnostic: `normalizeSourceTypes`, `applySourceLinkCheck`,
`gateReport`, `blendComps`, `harvestComps`, `storeCachedSearch`,
`maybePublishMarketSnapshot`.

So the change is to replace one function with a provider registry, not to
rewrite the pipeline.

### The provider module is pure; `server.js` keeps the I/O

This follows the split the repo already uses. `entitlements.js` holds the
rules while `server.js` owns the reads. `vault-page.js` draws the page while
`server.js` resolves the data behind the gate. Applied here:

```js
// search-provider-gemini.js
module.exports = {
  name: "gemini",
  capabilities: {
    searchBudget: false,       // google_search accepts no max_uses
    promptCaching: "implicit", // no cache_control breakpoint
  },
  buildRequest({ prompt, maxComps, searchUses, stream }), // -> {url, headers, body}
  parseResponse(body),                                    // -> {text, usage, searches}
  frameToEvents(frame),                                   // -> normalized progress events
  costOf(usage),                                          // -> dollars
};
```

`server.js` retains `fetch`, the derived timeout, the abort handling, the
chunk loop, and the `solo()` retry ladder. Every exported provider function is
pure, so all of it is testable against recorded fixtures with no network and
no API key.

`buildPrompt` stays exactly where it is, shared and unchanged. The prompt text
is provider-agnostic.

### The capability descriptor is load-bearing

`searchBudgetFor` returns a `max_uses` that Gemini physically cannot honor,
and `searchTimeoutMsFor` derives the call deadline from that same number. A
Gemini call routed through the existing code would therefore inherit a
deadline computed from a search budget that was never applied.

`server.js` must branch on `capabilities.searchBudget`, **never on
`provider.name`**. This mirrors the rule already enforced for plan names in
`entitlements.js` and for `canUseVault` in the vault routes: test the
capability, never the name. A name test is how a third provider later grows a
silent hole.

Consequence worth recording: on a provider without `searchBudget`,
corpus-first retrieval stops being a **cost** lever. It still improves quality
by seeding the prompt with known comps, but it can no longer cut the search
budget from 10 to 3. The measured $0.062 already reflects this, since that run
was uncapped.

### What transfers unchanged

`makeCompExtractor` scans streamed **text** incrementally, so it is already
provider-agnostic. Only the frame-to-event mapping is provider-specific.

### Fallback fires on transport failures only

A timeout, a 5xx, or a connection reset falls through to the other provider. A
**parse failure does not**, because `solo()` already owns that path with its
salvage, repair, and re-search ladder.

If fallback also caught malformed JSON, a provider that reliably emitted bad
output would silently double the cost of every search. That is the shape of
failure that hides for weeks. Fallback sits above `solo()`, never inside it.

### Cost accounting stops being a constant

`COST_REPORT_SEARCH` is currently a flat `0.36` feeding the `/admin` spend
tile. With two providers roughly 6x apart, one constant makes that tile
meaningless. Each provider's `costOf(usage)` computes from real token counts,
and the analytics event records which provider ran.

The `analytics_events` schema is fixed, so the provider name rides in the
existing `source` column, the same way `link_check` counts already do.

## Phasing

### Phase 1: the seam, Anthropic only

Extract `search-provider-anthropic.js` from the existing `callAnthropicOnce`
with **zero behavior change**.

This phase is independently verifiable in a way later phases are not:
`npm test` stays green, and the same address searched before and after must
produce an identical report. If that does not hold, the seam is wrong and
nothing else should be built on it.

### Phase 2: Gemini, non-streaming. The validation gate.

Add the Gemini module and the capability branches. At the end of this phase,
`SEARCH_PROVIDER=gemini` runs real searches through the real pipeline.

**This is where we learn whether the 6x holds up, and it lands before the
expensive work.** Two things must be measured here that the scratch harness
could not:

- **How many comps `applySourceLinkCheck` demotes.** The offline audit found
  30% of Gemini's `source_url` values were bare domains with no path. Those
  prove nothing to a customer, and the real pipeline may demote them.
- **The listing-versus-closed-sale rate.** Several Gemini comps dated the
  current month cite Crexi, which suggests active listings may be reported as
  closed sales. Observed on the Dallas target, never quantified.

If either number is bad, phases 3 to 5 should not be built.

### Phase 3: per-provider cost accounting

`costOf(usage)` wired into the analytics event and the `/admin` spend tile.

### Phase 4: streaming parity

The Gemini frame reader and event mapping, so Gemini reports assemble live
through the existing `beginAssembly` / `assemblyComp` / `assemblySummary`
surfaces.

### Phase 5: fallback

Transport-level fallback between providers, per the rule above.

Phases 3 through 5 are each independently shippable and only justified by
phase 2's numbers.

## Testing

- **Pure-module tests per provider**, run against **recorded fixtures**
  captured from real calls and committed to the repo, so CI needs no API key
  and no network. Covers `buildRequest` shape, `parseResponse` extraction,
  `frameToEvents` mapping, and `costOf` math.
- **A wiring test** in the style of `test/routes.test.js`, which exists
  precisely to catch rules that are correct in isolation but never actually
  wired to a route. The same hazard applies here: a capability descriptor that
  is right in the module and ignored by `server.js` would pass every unit
  test.
- **Phase 1 regression check**: an identical-report comparison across the
  refactor, not just a green suite.

## Risks and open questions

- **The Interactions API streaming format is unverified.** Phase 4's size is a
  genuine unknown. That is why it sits late.
- **Gemini's `maxOutputTokens` must be checked against the truncation trap.**
  The Sonnet 5 evaluation was nearly ruined by a 10,000-token ceiling
  truncating JSON mid-array, with the repair call salvaging one comp from the
  fragment. Gemini's thought tokens count toward output (6,473 thought versus
  928 output on a measured eval call), and this prompt asks for large JSON, so
  the ceiling needs to account for both.
- **Single stochastic run.** The 12-target comparison has not been repeated.
  Phase 2 should re-run for confidence rather than trusting one pass.
- **Google billing is fragile in this account.** Grounding requires a
  paid-tier project. The `compninja.co` Workspace org has a policy requiring
  Gemini API keys to be bound to a service account, which makes Cloud Console
  key creation impractical; the working path was AI Studio prepay billing on
  `Default Gemini Project`. Verify grounding returns `groundingMetadata`
  before assuming a key works.

## What this design does not do

- It does not switch the default provider. `SEARCH_PROVIDER` defaults to
  `anthropic`, and changing that is a separate decision requiring phase 2's
  numbers.
- It does not add Perplexity. The harness exists (`eval-perplexity.js`) and is
  unrun; a third provider would slot into the same registry if wanted.
- It does not abstract `buildPrompt`. Per-provider prompt tuning may prove
  necessary later, but adding that indirection now would be designing an
  abstraction before meeting the thing it abstracts.
- It does not change corpus-first retrieval, even though its cost payoff
  changes on a provider without a search budget. Re-tuning that subsystem is
  out of scope and should follow real measurement.

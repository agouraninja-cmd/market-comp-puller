# Live report preview on the loading card

Date: 2026-08-03
Status: approved (owner, in-session)

## Problem

A billed search spends ~5s on web searches and 40-70s on the model writing the
report. The loading card already receives real progress (including per-comp
events), but renders them as five plain text lines. The user stares at a
progress bar for the longest phase even though most of the report's content has
already arrived in the browser. Perceived wait is the cheapest lever left:
the write phase cannot be made much faster without cutting output, but the
wait can be made to feel like reading instead of waiting.

## Goal

While the model writes, the loading card shows a growing preview of the real
report: the market summary paragraph as soon as it streams in, and a compact
table of comps that gains a row per comp event. The final `result` event still
drives the normal full `renderResults`, which replaces the preview wholesale.
Zero added cost (no extra API calls, no extra searches), zero quality change
(the final report is byte-identical to today's).

## Non-goals

- No early rendering of the real results section, hero, chart, or map.
- No provisional value range (the number would shift as comps land).
- No change to the prompt, search budget, cache keys, or gating rules.
- No change to the three streaming fallback layers.

## Design

### Server (server.js)

1. **Enriched comp events.** `makeCompExtractor`'s callback payload grows from
   `{ n, address, price }` to also carry `size_sqft`, `date`, `transaction`
   (all stringified, same defensive coercion as today's fields).
   Deliberately excluded: `price_per_sqft` (corrected post-parse by
   `reconcilePricePerSqft`) and `source_type` (demoted post-parse by
   `normalizeSourceTypes`). The preview must never show a figure or badge the
   final report walks back; `price_or_rate` is safe because it renders
   unchanged in the final table. `guardComp` needs no change: it already
   passes identified events through and anonymizes past-plan events to
   `{ locked: true }`, so enrichment flows to allowed comps only.

2. **One new `field` progress event.** A small string-escape-aware watcher on
   the streamed text fires once when the top-level `"summary"` value closes,
   emitting `{ phase: "field", key: "summary", value }`, with em dashes
   stripped to match post-parse treatment (`stripEmDashes`). The prompt
   already orders `summary` before `comps`, so this arrives in the first
   seconds of the write phase; no prompt change. Same safety contract as the
   comp extractor: wrapped so any throw disables it for the rest of the call,
   and the authoritative report never depends on it. Only the primary/solo
   lane gets one (the records lane reports no progress).

### Client (index.html)

3. **Preview table.** `loadingComps` becomes a compact table (Address /
   Price / Size / Date) inside a wider container than today's `max-w-xs`.
   One row per identified comp event, all rows kept (no 5-row cap). The
   locked marker stays as a single footer line ("+N more found - unlock with
   Pro"). The summary renders as a short labeled paragraph above the table
   when its `field` event arrives. All model-written text via `textContent`,
   never `innerHTML`. The box keeps `aria-hidden` (the polite live region
   above narrates progress). `resetLoadingComps` clears summary and table;
   the `retry` phase already calls it, so attempt 2 starts clean.

4. **Geocode prefetch.** Each identified comp event fires the existing client
   geocode helper for its address, fire-and-forget. Results land in the
   existing `geoCache.v1` localStorage cache, so `renderResults`' map paints
   pins immediately instead of trickling. Same total request count as today,
   naturally throttled by comp arrival (~1/sec).

### Unchanged, and load-bearing

- Final `result` -> `completeLoadingCard()` -> `renderResults` exactly as
  today; the preview is discarded, so reconciliation is free.
- Fake wall-clock progress, non-SSE content-type fallback, and the 8-second
  silence watchdog: untouched. A buffered stream means no preview, which is
  today's behavior.
- Cache hits stay plain JSON and never see any of this.
- `comp` and `field` events do not claim `ctx.lastPhase` (same rule as
  today's `comp` events, or the drafting branch re-swaps the headline).

## Error handling

Every new piece is additive and fails silent: extractor throws disable the
extractor, a malformed event is ignored by `applyProgress`, a failed geocode
prefetch is already swallowed by the geocode helper. No new user-facing error
states.

## Testing / verification

- No automated coverage (only `entitlements.js` has a suite; the extractors
  live inside server.js by design).
- End-to-end via the zero-cost fetch-shim harness: replay a canned Anthropic
  SSE stream against a locally running server and watch the preview fill in,
  including the locked-comp path and the retry reset.
- One real billed search as a final sanity check.
- New Tailwind utilities (if any) are covered by the auto-regen hook.
- Devlog entry ships in the same commit.

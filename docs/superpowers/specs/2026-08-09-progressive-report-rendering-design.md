# Progressive report rendering (design)

Date: 2026-08-09
Status: AGREED (approach B chosen over a richer loading-card preview and over
teaching renderResults partial data)

## Problem

A report search spends ~5 seconds searching and 40 to 70 seconds writing.
During the write the visitor watches a loading card. The card already previews
streamed comps in a mini table and shows the streamed summary as an "Early
market read", but when the report finishes the whole card is discarded and the
results section appears as a scene change. The wait feels like a spinner
followed by a reveal, not like a report being assembled.

## Decision

When streamed content starts arriving, reveal the real results section in an
"assembling" state and fill the actual report surfaces in place: the value
hero as a calm placeholder with live counts, the real summary block, and the
real comp table receiving rows as they stream. The final `result` event then
runs `renderResults` exactly as today, repainting the same regions with
authoritative data. Finishing becomes a refinement of a layout the visitor is
already reading.

Two constraints fixed during design, both owner-confirmed:

1. **No dollar figures before the final render.** The server already withholds
   `price_per_sqft` and `source_type` from `comp` events because both are
   corrected post-parse; the preview must never show a figure or badge the
   final report walks back. The assembling hero shows counts only
   ("7 comps so far, 4 priced sales"), never a valuation.
2. **Report search only.** The Market Explorer keeps its compact progress
   applier untouched.

## What the visitor sees

1. Submit. Loading card appears exactly as today (headline, progress bar,
   detail line). The corpus/search phases are short and stay on the card.
2. First streamed content (the `field:summary` event or the first `comp`
   event, identified or locked, whichever lands first): the results section
   appears below the
   loading card in assembling state. The loading card stays, slimmed to
   headline + bar + detail; its embedded preview table and "Early market read"
   block are retired (their content now renders in the report itself).
3. As `comp` events arrive, rows append to the real comp table (core columns
   only). The hero placeholder's counts tick up. Locked events maintain a
   "+N more found · unlock with Pro" line below the table, as today.
4. Final `result`: bar snaps to 100, loading card hides, assembling class is
   removed, `renderResults` runs unchanged and repaints everything, adding the
   toolbar, stat tiles, map, chart, and full per-type columns.

Rows appear with a subtle fade only. No shimmer, no skeleton animation
(calm-UI rule).

## Mechanics (index.html only; no server change)

The server side needs nothing: `comp` and `field` events already carry
everything used here, and `guardComp` already anonymizes past-entitlement
comps to `{ locked: true }`.

### Assembly state

- `#results` gains a class `assembling` while active, plus `aria-busy="true"`.
- Participating top-level blocks are tagged `data-assemble` in the HTML: the
  hero card, the summary card, and the comp table card. CSS hides every other
  direct child of `#results.assembling`. An allowlist, deliberately: a future
  card added to the results section stays hidden during assembly by default
  instead of leaking in half-rendered.
- The toolbar (share/save/export buttons) is never visible during assembly;
  exports and shares only exist for a finished report.

### New functions (all near the existing loading-card code)

- `beginAssembly(address, type)`: clears any previous report's content out of
  the participating blocks (hero to placeholder state, summary text emptied,
  table reset to a core-column header + empty tbody), un-hides `#results`,
  adds `assembling`. Idempotent; called by the first qualifying event.
- `assemblyComp(evt)`: identified comps append a row (n. address /
  transaction / price / size / date), `textContent` only, never `innerHTML`
  (model-written text). Keeps the `geocodeAddress(evt.address)` cache warmer.
  Locked events update the "+N more" line. Maintains the counts the hero
  placeholder shows; "priced sale" means a non-empty price on a comp whose
  transaction reads as a sale.
- `assemblySummary(text)`: writes `#summaryText` and shows its card.
- `resetAssembly()`: empties the participating blocks, removes `assembling`
  and `aria-busy`, re-hides `#results`. Called from the `retry` branch of
  `applyProgress` (attempt 2 finds its own comps, same as today's
  `resetLoadingComps`), from the submit handler's error path, and from
  `hideLoadingCard` so every existing exit unwinds it without new call sites.

`applyProgress` routes `comp` events to `assemblyComp` and the summary field
event to `assemblySummary` instead of `addLoadingCompLine` /
`showLoadingSummary`; those two functions and the `#loadingComps` box are
removed. The `lastPhase` bookkeeping note still applies: `comp` and `field`
events never claim `lastPhase`.

### Hero placeholder

Rendered into the real `#ownerHero` card: the subject address and type, the
line "Valuation computes when all comps are in", and the live counts. No
dollar signs anywhere in the placeholder. `renderOwnerHero` overwrites it
wholesale at final render.

### Why the final repaint is safe

`renderResults` already rebuilds the hero, summary, and table wholesale on
every render (a re-search over an on-screen report works today for exactly
this reason). Assembly writes into regions the final render owns and
overwrites; there is no merge step and no partial-data flag inside
`renderResults`.

## Fallbacks (all preserved by construction)

- **Plain JSON response** (cache hit, non-streaming server): no progress
  events, assembly never begins, behavior is byte-identical to today.
- **Buffered SSE** (Render's edge): no events until the end; the 8s watchdog
  restarts the wall-clock simulation on the loading card; assembly never
  begins.
- **Mid-stream retry**: `resetAssembly()`, then attempt 2 re-begins assembly
  when its own events arrive.
- **Mid-stream error / connection drop**: the existing catch path shows the
  error card; `resetAssembly()` rides on `hideLoadingCard` so no half-report
  is left on screen.
- **Free tier, everything past the cap**: table shows only the lock line and
  the hero shows total found; matches the gated final report's shape.

## Out of scope

- The Market Explorer's stream (revisit after this proves out).
- Any change to SSE event payloads, `makeCompExtractor`, or `guardComp`.
- Provisional valuations of any kind.
- Streaming into the map, chart, stat tiles, or market comparison.

## Testing

The front end has no DOM test harness (only `vault-page.js` gets a compile
test), so verification is manual, in the browser, against a locally running
server:

1. Fresh search on a never-searched address: report assembles, final render
   matches a control search with the feature absent.
2. Cache hit: instant render, no assembly flash.
3. Free-tier search over the comp cap: lock line during assembly, gated
   report after.
4. Kill the server mid-write: error card, no half-report left behind.
5. A `retry` run (forceable by temporarily breaking `parseCompJson` locally):
   assembly resets and rebuilds.
6. Re-search while a report is on screen: old report never shows through the
   assembling state.
7. PNG + print exports after render are unchanged (assembly leaves no
   `no-print`/`no-capture` residue in the report).

Ship with a devlog.json entry and update CLAUDE.md's live-progress paragraph
(it still describes the retired text-line preview).

## Accepted deviation (final review, 2026-08-09)

The hero placeholder shows the counts line only, not the subject address and
type this spec asked for. During assembly the loading-card headline directly
above the hero already names the address and type, so duplicating them in
`ownerBasis` would add plumbing (threading the subject into `beginAssembly`
and `updateAsmHero`) for no information gain. Accepted as shipped.

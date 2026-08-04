# Complete the pair + pre-search footprint sizing

Date: 2026-08-04
Status: approved (owner, in-session)

## Problem

A real report (3263 N Eagle Rd, Meridian - a Walgreens) rendered no value
because the hero needs two sale comps carrying BOTH a price and a size, and
the report had a $4M comp with no size, a sized comp with no price, and no
subject square footage from any record. Separately, a search that arrives
without the subject's size grants the model two extra web searches just to
look it up (budget 8 -> 10), which is ~8 seconds and cost on the common case
where the visitor types nothing.

## Goal

1. The model completes the size on priced sale comps instead of leaving them
   useless to the valuation ("complete the pair").
2. The browser estimates the subject's size from its OSM building footprint
   BEFORE the search, during the confirm modal, filling the editable size
   field - which both feeds the hero and shrinks the search budget by two.

## Design

### Part 1 (server.js, buildPrompt): the complete-the-pair rule

One shared rule line, both lanes, near the existing SIZE FIT guidance:

"PRICED BUT UNSIZED COMPS: a sale comp that has a price but no building size
cannot support the valuation math. If a sale comp you are including has a
price but you could not find its size, spend one of your searches
specifically on that building's size (an assessor or listing page) before
finalizing. Completing the size on 2-3 priced sale comps matters more than
adding one more marginal comp."

No search-budget change: the rule re-prioritizes spending within the
existing cap. Accepted cost: occasionally one more search consumed on thin
markets, deliberately.

### Part 2 (index.html): footprint size estimate during the confirm modal

Trigger, all conditions required:
- the confirm modal opened with a VERIFIED geocode (`geo` present);
- `#targetSize` is empty;
- the typed address starts with a street number (the map-photo gate: a
  submarket point must never size some random building);
- the selected type is not Land.

Lookup (async, non-blocking - runs while the visitor reads the modal):
- one `overpassQuery` for `way(around:120,lat,lng)["building"]` with
  `out geom;` (real polygon coordinates plus tags);
- candidate scoring identical in spirit to `snapMarkersToBuildings`: within
  120m, area discounted by distance, biggest-near wins;
- area = shoelace over the way's geometry (meters via the same lat/lng
  scaling the snap uses), x 10.7639 to SF, x `building:levels` when present
  (parsed, clamped 1-6, default 1);
- sanity bounds: accept only 800 SF to 2,000,000 SF, else discard;
- cached in localStorage (`fpSize.v1`, same trim pattern as bldgCache).

On success, IF the modal is still open and the size field is still empty:
fill `#targetSize` with the estimate rounded to the nearest 100, dispatch
`input` (existing listeners re-render), and show a small muted note under
the size row: "Estimated from the building's footprint - edit if it's off."
The note clears whenever the visitor edits the field or a new report
renders. The value lives in the user-editable field: the visitor can
correct or clear it, and it is never presented as a public record - the
note is the honesty label.

If the visitor confirms before the lookup resolves, the search runs without
a size, exactly as today. Overpass failure = no estimate = today.

### Effects

- Filled size -> the request carries `subjectSizeSqft` -> `searchBudgetFor`
  drops the budget 10 -> 8 (corpus-strong 3 -> 2): ~8s and a little cost off
  the common no-size search.
- The hero gets its denominator on buildings public records miss.
- Cache keys include the size, so estimated-size searches key separately
  from sizeless ones (honest: different input, different report).

## Non-goals

- No server-side Overpass (keeps the request path dependency-free; the
  browser-direct pattern exists and fails free).
- No render-time fallback estimate (redundant once pre-search fill exists).
- No change to how the model's own looked-up size is handled.

## Verification

- Zero cost: open the confirm modal for "3263 North Eagle Road, Meridian,
  ID" (Retail) with an empty size field; expect a fill of roughly 13-15k SF
  plus the note, without running a search. Cancel out. Also confirm a Land
  type and a numberless address do NOT fill.
- One real billed re-run (~$0.35) of the owner's exact Walgreens search with
  the filled size: the end-to-end proof that the report now renders a value
  range (footprint size + complete-the-pair rule together).
- Devlog entry ships with the change.

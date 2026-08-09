# Property type chosen at verification; building size promoted to the main form

Date: 2026-08-08. Status: agreed with the owner (approach and both form decisions confirmed in session).

## Problem

The property-type dropdown defaults to Industrial and nothing forces a visitor to
look at it. A visitor who forgets it silently runs an Industrial search on an
office building and gets a confident wrong-type report. The OSM type autofill
(shipped 2026-07-31) closes part of this: it detects the type on address blur
when OpenStreetMap has the building mapped with a matching house number and a
meaningful type tag. It is deliberately conservative, so on many addresses it
stays silent and the Industrial default stands.

## Decisions already made

- **No model-side detection.** Detecting the type inside the report search is
  not possible: the prompt is built per type before the search starts
  (per-type guidance and per-type comp fields), and the cache key, corpus, and
  purchase records are all keyed on the type. A pre-pass classification call
  would cost roughly +$0.02-0.03 per affected search (~6-8% of the ~$0.36
  search cost) and +3-8 seconds. The owner chose the zero-cost path instead:
  the human confirms the type at the verification step.
- **The type question moves to the address-confirm dialog** when it is still
  unresolved at submit. Zero cost, zero added generation time.
- **The freed form slot gets the Building size (SF) field**, promoted out of
  the collapsed "Your property details" section. A typed size cuts the
  server's search budget (skips the model's records lookup) and powers the
  value hero, so raising its fill rate has direct cost value.

## Design

### 1. Main form changes (index.html)

- Row one becomes Address + Building size (SF). The size pair (`targetSize`
  and optional `targetSizeMax`) moves up whole, with `sizeEstimateNote`. The
  label keeps its existing per-type relabeling (`targetSizeLabel`), so Land
  still reads correctly. The collapsed details section keeps price, NOI, and
  the per-type extras, and its summary line drops "size" from its pitch.
- Under the address input, the existing `typeAutoNote` line becomes a
  persistent **type status line**:
  - "Property type: Office, detected from OpenStreetMap · change" after a
    detection.
  - "Property type: Office, your choice · change" after any explicit pick.
  - "Property type: chosen when you run the report" when unknown.
  - "change" opens a small inline picker with the six types. This is also the
    door for re-running an existing report under a different type now that
    the dropdown is gone.

### 2. Type resolution order

1. **Explicit pick always wins**: inline picker, Address Explorer chip,
   recent-search chip, shared-report restore, market-page deep link. These
   set the type and skip any asking (`userChoseType` semantics unchanged).
2. **OSM detection** on address blur (existing `detectPropertyType`, guards
   unchanged) pre-fills the status line and the dialog's pre-selection.
3. **Confirm dialog** at submit, only when the type is still unknown: a
   "What kind of property is this?" row of six tap-to-pick buttons, with the
   OSM guess pre-selected when there is one. The run button is disabled until
   a type is selected, so nothing silently defaults to Industrial. The
   unverified-address (no geocode) variant of the dialog carries the same row
   with nothing pre-selected.
4. **Per-address memory**: the resolved type is remembered per normalized
   address in localStorage (`addrType.v1`, bounded like the other caches), so
   re-runs and the confirmed-address dialog-skip path never re-ask.

### 3. The hidden-select trick

`#propertyType` stays in the DOM, visually hidden, as the single source of
truth. All existing readers and writers (roughly 25 call sites: recommended
lookback, `renderSubjectFields`, Explorer, shared-report restore, market
links, the submit handler, exports) keep working untouched. The status line,
inline picker, and dialog buttons read and write the select and dispatch
`change`, which keeps `syncSubjectFieldsToType` semantics and the
`userChoseType` flag working exactly as today.

"Unknown" is represented by a new state flag alongside the select, not by an
empty select value, so no reader ever sees an invalid type. Until the type is
resolved the select keeps its previous value; the flag decides whether the
dialog asks.

### 4. Server

- Zero changes to the search flow. The type still rides the POST body; cache
  keys, corpus, entitlements, and gating untouched. Cost and generation time
  unchanged.
- One tiny addition: the `/api/type-autofill` outcome allowlist gains
  `dialog_pick`, logged when the confirm dialog's picker decides the type, so
  the /admin tile shows how often the dialog does the deciding.

### 5. Per-type machinery

On any type resolution the existing `applyDetectedType` path runs:
`applyRecommendedLookback()` plus `renderSubjectFields()`. Before a type is
known, the details section shows only the generic fields (price, NOI; size now
lives in the main form); per-type extras appear once the type resolves.

### 6. Edge cases

- Saved, shared, and sample reports never enter the submit handler and are
  unaffected.
- The Explorer's per-chip type snap (devlog 2026-08-05 fix) keeps working via
  the hidden select.
- Escape/edit from the confirm dialog leaves the type unresolved; the next
  submit asks again.
- A visitor who picked a type, then edits the address, keeps their pick
  (`userChoseType` stands, as today); the status line keeps saying "your
  choice".

## Testing

- Front end has no automated harness; verify in the browser per the repo's
  practice: fresh address with OSM coverage (pre-selected dialog skip case),
  fresh address without coverage (dialog requires a pick), re-run of a
  confirmed address (no re-ask), Explorer chip, shared report, market link,
  type change via the status line after a report renders.
- `test/routes.test.js` additions only if the `/api/type-autofill` allowlist
  change is testable there; otherwise no server tests change.
- New Tailwind utilities, if any, ride the session regen hook; verify they
  landed in the vendored `tailwind.css` and commit it alongside.

## Out of scope

- Any model-side classification call.
- Changing the OSM detector's guards or confidence rules.
- Server-side type inference or prompt restructuring.

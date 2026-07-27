# Per-type subject property details — Design

Date: 2026-07-27
Status: approved by owner (this doc records the design conversation)

## Goal

Roadmap item #6 from the friend-feedback list. The subject-property form is
identical for all six property types today: a Land user sees "Building size
(SF)" over raw dirt and a Net operating income box. `targetSizeLabel`,
`targetPriceLabel`, and `noiWrap` already carry ids for this, but no JS ever
touches them.

This adds the 2-3 detail fields each type actually needs, sends them to the
model so comp selection matches the subject, and feeds the two that unlock
better valuation math ($/unit for multifamily, $/acre for land).

Companion to #5 (`d40f9af` / `f1b29be`), which added the matching per-comp
fields. #5 answered "what do we report about each comp"; this answers "what do
we know about yours".

## Decisions already made (owner-approved)

- **Both halves.** Details feed the prompt (better comp matching) *and* the
  client-side math. Not one or the other.
- **Lean field sets, one to three per type.** Not the full lists from the
  email. An optional 7-field form on a free tool gets skipped, and an unfilled
  field helps nobody. Every field must either narrow comp selection or feed a
  number in the report. Multifamily and Residential land on a single field
  each; that is the rule working, not a gap to fill.
- **Subject fields mirror `TYPE_COMP_FIELDS`,** minus the derived price
  metrics a user cannot type (`price_per_unit`, `price_per_acre`). The user
  enters what they have; the comp table shows the same attribute for every
  comparable, so like compares to like.
- **All new fields are public property attributes.** They go to the server and
  ride along in shared links. The NOI / debt / rent-roll privacy boundary is
  untouched.

## 1. Field set

New map `TYPE_SUBJECT_FIELDS` in `index.html`, sitting beside `TYPE_COLUMNS`:

| Type | Fields | Input |
|---|---|---|
| Industrial | `clear_height`, `dock_doors` | number, number |
| Office | `building_class`, `floor_plate` | select (A/B/C), number |
| Retail | `center_type`, `anchor_tenant` | select, text |
| Multifamily | `units` | number |
| Land | `lot_acres`, `zoning` | number, text |
| Residential | `beds_baths` | text |

Retail `center_type` options: Neighborhood center, Strip center, Power center,
Single-tenant NNN, Urban storefront — the same vocabulary the prompt gives the
model in `TYPE_COMP_FIELDS.Retail`, so subject and comps use one taxonomy.

Every field is optional. The form works exactly as it does today when all are
blank.

## 2. Front-end form (`index.html`)

Reuse the existing `#subjectDetails` collapsible. No new sections, no nested
disclosures.

- A `#subjectTypeFields` container inside the existing grid, rebuilt by
  `renderSubjectFields(type)` whenever the property-type select changes. Same
  shape as `columnsForType()`: read the map, build the inputs, no per-type
  branching anywhere else.
- **Fix existing wrongness at the same time:**
  - `targetSizeLabel` becomes per-type: "Building size (SF)" for
    Industrial/Office/Retail/Multifamily, "Lot size (SF)" for Land, "Living
    area (SF)" for Residential.
  - `noiWrap` hides for Land. It stays for Residential — investment SFR is
    real.
- Values are read into a flat `{key: value}` object by
  `readSubjectDetails()`, dropping blanks so an untouched form produces `{}`.
- Switching type clears the previous type's values (they are meaningless for
  the new type) and rebuilds the inputs.

## 3. Persistence and privacy

- Values live at `meta.subject.details`, a nested object. Existing flat keys
  (`sizeMin`, `priceMin`, `noi`, ...) are unchanged.
- Saved reports, history, and portfolio rows carry `meta` wholesale, so
  persistence is automatic — no new storage code.
- `/api/share` (server.js ~3850) spreads `safeMeta.subject` and nulls `noi`.
  `details` rides along untouched, which is intended: unit count and zoning
  are public record, unlike NOI and loan terms.

## 4. Server (`server.js`)

- `/api/comps` request body gains `subjectDetails` (an object). Validate it as
  a flat object of short strings: keep only keys present in that type's
  `TYPE_COMP_FIELDS` list, coerce values with `String()`, trim to 40
  characters, drop anything left blank. That caps the block at three keys by
  construction. Never interpolate it into the prompt without that trim.
- `buildPrompt` gains a `SUBJECT DETAILS` block, emitted only when the object
  is non-empty:

  > SUBJECT DETAILS provided by the owner: 48 units. Prefer comps that match
  > these attributes where the market offers them, and say so in "summary"
  > when the closest available comps differ materially.

  Rendered from the same `TYPE_COMP_FIELDS` key list, so labels stay in sync.
- **`cacheKeyFor` must include a normalized signature of `subjectDetails`.**
  Without it a 48-unit and a 6-unit building at the same address, type, and
  size collide on the 7-day cache and are served each other's comps. Fold in a
  sorted `key=value` join, same treatment as `verifiedSig`.

## 5. Valuation math (client-side, `renderOwnerHero`)

Two secondary value lines, each shown only when its inputs exist:

- **Multifamily:** subject `units` x the median `price_per_unit` across sale
  comps that carry one.
- **Land:** subject `lot_acres` x the median `price_per_acre`.

Both mirror the existing $/SF logic and reuse the fields #5 already collects.
Guard: require at least 3 sale comps carrying the metric, matching the
existing "Based on N sale comps" threshold. Below that, render nothing rather
than a range built on one data point.

Land bridge: if `lot_acres` is given and the SF size field is blank, derive
SF = acres x 43,560 so the existing $/SF path still works. SF stays the
canonical unit internally; acres is a display and prompt concept.

## 6. Traps

- **The subject-edit listener replaces `currentMeta.subject` wholesale**
  (`index.html` ~1570) from five hardcoded ids. It must carry `details`
  forward or every keystroke in the size box silently wipes the detail values.
  Add the detail inputs to that same listener list so edits re-render in place
  with no new billed search, as size and price do today.
- Reports rendered before this ships, and shared reports stored as opaque
  blobs, have no `meta.subject.details`. Every read must tolerate `undefined`.
- Changing property type mid-session must clear stale details before the next
  search, or a Retail anchor tenant follows the user into an Industrial
  search.

## 7. Out of scope (YAGNI)

- No fields beyond the mirror set: no parking ratio, sprinkler type, HVAC age,
  occupancy, or WALT.
- No change to the NOI / debt / rent-roll privacy boundary.
- No per-type *market page* columns — that is roadmap #7.
- No broker comp-submission changes; brokers still submit the base field set.
- No validation beyond type and length. These are hints to a search, not
  accounting inputs.

## 8. Verification

1. `TYPE_SUBJECT_FIELDS` renders the right inputs for all six types, with no
   leakage between them (browser check, zero cost — the same way
   `columnsForType()` was verified for #5).
2. Land shows no NOI box and reads "Lot size (SF)"; Residential reads "Living
   area (SF)" and keeps NOI.
3. One billed Multifamily search with a unit count entered: confirm the prompt
   carried it, a $/unit range renders, and editing the unit count re-renders
   without a new search.
4. Two requests, same address and size, different unit counts: confirm the
   second is a cache miss, proving the cache-key fix.
5. Publish a share and confirm `subject.details` survives while `noi` is null.

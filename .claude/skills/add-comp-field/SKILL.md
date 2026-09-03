---
name: add-comp-field
description: Use when adding, renaming, or removing a per-type field in CompNinja — a new column in the comp table, a new spec the model should report, a new subject-property input on the search form, or a type-specific field like clear_height/units/lot_acres. Also use when a field "isn't displaying", "is missing from the CSV export", or comes back empty on every comp.
---

# Add a Per-Type Field

## Overview

Per-type fields are declared in **one map per side** and fan out from there.
The maps are the contract; miss one and the field is silently absent — the
model returns data nobody renders, or a column renders forever-empty cells.

| Where | What it declares |
|---|---|
| `TYPE_COMP_FIELDS` (server.js:1340) | field keys + the prompt sentence. **Source of truth.** |
| `SHORT_COMP_KEYS` (server.js, right after `ALL_TYPE_COMP_FIELDS`) | the field's compact 1-3 char key the model writes (see step 1b) |
| `TYPE_COLUMNS` (index.html:1386) | comp-table columns, per type |
| `TYPE_SUBJECT_FIELDS` (index.html:1444) | subject-property form inputs, per type |
| `ALT_BASIS` (index.html:2031) | optional: a per-unit valuation cross-check |

Everything else derives: table render, sorting, CSV export, PNG snapshot, and
mobile cards all read the active `COLUMNS` array, so they need no edits.

**Load-bearing constraint:** `TYPE_SUBJECT_FIELDS` keys must be a **subset** of
that type's `TYPE_COMP_FIELDS[type].fields`. `sanitizeSubjectDetails`
(server.js:1375) whitelists incoming subject details against exactly that list,
so a subject input whose key isn't a declared comp field is silently discarded
before it reaches the model.

## The Recipe

### 1. Declare it (server.js — restart required)

Add the key to the right type in **`TYPE_COMP_FIELDS`** (server.js:1340) and
extend that type's `instruction` string. Tell the model what the field means,
give an example value, and keep the escape hatch: *"If it genuinely can't be
found, use an empty string — do not guess."*

Everything downstream on the server is automatic: the comp JSON shape
(server.js:1415), the prompt sentence (server.js:1481), the corpus-reuse line
(`typeSpecsOf`, server.js:1430), the harvest row (`harvestComps`,
server.js:1168 via `ALL_TYPE_COMP_FIELDS`), and the corpus CSV export
(server.js:3860).

**Enum fields:** if the field has fixed allowed values, normalize server-side
onto the enum the way `source_type` does (unknown → safest value), so the
front-end can trust it.

### 1b. Give it a short key (report-parse.js — same edit session)

Since 2026-08-03 the model writes comps under compact keys (`SHORT_COMP_KEYS`,
in **report-parse.js** since the 2026-08-08 extraction) and `expandCompKeys`
(same file) restores the
long names at parse time. **A new comp field needs an entry there too** — 1-3
chars, unique among the shorts, and never colliding with any long field name
(`test/report-parse.test.js` pins both invariants).
The prompt template (`compShape`) and legend line pick it up automatically.
Miss this and the prompt's template line throws at build time (`S[f]` is
undefined inside a template literal renders "undefined" as the key — the
model will write junk keys that survive expansion as unknowns), so add the
entry in the same edit as `TYPE_COMP_FIELDS`.

### 1c. Say whether it is the BUILDING's or the DEAL's (building-facts.js)

The vault's deals on one building inherit building-level facts from each
other at read time (migration 050; spec
`docs/superpowers/specs/2026-09-03-vault-building-facts-design.md`). Every
`broker_comps` column must be on exactly one side of `BUILDING_FIELDS` /
`DEAL_FIELDS` in **building-facts.js**, and `test/building-facts.test.js`
fails the build when a new column is on neither. The rule for choosing: a
fact inherits only if it would be the same on every deal on that building,
whoever did the deal and whenever (year built, clear height, units, zoning
inherit; a price, a rent, a tenancy at the time of the deal never do). A
field that is the building's on a sale and the suite's on a lease goes in
`SALE_ONLY` beside `size_sqft`.

### 2. Run the Supabase migration BEFORE deploying

`harvestComps` writes one flat `comp_corpus` row per comp using
`ALL_TYPE_COMP_FIELDS`, so the table needs a column per field. PostgREST
**400s on an unknown column**, and harvesting is fire-and-forget — so a missing
column doesn't break searches, it just silently diverts every harvested comp to
the ephemeral file fallback, which the host wipes on redeploy. You lose data
without an error anyone sees.

Schema changes live in the `migrations/` folder (see `migrations/README.md`).
Write the next numbered file, run it in the Supabase SQL editor, and log it in
`migrations/APPLIED.md`:

```sql
alter table public.comp_corpus add column if not exists my_field text;
```

Also add the column to the full-shape `create table` in
`migrations/001-comp-corpus.sql` so a fresh environment gets it in one go.

Also add the field to the `&select=` list in `corpusRowsForMarket`
(server.js:694), or reused corpus comps come back without it.

### 3. Show it (index.html — no restart, served from disk per request)

**Comp column** — add to the right type in `TYPE_COLUMNS` (index.html:1386):

```js
{ key: "my_field", label: "My Field", numeric: true, after: "size_sqft" }
```

`after` names the column it sits behind. Convention: specs follow **Size**,
per-unit/per-acre pricing follows **$/SF** so price metrics stay together.
Add `wide: true` for long values that need a full-width row on mobile cards.
`columnsForType()` (index.html:1422) groups by `after` so fields sharing an
anchor keep their declared order.

**Subject input** (optional) — add to `TYPE_SUBJECT_FIELDS` (index.html:1444):

```js
{ key: "my_field", label: "My Field", type: "number", placeholder: "e.g. 32" }
```

`type` is `number`, `text`, or `select` (with an `options` array whose first
entry is `""`). Remember the subset rule above.

**Valuation cross-check** (rare) — only if the field is a denominator the
market actually quotes, like units or acres. Add to `ALT_BASIS`
(index.html:2031); `altBasisEntry` (index.html:2036) renders it as an entry in
the hero's `renderApproaches` list.

### 4. Sample report

`SAMPLE_REPORT` (index.html:4169) is hard-coded Industrial demo data. If you
add an Industrial comp field, add it there too or the demo shows empty cells.

## Gotchas

- **The search cache serves old-shape reports for up to 7 days.** The cache key
  (`cacheKeyFor`, server.js:807) covers address + type + note + window + size +
  maxComps + txFocus + verified-comp signature + subject details — but NOT the
  prompt text, so cached hits lack a newly added field. Shared reports
  (`/r/<id>`, opaque blobs, no expiry) lack it forever. **Renderers must
  tolerate `undefined`** — every read uses `(x.details || {})` or
  `numericValue()`, which returns `NaN` and fails the `> 0` guards. Don't break
  that. To test, use a never-searched address.
- **Does the model actually know this?** Some fields simply aren't published
  often enough to be worth a column. A `lot_size` field for Residential was
  tried and dropped: **0/16 fill across two addresses**, even with an explicit
  "check the assessor record" instruction, because the search budget (6-8 calls
  total) doesn't stretch to a per-comp assessor lookup. Office `floor_plate`
  only reached 4/8 until the prompt was told it may derive it from the floor
  count. **Measure fill rate on a real search before trusting a new field**; a
  permanently blank column reads as broken, not thorough.
- **Verified broker comps** are offered to the model as one text line each
  (`verifiedBlock`, server.js:1420) carrying only the base fields. If brokers
  should supply the new field, extend that line AND the broker
  comp-submission form/endpoint — otherwise verified comps depend on the
  model's own search for it.
- **Two hard-coded lists in the mobile card** (index.html:4713-4716): `core`
  decides which EMPTY fields still render (optional fields can stay out), and
  `wide` forces a full-width row — driven by the column's `wide` flag, so set
  that in `TYPE_COLUMNS` rather than adding another key here.
- **Tailwind is vendored.** New utility classes need `tailwind.css`
  regenerated; a PostToolUse hook does this automatically on index.html edits.
  Reusing existing label/input classes needs nothing.
- **Another Claude session may share this checkout.** Stage explicit paths, and
  read the whole diff before committing — see [[concurrent-sessions-one-checkout]].

## Verify

0. **Run the map consistency check first** — free, instant, no server:

   ```bash
   "$LOCALAPPDATA/node-portable/node-v24.16.0-win-x64/node.exe" .claude/skills/add-comp-field/check-field-maps.js
   ```

   It extracts the four real maps and cross-checks them, catching the failures
   that are otherwise silent: a subject input the server will strip, a comp
   field with no column, an `ALT_BASIS` pointing at a field the type doesn't
   collect, and a column anchored `after` a column that doesn't exist. Exits
   non-zero on any problem.

1. **Free, next:** reload and check `columnsForType("<Type>")` in the browser
   console returns the new key in the right position, and that a *different*
   type does NOT include it.
2. If you added a subject input, check `renderSubjectFields("<Type>")` then
   `readSubjectDetails()` round-trips the value.
3. **Then pay once:** run a search for the matching type with a never-searched
   address (cache-miss, ~$0.60). Confirm the column renders with data, sorts,
   and appears in the CSV export.
4. Check the fill rate across the returned comps. Empty on most of them means
   the field isn't reliably published — reconsider before shipping.
5. Confirm the corpus row carries it: `GET /api/comp-corpus` with `ADMIN_KEY`,
   or query Supabase directly.

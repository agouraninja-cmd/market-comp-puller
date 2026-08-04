# Compact comp encoding: short keys + omitted empties

Date: 2026-08-03
Status: approved (owner, in-session)

## Problem

Report wall-clock is dominated by writing the output. The comps array is
69-76% of a report, and its long key names alone are 20-23% of the whole
report (1,288 chars on each of the two real reports measured 2026-08-03).
Separately, 20-40 of ~105 comp fields per report are empty strings the model
still spells out key-by-key (318-650 chars).

## Goal

The model writes each comp under 1-3 char keys and omits fields it has no
value for. The server re-expands to today's exact long-key shape immediately
after parse, so nothing downstream changes. Measured projection: ~17-20%
smaller model output, several seconds off every billed search, slightly
cheaper. Rendered reports are byte-shaped identical to today's.

## Non-goals

- Top-level keys stay long (they occur once each; shortening would also break
  the summary field extractor and progress phases).
- No client changes, no cache-key changes, no max_tokens change.
- Old cached reports (long keys) render unchanged.

## Design

1. `SHORT_COMP_KEYS` in server.js next to `TYPE_COMP_FIELDS`: short -> long
   for every comp field. Mnemonic, all distinct: a/d/t/sf/p/psf/cap/ten/yr/
   n/u/st/v plus type fields ch/dd/bc/fp/ct/at/un/ppu/ac/ppa/z/bb.
2. `compShape` rebuilt from the map (template shows short keys). A legend
   line beside it maps every short key to its full name and says the rules
   below refer to fields by full name - the battle-tested rules stay
   untouched. A second line: omit any comp field with no value instead of
   writing "" (top-level fields keep "" as before). Both lanes get this
   (the records lane outputs comps too).
3. `expandCompKeys(parsed, type)` at the single parse site, between
   `parseCompJson` and `normalizeSourceTypes`: tolerant key expansion (long
   keys accepted, unknown keys pass through, long key wins if both present),
   then backfill of omitted fields to "" using the request's type (base
   fields + that type's TYPE_COMP_FIELDS + tenancy/year_built unless Land,
   `verified` to boolean false), so the report is byte-shaped like today's
   and no consumer can meet undefined.
4. The live-preview comp extractor callback runs a single-comp `expandComp(c)`
   before reading fields, so streamed `comp` events keep their current field
   names and index.html is untouched.
5. Docs: the add-comp-field skill gains the fifth mapping step (new field =
   new short key); CLAUDE.md's composition note records the result.

## Failure containment

The expansion layer is tolerant both ways, so a model that ignores the short
keys and writes long ones produces today's exact behavior. If verification
shows the model fumbling short keys (missing or misfiled values), the
fallback is deleting the legend line and restoring the long-key compShape;
omit-empties and the expansion layer stay, keeping the safe 6-10%.

## Verification (two real billed searches, ~$0.72)

One Industrial and one Multifamily search (the latter exercises un/ppu type
fields), fresh markets. Assert:
- every comp in the final report carries long keys, no short keys, no
  undefined anywhere in the serialized report;
- field-population rates comparable to the two baseline reports (the
  reliability question: does the model fill "psf" as faithfully as
  "price_per_sqft");
- the live preview fills in during the search (proves the extractor remap);
- report size roughly 17-20% below the same-market baseline expectation.
Devlog entry ships in the same commit.

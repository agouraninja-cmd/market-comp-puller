# Market Explorer query parsing

Approved by the owner 2026-08-10.

## Problem

`parseExploreQuery` in index.html accepts one shape: `<type> <city> <ST>`,
with the state as a two-letter abbreviation in the final token. Everything
else dead-ends in a hint row:

- **Full state names.** "industrial Boise Idaho" fails; "idaho" is not in
  `US_STATES`, so the parser reports `no-state` and the visitor is told to
  add the state they just typed.
- **Zip codes.** "83301" fails, even though the Address Explorer already
  resolves zips through Zippopotam (`resolveMarket` in index.html).
- **Natural phrasing.** "industrial market in Boise ID" fails, because
  "market" and "in" become part of the city.
- **Type synonyms.** "warehouse Boise ID" reports `no-type`, so the visitor
  gets the four type chips instead of the market they described.

Unlike the previous two Explorer items, this one is not gated behind
`ACCOUNT_WALL`: it is the top of the funnel and it fails for signed-in
members today.

## What ships

A new pure module, `explore-query.js`, holding the parse and its tables,
plus an async zip hop that stays in index.html. Owner's decision: the
**generous** scope, all four gaps above.

The module follows the repo's dual Node/browser export precedent
(`valuation.js`, `gut-check.js`): `module.exports` for `npm test`, a global
for the browser. It is served with `max-age: 0` like both of those, for the
same reason — a stale copy against a newer index.html is the failure nobody
detects.

### Exports

- `parseExploreQuery(raw)` — synchronous, no I/O. Returns one of:
  - `{ type, city, state }` when everything resolved;
  - `{ reason: "no-type", city, state }` — the type chips row;
  - `{ reason: "zip", zip, type }` — index.html resolves it (see below);
  - `{ reason: "no-city" | "no-state" | "unsupported-type" }`.
- `STATE_NAMES` — full name to abbreviation, 50 states plus DC.
- `TYPE_SYNONYMS` — synonym to canonical Explorer type.
- `FILLERS` — words dropped from the city.

### Parse order (load-bearing)

1. Lowercase, commas to spaces, split on whitespace, drop empties.
2. **Unsupported type** (land, residential) → `unsupported-type`, as today.
3. **Type:** two-word synonyms first (adjacent token pairs, "shopping
   center", "office building"), then an exact match against the four
   Explorer types, then one-word synonyms. Matched tokens are removed.
   **Pairs must precede the exact match**: "office building Boise ID" would
   otherwise match the bare "office", leaving "building" glued to the city.
4. **Zip:** a five-digit token → `{ reason: "zip", zip, type }`. This comes
   after the type step so the intent can carry a type the visitor also
   typed ("warehouse 83301").
5. **State, BEFORE filler stripping:** try the last two remaining tokens as
   a full state name ("new mexico"), then the last token as a full name
   ("idaho"), then the last token as an abbreviation ("id").
6. **Fillers:** strip `FILLERS` from what remains.
7. **City:** title-case the remaining tokens.

**Step 5 must precede step 6.** Eight state abbreviations are also English
words (IN, OR, OK, ME, HI, DE, LA, PA). Stripping fillers first would eat
the "IN" in "warehouse in IN" and lose Indiana. Resolving the state from
the final token first makes that impossible, and the filler pass then only
ever sees tokens that are not the state.

### The empty-city guard

If a state resolves but no city tokens remain, return `no-city`, never a
blank city. So "office New York" stays a hint (the state name consumed
everything), while "office Brooklyn New York" resolves normally. Without
this guard the Explorer would offer to build a page for an empty city.

## Zip resolution (index.html only)

`parseExploreQuery` never performs I/O, so a `{ reason: "zip" }` result is
resolved by the Explorer IIFE:

- A per-session `Map` caches zip to `{ city, state }` (and to `null` for a
  zip that does not resolve, so a bad zip is asked once).
- On a cache miss, a 400ms debounce fires one `GET
  https://api.zippopotam.us/us/<zip>` — the same keyless service the Address
  Explorer's `resolveMarket` already uses, and the same one `city-check.js`
  validates cities against server-side. On success the dropdown re-renders
  with the resolved city and state, so the visitor sees the ordinary
  "Explore this market, build the Industrial · Twin Falls, ID page" row.
- A failed or unresolvable lookup renders a hint row naming the zip. It
  never blocks typing and never throws.

Debounced rather than resolved on click: a zip is the whole query, so
making the visitor click an extra "look it up" row before the real explore
row appears would be two clicks for what they already typed.

## What deliberately does not change

- **The server.** No route, prompt, or validation change. The client still
  posts `{ type, city, state }`, and `city-check.js` still validates the
  city exists before anything is billed.
- **Nothing auto-runs.** A resolved query still renders the explore row;
  the visitor clicks it (or presses Enter) as today. Parsing more
  generously must not turn a keystroke into a billed search.
- **The visitor always sees what was parsed.** The explore row spells out
  "Industrial · Twin Falls, ID" before anything runs, which is what makes a
  generous parser safe: a wrong guess is visible, not silent.
- **The four Explorer types and the Land/Residential refusal.**
- **The Address Explorer's own `resolveMarket`** stays where it is; this is
  a separate surface and merging them is not worth the coupling.

## Testing

`npm test` covers `explore-query.js` directly, since it is pure:

- every state form: abbreviation, full name, two-word full name;
- the ordering traps: "warehouse in IN" keeps Indiana, "industrial market
  in Boise ID" resolves, "Kansas City Kansas" gives city "Kansas City";
- the empty-city guard: "office New York" is `no-city`, "office Brooklyn
  New York" resolves;
- each type synonym, including a two-word one and the hyphenated
  "multi-family";
- zip detection returns the zip intent, with and without a type;
- unchanged behavior: "industrial Boise ID", the `no-type` chips path, and
  the Land/Residential refusal.

The browser half (debounce, cache, re-render) is verified on a local boot:
type a zip and confirm the explore row appears with the right market, and
confirm an unresolvable zip shows its hint without breaking the dropdown.

## Files

- `explore-query.js`: new pure module.
- `test/explore-query.test.js`: new test file.
- `index.html`: script tag, the IIFE's use of the module, the zip hop.
- `server.js`: one `STATIC_FILES` entry, served `max-age: 0`.
- `devlog.json`: entry in the same commit.

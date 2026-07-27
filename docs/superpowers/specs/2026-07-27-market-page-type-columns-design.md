# Per-asset-class comp columns on market pages — Design

Date: 2026-07-27
Status: approved by owner (this doc records the design conversation)

## Goal

Roadmap item #7. The programmatic-SEO market pages (`/market/<slug>`) show a
"Recent comps" table with six fixed columns. Feature #5 taught every property
type to report its own specs, and #6 put them in the app's comp table, but the
market pages never see them: `distillMarketSnapshot` trims each comp to seven
keys before the page is ever rendered.

Make that table show the same per-type columns the report does, so a visitor who
lands on `/market/industrial-ontario-ca` and then runs a valuation sees one
consistent product rather than a teaser and a different tool.

## The finding that shaped this

The per-type fields are not missing from the model's output — they are
**discarded**. `market-snapshot.js:74` maps each comp down to
`address, date, transaction, size_sqft, price_or_rate, price_per_sqft,
source_type`. `cap_rate`, `tenancy` and `year_built` are dropped at the same
line, and have been all along.

That trim has two consumers with very different economics:

| Consumer | Source | Cost to gain the fields |
|---|---|---|
| `/api/explore-market` (visitor-generated pages, server.js:3102) | live search, on demand | **free** — new pages carry them as soon as the trim widens |
| `market-seed.json` (27 committed pages, via `gen-market-seed.js`) | generated offline before #5 | a fresh search per market |

The search cache cannot help the second: those payloads were stored before #5,
so a cache hit returns data without the fields. Backfilling by regeneration
means real cache-miss searches.

## Decisions already made (owner-approved)

- **Widen the trim now; backfill later.** Ship the free half and let evidence
  from a real page inform the spend.
- **Mirror the app's per-type columns** rather than a market-page-specific
  subset, so the landing page reads as a genuine preview of the report.
- **No fifth per-type map.** A per-type field already spans four maps
  (`TYPE_COMP_FIELDS`, `TYPE_COLUMNS`, `TYPE_SUBJECT_FIELDS`, `ALT_BASIS`);
  adding a market-page one would compound the drift problem documented in
  CLAUDE.md and the `add-comp-field` skill.

## 1. Data — widen the trim (`market-snapshot.js`)

`TYPE_COMP_FIELDS` lives in `server.js`, and `server.js` already requires
`market-snapshot.js`. Importing the field list into the snapshot would be
circular, and `gen-market-seed.js` needs it too.

So the snapshot switches from an allowlist of seven keys to a **denylist**:
keep every key the model returned except the bulky ones no market page shows —
`lat`, `lng`, `notes`, `source_url`, `verified`. This needs no shared constant,
introduces no circular import, and means a future comp field needs no snapshot
change at all.

Payload growth is real but small. Note that `notes` and `source_url` are not in
the current seven-key allowlist either, so denylisting them changes nothing —
the per-type specs are pure addition, not a swap. They are short strings
("32 ft", "48", "M-1"), at most three per comp, eight comps per market: on the
order of a few hundred bytes per market against a 108 KB seed file. Values are
coerced with `String(x || "")` as today, so a missing key becomes `""` rather
than `undefined`.

Rejected alternative: extracting `TYPE_COMP_FIELDS` into a shared module for an
exact allowlist. Cleaner hygiene, but it moves the source of truth that
CLAUDE.md, the `add-comp-field` skill, and `check-field-maps.js` all reference
by location — a wide refactor of the corpus write path for a narrow gain.

## 2. Rendering — derive the columns (`server.js`)

`renderMarketPageHTML` (server.js:2124) currently hardcodes six `<th>` cells and
six `<td>` cells. Both become derived:

- Base columns stay: Address, Date, Type, Size (SF), Price / Rate, $/SF.
- That type's `TYPE_COMP_FIELDS[p.type].fields` are inserted **after Size (SF)**,
  matching the app's ordering convention (specs follow Size).
- **A column whose value is empty on every comp is dropped entirely.** This is
  what makes "backfill later" safe: the 27 seeded pages have no per-type data,
  so they render exactly as they do today rather than growing blank columns.
  It also protects a page whose search simply failed to find a given spec.

The table already sits inside `<div class="scroll">`, so extra columns scroll
horizontally on mobile instead of breaking layout. These pages carry their own
inline CSS (`MARKET_CSS`), so no Tailwind is involved.

Derived fields the user cannot type (`price_per_unit`, `price_per_acre`) are
included here — unlike `TYPE_SUBJECT_FIELDS`, this is a display surface, and
$/unit is exactly the figure a multifamily searcher wants.

## 3. Labels and the drift guard

A flat `FIELD_LABELS` map in `server.js`, keyed by field name rather than by
type:

```js
const FIELD_LABELS = { clear_height: "Clear Height", dock_doors: "Dock Doors", ... };
```

One lookup shared by all types — not a fifth per-type map.

The one real risk of this approach is that `FIELD_LABELS` (server) and
`TYPE_COLUMNS` (client) drift apart, so the same field is labelled differently
in the report and on the market page. `check-field-maps.js` is extended to fail
when:

- a field in `TYPE_COMP_FIELDS` has no entry in `FIELD_LABELS`, or
- a `FIELD_LABELS` label disagrees with that field's `TYPE_COLUMNS` label.

That converts the risk into a caught error rather than a silent inconsistency.

## 4. Backfill — two paths, and the cheap one is new

**Path A: enrich from the corpus (free, preferred).** Market pages *already*
read `comp_corpus`: `refreshMarketIntel` (server.js:2065) caches up to 5000
rows for 10 minutes and `marketIntelRows` merges them with the seed comps for
the price-trend chart. But its `select=` lists only
`market, property_type, address, transaction, deal_date, price_per_sqft, ts` —
no per-type fields. Widening that select and matching corpus rows to seed comps
by normalised address would let the seeded pages fill in their per-type cells
from data harvested by ordinary traffic, at no search cost, self-healing as the
corpus grows.

Honest caveat: corpus coverage is thin today (tens of rows live, not thousands)
and grows only with real searches, so this backfills gradually and unevenly.

**Path B: regenerate the seed (~$16).** `node gen-market-seed.js` re-runs one
search per market. Also refreshes comp data that predates #5. Note it re-applies
the `MIN_PRICED_SALE_COMPS` filter, so the set of live markets can change —
some of the 27 may drop and others qualify.

Both are **out of scope for this spec**. It records them so the next session
does not rediscover Path A and reach for the $16 first.

## 5. Traps

- **`p.comps` has a second consumer** at server.js:2154, which maps comps into
  the trend chart's rows (`address, transaction, deal_date, price_per_sqft`).
  Widening the stored shape must not disturb it — it reads named keys, so extra
  keys are inert, but confirm the trend chart still renders after the change.
- **Stored payloads are heterogeneous.** Seeded markets, Supabase `market_pages`
  rows, and freshly generated explorer pages will all coexist with different
  comp shapes. Every read must tolerate a missing key.
- **`/markets` directory pages** read only `p.ppsf` and counts, not comps, so
  they are unaffected — but re-check after the change rather than assuming.
- **Land and Residential have no seeded markets** (the 27 are Industrial 8,
  Office 8, Retail 5, Multifamily 6). Their column paths can only be exercised
  through a visitor-generated explorer page or a unit-level check.

## 6. Out of scope

- No regeneration of `market-seed.json`, and no corpus-enrichment implementation
  (both recorded in section 4 for a later pass).
- No cap-rate / tenancy / year-built columns. They will now be *stored* by the
  widened trim, so surfacing them later is a rendering change only.
- No changes to the `/markets` directory page.
- No new per-type map, and no refactor of `TYPE_COMP_FIELDS`'s location.

## 7. Verification

1. **Free, first:** `node .claude/skills/add-comp-field/check-field-maps.js`
   passes with the new `FIELD_LABELS` assertions.
2. A unit-level check that `distillMarketSnapshot` preserves per-type fields and
   drops the denylisted keys, run against the real function extracted from
   `market-snapshot.js`.
3. Render a seeded market page (`/market/industrial-ontario-ca`) and confirm it
   looks **unchanged** — no blank columns — because its comps predate #5.
4. Render a market page from a payload that *does* carry per-type fields and
   confirm the columns appear in the right position with the right labels.
5. Confirm the price-trend chart still renders on a seeded page (trap 1).
6. Only if a live check is wanted: one `/api/explore-market` run for a
   never-generated market (~$0.60) to see the whole path end to end.

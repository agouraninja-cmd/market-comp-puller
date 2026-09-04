# The building remembers: building-level facts in the broker vault

**Date:** 2026-09-03
**Status:** PROPOSED. Not built, no migration file. Written so the owner can
say yes or no to the shape before anyone spends a day on it.
**Owner:** unassigned

This complements archive ingestion (`2026-08-21-archive-email-ingestion-design.md`)
rather than competing with it: that spec is about getting deals INTO the vault
with less effort, this one is about the deals already there being worth more
once they are in.

---

## The problem in one line

Every fact in the vault is stored on the deal, but most of the facts a broker
types are about the building, so a broker with three deals on one building
types the year built three times, and the row where they skipped it counts
for nothing in every median.

---

## 1. What is stored today, and where

Traced on `main`, not assumed.

- **`broker_comps`** holds everything the broker states: the deal facts
  (price, date, cap rate, rent, basis, lease type, tenancy) AND the building
  facts (`size_sqft`, `year_built`, `clear_height`, `dock_doors`,
  `building_class`, `floor_plate`, `center_type`, `anchor_tenant`, `units`,
  `lot_acres`, `zoning`, `beds_baths`). One row per deal; nothing is shared
  between two deals on one building.
- **`broker_properties`** (migration 016) is the building dimension. It holds
  an address, a market, a type, first/last seen, and since 017 a location.
  Its own migration says why it exists: "it is the one dimension a broker
  slices by". Nothing about the building itself lives on it.
- **`org_buildings`** (migration 046) is the FIRM's building record and it
  carries `size_sqft` and `year_built`, editable through `PATCH
  /api/org/buildings`. So the firm can know more about a building than the
  broker whose deals are on it.

Three consequences a broker feels:

1. **A priced sale with no size is dead weight.** `normalizeRow` writes
   `price_per_sqft` only when both price and size are present, and every
   median on `/vault`, every gut-check bucket and `archiveCoverage`'s
   "usable" test read that column. A sibling deal on the same building that
   DOES carry the size does nothing for it.
2. **The add form and the confirm table start from nothing** every time,
   even when the address is one the book already holds. The reviewer sees a
   row that says "Retail" and has to work out which property it is; the
   roadmap's open item 3 on the confirm table is this complaint.
3. **A fact stated once cannot be corrected once.** Fixing a year built means
   finding every deal on that building.

---

## 2. Which facts are the building's

Not every column moves. The rule is: a fact inherits only if it would be the
same on every deal on that building, whoever did the deal and whenever.

| Field | Level | Inherits? |
|---|---|---|
| `year_built`, `clear_height`, `dock_doors`, `building_class`, `floor_plate`, `center_type`, `units`, `lot_acres`, `zoning`, `beds_baths` | building | yes |
| `size_sqft` | building on a SALE, the suite on a LEASE | derived from sales only; inherited onto sales only |
| `anchor_tenant` | building, but it changes hands | yes, most recent deal wins on disagreement (§4) |
| `price`, `deal_date`, `cap_rate`, `rent_psf`, `rent_basis`, `lease_type`, `lease_expiry`, `option_notice_date`, `tenancy`, `notes`, `price_per_unit`, `price_per_acre` | deal | never |

`size_sqft` is the one that would do damage if it moved carelessly. A lease
comp's size is the space leased, and a 4,000 SF suite in a 60,000 SF center
is a real, correct row. So the building's size is derived from sale rows
only, and offered only to sale rows. A lease with no size stays a lease with
no size.

`tenancy` looks like a building fact and is not: "Single tenant" describes the
building at the time of THAT deal, and the same center is multi-tenant three
years later. It stays on the deal.

`price_per_sqft` and `price_per_unit` / `price_per_acre` are never inherited,
because they are derived from the deal's price. When a size is inherited onto
a priced sale, the $/SF is computed at the same moment from that deal's own
price (§5), never copied from another deal.

The list lives in one place, `BUILDING_FIELDS` in the new pure module, and
the `add-comp-field` skill gains a step: a new per-type field must be placed
on one side of this table.

---

## 3. Storage: one additive column

```sql
alter table broker_properties
  add column if not exists facts jsonb;
```

Migration 050. Nothing else changes: no column on `broker_comps`, no new
table, no backfill in SQL (the derivation is JS, the same reason 019 has no
backfill).

`facts` is jsonb rather than a column per field for the reason 030 stores
the firm copy as jsonb: the per-type field list grows through the
`add-comp-field` skill and a column per fact would make every new field a
migration here too. The shape:

```json
{
  "values":    { "year_built": "1998", "size_sqft": 84000, "clear_height": "28 ft" },
  "conflicts": { "dock_doors": ["12", "14"] },
  "derived_at": "2026-09-03T18:20:11Z"
}
```

A fact is in `values` OR in `conflicts`, never both. A fact no deal states is
in neither.

The column is **derived, never stated** in this version. Nothing the broker
types goes into it directly; it is a cache of what their own deals agree on.
That is what makes it safe to recompute rather than fill-only: there is no
stated value to protect. The day a "state a fact on the building" door is
added (§9), that changes, and the fill-only rule the coordinate PATCH uses
(`lat=is.null`) becomes the rule here.

---

## 4. Derivation (pure, tested: `building-facts.js`)

`deriveFacts(comps)` takes every deal on ONE building and returns the object
above. Rules:

- **Agreement gives a value.** Text compared after trim and case-fold; numbers
  compared as numbers. Two deals saying `28 ft` and `28 FT` agree.
- **Disagreement gives a conflict, not a winner.** `dock_doors: 12` on one
  deal and `14` on another puts both in `conflicts.dock_doors` and no value
  is served. The vault's stance everywhere is refuse rather than guess, and a
  quietly chosen year built is a guess. `anchor_tenant` is the one exception,
  because a center genuinely changes anchors: the most recent dated deal's
  value wins and the others are listed as prior.
- **Blank is not a vote.** A deal that omits a field neither agrees nor
  disagrees.
- **`size_sqft` reads sale rows only** (§2). A book holding only leases on a
  building derives no size for it.
- **Recomputed whenever the building is touched.** `linkVaultProperties`
  already runs after every upload, every `POST /api/vault/comp` and every
  `PATCH /api/vault/comp`, and already has the building's `address_key` in
  hand; it gains one read of that building's deals and one PATCH of `facts`.
  An import across ten buildings is ten extra PATCHes, the same count the
  `property_id` link already makes.
- **A delete does not recompute.** `DELETE /api/vault/comp` does not call
  `linkVaultProperties` today, so a fact stated only on a deleted deal
  lingers in `facts` until the building is next touched. Accepted for v1: the
  fact was about the building and is still true of it, and the next add,
  edit or upload on that building refreshes it. Named here so it is not
  mistaken for a bug later.
- **Never throws, never awaited on the response path.** `linkVaultProperties`'s
  own contract: a failed derivation costs a suggestion, a failed upload costs
  a broker their spreadsheet.

---

## 5. Inheritance happens at READ time, never in storage

This is the whole design and the rule most likely to be "simplified" away.

`applyFacts(comp, facts)` returns a copy of the deal with each EMPTY
building field filled from `facts.values`, an `inherited` array naming which
ones, and, when a size was inherited onto a priced sale, `price_per_sqft`
computed from that deal's own price. It writes nothing. `broker_comps` keeps
exactly what the broker stated on that deal, so:

- an export writes stated values only, and export then re-import cannot turn
  a derived value into a stated one (the `undated` round-trip rule in
  reverse);
- a deal whose stated value disagrees with its siblings keeps its stated
  value, because a stated cell is never empty and `applyFacts` fills only
  empty cells;
- correcting one deal moves the derivation and every sibling's inherited
  view, with no second write to chase.

Where it runs, and where it deliberately does not:

| Path | Runs? | Why |
|---|---|---|
| `vaultCompsForReport` (the broker's own report blend) | yes, before the blend | a priced sale with an inherited size now carries a $/SF and joins the valuation |
| `vaultReadPayload` (`/vault` page) | yes | the table, the medians, the gut check and the strip all read the filled row; the page shows which cells are inherited (§6) |
| `GET /api/vault/export.csv` | **no** | stated values only |
| `shareVaultCompsToOrg` (firm copy) | **no** in v1 | the firm copy is what the broker stated; whether a colleague's report should see the inherited size is an open question (§9) |
| `POST /api/vault/publish` | **no** | a published comp is a public claim, and a derived figure was never vouched for on that deal |
| `archiveCoverage` / `archiveIsStrong` | yes, by construction | it reads the rows `vaultCompsForReport` returns |

`facts` reaches each comp through `vault-api.js`'s `PROPERTY_FIELDS`, the
list that exists for exactly this: a field a comp inherits from
`broker_properties` rather than from its own row. The schema test that pins
that list against the migration files passes with the new column and fails
without it, which is the tripwire wanted. `inherited` is not a stored
column anywhere and rides beside `cited_count`'s precedent as a fourth
checked list, `DERIVED_FIELDS`, so the both-ways schema tests keep their
teeth.

`attachPropertyCoords` already reads `broker_properties` by id for the
report path; it selects `facts` too and merges it. `vaultReadPayload` does
not stitch building data today (the export path does its own chunked read
for coordinates); it gains the same call, which also puts `lat`/`lng` on the
page's rows as a side effect.

The module is dual-exported like `gut-check.js` (browser global
`BFACTS`, served `max-age: 0`), because the page has to prefill from the
same rule the server fills with, and two copies of "which fields inherit"
would be the `compWeight` pair again.

---

## 6. What the broker sees

Four surfaces, each a small change.

1. **The compact table.** An inherited cell renders the value in the muted
   ink with `title="From the building · stated on 2 other deals"`. Focusing
   it shows an EMPTY raw value, because that is what is stored; typing a
   value states it on this deal and the inherited one goes away. `cellDisplay`
   already separates displayed from raw, so this is the existing convention
   with a third state.
2. **The add form.** On leaving the address field, the page looks the typed
   address up against the book it already holds (the page fetches
   `?limit=1000` and keeps its own `addrKey`, byte-identical to the server's
   `addressKey`). A match prefills the empty building fields, `size_sqft`
   only when Transaction is Sale, and a line under the address says "Known
   building · 2 deals in your book". A prefilled value is a value in the
   input, so it is sent and STATED on the new deal, which is the point: the
   broker confirmed it by saving.
3. **The confirm table** (PDF, screenshot, spreadsheet). The same lookup per
   extracted row, filling empty building cells and adding the "known
   building" note to the row. This answers half of the roadmap's item 3
   (which property is this row about) without a name field, for every row on
   a building the broker already holds. Rows on new buildings are unchanged.
4. **The repeats panel.** Each repeat property gains one line of facts under
   its address: the derived values, then what nobody has ever stated
   ("no year built on any of these") and any conflict, named with both
   values. This is where a broker sees that fixing one cell fixes the
   building.

Nothing new is required of a broker. A book uploaded before this shipped
derives on its next touch; a never-touched book derives the first time
`/vault` is opened, riding the 8-per-read backfill pattern `geocodeVaultPropertyRows`
already uses, since the read has the rows in hand.

---

## 7. The privacy wall

Nothing here crosses it, and the reasons are structural rather than
promised:

- Every read and write is scoped by `user_id` first, in the same functions
  that already hold the vault's rule (`linkVaultProperties`,
  `attachPropertyCoords`, `vaultReadPayload`).
- `facts` is derived from the broker's own rows and read back onto the
  broker's own rows. No other account's deals are consulted, ever. Two
  brokers on the same building keep separate `broker_properties` rows (016's
  rule) and therefore separate facts.
- Nothing vault-shaped reaches `harvestComps`, `corpusRowsForMarket` or a
  market snapshot, unchanged. `applyFacts` runs inside `vaultCompsForReport`,
  which is downstream of every one of those by the blended-comps contract.
- `POST /api/share` strips or anonymizes vault comps as before. An inherited
  size rides the anonymized `locked_basis` row exactly as a stated one does,
  with no address, and that is correct: the valuation the client sees should
  match the broker's to the dollar.
- The firm copy and the public records get stated values only (§5).
- The lookup in §6 runs in the browser against rows the page already holds.
  No address leaves the page to ask "do I know this building".

---

## 8. Tests

- `test/building-facts.test.js`: the field table in §2 in both directions
  (a deal field never inherits, a building field always may); agreement,
  case-fold agreement, disagreement to conflict, blank-is-not-a-vote,
  size-from-sales-only, size-onto-sales-only, `anchor_tenant`'s most-recent
  rule, `price_per_sqft` computed from the deal's own price and only when
  size was inherited onto a priced sale, `applyFacts` never touching a
  non-empty cell.
- `test/vault-api.test.js`: `facts` in `PROPERTY_FIELDS` against the
  migration's column; `inherited` in `DERIVED_FIELDS` and in no table.
- `test/vault-building-facts-run.test.js` against the fake PostgREST: upload
  three deals on one building, two stating a year built and one not; read
  `/api/vault` and see the third row carry it with `inherited`; export and
  see it absent; edit the second deal to a different year and see the
  building fall to a conflict on the next read; add a lease on the building
  and see no size inherited onto it; add a priced sale with no size and see
  a $/SF appear on the vault read and in `vaultCompsForReport`, and not in
  the firm copy.
- `test/vault-page.test.js`: the page still compiles; `BFACTS` is loaded;
  the add-form lookup fills `size_sqft` only when Sale is selected.
- The `add-comp-field` skill's checklist gains the §2 placement step, and a
  test fails the build when a per-type field is on neither side of
  `BUILDING_FIELDS` / the deal list.

---

## 9. Not built, and the open questions

- **Stating a fact ON the building.** The obvious next door: an edit on the
  repeats panel that writes `facts.values` directly, so a broker fixes the
  year built once without picking a deal to carry it. Deferred because it
  changes §3's "derived, never stated" rule into a fill-only rule with a
  conflict between stated-on-building and stated-on-deal to resolve, and
  because v1 already delivers "type it once": stating it on any one deal
  gives it to all. Build it when a broker asks which deal to put it on.
- **The firm copy.** Should `shareVaultCompsToOrg` share the inherited size
  so a colleague's report can price the deal? Probably yes, snapshotted at
  share time the way `refreshSharedComp` already re-copies on edit, but it
  writes a derived figure into a table that has only ever held stated ones.
  Owner's call.
- **Merging into `org_buildings`.** The firm's building record has
  `size_sqft` and `year_built` and a member's derived facts could seed it.
  Not touched: that is a colleague-visibility question, and the "Add to firm"
  door already exists for the case where the broker wants the building on the
  board. `test/org-routes.test.js` refuses `org_buildings` outside its own
  block, and this spec keeps it that way.
- **Delete recompute** (§4). Cheap to add; left out until a lingering fact
  is actually observed to mislead.
- **The confirm table's business name.** §6.3 covers known buildings only.
  A row on a new building still needs the roadmap's item 3 decision.

---

## 10. Cost and order

Roughly one focused day, in this order so each step ships green on its own:

1. Migration 050 and `building-facts.js` with its unit tests. Nothing reads
   the column yet.
2. `linkVaultProperties` derives and PATCHes; `attachPropertyCoords` and
   `vaultReadPayload` stitch and apply; `vault-api.js` lists the two fields;
   the run test. The report blend and the page are now right, with no UI.
3. The four surfaces in §6, with the page test.
4. Before and after pictures of `/vault` with a seeded book carrying one
   conflict and one inherited size, per the standing rule, using the
   fake-supabase seed the vault preview memory describes.

Rollback at any step is unsetting nothing: the column is additive, a missing
`facts` means no inheritance, and the page renders exactly as it does today.

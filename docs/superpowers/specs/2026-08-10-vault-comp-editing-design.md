# Vault comp editing, adding and export: the first ten minutes

Status: AGREED 2026-08-10. Not yet implemented.

## The problem, and the evidence for it

The vault has never had a single real upload. Not one broker book, ever
(`docs/ROADMAP.md` records this as the reason import-time geocoding was
deferred on 2026-08-06, and the CSV column mapper shipped on 2026-08-10 with
no live end-to-end test because there was nothing to test it against).

That fact should govern what gets built next. The vault is not short of
features: it has a market rollup, median $/SF by year, repeat properties, the
gut check, the BOV tracker, the lead inbox and opt-in publishing. What it is
short of is anyone walking through its front door.

So this work is not another panel. It closes three gaps a real broker hits in
the first ten minutes, each of which is an objection raised *before* uploading
rather than a reward for having uploaded. The whole vault API is seven
endpoints (`template`, `inspect`, `upload`, `publish`, `benchmarks`,
`GET /api/vault`, `DELETE /api/vault/upload`) and none of them can do any of
the following.

**1. There is no way to fix one comp.** The only delete is by import id, with
comps cascading. A broker who spots one wrong sale price must delete the
entire spreadsheet and re-import it. On a 400-row book that is a punishing way
to correct a typo, and correcting a typo is the first thing anyone does after
a first import.

**2. There is no way to add one comp.** A broker who closes a deal on Tuesday
has to author a CSV to record it. That guarantees the vault goes stale between
bulk uploads, which quietly degrades every panel built on it. The gut check,
the rollup and the median chart all read a book that stopped being current.

**3. There is no way to get the data back out.** Nothing exports a broker's
own vault. That is the question asked before the first upload, not after it:
"what happens to my book if I cancel." The plan card already promises a lapsed
vault is never deleted, and the vault has no file fallback precisely so a
broker's book cannot silently vanish, but there is still no door to walk out
of. An export is the cheapest trust purchase on the list.

## Scope

In scope: editing one comp, deleting one comp, adding one comp by hand, and
exporting the whole vault as CSV.

Out of scope, deliberately:

- **Bulk edit.** Fixing fifty rows is what the export plus re-import round trip
  is for, and that round trip is a stated requirement of section 5 below.
- **Undo.** A deleted comp is gone. See section 3 for why a tombstone the
  broker cannot see would be worse than the deletion they asked for.
- **Import-time geocoding.** Still deferred, still waiting on evidence from a
  real book. Unaffected by this work.
- **XLSX export.** Considered and rejected during brainstorming: it does not
  round-trip through the importer without a CSV save first, and the repo's only
  XLSX writer lives in `index.html` for reports.
- **Editing another broker's anything.** Stated only because it is the failure
  mode every route here must be written against.

## Decisions locked during brainstorming

1. **A published comp is retracted when it is edited or deleted.** Owner's
   decision. See section 4.
2. **The export is template-shaped CSV**, so it round-trips back through the
   importer with no mapping screen. Owner's decision. See section 5.
3. **Every field is editable, address, date and price included.** Fixing a
   wrong number is the point of the feature, so restricting the editable set to
   the fields that are safe to change would miss the case that motivates it.
4. **Delete is a hard delete.**

## 1. Where the rules live

Every new validation goes in **`broker-vault.js`**, which is pure, has no I/O
and already carries 64 tested cases. Nothing new is validated in `server.js` or
`vault-page.js`.

This is not style. It is what lets `npm test` exercise these rules with no
database, and it is the single mechanism preventing the thing this feature is
most likely to break: **a hand-typed comp bypassing checks a CSV row faces.**
`broker-vault.js` rejects rather than guesses, refusing "1.2M", a bare number
as a date (Excel's serial) and day-first dates with a line number, because a
wrong number in a broker's own records is worse than a rejected row, since
nobody will notice it. A second validator written into a form handler would
reintroduce every one of those.

The new pure function is `validateEdit(existing, patch)`, returning the same
result shape a row parse already returns. The add path calls the existing row
parser directly rather than a new one.

## 2. Edit one comp: `PATCH /api/vault/comp?id=`

Through the same `openVault()` helper every vault route uses, in the same
order: 401 not signed in, 403 not a broker (`canUseVault`), 503 no database.
`user_id` is in the filter of every read and every write, without exception:
without it, knowing another broker's comp id is enough to edit their data.

- **Same parsers as the CSV path.** `validateEdit` routes through `parseMoney`,
  `parseNumber`, `parsePercent` and the existing date rules.
- **Keys recomputed** when `address`, `deal_date` or `price` change:
  `address_key`, then `dedupe_key`, then a re-link through
  `linkVaultProperties()`. Both keys must be built by the **same code**
  `parseUpload` uses, extracted if necessary, never by a second expression that
  restates the format. `dedupe_key` encodes its empty cases deliberately
  (`deal_date || ""`, `price == null ? "" : price`) because Postgres compares
  NULLs as DISTINCT, so an unpriced comp under a multi-column constraint could
  re-import without limit; a near-miss copy of that string would reintroduce
  exactly that bug in the edit path. The link **never throws**:
  the property dimension is an index onto a broker's book, not part of it, so a
  failed link costs a join while a failed edit costs the broker their
  correction.
- **A colliding edit is refused by name.** If the recomputed `dedupe_key`
  matches another of the broker's own comps, the answer is "you already have
  this comp", not a 500 surfaced from the unique constraint.
- **`price_per_sqft` is recomputed on sales only** and left null on leases, the
  existing rule. An annual rent divided by size is $/SF/yr and would corrupt
  any median it entered, which is why the vault dashboard reads that stored
  column and never derives one.
- **`market` is recomputed with `marketOf()` in `server.js`, never in
  `broker-vault.js`**, matching how upload does it. It has to agree byte for
  byte with `comp_corpus.market` so a comp published later needs no
  translation, and a second copy of that parse would be a second thing to keep
  in sync.

## 3. Delete one comp: `DELETE /api/vault/comp?id=`

Same gate, same `user_id` scoping, same retraction rule as section 4.

**Hard delete**, with a confirm in the browser. The vault's standing rule that
a lapsed subscription never deletes a book protects the broker from us. This is
the broker deleting their own row on purpose, and a soft-delete tombstone they
cannot see, cannot search and cannot remove would be worse than the deletion
they asked for.

## 4. What happens to a published comp

Publishing writes a `comp_submissions` row credited to the broker's firm and
sets `broker_comps.published`. So editing or deleting privately has a public
consequence.

**Both paths retract first.** The existing unpublish path already takes this
position, deleting the submission outright rather than marking it rejected,
with the reason recorded in `server.js`: `fetchVerifiedComps` selects on
status, and a retracted comp should leave no public row at all. Edit and delete
reuse that path verbatim: delete the `comp_submissions` row, clear `published`,
`published_at` and `published_submission_id`, then apply the change.

An edit therefore leaves the comp **unpublished**, so republishing is a
deliberate act by a broker looking at the corrected row. The response carries
that fact so the UI can say so rather than let the broker discover it later.

**A limit to state, not to solve.** If the submission was already approved, the
comp may already have been served in reports and harvested into `comp_corpus`.
Retracting the submission does not un-harvest those rows. This work does not
change that, and the UI should not imply otherwise.

## 5. Export: `GET /api/vault/export.csv`

**Its own route, deliberately not the dashboard's data.** `vaultReadPayload`
hard-caps at 1000 rows (`Math.min(..., 1000)`), and the dashboard already
fetches `?limit=1000` and filters in the browser. Building the export from what
the page holds would therefore silently truncate exactly the large books that
most need exporting, which is the same silent-data-loss failure the CSV mapper
exists to prevent. This route pages server-side until the vault is exhausted.

- **Template-shaped**, leading with `TEMPLATE_COLUMNS` in its exact order, so
  the file re-imports with no mapping screen: a file already in our own column
  names skips that screen by design.
- **Plus every optional per-type column that actually carries data.**
  `TEMPLATE_COLUMNS` alone is NOT the export shape, and assuming it was is a
  bug this spec originally contained. `OPTIONAL_SPEC_COLUMNS` (`clear_height`,
  `units`, `lot_acres` and nine more) are importable, are stored on
  `broker_comps`, and are named in the template's own guidance as columns a
  broker may add. An export of `TEMPLATE_COLUMNS` only would drop them
  silently, so a broker who exported to fix a price would re-import a book with
  every clear height gone. The export therefore appends each
  `OPTIONAL_SPEC_COLUMNS` name that is non-null on at least one exported row,
  in that constant's own order. A book with no per-type data gets exactly
  `TEMPLATE_COLUMNS` and no trailing empty columns.
- **`lat` and `lng` come from the joined property, not the comp.** They are in
  `TEMPLATE_COLUMNS` but they are not columns on `broker_comps`; they live on
  `broker_properties` one join away, which is why `vault-api.js` keeps them in
  a separate `PROPERTY_FIELDS` list. An export built from `broker_comps` alone
  would emit them empty, and re-importing that file would strip the
  coordinates and send a private address back out to a third-party geocoder on
  the next report. That is a privacy regression, not merely data loss, so the
  export route joins `broker_properties` and a test covers the round trip.
- **Data rows only**, no `#` guidance lines. The template teaches; an export
  carries data.
- **The whole vault**, ignoring the dashboard's current filter. The button says
  **"Export all comps (CSV)"** so there is no ambiguity about what a filtered
  view produces.
- Scoped by `user_id` like every other read here.

## 6. Add one comp: `POST /api/vault/comp`

One form on `/vault`: the four required fields (`address`, `property_type`,
`transaction`, `deal_date`, i.e. `REQUIRED_TARGETS`) plus the optional per-type
columns for the chosen type. It runs the **identical row parser** the CSV path
uses, so the two entry doors cannot drift.

`upload_id` stays null, which the schema already allows
(`upload_id uuid references broker_uploads(id) on delete cascade`, with no
`not null`). **No migration is required for any part of this work.**

Two consequences, both intended and both worth stating in the UI:

- A hand-added comp belongs to no import, so "delete this import" can never
  remove it and per-comp delete is the only way.
- The first-run panel is unaffected: it keys on comps **and** uploads, so a
  broker who has only ever hand-added comps has been through the door and is
  correctly not shown the first-run steps again.

## 7. Testing

- `broker-vault.js` unit tests for `validateEdit`: each parser's rejections
  reached through the edit path, the dedupe-key recomputation, and the
  collision case.
- Export row shaping tested pure, including a comp with every optional field
  empty.
- **Header tests pinning the export against both constants.** An empty book
  exports exactly `TEMPLATE_COLUMNS`; a book carrying a per-type value exports
  that column too, and only the ones carrying data. These fail the build the
  next time a per-type field is added through the `add-comp-field` skill
  without the export learning about it, which is how the round trip would
  otherwise break quietly. Same shape as the existing test pinning the
  template's guidance against `PROPERTY_TYPES` and `OPTIONAL_SPEC_COLUMNS`.
- **A round-trip test**: build rows, export them, run the CSV back through
  `parseUpload`, and assert every value survives, coordinates included. This is
  the single test that would have caught both of the export flaws recorded in
  section 5.
- `test/routes.test.js` gets the gate wiring for all four endpoints: the
  401/403/503 order, and that each refuses a comp id belonging to another user.

## 8. What this deliberately does not prove

None of this has been exercised against a real broker export, because none
exists. The round trip in section 5 is testable end to end with our own
template, and that is the strongest available evidence, but it is not the same
as a CoStar export making the journey out and back. Getting one real book
through the importer remains the highest-information thing available and is not
replaced by this work.

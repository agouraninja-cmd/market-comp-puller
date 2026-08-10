# Vault CSV column mapper: accept the broker's own export

Status: AGREED 2026-08-10. Not yet implemented.

## The problem, and the evidence for it

`broker-vault.js`'s `parseUpload` normalizes header case, spaces and dashes
(`normalizeHeader`), then requires literal template names. If it cannot find a
column that normalizes to exactly `address` it rejects the whole file:

> "That file has no `address` column, download the template and paste your
> comps into it."

A CoStar, MLS or CRM export whose first column is "Property Address"
normalizes to `property_address` and dies on line one. So a broker's first
experience of the vault is being told to go do data entry into our template.

Two facts make this the highest-value broker change available:

1. `docs/ROADMAP.md` records that import-time geocoding was deferred on
   2026-08-06 because there were **no vault uploads at all** to measure
   against, and that the product had zero real outside users at that date.
2. Everything downstream of the upload is already built: market rollup,
   median $/SF by year, repeat properties, the gut check, the BOV tracker,
   the lead inbox, opt-in publishing. The vault is feature-rich behind a
   front door nobody has walked through.

There is also a **silent** failure today, not just a loud one. Only four
fields are required per row (`address`, `property_type`, `transaction`,
`deal_date` in `normalizeRow`). A file carrying "Sq Ft" instead of
`size_sqft` therefore imports successfully with every size null, every
`price_per_sqft` null, and nothing anywhere saying so. The vault dashboard
then shows comp counts instead of medians and the broker has no way to learn
why.

## What this is not

The current behavior is a deliberate decision, recorded above
`TEMPLATE_COLUMNS`:

> "A broker fills this in; we do not try to guess what their own column names
> meant... 'Sale Price', 'Price', '$' and 'Consideration' all mean the same
> thing, and a wrong guess puts the price in the size column."

That reasoning stands and this design does not overturn it. A mapper does not
guess, it **asks**, and nothing is written until the broker confirms. The
suggestion rules in section 4 are shaped specifically so that the ambiguous
case named in that comment resolves to a question rather than a coin flip.

## Scope

In scope: reading any CSV, letting the broker map its columns onto our fields
once, remembering that mapping, and importing through the existing validated
path.

Out of scope, deliberately:

- Excel (`.xlsx`) parsing. The repo has no dependencies and hand-rolling a
  workbook reader is a project of its own. Every system that exports to Excel
  also exports to CSV.
- PDF ingestion, despite the Ecosystem Plan's "CSV/PDF" phrasing. Same reason,
  larger.
- Splitting or combining columns (one "City, ST" column into two, or a
  first-plus-last name join). Nothing in the template needs it.
- Transforming values. The mapper decides which column is which and never what
  a value means; `normalizeRow` keeps that job unchanged.

## Decisions locked during brainstorming

1. **Pre-select a suggested mapping and show real sample values** under each
   column, rather than starting blank. The sample values are what make a
   mis-suggestion visible rather than silent.
2. **Always show the mapping screen, except for a file whose headers already
   match the template exactly**, which imports straight through as today. This
   is what closes the silent-drop case above.
3. **Remember the broker's confirmed mapping** so a recurring export is fast
   the second time.
4. **Server-side, with a new inspect route.** Rules in the pure tested module,
   I/O and the gate in `server.js`.

## Architecture

The browser already reads the file to text with `FileReader` before posting
(`upload()` in `vault-page.js`), so the file is read once and held in memory.

```
pick file
  -> FileReader.readAsText            (unchanged)
  -> POST /api/vault/inspect {csv}    (new)
       <- { headers, samples, suggested, remembered, cleanTemplate }
  -> if cleanTemplate: skip the screen
     else: render the mapping table, broker confirms
  -> POST /api/vault/upload {filename, csv, mapping}   (mapping is new+optional)
       server: VAULT.applyMapping(csv, mapping) -> parseUpload -> unchanged path
```

The file crosses the wire twice. At the sizes involved (a 5,000 row sheet is
well under 1MB against an 8MB guard) this is not worth engineering around, and
the alternative, holding the upload server-side between two calls, would add
state to a stateless path.

### Why not the two alternatives

**Browser-side mapping** (serve `broker-vault.js` as a dual Node/global module
the way `valuation.js` and `gut-check.js` are, map in the browser, rewrite the
header row, post to the unchanged route) needs no server change at all. It was
rejected because it moves the one step that can silently corrupt a broker's
book into the client, where it is neither gated nor covered by `npm test`, and
because `vault-page.js` is already a 75KB single template literal in which a
stray `${` yields a blank workspace rather than a loud failure.

**A `dryRun` flag on the existing upload route** avoids a new route by giving
one endpoint two unrelated behaviors. Rejected: the gate, the rate limiter and
the error shapes all want to differ between "tell me about this file" and
"import this file".

## The endpoint

`POST /api/vault/inspect`, body `{ csv }`.

- Goes through the same `openVault()` helper as every other vault route, so it
  gives the same three refusals in the same order: 401 not signed in, 403 not
  entitled (`canUseVault`), 503 no database. It needs no database itself, but
  gate consistency is the rule here; `/api/vault/benchmarks` already reads no
  vault rows and still answers through `openVault`.
- Rate limited per IP on its own key (`vaultinspect:`), separate from
  `vaultup:`, since inspecting is cheap and a broker may retry the screen.
- Same 8MB runaway guard as the upload route.
- **Writes nothing and stores nothing.** It is an echo with analysis. The one
  exception is the remembered mapping, which it only ever *reads*.

Response:

```jsonc
{
  "headers": ["Property Address", "Sale Price", "SF", "Consideration"],
  "samples": {                       // up to 3 non-empty values, in file order
    "Property Address": ["1234 W Main St, Boise, ID", "…"],
    "Sale Price": ["$2,450,000", "…"]
  },
  "suggested": { "Property Address": "address", "Sale Price": "price" },
  "remembered": { "SF": "size_sqft" },  // or null
  "cleanTemplate": false,
  "rowCount": 412,
  "targets": [ /* selectable fields, grouped, with labels */ ]
}
```

`targets` is served rather than hard-coded in the page so the dropdown cannot
drift from `TEMPLATE_COLUMNS` + `OPTIONAL_SPEC_COLUMNS`. Adding a per-type
field stays a one-place change, which is what the `add-comp-field` skill
assumes.

`POST /api/vault/upload` gains an optional `mapping` object. Absent, behavior
is byte-identical to today, so `gen-market-seed.js` and any existing caller are
unaffected.

## The rules (`broker-vault.js`)

All of the following are pure, take no clock and no I/O, and are covered by
`npm test`.

### `suggestMapping(headers)`

An alias table keyed on `normalizeHeader` output, for example:

| target | aliases |
| --- | --- |
| `address` | `property_address`, `prop_address`, `street_address`, `site_address` |
| `price` | `sale_price`, `sales_price`, `purchase_price`, `sold_price` |
| `size_sqft` | `sf`, `sq_ft`, `sqft`, `square_feet`, `building_sf`, `size` |
| `deal_date` | `sale_date`, `close_date`, `closing_date`, `transaction_date`, `date` |
| `property_type` | `type`, `prop_type`, `asset_type` |
| `transaction` | `deal_type`, `sale_or_lease`, `transaction_type` |
| `cap_rate` | `cap`, `going_in_cap` |
| `year_built` | `yr_built`, `built` |
| `notes` | `comments`, `remarks` |

**The ambiguity rule is the load-bearing part.** A target is pre-selected only
when **exactly one** column in the file claims it. If two columns both alias to
`price`, neither is pre-selected and the broker chooses. This is the direct
answer to the "Price versus Consideration" case in the original comment: the
mapper never breaks that tie itself.

An exact match on a template name always wins over an alias, so a file that
has both `price` and `Sale Price` selects the literal one.

### `validateMapping(mapping, headers)`

Refuses rather than repairs, matching the module's existing stance:

- every required target (`address`, `property_type`, `transaction`,
  `deal_date`) must be claimed, and the error names which are missing;
- no target may be claimed by two source columns;
- an unknown target name is an error, not a silently ignored key;
- a source column that appears in the mapping but not in the file is an error
  (it means the page and the file have diverged);
- a source column mapped to nothing is normal and is simply dropped. A 40
  column CoStar export is expected.

### `applyMapping(csvText, mapping)`

Rewrites only the header row to template names and returns the CSV text.
Deliberately a header rename and nothing else, so `parseUpload` remains the
single place any *value* is interpreted.

### `isCleanTemplate(headers)`

True when every header normalizes to a known target and all four required
targets are present. This is the auto-skip condition in step 3 of the flow.
Note it requires *every* header to be known, so the "Sq Ft" file does not
qualify and correctly gets the screen.

## Storage

Migration `021-broker-csv-mappings.sql`, purely additive, one row per broker:

```sql
create table if not exists broker_csv_mappings (
  user_id uuid primary key references users(id) on delete cascade,
  mapping jsonb not null,
  updated_at timestamptz not null default now()
);
alter table broker_csv_mappings enable row level security;
```

`user_id` is the primary key rather than a surrogate `id` alongside it, unlike
`broker_bovs` and `broker_comps`. Those are fact tables holding many rows per
broker; this holds exactly one, and making that the key enforces it in the
schema instead of in a code path. It also means no index is needed and the
upsert has an obvious conflict target. RLS is enabled to match every other
vault-class table (013, 019); the service key bypasses it, and nothing else
ever reads this.

A dedicated table rather than a column on `broker_profiles`, because a Pro
subscriber who uploads may have no profile row at all (profiles arrive through
the broker network and comp submissions), and an upload must not depend on a
row that may not exist.

Read scoped by `user_id` like every other vault read. Written by upsert on
confirm. Never read by any owner-facing surface; it is vault-class private,
though it holds only column names.

### Why plain remembering is safe here

Remembering was chosen over keying the mapping to a fingerprint of the file's
header row. That is safe **only because** decision 2 always shows the screen: a
remembered mapping is a better pre-selection, never a silent auto-apply. If a
broker's export gains, loses or renames a column, or they switch systems
entirely, the remembered mapping fills what still matches, anything new starts
blank, and they confirm. There is no path by which a stale mapping imports the
wrong thing.

**If a future change makes the screen skippable on a remembered mapping, the
header signature becomes necessary.** Recorded here so that connection is not
lost.

## UI on `/vault`

A panel replacing the upload area while mapping is in progress: a table of
your column / maps to (a `<select>` of `targets`) / sample values, above a
short line naming the columns that will be ignored, and an "Import N rows"
button. The ignored list exists because silent dropping is one of the two
problems being fixed.

Follows the page's existing quiet style: no new colors, the red accent only on
the primary action, empty and error states as sentences rather than empty
tables. The panel is hidden on first paint like every other section and shown
only by the inspect response, so the first-run experience
(`applyFirstRun()`) is untouched.

Cancelling returns to the upload area and writes nothing.

## Privacy

The CSV already crosses to our server on upload, so inspect introduces no new
exposure of a broker's book. Three constraints hold:

- inspect persists nothing, so a broker who cancels leaves no trace;
- sample values are echoed back only to the caller who just sent them;
- the mapping table itself is user-scoped and never reaches an owner surface.

`lat` and `lng` become mappable, which is a genuine privacy gain: a broker
whose export carries coordinates never has an off-market address sent to a
third-party geocoder, which is exactly what migration 017 and the
private-comp-geocoding spec set up.

## Error handling

- Inspect fails (network, 500): show the error and let the broker retry.
  Deliberately **not** a silent fallback to the strict path, which would
  reintroduce today's confusing rejection under a different cause.
- Mapping invalid on submit: `validateMapping` runs server-side too, so a
  hand-crafted request cannot bypass it. The screen also validates live so the
  Import button is disabled until the four required fields are claimed.
- After mapping, per-row failures are unchanged: line numbers, first 100
  errors, and nothing written when nothing is usable.

## Testing

`broker-vault.js` (pure, in `npm test`):

- `suggestMapping`: aliases resolve; exact names beat aliases; **two columns
  claiming one target leaves both unselected**; an unknown header suggests
  nothing.
- `validateMapping`: each refusal above, one test per rule.
- `applyMapping`: headers renamed, body untouched, quoted headers survive,
  a BOM-led file still works (`parseCsv` already strips it).
- `isCleanTemplate`: true for the template, false for the "Sq Ft" file.
- End to end: the "Property Address / Sale Price / SF" fixture maps and then
  parses to the same rows the template version of that file produces.

`test/routes.test.js`: `/api/vault/inspect` gives 401 / 403 / 503 in the same
order as the other vault routes. This is the file's whole purpose and the
mapper adds a fifth route that could drift from `openVault`.

## Rollout

No feature flag. The change is additive: `mapping` absent means today's
behavior, so the rollback is reverting the page.

Order matters, per the deploy skill: **run migration 021 before deploying**,
because remembering reads a table that must exist. The read is failure-safe
(no remembered mapping simply means none is offered), so a deploy-then-migrate
ordering degrades rather than breaks, but the documented order still holds.

## Follow-ons this unblocks

- **Import-time geocoding** (`docs/ROADMAP.md`, Next). It was deferred for
  want of a real broker book to measure. This is the change most likely to
  produce one.
- **A read on how many exports already carry coordinates**, which is the exact
  question section 7 of the private-comp-geocoding spec could not answer.

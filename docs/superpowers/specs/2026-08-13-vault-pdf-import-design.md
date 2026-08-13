# Vault PDF import: table PDFs into the confirm table

Date: 2026-08-13
Status: agreed
Touches: `vault-page.js`, `server.js`, `broker-vault.js`, `search-provider-*.js`
(a `pdfExtract` capability only), `test/broker-vault.test.js`,
`test/vault-page.test.js`, `test/vault-first-run.test.js`, `test/routes.test.js`,
`devlog.json`, `CLAUDE.md`

Source: Ecosystem Plan §3 ("Upload comps (CSV or PDF)"), deferred by vault v1
decision 1 in `docs/superpowers/plans/2026-08-05-broker-vault-v1.md`, then
explicitly out of scope in the CSV mapper spec. Unblocked by a real request
for table PDFs (CoStar / ARGUS / in-house CMA), not flyers.

## 1. The problem

`/vault`'s first-run step is "Build your own comp set." The picker accepts
`.csv` only. Brokers already keep closed deals as a table PDF — a CoStar
export, an ARGUS roll, a printed CMA. Today that file bounces, and the only
door in is retyping into the template or exporting CSV from the same system.

Spreadsheets stay exact. A PDF has to be read, so a price or date can come out
wrong. Vault v1 deferred this for that reason: "a wrong number in a broker's
own private records is worse than no import feature." The mapper later asked
before guessing column names. This feature asks before guessing values.

## 2. What this is not

- Not a second write path. Confirmed rows land through today's
  `POST /api/vault/upload` → `parseUpload` → `normalizeRow`. Extract writes
  nothing.
- Not the column mapper. A PDF never opens `#mapSec`. The mapper is for a
  spreadsheet whose values are already right.
- Not Excel (`.xlsx`). Still no dependencies; every system that exports xlsx
  also exports CSV. Unchanged from the mapper spec.
- Not offering-memo flyers or one-property listing PDFs. Those are a different
  product (one building per file). Out of scope.
- Not storing the PDF. `broker_uploads` records the filename after confirm,
  the same as a CSV. The bytes are discarded when the extract response is
  sent.
- Not a search. The extract call must not attach `web_search` or
  `google_search`. The file is private broker data. Search-provider
  `buildRequestBody` is unused here because those builders always attach
  tools.

## 3. Decisions locked during brainstorming

1. **Table PDFs only.** Many comps on a page, not a flyer.
2. **Model extract, then a confirm table.** Gemini/Anthropic already accept
   PDFs; the repo stays at zero npm deps. Cost is one model call per file.
3. **Layout A: every extracted row is an editable spreadsheet.** Same panel
   shape as "Match your columns." Checkboxes on for rows that already parse;
   problem rows tint and start unchecked. Click a cell to fix it.
4. **CSV path unchanged.** Same file input, two readers.
5. **Privacy copy names the vendor.** A PDF is sent to the extract vendor to
   read the table. CompNinja does not store the file. Rows land only after
   confirm. They are still never read into public records, never exported or
   shared, never shown to another broker.

## 4. Architecture

Same picker (`#file`). `upload(file)` branches on type:

```
.csv  -> POST /api/vault/inspect -> mapper or doImport   (today, byte for byte)
.pdf  -> POST /api/vault/extract -> confirm table        -> POST /api/vault/upload
```

Still exactly one `<input type=file>`. First-run's "Choose a spreadsheet"
button and the deck action both keep calling `$("file").click()`.

### Extract (`POST /api/vault/extract`)

JSON `{ filename, pdf }` where `pdf` is base64. Same JSON-not-multipart
pattern as upload (CLAUDE.md: multipart would be hundreds of lines of
hand-rolled parsing in a repo with no dependencies). Gate is `openVault`,
same three refusals in the same order (401 / 403 / 503).

Server:

1. Decode, refuse if not a PDF (`%PDF` magic) or over 4 MB decoded. The
   existing upload body cap is 8 MB of JSON; base64 expands 4/3, so 4 MB
   decoded is the product limit and the runaway guard still sits above it.
2. Send the PDF to the live search vendor as a document, via a **dedicated**
   extract body that has no tools. Branch on
   `PROVIDER.capabilities.pdfExtract` (new boolean). If false, 503 "PDF
   import isn't available on this deployment" — no silent fallback to the
   other vendor, which would send a private file to a vendor this
   deployment did not choose and might not even have a key for.
3. Model returns a JSON array of objects keyed by `TEMPLATE_COLUMNS` plus
   any `OPTIONAL_SPEC_COLUMNS` it actually saw. Prompt: extract every deal
   row from tables; omit header, total, and submarket-summary rows; omit a
   field rather than invent it; never invent a price, date, or size;
   `property_type` must be one of `PROPERTY_TYPES`; `transaction` is sale or
   lease.
4. Unknown keys are dropped (the `sanitizeSubjectDetails` rule: only
   `TEMPLATE_COLUMNS` + `OPTIONAL_SPEC_COLUMNS` may survive). Each
   candidate then runs through `normalizeRow`. The response is
   `{ rows: [{ values, error }] }` where `values` are the model's raw
   strings (so the broker recognises their PDF) and `error` is the
   joined `normalizeRow` errors or `null`. Nothing is written. A PII-free
   `vault_extract` analytics event packs the row count in `source` (the
   `link_check` / `vault_import` precedent).

Rate limit: `rateLimited("vaultex:" + ip, 8)` — tighter than CSV's 30,
same 5-minute window, because this costs money. Timeout: 90 s, fixed.
Fails closed with no API key.

Anthropic: a `document` content block, `media_type: application/pdf`, on
the Messages API. Gemini: `inline_data` with `mime_type: application/pdf`
on **generateContent**, not the Interactions search endpoint — search and
extract are different HTTP shapes, and Interactions is unverified for
files. `buildExtractBody` is a new provider function; it has no `tools`
key. A 400 on an assumed field is the same class of bug the Interactions
`generation_config` trap already taught us, so the first implementation
task is a live probe that pins the Gemini body before the route is wired.

### Confirm table (`#pdfSec`)

Sibling of `#mapSec`, not a reuse of it. H2 "Review these comps." Sub:
"N deals in \<filename\>. Uncheck any that aren't yours. Fix a cell if we
misread it. Nothing is saved until you import."

A three-cell count strip above the table: found / ready / need a fix.
Ready = `error == null`. Need a fix names the most common missing required
field when it can ("2 need a date"), otherwise "N need a fix."

Table columns: the four required fields always (`address`, `property_type`,
`transaction`, `deal_date`), then any other `TEMPLATE_COLUMNS` /
`OPTIONAL_SPEC_COLUMNS` that have a value on at least one row. Empty
optional columns stay off the screen. Every visible cell is an input.
Checkbox column: on when `error == null`, off otherwise. Problem rows
(`error != null`) tint with the existing `.msg.bad` wash
(`#FDF2F2` / `#F0C7C7`). Editing a cell does **not** re-run
`normalizeRow` in the browser — `broker-vault.js` stays Node-only, and
Import is the validator, the same as the mapper. Tint and default
checkbox are from extract time; a broker who fixes a date still has to
check the box (it started off). After a partial import the panel stays open with
the server's line-numbered skips (the mapper's `failed()` rule).

Import N / Cancel. N is the count of checked rows. Cancel drops the
preview and reopens the uploader; nothing was stored.

A drop of a `.pdf` takes this path. A drop that is neither CSV nor PDF
is refused with "Use a .csv or .pdf" rather than `readAsText`'d into
inspect, which is what a `.xlsx` does today and which this feature must
not copy.

### Write path

Import posts `{ filename, rows }` to today's `POST /api/vault/upload`,
where `rows` is the array of edited `values` objects for **checked rows
only**. Unchecked rows never leave the browser.

The upload handler: if `rows` is a non-empty array, set
`csv = VAULT.exportCsv(rows)` and then `parseUpload(csv)` as today. If both
`csv` and `rows` are present, 400 — do not guess. CSV-only callers
(mapper, template, any existing client) are unchanged. `mapping` is ignored
when `rows` is set.

`exportCsv` already round-trips through `parseUpload` (tested). That is why
the confirm table does not grow a second validator. Filename on
`broker_uploads` is the PDF's name, sliced to 200 characters as today.

A checked row that still fails `normalizeRow` is skipped with a
line-numbered error on the same panel; the rest still import. Same
`failed()` rule as the mapper: a partial failure must not dismiss the
preview. If zero checked rows survive, 400 and the panel stays open, same
as a CSV that parsed nothing.

## 5. Copy

Picker button (first-run and deck): "Choose a spreadsheet or PDF."
Drop line: "or drop a .csv or .pdf here · download the template."
`accept`: `.csv,.pdf,text/csv,application/pdf`.

First-run privacy disclosure, one added paragraph after the existing
"never read into public records" paragraph:

> A PDF is sent to our extract vendor to read the table. CompNinja does
> not store the file. Rows land in your vault only after you confirm.

The four-required-columns paragraph stays; it is still true of a PDF row.

Empty-table copy under the comps section ("upload a spreadsheet") becomes
"upload a spreadsheet or PDF."

## 6. Errors the broker can actually use

| Case | What they see | What was stored |
|---|---|---|
| Not a PDF / over 4 MB | "That file is too large to read." / "That doesn't look like a PDF." | nothing |
| Zero deal rows | "We couldn't find a deals table in that PDF." | nothing |
| Vendor timeout / 5xx | "Could not read that PDF. Nothing was saved." | nothing |
| No `pdfExtract` capability / no key | 503, same class of copy as the vault's own DB-down refusal | nothing |
| 429 | "Too many uploads. Please wait a moment." | nothing |
| Confirm with all rows unchecked | Import disabled | nothing |
| Some checked rows fail `normalizeRow` | Import the rest; line-numbered skips on the panel | only the surviving rows |

Do not promise OCR. A scanned page that yields zero rows gets the same
"couldn't find a deals table" line as a brochure. The model may still read
a digital table that happens to be drawn; that is luck, not a claim.

## 7. Tests

Pure, in `broker-vault.js`:

- `exportCsv` of confirm-shaped objects round-trips through `parseUpload`
  (already true of stored comps; pin the confirm shape too — raw strings,
  optional blanks).
- A helper that classifies extract candidates (`ready` vs `error`) agrees
  with `normalizeRow` and never drops `values` on failure.
- Magic-byte / size guards are pure if they live in the module; otherwise
  they are route tests with a mocked body.

Provider:

- `capabilities.pdfExtract` is declared next to the existing flags.
- `buildExtractBody` has no `tools` key and no `google_search` /
  `web_search` string anywhere in the payload. This is the privacy test.
  A regression that reused `buildRequestBody` fails it.

Routes (`test/routes.test.js`):

- `POST /api/vault/extract` is in the vault-gated list with upload
  (401 / 403 / 503, same order).
- Extract does not insert into `broker_uploads` or `broker_comps` (assert
  on the mocked `sbRequest`, or that a 200 extract returns rows and a
  follow-up `GET /api/vault` is unchanged).

Page (`test/vault-page.test.js`, `test/vault-first-run.test.js`):

- Still exactly one `<input type=file>`.
- `accept` includes `.pdf` / `application/pdf`.
- A PDF file does not call `/api/vault/inspect` and does not open `#mapSec`.
- A CSV file still does.
- Import posts only checked rows, under the PDF's filename.
- The new privacy sentence is present in the first-run disclosure.

No binary PDF fixtures. The model call is mocked. A green suite does not
prove a real CoStar file extracts well; the confirm table is what makes
that miss safe.

## 8. Out of scope

- `.xlsx`
- Offering memos / flyers / one-property PDFs
- Storing the PDF, or a retry that resends it
- Import-time geocoding (still the ROADMAP item behind `/api/geocode` POST)
- Sending extract progress over SSE (a spinner on the drop zone is enough)
- A second file input
- Changing `MAX_ROWS_PER_UPLOAD` (5,000). A table PDF will not approach it;
  the 4 MB cap bites first.

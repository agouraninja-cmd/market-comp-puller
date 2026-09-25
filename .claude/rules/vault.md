---
paths:
  - "vault-page.js"
  - "vault-api.js"
  - "broker-vault.js"
  - "broker-properties.js"
  - "broker-leads.js"
  - "building-facts.js"
  - "gut-check.js"
  - "bov-log.js"
  - "blend-comps.js"
  - "xlsx.js"
  - "test/vault-*.test.js"
  - "test/broker-vault.test.js"
  - "test/broker-properties.test.js"
  - "test/broker-leads.test.js"
  - "test/building-facts.test.js"
  - "test/gut-check.test.js"
  - "test/bov-log.test.js"
  - "test/blend-comps.test.js"
  - "test/xlsx.test.js"
---
# The broker vault and lead inbox

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `LEAD_METRO` — optional `on`/`off`, **default ON**. Matches broker lead
  coverage across `market.js`'s curated `METRO_GROUPS`, so a Boise-covering
  broker sees Meridian leads. Reads the same table as `CORPUS_METRO` and is
  switched separately on purpose — one decides which comps a search may draw
  on, the other decides who sees a stranger's enquiry, and rolling back one is
  no reason to roll back the other. `off` restores exact-market matching in
  the inbox, the intro gate and the new-lead alert together. Rules live in
  `broker-leads.js`, so `npm test` covers them.

## Architecture

- `POST /api/comp-submission` — stores a broker-submitted comp (broker contact +
  comp details, `status: "pending"`) in the Supabase `comp_submissions` table
  (file fallback: `comp-submissions.jsonl`). Review is manual: setting a row's
  `status` to `approved` in Supabase puts it in the verified comp layer — each
  search fetches approved comps of the matching property type and offers them
  to the model as trusted candidates; comps the model includes from that list
  carry `"verified": true` and the front-end shows a green Verified badge in
  the Address column. **Broker loop**: the server matches each returned verified
  comp back to its submission (by normalized address) and attaches
  `verified_by` (firm or broker name), which renders as "Verified · via
  <firm>" — visible credit for the contributor. And a BOV lead's owner email
  lists any brokers who've contributed approved comps in that same market
  (`findBrokersForMarket`), so the owner can connect them. Routing is
  owner-mediated: broker contact info goes only to the owner, never the
  reverse — owner PII is never auto-forwarded to a broker (also, Resend's free
  tier only delivers to the owner address anyway). Rate-limited per IP.
- **The vault is part of Pro. There is ONE subscription** (decided and shipped
  2026-08-05; the vault itself is live). Ecosystem Plan v1 — design spec and
  the vault contract in
  `docs/superpowers/specs/2026-08-05-broker-tier-design.md`, which predates the
  decision and still describes two products; read it for the vault's design,
  not for how it is sold. The tier briefly existed as a second plan,
  `broker_monthly`, modelled as a superset of Pro. It was **removed rather than
  left unset**: it is gone from `/api/checkout`'s `PLANS` map,
  `STRIPE_PRICE_BROKER_MONTHLY` is deleted, and `entitlements.js` now reads
  `const broker = pro`. Nobody lost access, because that plan was never
  sellable — its Stripe price was never set, so checkout always 503'd for it
  and no subscription row in the wild can carry it. Four things to know:
  - **Vault routes test `ent.canUseVault`, never a plan name.** The result
    carries `broker` (identity, mirrors `pro`) and `canUseVault` (capability,
    mirrors `canBrand`); `/api/config` exposes both. The usual rule applies
    with more force than usual here — this gate guards private data.
  - **An unrecognized plan name now DOES open a vault**, matching `pro`, where
    status governs access and an unfamiliar plan on a paid row is treated
    generously. This reversed on 2026-08-05 and the test that pinned the old
    rule now pins the opposite. Failing closed on the name was right when an
    unnameable plan might have been a second product; with one product it would
    withhold half of what a paying customer bought.
  - **Access still lapses with the card.** `canUseVault` tracks `broker`, which
    tracks `pro`, so it goes false at the end of a cancelling period and at the
    end of the grace window. Nothing DELETES a lapsed vault — the only delete
    paths are the broker's own "remove this import" and account deletion — and
    the plan card says so, because a broker who uploaded their book and then
    finds the door shut will assume the worst otherwise.
  - **`PRO_ENABLED=off` grants no vault**, even though that branch grants every
    other capability. "Pre-Pro behavior" restores what visitors USED TO HAVE
    free; the vault was never free, it did not exist. The opposite would open
    an upload endpoint to every anonymous visitor on an un-launched deployment.
  **Selling it is copy, in three places, and they must agree**: the Pro tile's
  bullet list and the plan-card strings in `index.html`, and the vault page's
  own 403 in `vault-page.js`. All three say "Pro" and none of them may name a
  broker plan — a visitor sent looking for one finds a product that cannot be
  bought.
  The privacy wall is the product: no vault row may ever reach `harvestComps()`,
  `corpusRowsForMarket()`, a market snapshot, or another account's report.
  Enforce it with **separate tables read by separate functions**, not a
  `private` column filtered in the corpus queries — the corpus read path
  swallows its own errors, so one missed filter would leak silently.
- **Broker vault** (v1 server side 2026-08-05; the `/vault` page followed on
  2026-08-06 — see "The `/vault` PAGE lives in `vault-page.js`" below). `GET|POST|DELETE
  /api/vault*` — the broker's private comp store. DDL in
  `migrations/013-broker-vault.sql` (**run before deploying**); plan in
  `docs/superpowers/plans/2026-08-05-broker-vault-v1.md`. Routes:
  `GET /api/vault/template` (the CSV a broker fills in), `POST
  /api/vault/upload` (JSON `{filename, csv}` — deliberately not multipart,
  which would be hundreds of lines of hand-rolled parsing in a repo with no
  dependencies; also accepts `{filename, rows}` from the PDF confirm table,
  converted through `exportCsv` then `parseUpload` — the CSV path is
  unchanged), `POST /api/vault/extract` (JSON `{filename, file}` — base64 —
  sends the file to the extract vendor with no search tools, writes nothing,
  and returns `{ rows: [{ values, error }] }` for the confirm table),
  `GET /api/vault` (filters by `market` and `type`), and
  `DELETE /api/vault/upload?id=` (undo one import; comps cascade).
  All of these routes go through one `openVault()` helper: 401 not signed in →
  403 not a broker (`canUseVault`) → 503 no database.
  - **`/api/vault/extract` takes screenshots too** (2026-08-13). The file a
    broker actually has is often a screenshot of a CoStar table or a photo of
    a printed comp sheet rather than an exported PDF, and both providers read
    an image on the same call the PDF uses, so it is the same route, the same
    prompt, the same confirm table and the same "nothing is stored" promise.
    Four rules:
    - **The BYTES decide the media type, never the filename and never the
      browser's `type`.** `sniffExtractMedia` reads magic bytes and
      `checkExtractFile` (type + size, one place so the refusal copy cannot
      drift) is what the route calls; a `mediaType` taken off the request body
      would defeat the check that exists to stop a renamed `.xlsx` reaching a
      third-party vendor. A test pins that the route never reads one.
    - **`EXTRACT_MEDIA_TYPES` is the INTERSECTION of the two providers**
      (pdf/png/jpeg/webp), not the union: Anthropic reads GIF and Gemini does
      not, Gemini reads HEIC and Anthropic does not, and a file that imports
      on one deployment and refuses on another is a bug nobody can reproduce.
      Adding a type means checking both vendors.
    - **HEIC is recognized in order to be refused BY NAME.** An iPhone photo
      is the likeliest unsupported file to arrive here, and a generic "that
      file isn't something we can read" would send a broker looking for a
      fault in their comp sheet instead of exporting a JPEG.
    - **Only the Anthropic provider branches.** A PDF is a `document` block
      and an image is an `image` block there; Gemini's `inline_data` carries
      whichever `mime_type` it is handed. `buildExtractBody` takes
      `{ fileBase64, mediaType }` on both.
    The body field is `file` (`pdf` is still accepted, so a browser holding a
    cached copy of the old page still works). One ceiling covers both kinds,
    `MAX_EXTRACT_BYTES` = 4 MiB, sized against the handler's 8 MB body cap
    because base64 costs a third more than the bytes it carries. The
    `vault_extract` analytics event names the kind (`ok:image:5`), which is
    the only place "do brokers bring PDFs or screenshots?" can be counted.
  - **The confirm table carries a per-sheet rent basis** (2026-08-29). Lease
    sheets state a rate and never the word "annual"/"monthly" — within a
    market it goes without saying — which made them close to unimportable
    (4 refused rows in the 2026-08-28 extraction verdict). The basis stays
    required per ROW (migration 029: a guess is 12x wrong); the sheet-level
    answer is the broker's, chosen once on `#pdfBasisRow` (rendered only
    when a row has a rent and no basis — the Buy-button rule, and no
    default) and STAMPED visibly into exactly those rows' cells, curing the
    rows whose only blocker it was. A stated or hand-typed cell always wins
    (`stampedBasis` tracks the selector's own writes). The needle it cures
    by (`RENT_BASIS_NEEDLE` in vault-page.js) is a ⚠ mirror of
    broker-vault.js's refusal, pinned by test; the server re-validates every
    imported row regardless. The value travels IN the rows — zero server
    change. Three extract-prompt rules shipped with it, all pinned in
    test/routes.test.js: the `undated` sentinel scoped to
    document-has-no-date-column; rent_basis never inferred from market
    convention; and addresses street-verbatim with "City, ST" completion
    only when the document itself proves the state — the 2026-08-28
    verdict's dedupe-key instability, made deterministic.
  - **A bare address is offered its city, never handed one** (2026-09-02).
    A firm's own sheet writes "123 Main St" because everyone there knows
    which city, and both import doors refused every such row — the CSV by
    line number, the confirm table only AFTER Import, since
    `classifyExtractRows` never asked. Now `POST /api/vault/inspect` and
    `/api/vault/extract` answer `marketSuggest` (`count`, a `sample` of the
    bare rows, and `candidates` ranked **this file → the broker's vault →
    their coverage**, the order in which each is likely to be what the sheet
    left unsaid), and each door asks ONCE: the mapper's `#mapMarket` row
    (`CONST_ASK`'s shape) and the confirm table's `#pdfMarketRow`
    (`#pdfBasisRow`'s shape). Rules, all test-pinned
    (`test/vault-market-complete.test.js`, `-run.test.js`, the page suite):
    - **Nothing is applied until a person picks.** The blank option is
      today's behaviour (those rows are left out and named). The pure
      `suggestMarketCompletion` writes no address; `marketOf` is INJECTED
      beside `hasMarket`, and a market string that is not itself canonical
      is never offered back (a vault row misfiled before `hasMarket` existed
      must not become a completion).
    - **The CSV door completes on the SERVER**: `completeWith: "City, ST"`
      on `/api/vault/upload`, canonicalized by the route (`canonicalMarket`
      — "boise, id" files as "Boise, ID"; a non-market is 400 before any row
      is read), then composed inside `parseUpload` right where
      `composeAddress` runs — only onto an address that still fails
      `hasMarket` AFTER the mapped City/State columns had their say, so a
      row naming its own city keeps it — and the result still passes the
      ordinary `hasMarket` gate, so "Boise, Idaho" is refused with the
      ordinary message naming the string it produced. `completed` /
      `completedAs` ride the response and the result line says "N addresses
      completed as Boise, ID". The rows door never takes it: confirm-table
      rows carry their completed addresses in the cells, stamped visibly by
      the selector (`joinMarket`, a ⚠ mirror of `composeAddress`'s
      append-only rule, pinned on three shapes), a hand-typed address always
      winning and the blank option putting a stamped row back.
    - **`MARKET_NEEDLE` is a ⚠ mirror of `MARKET_REFUSAL`**, exported so the
      page test pins it — `RENT_BASIS_NEEDLE`'s reason.
    - **`POST /api/vault/confirm-market` is a badge, never a gate.** After a
      pick, and only then, ≤10 completed streets go to `geocodeCensus` — our
      own in-process call, never Nominatim, never the browser (migration
      017's wall) — and the row says "k of n found in Boise, ID". A miss on
      a rural or new address is ordinary, so "0 of n found" is information,
      not a refusal. Writes nothing, logs no address, through `openVault`.
    - **The mapper opens for a clean template that holds bare addresses**
      (every column already mapped, one question) — the deliberate bend of
      "the screen is shown only when a header is not ours": that rule's
      reason was that there was nothing to ask, and now there is. The
      mapper re-asks inspect only when the address trio of the mapping
      changes (`trioSig`), since a City column mapped onto `address_city`
      is what makes a bare street whole and the question then disappears.
    - **The extract prompt is untouched.** It still never guesses a city
      the document does not name; the completion is the broker's act.
    Not built: bulk valuation and the firm-buildings form still refuse a
    bare address with their own messages (owner's scope, 2026-09-02).
  - **Per-comp editing, adding and export** (2026-08-10). `PATCH|DELETE
    /api/vault/comp?id=` fixes or removes one stored comp; `POST
    /api/vault/comp` adds one by hand (a broker who closed a deal on Tuesday
    should not have to author a CSV); `GET /api/vault/export.csv` downloads
    the whole book. **Every cell on `/vault` is typed into directly**
    (2026-08-16): one field per cell, saved on leaving it, so Tab/Enter work
    like a spreadsheet and Esc restores the stored value. There is no Edit
    button — the compact table's own cells are the editor, and the inline
    edit form it used to open is gone. Three rules the compact table adds
    over the spreadsheet, all in `vault-page.js`. **`CELL_FIELDS` excludes
    the two derived columns**: `market` is parsed from the address by
    `marketOf()` server-side and `price_per_sqft` is computed by
    `normalizeRow` for priced sales only, so offering either as an input
    would let a broker type a figure the very next save silently overwrites;
    they render as `td.ro` cells and are **refreshed from the row the PATCH
    returns**, because a price edit that left the old $/SF sitting beside it
    is a wrong number in a priced column. **A cell shows the formatted figure
    and swaps to the raw one on focus** (`data-raw` + `cellDisplay`), since a
    book of business is read far more often than edited and every price
    becoming `1250000` is not an acceptable cost of making it editable; the
    value put back after a save is the SERVER's normalized one, never the
    string that was typed. And **a save that lands after the table was
    rebuilt** (a sort, a filter, a delete's reload) re-renders instead of
    writing into the detached input, or the row would show the pre-save value
    with a refreshed $/SF next to it. Spreadsheet mode (`Open spreadsheet`,
    or Open on that import) stays as the other door: it is the only place
    `cap_rate`/`tenancy`/`year_built`/`notes` and the per-type extras have
    columns, and its cells deliberately show STORED values with no
    formatting, because it is the view a broker opens to check what an import
    actually landed. **`EDITABLE_FIELDS` in `broker-vault.js` is an
    allowlist**, not a second validator — `validateEdit(existing, patch)`
    merges the patch over the stored row and reruns it through
    `normalizeRow`, the same function every imported row goes through, so a
    hand-typed "1.2M" or an Excel serial date fails an edit exactly as it
    fails an upload.
    **Editing or deleting a PUBLISHED comp retracts it** (`retractPublishedComp`)
    — deletes the `comp_submissions` row and clears `published`/
    `published_at`/`published_submission_id` — and **the retraction happens
    only AFTER validation succeeds**, never before. It shipped the other way
    round first: retracting ahead of `JSON.parse`/`validateEdit`/the
    collision check meant a broker's REJECTED edit (typing "1.2M", the exact
    input the vault exists to refuse) still pulled the comp from the public
    records and stripped its firm credit before the 400 was ever returned —
    the broker saw only a parse error and had no way to know what had
    happened, and if the submission had already been approved, republishing
    creates a fresh PENDING row needing manual owner re-approval, so the
    credit does not come back on its own. DELETE has no validation step that
    can fail, so it stays retract-first.
    **An address edit nulls `property_id`** before the write, specifically
    when `row.address_key !== comp.address_key`, never on an untouched
    address. `linkVaultProperties`' relink PATCH only ever fills a NULL
    `property_id` (`property_id=is.null`, so a re-import can't rewrite a
    link that already looks correct) — left non-null after an address
    change, a comp would keep pointing at the OLD building forever and
    `attachPropertyCoords` would stitch the old building's coordinates onto
    the corrected address in every future report.
    **The export must be complete or refuse.** It does NOT build on
    `vaultReadPayload`, which hard-caps at 1000 rows; it pages until an
    EMPTY page comes back, advancing the offset by the rows actually
    returned rather than by the page size, because PostgREST can honor a
    project-level Max Rows setting by returning fewer rows than requested
    with no error — treating a short page as "done" would silently truncate
    at whatever that cap is. It orders by `deal_date.desc,id.asc`
    specifically because `deal_date` alone is day-granularity and ties
    across many rows in an imported book; Postgres only guarantees stable
    OFFSET/LIMIT paging when the ORDER BY produces a unique row order, so a
    non-unique sort key can drop (or duplicate) a comp on a page boundary.
    It also JOINS `broker_properties` for `lat`/`lng` — those are not
    columns on `broker_comps` — and separately carries every populated
    per-type column (`clear_height`, `units`, `lot_acres`, etc.), which ARE
    columns on `broker_comps` and ride along for free because the paging
    query passes no `select=`; `VAULT.exportColumns` then appends only the
    ones actually populated. Omit either source and a re-import silently
    drops that comp's specs or sends a private address back out to a
    third-party geocoder, which migration 017 and `parseCoord` exist to
    prevent.
    No migration was needed for any of this: `broker_comps.upload_id` was
    already nullable (a hand-added comp belongs to no import, so it can only
    ever be removed per-comp, never by deleting an import), and every new
    field these routes touch already had a column.
  - **Blended comps** (server half, 2026-08-06). A broker's own vault comps
    appear inside **their own** reports, flagged `private: true` with
    `source_type: "broker_vault"`, plus a top-level `private_count`. Rules in
    the pure, tested **`blend-comps.js`**; the `user_id`-scoped read is
    `vaultCompsForReport()` in server.js. Spec:
    `docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md`.
    **Blending happens at SERIALIZATION only** — the exact mirror of
    `gateReport()`'s rule. It runs inside the `gate()` closure in `/api/comps`,
    which is the single funnel all four exits route through, and therefore
    downstream of `storeCachedSearch()`, `harvestComps()` and
    `maybePublishMarketSnapshot()`, all of which keep seeing the **public**
    report. Blend earlier and it fails silently twice over: before the cache
    write, one broker's private book is served to the next visitor who searches
    that address (`search_cache` is keyed by property, not by user); before the
    harvest, the rows enter the public corpus permanently with nothing alerting
    anyone, because that path swallows its own errors. **`POST /api/share`
    strips them** — it takes the report FROM the browser, and a broker's
    browser holds a blended one. A vault comp claims no public provenance: not
    `verified` (a public claim, earned by vouching in the public records) and
    not the enum default (which normalizes to `estimate` and would stamp a real
    closed transaction as guesswork). An empty vault returns the **same report
    object**, with no `private_count` key at all, so a non-broker's response is
    byte-identical to before the feature existed.
  - **The `/vault` PAGE lives in `vault-page.js`, not `server.js`** (moved
    2026-08-06). It is a web page, so it belongs to whoever owns the front end;
    as a 475-line block inside `server.js` it could not be edited without
    editing the server file, which made front-end and server work collide by
    accident. **Since 2026-08-30 it renders a BODY, not a document**
    (`renderVaultBody(boot)` — Task 9 of the rail plan): the doctype, head,
    header and footer are `marketShell`'s, exactly as for `/markets`,
    `/brokers-firms`, `/pricing` and `/bulk`. Its old twelve-key chrome
    object (`CN_LOGO`, `RAIL_CSS`, `ACCOUNT_NAV_*`, `FOOTER_*`, `THEME_*`,
    `NAV_SHELL_CLASS`) is gone — every key existed only to rebuild by hand
    what the shell already had, and rebuilding it is what made this the page
    that drifted. **The DATA is still resolved in `server.js` by
    `vaultReadPayload`, which owns the entitlement gate**; `vault-page.js`
    only decides how that data is drawn. Keep it that way — a read that
    happened there would be a read outside the gate.
    Two rules the fold leaves behind, both easy to undo by accident:
    - **The page's stylesheet is emitted in the BODY, after `MARKET_CSS`.**
      That is `bulk-page.js`'s pattern and it is load-bearing, not tidiness:
      this page redefines `body`, `a`, `.wrap`, `main.wrap`, `.card`,
      `.kicker`, `.ledger` and `.lcell`, so its rules must come later in
      document order to win on equal specificity. `marketShell`'s `head`
      parameter is emitted BEFORE `MARKET_CSS` and would lose.
    - **A shared selector leaks every property the vault does not set.** Both
      stylesheets use `.card`, `.ledger`, `.lcell`, `.btn`, `table`, `th` and
      `td` for entirely different components. Six declarations leaked on the
      first pass (margins on `.ledger`/`.card`, a right border and flex basis
      on `.lcell`, tabular figures and a 180px first column on the comps
      table) — found by rendering a populated vault before and after and
      diffing computed styles, not by reading. `test/vault-shell.test.js`
      COMPUTES that set from the two stylesheets and fails the build on a new
      one; the fix is to state the property on the vault's own rule.
    `INTER_FONT_HEAD` rides through `marketShell`'s `head` for this page
    alone: `MARKET_CSS` names Inter in `body{}` and no server-rendered page
    fetches it, so without that link the fold would silently have restyled
    the page brokers use daily.
  - **The deal desk (2026-09-25; the owner's pick of the redesign drafts at
    https://claude.ai/artifact/Mw9KrzNpaLygnJ3azF1cYK: Draft C with Draft B's
    map and comp set).** The page now reads This week → Your pipeline → Your
    book (the privacy ledger under its rule) → properties, watchlist,
    contributions. Everything added is DRAWING over reads the page already
    made, and every control that changes something is an existing one — hold
    both. Six rules, all in `test/vault-page.test.js`'s last block:
    - **This week (`#weekSec`, in `VAULT_DECKS`) has no route.** Owner
      requests come from `/api/broker/leads`, delivered BOVs from
      `/api/broker/bovs`, and leases ending within a year from the book
      (`leaseKey`: the option notice date when it is still ahead of the
      expiry, else the expiry). A read that failed shows a dash and its
      error, never a zero — the pipeline's own rule.
    - **The board and the list are one section's two views** (`#pipeSec`
      carries `vd-list`; `renderPipeline` draws both from the same rows).
      Every card control is the table's own — `data-intro`, the stage select
      built by `bovSelect`, `data-bovdel` — caught by the same
      document-level handlers, so the two views cannot act differently.
    - **The book's Map and Table draw the same `view()`**: `render()` calls
      `renderBookMap(rows)` beside the table, so the filter row scopes both
      identically. The view class lives on `#bookViews`, because
      `applyFirstRun` writes `#compsSec`'s whole className. The spreadsheet
      belongs to Table: `render()` moves there whenever `sheetMode` is on.
    - **The map never geocodes.** Pins come only from `lat`/`lng` the book
      already holds (`hasLoc`); a comp without them stays in the list and
      `#bmNoLoc` says how many. Leaflet and CNBASE arrive through
      marketShell's `head` from `LEAFLET_HEAD` and `BASEMAP_JS` in the /vault
      route, never a copy in this file (`test/vault-shell.test.js`).
    - **The comp set is memory only** and summarises by the book's rules:
      sales and leases apart, no single figure across property types
      (`setSummary` over `psfStats`/`rentStats`). Its Publish and Share are
      `publishList` and `shareListWithFirm` — the filter row's buttons call
      the same two functions, so there is still one confirm per route.
    - **The comp sheet and the set's CSV are files for the broker**, the
      whole-book CSV's class of exit. The sheet (printed through
      `body.vd-printing`, which only matters in print media) carries the
      saved report branding (own, else the firm's), the "not an appraisal"
      line and "Prepared with CompNinja", and **never the notes** — a note is
      written for the broker, and the sheet is what they hand a client. The
      CSV guards formula cells like the server's export.
    Not built from Draft C: the properties and watchlist side by side (the
    properties table needs its full width), and saving a comp set onto a BOV
    (that would be a migration).
  - **TWO DECKS, not ten peer sections** (Vault Direction U, approved and
    shipped 2026-08-10; card `vault/direction-u-two-decks.html`). The page is
    two products sharing one scroll, so it carries exactly two deck rules —
    serif label, ink rule, the deck's one action — and they are the level
    ABOVE `h2`. **Your book** holds the uploader, the market rollup and the
    comps; **Your pipeline** holds one table from a new lead through won or
    lost (leads and BOVs used to be two sections; they merged 2026-08-13).
    Five rules:
    - **`#addSec` is a panel, not a section, and ships CLOSED.** "Add comps"
      was a section above the comps table, so a broker with 200 comps opened
      their book and was handed an uploader. It is the book deck's action now.
      `setAddOpen()` is the single writer of its visibility (the label and
      `aria-expanded` ride with it); `applyFirstRun` only re-asserts the flag
      and deliberately does **not** force it shut, because `#res` lives inside
      the panel and an import that failed before it could raise the comp count
      would otherwise write its error into something invisible. `doImport`
      opens it for exactly that reason on the non-mapper path.
    - **Dragging a file anywhere over the page opens it.** `#drop` is inside
      that closed panel, so without the document-level `dragenter`/`dragover`
      handler drag-and-drop would silently stop existing. It is guarded on the
      book deck being visible (a 403 hides `#app`), not on a first-run page —
      the empty vault IS the two decks (2026-08-13).
    - **`.deck.hide` and `.strip.hide` are load-bearing.** Both classes set
      `display`, and both are declared BELOW `.hide` in the same stylesheet, so
      a plain `deck hide` loses the cascade and leaves a stray "Your book"
      rule. Found in a browser, not by reading. Same trap as
      `ACCOUNT_NAV_CSS`'s `[hidden]` line. Decks now ship visible; the line
      still matters if a future gate adds `hide`.
    - **The empty vault is the real vault** (2026-08-13). Both decks and the
      trust line (including zeros) always show. `#bookEmpty` / `#pipeEmpty`
      are invitations, not a numbered `#firstRun` page. Spec:
      `docs/superpowers/specs/2026-08-13-vault-empty-workspace-design.md`.
    - **One hidden-sibling CSS patch, `#rollupSec.hide + #compsSec`.** It
      replaced two others (`#firstRun.hide + #addSec`, `#addSec.hide +
      #mapSec`), which stopped being needed once those two became divs. Keep
      such rules scoped to the specific pair — a blanket hidden-sibling rule
      also strips dividers that are correct.
  - **The vault DASHBOARD** (2026-08-06, re-ranked 2026-08-10). `/vault` leads
    with a market rollup —
    one card per `market` + `property_type`, the same pair the lead coverage
    below it is keyed on — then a median-$/SF-by-year chart and a
    repeat-property list, all three scoped by one filter row. **Since Direction
    U those three are collapsed `<details class="dbox">` under a three-cell
    reading strip** (`renderStrip`), not three bordered panels in front of the
    table: measured on a seeded book the comps table moved from 4363px down
    the document to 1101px. Two rules for the strip. Its median comes from the
    same `psfList`/`median` pair that seals the table's own footer, so the two
    can never quote different figures. And a cell is a `<button>` **only** when
    the panel behind it is actually showing — an affordance over a hidden panel
    is a control that does nothing. `renderGutCheck` and `renderRepeats` feed it
    through the module-level `lastGut`/`lastReps` rather than a changed return
    type, because the return value is the outlier map the table reads. Four
    further rules:
    - **What publishing gave back** (2026-08-17). `comp_submissions.cited_count`
      has existed since migration 003 and `bumpCitedCounts` has incremented it
      on every earned badge ever since — and it was rendered in exactly one
      place, the "Report citations" tile on the PUBLIC `/broker/<slug>`, which
      exists at all only once a broker opts `broker_profiles.public` to true
      (false by default, per broker-directory.js's two-consents rule). So the
      one person who could not see the credit was the broker who earned it, and
      a vault-first broker published comps and got no signal back whatsoever.
      This surfaces the existing number: per comp beside the Published chip,
      and summed under the ledger's Published cell. **Nothing new is counted
      and no hot path changed** — `attachCitedCounts` is a read, chunked at 200
      ids because the in.() list would otherwise outgrow a URL, and it **never
      throws**, because a citation count is a reward and a vault that would not
      open without one would be a strictly worse trade. Two honesty rules: the
      count is **omitted at zero** rather than shown as "0" beside every
      freshly published comp, and the tooltip says it is counted **when a
      report is generated**, since a cache hit serves the stored report without
      re-running `attachVerifiedAttribution` and therefore does not bump it —
      the figure is a floor, not an impression count. `cited_count` reaches the
      browser through `vault-api.js`'s **`SUBMISSION_FIELDS`**, a third checked
      list beside `PROPERTY_FIELDS` for the same reason that one exists: it is
      not a `broker_comps` column, so putting it in `API_COMP_FIELDS` would
      correctly fail the both-ways schema test.
    - **Bulk publish** (`POST /api/vault/publish-many`, 2026-08-17). Publishing
      is how the public corpus grows and it was one button plus one identical
      confirm per comp, so in practice nobody published a book — they published
      a comp. The button counts the UNPUBLISHED comps in the current view and
      deliberately does not decide eligibility: `VAULT.canPublish` is the rule,
      a browser copy would be a second one, and the route reports what it
      skipped and why (naming the first reason, since they repeat). Its own
      route rather than an `ids` array on the single one — that contract's
      404/400 are right for one comp and wrong for fifty, where "some of these
      are not ready" is the normal answer. Same `openVault` gate, same
      `user_id` scoping, same credit-name refusal, asked ONCE before anything
      is written. Insert and PATCH stay **paired inside one task** at
      concurrency 6, never one bulk insert with ids read back positionally:
      repeat properties are real here, so returned rows could not be re-paired
      by address even in principle. A PATCH that fails after its insert
      **deletes the submission back out**, or the comp sits in the public
      records crediting a row the vault still calls unpublished and a re-run
      credits it twice. Capped at `VAULT_PUBLISH_BATCH` (100) per request,
      reporting `remaining` rather than refusing, which is safe because
      publishing is idempotent.
    - **Undo a delete** (2026-08-17). A hard delete behind one confirm sat
      oddly against a codebase that refuses a file fallback rather than risk
      losing a broker's book. The message now carries an Undo that re-posts the
      comp through **`POST /api/vault/comp`**, the ordinary add route, so a
      restore goes through `normalizeRow` like every other written comp and
      cannot put back something the vault would refuse to be told today.
      Three rules: it is held **in memory only** — this catches the misclick
      noticed immediately, not a deletion regretted tomorrow, and a store that
      emptied on reload would promise more than it keeps; the restore is a
      **new entry** belonging to no import, said plainly rather than left to be
      discovered; and a comp that was published **is not republished** by
      putting it back, because publishing is a deliberate public act and
      undoing a delete is not consent to repeat it. The confirm no longer says
      "this cannot be undone", since that stopped being true.
    - **Four filters, and only one of them is a search.** Market and Type
      narrow to a slice; Deal (Sale/Lease) exists because the two are priced
      in different units and a view holding both can state no median; and the
      Find box searches address, notes, market, type and tenancy, ANDing its
      terms so two words mean both rather than the phrase. All four compose,
      all four are cleared together, and **opening one import clears every one
      of them** — a search left over from the previous view would hide the
      comps that import just landed. **An empty result names which of the two
      empty states it is**: "No comps match this filter" with a Clear link
      when the book is non-empty, and the upload invitation only when it is
      genuinely empty. Telling a broker who searched for a deal they own that
      there is "nothing here yet" reads as the vault having lost their book —
      the same misreport-an-outage-as-absence trap the hub list and the lead
      inbox each had to fix.
    - **The page fetches `?limit=1000` and filters in the BROWSER.** It used to
      re-query with `market=`/`type=` params, which cannot work now: the rollup
      counts the whole book, and server-side filtering leaves the browser
      holding only the current slice. It also fixes a real bug — the route
      defaults to `limit=200`, so a broker with 400 comps was shown half their
      vault with nothing saying so. Past 1,000 the page says it is truncated
      rather than under-reporting silently.
    - **Every rate figure comes from a stored column, never derived here.**
      `broker-vault.js` writes `price_per_sqft` for **sales only** and leaves
      it null on a lease, because an annual rent ÷ size is $/SF/yr and would
      corrupt any median it entered; it writes `rent_psf_yr` for **leases
      only**, from the broker's `rent_psf` × their stated `rent_basis`. The
      page reads both and never recomputes either. A bucket with neither shows
      its comp count instead of a fabricated number.
    - **Lease rent (migration 029, 2026-08-17).** Until then the vault only
      really worked for investment sales: the template said to leave `price`
      blank on a lease and put the rent in `notes` as prose, so a leasing book
      carried no figure any median could read and every card said "no priced
      sales yet". Four rules.
      **`rent_basis` is required with a rent and has no default** — California
      industrial and retail quote rent MONTHLY while most of the country
      quotes annually, so $1.35/SF is an ordinary monthly rent and an
      impossible annual one; defaulting either way stores a figure 12× wrong
      in a broker's own records, which is the class of error this module
      refuses "1.2M" to avoid. **`lease_type` (NNN/FS/MG) is optional and
      disclosed**, the deliberate asymmetry: mixing bases makes a median
      WRONG, mixing structures makes it WEAKER, and those get different
      answers — the footer says "mixed lease types" rather than refusing.
      **Sales and leases are never averaged together**: a view holding both
      states no median and names the Deal filter, which is why that filter
      had to ship first, and the rate column heading changes with the unit
      rather than labelling annual rents "$/SF". **The gut check abstains on
      leases** — corpus quartiles and market-page figures are sale $/SF and
      there is no public rent benchmark — which holds by construction because
      leases carry no `price_per_sqft`; a rent fallback in `psfOf` would break
      it, and a test pins that.
      Rent is deliberately **not carried into the public corpus**:
      `comp_corpus` has no rent column and `submissionRowFrom` is an explicit
      allowlist, so a published lease carries what it always did. Giving the
      corpus a rent column is its own decision with its own provenance
      questions, not a side effect of this one.
    - **Repeat properties group on `market` + address, never address alone.**
      Street names repeat across a metro; on the first test book that merged a
      Boise building and a Meridian building at the same house number into one
      property with three deals.
    - **It reads none of `vault-api.js`'s `INTERNAL_FIELDS`** (`user_id`,
      `address_key`, `dedupe_key`) — it keeps its own copy of `addressKey`
      instead — so those can be dropped from the response whenever Owen wants.
      `test/vault-page.test.js` pins that, and pins the thing this file is
      uniquely able to break: the whole page, including ~550 lines of browser
      JS, is one template literal, so a stray `${` or a single-backslash escape
      emits broken JavaScript and a blank workspace rather than failing loudly.
      That test compiles what the page actually emits.
  - **Your contributions is the fourth free deck** (2026-09-04). Under Your
    watchlist, `#deckContribs` lists the comps this member submitted through
    the public Submit-a-comp modal (`GET /api/broker/me`: status, citations)
    and carries the public-broker-profile switch, broker-directory.js's
    second consent. It is deliberately NOT in `VAULT_DECKS`: "has
    contributed" is a weaker fact than `canUseVault` and the modal is the
    free broker's funnel, so it renders on the 403 and 503 exits like the
    properties and watchlist decks. Hidden entirely when `isBroker` is
    false. It replaced the workspace's Broker deck, removed the same day.
  - **The EMPTY VAULT is the real vault** (2026-08-13; spec
    `docs/superpowers/specs/2026-08-13-vault-empty-workspace-design.md`).
    When a broker has no comps *and* no imports, `applyFirstRun()` still
    hides the comps table and the imports list, but both decks and the
    trust line (zeros included) stay up. `#bookEmpty` is the book's body
    (upload invitation + privacy disclosure + template / Choose buttons);
    `#pipeEmpty` is the pipeline's (watch-market form, visible, not
    collapsed). `#firstRun` as a numbered two-card page is gone. Four
    rules:
    - **It keys on comps AND uploads, never comps alone.** A broker whose
      import was entirely rejected, or who deleted every comp out of one, has
      been through the door already; showing the book invitation again reads as
      their work having been thrown away. Pipeline empty is independent: a
      waiting lead must show even when the book is empty.
    - **The trust line shows zeros.** It exists to let a broker watch
      "0 published" stay at zero. Hidden until 2026-08-13 because it sat over
      numbered onboarding cards; with the workspace showing, the zeros are
      the honest empty state. Privacy copy still lives in `#bookEmpty`'s
      collapsed "Required columns & privacy details" disclosure, is restated
      on the trust line, and is made again at publish. Do not put the fine
      print back on the invitation face without asking.
    - **The one input takes MANY files (2026-09-02).** Choose or drop
      several: PDFs and screenshots are read one by one (each its own
      `/api/vault/extract` call, the route being rate-limited) and land in
      ONE confirm table with a `pdf-src` row naming each file above its
      rows — a row, never a column, because a cell rides into the upload as
      a field. Spreadsheets QUEUE through the ordinary path one at a time
      (the mapper is a screen a broker answers, and two cannot be open at
      once): the extract batch first, then each CSV, and the next starts
      only from `doImport`'s success with the previous rows STORED. A
      refusal or a cancel drops the rest of the queue BY NAME
      (`dropQueue`) rather than carrying on past a message the broker has
      not read. `#res` is one line everywhere else, so a batch keeps
      `batchLog` and every write during one starts with `batchPrefix()`
      — "Imported 12 comps" from a.csv survives "Reading b.csv". One file
      is the old path byte for byte (no source row, the plain name).
      `test/vault-page.test.js` runs all four shapes.
    - **Excel workbooks and pasted rows come in too (2026-09-02)**, and both
      become comma CSV TEXT before anything reads them, so `inspectCsv`, the
      mapper and `parseUpload` keep one input and the browser keeps posting
      one shape to `/api/vault/upload`. `POST /api/vault/inspect` takes
      `{ xlsx }` (base64, `MAX_EXTRACT_BYTES`' 4 MB cap, the same
      `xlsxGridFromBase64` helper the contacts import uses at 1 MB) and reads
      it with **`xlsx.js`'s typed mode**: a numeric cell is read THROUGH its
      style in `xl/styles.xml`, so a date-styled serial arrives as
      `YYYY-MM-DD` (both epochs, the Lotus 29-Feb-1900 gap, the time
      fraction dropped) and a percent-styled fraction as the percentage Excel
      shows — handed `0.0625`, `parsePercent` would store a cap rate 100x low
      and nothing would refuse it. A serial in a General cell stays a serial
      and is refused by name. The contacts caller stays untyped and
      byte-identical. A tab-separated body (cells copied from Excel, Outlook
      or a CoStar web table, the `#pasteSec` drawer) is detected on its first
      non-blank line and converted through `parseCsv({ delimiter })` +
      `gridToCsv` — never a tab-for-comma swap, since an address is one cell
      holding two commas. Three rules: the converted text rides BACK to the
      browser as `csv` (only when converted) and is what the upload carries,
      so the bytes the mapping was confirmed against are the bytes it is
      applied to; `gridToCsv` pads blank rows back in so "Line 5" still
      names Excel's row 5, and uses `quoteCsvCell`, never `csvCell`, because
      the formula guard would put an apostrophe into a broker's own note;
      and `.xls` is let through by the browser so the server can refuse it
      BY NAME. `test/vault-xlsx-run.test.js` runs the loop against the
      stand-in PostgREST.
    - **The confirm table triages (2026-09-02).** A row `normalizeRow`
      accepted renders as TEXT — the formatted figure, read against the page
      — with an Edit control (or a double-click) that opens just that row; a
      refused row stays inputs, tinted, followed by a `pdf-err` line naming
      its reason, and the cursor lands on the first one on open. The strip
      says "12 found · 12 ready · everything reads clean" and a second
      Import button (`#pdfGoTop`) sits above the table carrying the same
      state as the one below (`refreshPdfGo` writes both). "Review every
      cell" (`#pdfEditAll`) is the all-inputs table this used to be. The
      measured reason is the 4m51s in
      `docs/evals/extract-2026-08-28-verdict-final.md`. Document order
      (#217) is untouched; `r.editing` survives re-renders exactly as
      `checked` does; Edit is delegated on `#pdfBody` because the body is
      rebuilt on every re-render.
    - **There is exactly ONE `<input type=file>`.** Its `accept` includes
      `.pdf`, `.xlsx`/`.xls` and the image types as well as `.csv`. `#bookPick` and the
      ordinary "Add comps"
      button both call `$("file").click()`. Two inputs would mean two values
      and two change handlers, and an upload started from one would be
      invisible to the other's result message. Table PDFs and screenshots
      land in `#pdfSec`
      (the confirm table), not the CSV column mapper. A test pins this, and
      pins the accept list item by item — a missing image type greys the
      broker's own file out in the dialog with nothing on the page saying
      why. `isExtractFile()` in the browser is a courtesy check only (it
      reads the name and the browser's `type`, both caller-supplied); the
      server's byte sniff is the real one.
    - **The coverage form is ONE relocating node** (`#covForm`). Its home is
      `#pipeEmpty`; `renderPipeline` moves it into `#covBox` once a lead or
      BOV row exists, and walks it home when the pipeline is empty again.
      Never add a second copy — it would be a second thing to keep in step
      with the coverage rules in `broker-leads.js`.
    Empty tables are hidden throughout rather than shown with a header row and
    a "nothing here yet" line — three of those stacked up was the thing that
    made a new vault read as broken rather than new.
  - **That 503 is the opposite of the rest of the app, deliberately.**
    Everywhere else a Supabase failure falls back to a local file so nothing is
    lost. Here the file WOULD be the loss — Render erases its disk on every
    deploy, so a broker's uploaded book of business would silently vanish days
    later. The vault has **no file fallback**; it refuses instead.
  - **`market` is attached in server.js with `marketOf()`, never in
    `broker-vault.js`.** It has to agree byte for byte with `comp_corpus.market`
    so a comp published in step 2 needs no translation, and a second copy of
    that parse would be a second thing to keep in sync (the repo already has
    one such pair — `compWeight` — and it carries a ⚠).
  - **`dedupe_key` is an explicit column**, like `comp_corpus`'s, not a
    multi-column unique constraint. Postgres compares NULLs as DISTINCT, so
    `unique (user_id, address_key, deal_date, price)` would let an *unpriced*
    comp (explicitly allowed — brokers track undisclosed deals) re-import
    without limit on every upload.
  - **`broker-vault.js` rejects rather than guesses.** "1.2M", a bare number as
    a date (Excel's serial), and day-first dates are all refused with a line
    number rather than stored as a best effort — a wrong number in a broker's
    own records is worse than a rejected row, because nobody will notice it.
    Pure and tested (`npm test`, 64 cases).
  - **The one way past "deal_date is required" is the literal word `undated`**
    (2026-08-29; migration 042 dropped the column's NOT NULL — run before
    deploy, the 038 hazard shape). A blank stays refused (an accident); the
    word is a statement, for real documents that date none of their deals
    (the 2026-08-28 extraction verdict's capital-markets report lost all 9
    rows to the refusal). Stored as SQL null; excluded from every report
    blend and lookback by SQL semantics (`deal_date=gte.` is NULL-false);
    unpublishable; unshareable to a firm (`org_comps.deal_date` stays NOT
    NULL and `POST /api/vault/firm` refuses by name — and editing a shared
    comp to undated PULLS the firm copy rather than leaving it stale). The
    sentinel is contained by an opt-in flag on `parseDate` — only the
    deal_date call passes `{ undatedOk: true }`, so `lease_expiry`,
    `option_notice_date` and the hub's manual-comp date keep refusing the
    word. `validateEdit` presents a stored null back as `undated` (without
    that, an undated comp is permanently uneditable), the book export writes
    `undated` for the null so export → re-import round-trips (an option only
    that route passes — the confirm path must never turn a missing date into
    a statement), and the compact table's date cell shows AND holds the word.
    `test/vault-undated-run.test.js` proves the whole loop against a real
    server.
  - **Every read is scoped by `user_id`**, including the DELETE — without it,
    knowing another broker's upload id would be enough to delete their data.
  - **The property dimension** (`migrations/016-broker-comps-star.sql`, **run
    before deploying**). `broker_properties` holds one row per building per
    broker; `broker_comps.property_id` links to it. It exists because
    `address_key` was written on every row since 013 and read by **nothing** —
    no index, no table, no FK — and it is the one dimension a broker slices by.
    There is deliberately **no market dimension** (it would duplicate the
    corpus vocabulary and become a second thing to keep in sync) and **no date
    dimension** (`date_trunc()` answers everything without a fiscal calendar).
    Three rules: the migration is **purely additive** and a test fails the
    build if a destructive statement appears in it, because there is no staging
    database to rehearse against; `property_id` is **nullable on purpose**, so
    migrate-then-deploy and deploy-then-migrate both work with no window where
    an upload fails; and `linkVaultProperties()` **never throws** — the
    dimension is an index onto a broker's book, not part of it, so a failed
    link costs a join while a failed upload costs a broker their spreadsheet.
    Two brokers on the same building get **separate** property rows; sharing
    one would make each one's activity inferable from the other's.
    `broker_comps_reporting` is a view for the service role and direct SQL
    ONLY — it carries `user_id` and every private measure with no per-caller
    scoping, so it must never be exposed to the anon or authenticated roles.
  - **The vault API's shape is a contract, not the table's shape.**
    `vault-api.js` owns it and `toApiComp` is an **allowlist**, so a new
    storage column cannot reach the browser by default and a dropped one fails
    the build. `user_id`, `address_key`, `dedupe_key` and `property_id` are
    omitted as plumbing. Do not go back to answering `comps: rows`.
    `PROPERTY_FIELDS` is the second list: fields a comp inherits from its
    **building** rather than from `broker_comps` (`lat`/`lng`/`geo_source`).
    They are separate because the contract tests check `API_COMP_FIELDS`
    against the `broker_comps` schema **both ways**, and a `lat` in there would
    correctly fail — the fix was a second checked list against
    `broker_properties`, never loosening the first.
  - **Private-comp coordinates**
    (`migrations/017-broker-property-coordinates.sql`; spec
    `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md`, AGREED
    2026-08-06). A broker's private comp used to be geocoded **by address, from
    their own browser**, on every report — so an off-market address left in a
    URL to the US Census geocoder and, on a miss, to OpenStreetMap with the
    broker's IP. `lat`/`lng`/`geo_source`/`geocoded_at` now live on
    `broker_properties`, filled from optional `lat`,`lng` columns in the vault
    CSV. Five things to know:
    - **This is only the STORAGE half. It fixes nothing on its own.**
      `renderMap()` in index.html still geocodes every comp unconditionally
      with no check for coordinates it already carries, so until the display
      guards land these columns are stored and ignored. Stated in §2 of the
      spec; it is why the work was contracted in two halves.
    - **`parseCoord()`, NOT `parseNumber()`.** The spec said to reuse
      `parseNumber`, which **rejects negatives** — it would refuse every US
      longitude, including the spec's own Boise example. Refuses DMS and
      bearings too: reject rather than guess, because a wrong coordinate puts
      a building on the wrong continent and nobody will recognise it as wrong.
    - **Coordinates ride on `_lat`/`_lng`, which are NOT columns.**
      `broker_comps` has no coordinate columns and PostgREST 400s on an unknown
      one, which on the upload path refuses the broker's whole spreadsheet.
      `PROPS.stripCarriedKeys()` removes them before the comp insert.
    - **They are written by a separate, guarded PATCH, never the property
      upsert.** That upsert is `resolution=merge-duplicates`, which replaces
      the columns in its payload — coordinates travelling in it would mean a
      later upload that omitted them **wiped** the ones already stored. The
      PATCH filters `lat=is.null`, so a located building is never rewritten.
    - **`geo_source` is `'broker'` from the spreadsheet, `'census'` from the
      import-time geocode — and the broker always wins.** Step 2 shipped
      2026-08-29 (the §7 deferral was "buy it with evidence"; the roadmap
      moved it to Next once the CSV mapper made `lat`/`lng` mappable):
      `scheduleVaultGeocode` in server.js runs at the tail of
      `linkVaultProperties`, fire-and-forget on `scheduleCorpusLocate`'s
      contract, and geocodes up to 25 of an import's unlocated buildings
      through `geocodeCensus` — our own in-process Census call, never
      Nominatim, never the browser. It reads AND patches with `lat=is.null`,
      and it runs after the broker-coordinate PATCHes, so a building the
      broker located is never even read, let alone rewritten. A miss or an
      outage is a skip, never a guess (outages are not cached in `GEO_MEM`,
      so the next trigger retries). Pre-existing books backfill 8 per vault
      read, riding `attachPropertyCoords` the way the corpus backfill rides
      its own read. The pure filter is
      `PROPS.propertiesNeedingGeocode` (`broker-properties.js`);
      `test/vault-geocode-run.test.js` proves the wall end to end against
      the fake PostgREST and a census stub on `CENSUS_API_URL` (test-only
      env, `RESEND_API_URL`'s precedent — decides where a private address is
      posted, so trusted config, unset in production).
  - **The building remembers** (2026-09-03; migration
    `050-broker-property-facts.sql`, **run before deploying**; spec
    `docs/superpowers/specs/2026-09-03-vault-building-facts-design.md`).
    Every fact in the vault is stored on the deal, but year built, clear
    height, units, lot acres, zoning and class are facts about the
    BUILDING, so a broker with three deals on one building typed them three
    times and a priced sale missing its size counted for nothing in any
    median. `broker_properties.facts` (jsonb) is what the broker's own
    deals on one building AGREE on, derived by the pure, dual-exported
    **`building-facts.js`** (browser global `BFACTS`, `max-age: 0` like
    `gut-check.js`) and recomputed by `deriveBuildingFacts` at the tail of
    `linkVaultProperties` on every upload, add and edit. Five rules, all
    test-pinned (`test/building-facts.test.js`,
    `test/vault-building-facts-run.test.js`):
    - **Inheritance is READ-TIME ONLY.** `applyFacts` runs in exactly two
      places, `vaultCompsForReport` and `vaultReadPayload`, and writes
      nothing: `broker_comps` keeps what was stated on each deal, so the
      export, the public records and the firm copy stay stated-only, and one
      correction moves every sibling's view with no second write. The comp
      carries `inherited` (vault-api.js's `DERIVED_FIELDS`, a fourth checked
      list whose tripwire is that it is a column on NO table) so the page
      can say a cell is a reading. On `/vault` an inherited cell shows the
      value muted and italic and HOLDS nothing (raw `""`, a placeholder in
      spreadsheet mode), so a blur that typed nothing is not a save.
    - **Disagreement is a CONFLICT, never a winner.** Two deals saying 12
      and 14 dock doors serve no value and name both; `anchor_tenant` is
      the one recent-wins exception. Blank is not a vote.
    - **`size_sqft` derives from SALES only and inherits onto SALES only.**
      On a lease it is the suite. A size inherited onto a priced sale gets a
      `$/SF` from THAT deal's own price, never copied from another deal.
    - **Every `broker_comps` column is on exactly one side** of
      `BUILDING_FIELDS` / `DEAL_FIELDS`, and the unit test fails the build on
      a column placed on neither — the `add-comp-field` skill's step 1c.
    - **The privacy wall is untouched.** Derived from the broker's own rows,
      read back onto the broker's own rows, user-scoped on both the read and
      the PATCH; `attachPropertyCoords` stitches `facts` but does not apply
      them, because it also serves `shareVaultCompsToOrg`. The add form and
      the confirm table prefill a known building's empty cells
      (`prefillFromBuilding` / `prefillPdfRow`, "Known building · 2 deals in
      your book · year built filled in from them") against rows the page
      already holds — nothing leaves the page to ask which building an
      address is — and a prefilled value is STATED when saved. A DELETE does
      not recompute (a lingering fact is still true of the building); a
      pre-050 book derives on its first vault read.
  - **Gut check** (v4 slice 1, 2026-08-08; spec
    `docs/superpowers/specs/2026-08-08-gut-check-design.md`). A panel on
    `/vault` compares the broker's per-bucket median $/SF and cap rates
    against two separately-labeled public benchmarks: corpus quartiles
    (floor 4 priced sales, same usability rules as retrieval) and the
    market page's model figures. Rules live in the pure, dual-export
    **`gut-check.js`** (browser global `GUTCHECK`, served with `max-age: 0`
    exactly like `valuation.js` and for the same reason). `POST
    /api/vault/benchmarks` serves the benchmarks and **reads no vault
    rows** — the broker's numbers stay in their browser, so this feature's
    server surface cannot leak a private comp even in principle. It still
    answers through `openVault` for gate consistency. Verdicts are
    untrended and framed "worth a look", never "your data is wrong";
    individual sale comps >25% outside the band get an outlier marker in
    the comps table. No migration.
  - **BOV tracker** (v4 slice 2, 2026-08-08; spec
    `docs/superpowers/specs/2026-08-08-bov-tracking-design.md`). The broker's
    private log of BOV engagements from any source, statuses
    open/delivered/won/lost (vocabulary validated, transitions deliberately
    unpoliced). Rules in the pure, tested **`bov-log.js`**;
    table `broker_bovs` (migration 019), vault-class private: DB-only, every
    read/write user-scoped, read by no owner surface (`/admin`'s
    intro-requests card is unchanged). Intro requests auto-create rows
    (non-blocking), and `GET /api/broker/bovs` seeds from
    `lead_intro_requests` only when the broker's log is EMPTY, mirroring
    `/api/broker/leads`'s own coverage-seeding rule: seeding on every open
    resurrected a row the broker had just Removed (status reset to open,
    notes gone), so it now runs only to recover history for a log with
    nothing in it yet, and `?noseed=1` skips it for one call the same way
    `/api/broker/leads` does, which is what the page's post-delete reload
    passes. From there the intro handler's auto-create is what keeps a
    non-empty log current. Idempotent via `unique (user_id, lead_id)`, and
    the reason migration 019 has no SQL backfill (`marketOf()` is JS).
    Routes go through `requireBroker`. Manual adds log a PII-free `bov`
    analytics event. Lapse locks the log, never deletes it.
    **On `/vault` those rows share one table with the lead inbox**
    (2026-08-13; spec
    `docs/superpowers/specs/2026-08-13-vault-pipeline-deck-design.md`). A
    lead is a `New` stage whose only action is requesting an introduction;
    a BOV keeps its status select and Remove. The four tiles became a
    five-cell stage strip (New / Open / Delivered / Won / Lost) plus a note
    line for this year and the win rate (dash under 3 decided). Coverage
    collapses under "Markets you watch". No new endpoint — the browser
    already had both payloads.
  - **The credit identity is STATED, never inherited** (2026-08-12).
    `POST /api/vault/identity` writes `broker_profiles.display_name` and
    `.company`, creating the row if needed; `vaultReadPayload` returns an
    `identity` block (`display_name`, `company`, `creditedTo`) so `/vault`
    can name the credit BEFORE a publish rather than after one. Four rules.
    **`creditName(profile)` reads the profile only** — the old `user.name`
    fallback is gone, and that fallback was the bug: the publish confirm
    promises "credited to your firm by name", a vault-first broker has no
    profile, so their comps were credited to whatever they typed at signup
    and `submissionRowFrom` copied that string into `broker_company`, which
    is published as their firm. Nobody chose it, so nobody could correct
    it. **An unstated identity now returns `""`**, the publish route
    refuses with `needs_credit_name`, and the vault opens the form in
    place — a one-time question instead of a silent wrong answer.
    **It never touches `public`**: broker-directory.js's TWO CONSENTS rule
    holds, so stating a firm name creates a row that is private by default
    (`public` defaults false in 003) and the opt-in stays on `POST
    /api/broker/profile`. Verified 2026-08-12 — after saving an identity,
    `/broker/<slug>` still 404s and the market page lists nobody. **The
    page prints `creditedTo` verbatim** and never recomputes the
    company-then-name preference, or it could promise a name the write
    would not produce; a test pins that by disagreeing the two on purpose.
    Rules in the pure, tested `validateIdentity` (at least one field must
    survive trimming; the two stay separate columns because a firm is not
    a person; control characters stripped since these strings reach a
    public page, formula shapes left to `guardFormula` at `csvCell` so a
    firm really called "+Plus Realty" keeps its name).
  - **The template carries its own rules, as `#` lines** (2026-08-10; spec
    `docs/superpowers/specs/2026-08-10-vault-template-self-documenting-design.md`).
    `isCommentRow` skips any body row whose FIRST cell starts with `#`, and
    `templateCsv` ships the required columns, the six property types, the
    date format, what the number parsers really accept, and the optional
    per-type columns as exactly those lines. They used to live in the single
    example row's `notes` cell, where the broker's first edit deleted them.
    Four rules. **Only the first cell decides**, which is what lets the three
    example rows sit fully populated under their correct headers with `#` in
    the address cell — so the file we hand a broker can never plant a fake
    comp in their own book, and they activate a row by typing an address over
    the `#`. **The skip is counted, never silent**: `parseUpload` returns
    `commented`, the route passes it through, and `/vault` says "N note lines
    ignored" — a broker's own export with a `#` row is refused today anyway
    (no street number), and this keeps that visible rather than trading a
    loud rejection for a silent drop. **`total` counts data rows only**
    (body minus comments), because it is what `imported` is compared
    against and "imported 3 of 16" reads as data loss. And **the guidance is
    pinned to the constants by a test** — every `PROPERTY_TYPES` value and
    every `OPTIONAL_SPEC_COLUMNS` name must appear in the template, so adding
    a per-type field through the `add-comp-field` skill fails the build until
    the template names it. Keep the text TRUE: `parseMoney` strips `$` and
    commas, `parseNumber` accepts `45,000 SF`, `parsePercent` accepts
    `6.25%`; the old template said "no $ signs" and was simply wrong.
    **Two columns get a sentence each because testers asked what they were
    (2026-09-02)**: `lat and lng are latitude and longitude` with a worked
    example, and a `tenancy:` line — it had NONE, only three example cells,
    and it is free text (`"NNN"` is stored in it elsewhere), so the line
    names the three usual answers and says it is never used in the math.
    The same two answers ride `vault-page.js`'s `FIELD_HINTS` as `title=`
    on every header that names the column (`headCell` and the confirm
    table) and on the add form, whose labels now read Latitude and
    Longitude; a hint explains a column and never names one, so it is not a
    fourth label map. Pinned in both test files.
  - **The CSV column mapper** (2026-08-10; spec
    `docs/superpowers/specs/2026-08-10-vault-csv-column-mapper-design.md`).
    A broker uploads their own export and maps its columns once. `POST
    /api/vault/inspect` reports headers, real sample values and a suggested
    mapping; `/api/vault/upload` takes an optional `mapping`, and absent it
    behaves byte for byte as before. **Since 2026-09-02 the screen has a
    summary mode**: when the pre-selection (suggested plus remembered) claims
    every required field, nothing is ambiguous and no two columns sit on one
    target, the dropdown table folds under `#mapDetails` ("6 of 6 columns
    matched · change how they match") and Import is the next thing on
    screen; the "Will be ignored" line moved ABOVE the fold so the rule below
    holds whether or not the dropdowns are showing. And the remembered
    mapping is **one per file SHAPE**, not one per broker (migration 049,
    run before deploying — the read names the column): `headerSignature`
    hashes the normalized header row, computed server-side from the CSV the
    route received; the exact shape wins and an unseen shape falls back to
    the most recent mapping, which is what one-per-broker always returned.
    Six rules a future editor will
    otherwise break: **a target is suggested only when exactly ONE column
    claims it**, which is how the old "we do not guess column names"
    decision survives (two columns aliasing to `price` suggest neither);
    **a rate-shaped header may claim nothing by ALIAS** (`isRateHeader`,
    2026-08-11, tested on the RAW header because the "/" carrying the
    meaning strips away in normalization) — "$/SF" normalizes to bare
    `sf`, which made it the sole claimant of the size alias on the first
    real broker file, so the mapper confidently suggested importing
    $68.11 as a 68 sq ft building; an exact target name still maps, so a
    literal "Price Per Unit" column keeps its real multifamily column;
    **the screen is always shown unless every header is already one of
    ours**, because only four fields are required per row, so a file with
    an unrecognised "Sq Ft" column imports today with every size null and
    nothing saying so; **unmapped columns are renamed `_ignored_<i>` rather
    than left alone**, or a literal `price` column the broker chose not to
    map would shadow the one they did; **the remembered mapping is only
    ever a pre-selection**, never auto-applied, which is what makes it safe
    to key on the broker rather than on a fingerprint of their header row
    (if the screen is ever made skippable on a remembered mapping, that
    stops being true and the header signature becomes necessary); and
    **the normalized header vector is produced in exactly one place**,
    `normalizedHeaderRow(rawHeaders)`, and `inspectCsv`, `validateMapping`
    and `parseUpload` all route through it rather than calling
    `normalizeHeader` directly. A header can be real and still normalize to
    nothing — `normalizeHeader` strips every non-alphanumeric character, so
    a column headed `$`, `#`, `%` or `($)` (the comment above
    `TEMPLATE_COLUMNS` already names `$` as a header brokers use for price)
    reduces to `""` and would vanish from the mapping screen entirely: not
    listed, not mappable, not even named in the "will be ignored" line. That
    is the exact silent-drop failure this feature exists to prevent, so such
    a header now gets a positional `column_<i>` key instead; a truly blank
    header still yields `""` and stays excluded, so trailing commas still
    cost nothing. Computing the vector separately in any one of the three
    call sites is what broke the round trip the first time this shipped: the
    inspection screen offered `column_0` as a mappable source, and the
    import route, keying its own copy off a bare `normalizeHeader` map,
    refused it as a column the file did not have. `suggestMapping`
    deliberately does NOT route through `normalizedHeaderRow` — it only
    produces optional suggestions, never a required key, and a synthetic
    `column_N` can never match a semantic alias like `sale_price`, so
    running it through the positional fallback would only manufacture
    suggestions nobody could recognise.
- **Broker lead inbox** (v1, 2026-08-05). DDL in
  `migrations/015-broker-lead-inbox.sql` (**run before deploying**). Rules
  live in the pure, tested **`broker-leads.js`** (coverage matching, the lead
  anonymization allowlist, coverage seeding, notify dedupe); server.js owns
  every read/write and computes `market` with `marketOf()` before calling in.
  **Metro matching (2026-08-17).** Coverage matching reads the same curated
  `METRO_GROUPS` corpus retrieval does, so a broker covering Boise industrial
  also sees Meridian industrial leads — those cities trade as one market, and
  until this shipped that table was read by retrieval and by nothing else.
  Four rules. **The adjacency function is INJECTED, never required**:
  `broker-leads.js` does not know what an address or a metro is (its header
  rule), so `filterLeadsForCoverage(leads, cov, siblingsOf)` takes it as an
  optional third argument and behaves exactly as it did before when omitted —
  which is what keeps every other caller and the whole test file safe by
  default. **The property type is never widened with the geography**: an
  industrial broker one suburb over is still an industrial broker, and
  crossing types would put a retail enquiry in their inbox on the strength of
  a shared postcode. **All THREE call sites move together or none do** — the
  inbox, the intro gate (`filterLeadsForCoverage` again, so a visible lead is
  always actionable) and the new-lead alert, which starts from one lead and
  therefore widens from the other end via `coverageMarketsFor` into a
  PostgREST `market=in.(...)`; a broker emailed about a lead the inbox hides,
  or shown one they were never told about, is a bug either way, and a test
  states the two as one rule. **And the reach is disclosed**: the API adds
  `nearby` per coverage row and the chip reads "+7 nearby", because a lead
  from a city the broker never typed otherwise reads as a bug in the one
  surface whose whole job is to be trusted about where their business is.
  Rollback is `LEAD_METRO=off`, deliberately separate from `CORPUS_METRO`:
  the two read one table but answer different questions — which comps a
  search may draw on, versus which PEOPLE see a stranger's enquiry.
  `GET|POST|DELETE /api/broker/coverage` — the broker's list of market +
  property-type pairs to watch. `GET` lists it; `POST` adds one pair
  (validated against `LEADSVC.isCanonicalMarket` and `VAULT.PROPERTY_TYPES`,
  capped at 200); `DELETE?id=` removes one, scoped by `user_id`.
  `GET /api/broker/leads` — the inbox itself: BOV leads from the last
  `LEAD_WINDOW_DAYS` (90) days matching the caller's coverage, anonymized to
  market/type/size/date only (`LEADSVC.anonymizeLead` — name, email, phone,
  company and street address never leave the handler). **DB-only, no file
  fallback**: any read error is a 503, because an empty inbox on error would
  misreport demand as zero. On first open with no coverage rows, seeds
  coverage from the broker's own approved comp submissions
  (`LEADSVC.seedCoverageFromSubmissions`); `?noseed=1` skips that reseed so a
  market a broker just removed stays removed for the rest of the page
  session. `POST /api/broker/leads/intro` — a broker raising a hand for one
  lead. Owner-mediated: emails the owner naming the broker, never contacts
  the property owner and never sends broker PII anywhere it didn't already
  go. Coverage-gated (mirrors the inbox's same source + window filters, so a
  broker cannot request an intro to a lead they cannot see) and deduped via
  `unique(lead_id, user_id)` on `lead_intro_requests` — a repeat request
  answers `{ ok: true, already: true }` rather than emailing the owner twice.
  All three routes go through **`requireBroker`**, a deliberate second copy
  of the vault's `openVault` gate (same three refusals, same order: 401 not
  signed in, 403 not a broker, 503 no database) — `test/routes.test.js`
  exists specifically to catch drift between the two copies.

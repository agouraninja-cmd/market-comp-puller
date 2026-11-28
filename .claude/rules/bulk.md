---
paths:
  - "bulk.js"
  - "bulk-page.js"
  - "test/bulk*.test.js"
---
# Bulk valuation

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

- `BULK_DAILY_ADDRESSES` — optional (default 200). Per-MEMBER ceiling on
  addresses bulk valuation may put through a search in one UTC day. A
  SEPARATE number from `DAILY_SEARCH_CAP` on purpose: that one is site-wide
  and Pro deliberately bypasses it (`countsDailyCap: !ent.pro`), an exemption
  written for somebody typing one address at a time. Bulk multiplies it by
  fifty per click — one run is ~17 minutes and ~$18, and with
  one-job-at-a-time as the only other bound a member could start another the
  moment it finishes, roughly $63/hour indefinitely. Charging bulk to
  `DAILY_SEARCH_CAP` instead was rejected: one 50-address run would eat a
  third of the site's daily allowance and lock out the free visitors that cap
  exists to protect. Counts rows that were ATTEMPTED (anything past `queued`),
  so cancelling a run costs what actually ran rather than what was queued;
  windowed on `created_at`, so a job straddling midnight counts wholly against
  the day it started. Fails OPEN on a read error — a paying member must not be
  locked out by one failed count, and the 50-address cap still bounds the
  damage. The remaining allowance rides on `GET /api/bulk` and the `/bulk`
  boot payload (`leftToday`/`dailyLimit`) so the form says it BEFORE a list is
  pasted, not only at the moment of refusal. Env-overridable because the
  moment it bites is the moment a real customer is blocked mid-workday.
- `SEARCH_API_URL` — **test-only**, unset in production, where the provider's
  own endpoint is the live value. `RESEND_API_URL`'s precedent for
  `RESEND_API_URL`'s reason: bulk valuation's whole point is fifty searches
  leaving the building, and without this the suite could reach the provider
  call and then had to stop and assume — everything from "a report came back"
  through valuing it, writing the row and putting it on the member's desk was
  argued in comments and never executed. `test/bulk-run.test.js` is the user.
  It covers the SEARCH call only; the extract vendor (PDF/screenshot import)
  keeps its own endpoint, so there is one override and one thing it can move.
  Not a secret and authorizes nothing (the API key still does), but it decides
  where a billed request is posted, so treat it as trusted config.

## Architecture

- **A row leans on the building's own sale exactly as its report does
  (2026-11-27; report-and-valuation.md, "The building's own sale leads its
  value", has the rule).** "One number, one place" below now covers the
  blend too: `BULK.valueFromReport` values the comps as before and then
  calls `VALUATION.valueWithOwnSale`, the function the report page's hero
  calls, with the same inputs. Read this before changing that function or
  any of its callers:
  - **Four more inputs, and a caller that leaves one out gets a different
    number from the report.** `address` (the sale has to be recorded for the
    subject: without it the row never leans, refused `no_address`),
    `txFocus` (a leases-only search leans on nothing), `netLease` (net lease
    mode does not lean; `VALUATION.isNetLease(type, details)`) and
    `ownSaleOff` (the member's switch on a saved report,
    `meta.curation.ownSaleOff`). All three callers in server.js pass them:
    the worker (`runBulkItem`), the re-value route
    (`POST /api/bulk/item/size`, which also reads the switch off the saved
    report) and `valueShelfReports` (a firm's building sheet).
  - **The asking price that can touch the sale is the listing the SEARCH
    found** (`report.subject_asking`), never the row's own Asking column. The
    row's own still weights the comps (`subjectPsfOf`), as it has since
    2026-11-10.
  - **What comes back.** `value_low/likely/high` are the blend when the sale
    is weighed and the comps' own otherwise; `psf_*` are those dollars over
    the size, so a row still multiplies out; `comps_low/likely/high` are
    what the comps alone say; `own_sale` says what happened (`anchored`,
    `weight`, `half`, `price`, `date`, `indexed`, `refused`, `why`). A row
    with no size can now have a dollar value (a clean first-year sale stands
    alone), so the worker writes no "No building size found" note on it.
  - **Nothing is stored about the sale.** `bulk_job_items` has no column
    for it and none was added (no migration): the row keeps its three
    figures, and the report it links to explains them. The CSV is unchanged.
  - **A row valued before this date does not move**, and neither does its
    report: that report's sale carries no stamp, so nothing leans on it. The
    two still agree. Re-running the address is what brings the new rule.
  - Tests: `test/bulk-own-sale.test.js`.

- **The example addresses are unsearched buildings near the member
  (2026-11-18, the owner: "the more searches that aren't in our cache the
  more data we have. So make the sample addresses random addresses in their
  area that haven't been looked up yet").** The DELIBERATE OPPOSITE of the
  Address Explorer's cache-friendly list: a sample that is already cached
  teaches us nothing, a fresh one is new comps for the corpus. Read this
  before "spending" a sample on a cache hit.
  - **`GET /api/sample-addresses?type=&count=`** (server.js, beside
    `/api/explore-addresses`): signed in, `canExploreAddresses` (the
    Explorer's gate, for its reason: corpus addresses are the asset), 30 a
    window per member. Addresses only (`{ address, type, market }`), never a
    price or a date, and `area` ("City, ST", or "" when nationwide). Any
    failure answers 200 with `addresses: []` and the box keeps its fixed
    examples. A GET that writes and logs nothing.
  - **The rules are `sample-addresses.js`** (pure, tested in
    `test/sample-addresses.test.js`): `areaMarkets` (a property 3, a Board
    market 2, a recent search 1; the top three, then their metro siblings),
    `sampleCandidates` (one street-numbered building with a "City, ST": no
    quantity, range, "&" or aggregate; one per building; shuffled with an
    injected random), `pickUnsearched`.
  - **"Never looked up" is `searchedAddressKeys`**: any `search_cache` row
    with that `address_key`, of ANY age and ANY type (stricter than
    `cachedAddressKeys`, which is the TTL'd, per-type instant badge). Rows
    from before migration 020 have no address_key and cannot be matched. It
    THROWS when the database cannot answer, so the route offers nothing
    rather than a sample it could not check. Probed 40 candidates at a time.
  - **Public corpus only** (`corpusAddressRows`: three columns, never
    `ALL_TYPE_COMP_FIELDS`, never `corpusRowsForType`, which geocodes as a
    side effect). No vault table; the member's own recents, properties and
    Board rows decide where to look and are never returned.
    `test/sample-addresses-run.test.js` holds all of that against a real
    server.
  - **On `/bulk`** `loadSamples` writes the answer INTO the textarea's
    placeholder, which stays the one source `fillExamples` reads (the
    bulk-routes test's rule), per type (the whole list runs as one type), a
    type with none putting the fixed examples back. It runs only once the
    page is SHOWN (`prerenderingchange`): this page is built ahead on every
    member page view. **On index.html** the five rotating `ADDRESS_EXAMPLES`
    are replaced, typed, the first time the member focuses or points at the
    address field, never on load (that page is Home too).

- **Bulk valuation** (2026-08-21; migration `036-bulk-valuations.sql`, **run
  before deploying**; spec
  `docs/superpowers/specs/2026-08-21-bulk-valuation-design.md`). A Pro member
  pastes or uploads a list of addresses and gets a value on each, as one
  portfolio, at **`/bulk`**. Rules live in the pure, tested **`bulk.js`**; the
  page is **`bulk-page.js`** (a marketShell BODY, the /brokers-firms pattern, so it
  carries no chrome of its own); server.js owns the job tables and the worker.
  **It loads Inter since 2026-11-13** (`head: INTER_FONT_HEAD` on the route,
  signed in or not, like `/comps`, the other tab of the Comps section): until
  then the page and the rail beside it were in the system font, and the
  section changed typeface between its two tabs. Nothing wrapped differently
  at 1440 or 390 wide on the form; the page is 1px shorter. **Not measured:
  a finished portfolio's table**, which the seed did not hold; Inter is about
  6% wider, so look at one with long addresses (markets.md, "Inter on
  /markets", has the measurements and what is still left).
  **The page is a desk since 2026-09-04** (owner's pick from a design canvas):
  headed "Run a report" — the door every bar and the workspace header call it
  by, while the rail row keeps "Bulk valuation" — with a two-cell strip
  (LEFT TODAY / PER RUN, `renderCap`) top right (removed 2026-10-09, owner's
  call: the limits still hold and the cost line still names the daily one
  once a list runs past it; index.html's list-mode "Up to N per run, N left
  today" line went the same day), the form as ONE bordered
  chamber in the report form's own anatomy (`BULK_CSS`: head row with the
  ready count, borderless address box, four settings on a hairline row, cost
  beside the solid red button on a wash footer), and Earlier runs as a ledger
  table in the shared run view (`renderPast` writes `<tr>`s into `#bkPast`,
  which is a `<tbody>` now). Nothing on it is dim (owner's call, same day):
  no `--ink-mute`, no faded disabled button — an empty box answers a click
  with a message. One address makes the button read "Run the report" and a
  one-address run started on the page opens its report when it lands
  (`singleJob` / `onRunState`). Every field id and handler survived the
  redesign, and `test/bulk-inline.test.js` pins the single-source rule for
  the run view, so the workspace's inline run inherits the ledger chips.
  **It takes every input the single form did (2026-09-04 evening; migration
  `051-bulk-job-options.sql`, run before deploying).** `bulk_jobs.tx_focus`
  (both/sales/leases) is the JOB's, like type and months; `bulk_job_items
  .subject` (jsonb: `asking`, `noi`, `capRate`, `details`) is the ROW's. The
  visible settings row is Property type · Focus · Lookback · Market note; the
  rest folds behind ONE derived line (`refreshMore`, the form's settings-line
  rule: "size from public records · no asking price · no NOI"): Property SF,
  Asking price, NOI, Cap rate, the type's own fields (`BULK_SUBJECT_FIELDS`, a
  mirror of index.html's `TYPE_SUBJECT_FIELDS` that `test/bulk-inline.test.js`
  evaluates and compares field for field — the add-comp-field skill's list
  grows by one), and the run's name. Five rules: **the per-property fields
  apply to a ONE-address run only** — the browser sends `subject` only then
  and the route applies it only then — while a list's rows bring their own
  through the upload's columns (`asking_price`, `noi`, `cap_rate`, and the
  type's keys as headers, read by `parseAddressList` with `detailKeys`
  INJECTED and the size column's warn-never-drop rule); **the focus is
  refused by name, never defaulted** (`normalizeTxFocus` returns null for a
  typo; empty is `both`); **asking price, NOI and cap rate never reach the
  model** — the worker hands `runCompSearch` only `txFocus` and the sanitized
  `subjectDetails`, exactly as `/api/comps` does, and the three ride into the
  stored recent's `meta.subject` for the report's client-side income and
  asking cross-checks (`test/bulk-run.test.js` asserts both halves against
  the stub provider); **an unvalued row is filed and linked too** (a
  leases-only search has its whole answer in the report, 3f), with the
  leases case saying so instead of "no priced sale comps"; and **the insert
  names `tx_focus`/`subject` only for non-default values**, so a plain run
  still starts before 051 has run, while a run that uses them 400s at
  PostgREST into "Could not start that run" — migrate first. Not done: a
  per-address property type (one type per job, as 036 argues).
  **Excel lists and "Add valued rows to portfolio" (2026-09-04).** `POST
  /api/bulk/inspect { xlsx }` reads a workbook's first sheet through
  `xlsxGridFromBase64` (typed, 1 MB — the vault import's helper) and hands
  back CSV TEXT that the page drops into `#bulkText`; its own route rather
  than a field on the run, because the count, the cost line and the
  one-address subject rule all run on the box BEFORE the button, and this way
  every rule a paste obeys applies to a spreadsheet unchanged. Nothing is
  stored. The `#bkAddAll` link on a finished run lives in the SHARED run view
  (so the inline homepage run has it and the single-source tests hold) and
  walks the one sanctioned door per valued row — `GET /api/recents?id=`, then
  `POST /api/portfolio` with the payload and the row's own value as the
  opening snapshot — so the match key, the 100/500 cap and the verified-key
  rule apply by construction and a property already in the book is counted
  as `existed`, never duplicated. It is an explicit act behind a confirm
  naming the count: the 2026-08-31 rule ("a portfolio is what you own")
  stands, and no bulk route writes to the portfolio.
  **A failed row can be retried alone** (`POST /api/bulk/item/retry {id}`,
  2026-09-04): it mutates the EXISTING row and job, never a one-row job (which
  would leave the old row failed forever and list two runs for one list).
  Four guards run before anything is written — `status === "failed"` only (a
  done-but-unvalued row would come back from cache; its fix is a longer
  lookback), one live job per member, the daily allowance must leave one, the
  provider key must exist — and `test/bulk-routes.test.js` asserts a refusal
  leaves the table untouched. Then the row goes back to `queued` with its
  `created_at` bumped to now (what makes the retry count as today's attempted
  address, since `bulkAddressesUsedToday` windows on `created_at`, with no
  schema change), the job back to `running` with `done_count - 1`, and
  `runBulkJob(job, [item], user, ent, { doneBefore })` works the one item
  with its counter starting where the job stood — the ONE worker change, and
  the bookkeeping `test/bulk-run.test.js` pins (done_count back to total, one
  more search, no duplicate recent). Ordinary cache, not `fresh`: a failed
  row wrote no cache entry.
  **The Earlier-runs ledger carries each run's value (same evening)** from
  ONE grouped `bulk_job_items` read in `bulkListPayload` (`job_id=in.(…)`,
  `status=eq.done`, `BULK.summarize` per job → `summary`), deliberately NOT a
  denormalized column on `bulk_jobs`: the list is read at boot and after a
  run, never on the 4-second poll, so 036's "denormalize because we poll"
  argument for `done_count` does not apply, and a stored sum would need a
  read-modify-write per row under `BULK_CONCURRENCY` plus a recompute on every
  later row mutation (a typed size, a retry). A failed read leaves `summary`
  off and the ledger shows a dash, never a zero. Each ledger row has **Run
  again** (`onRunAgain`, injected into `BULKRUN.init` because the shared run
  view must not know a form exists; it REFILLS the form and does not start the
  run), **Rename** (`PATCH /api/bulk {id, label}` — 120 chars, empty clears,
  user-scoped, in the ladder test) and **Delete** (the existing route, with a
  confirm that says the valuations stay).
  **The CSV carries those inputs too** (same evening): `exportCsv(job, items,
  { detailKeys })` APPENDS `asking_price`, `noi`, `cap_rate`, the type's detail
  keys and `tx_focus` after the classic sixteen columns, which stay
  byte-identical along with the totals row's positions (both pinned in
  `test/bulk.test.js`) — a header-keyed reader sees new columns, a positional
  one sees nothing move. `bulkItemRow` surfaces `subject` field by field
  (`bulkSubjectRow`), never the raw jsonb, and the export route passes the
  type's `TYPE_COMP_FIELDS` keys. The filename carries the run's label as a
  slug (`compninja-bulk-q3-review-2026-09-04.csv`).
  Routes: `GET|PATCH|POST|DELETE /api/bulk`, `POST /api/bulk/cancel`,
  `POST /api/bulk/item/retry`, `POST /api/bulk/inspect`,
  `GET /api/bulk/export.csv?id=`, all through **`openBulk`** — a deliberate
  THIRD copy of the vault's 401 → 403 → 503 ladder (`test/routes.test.js`
  catches the three drifting). Every finished row is also upserted into
  `portfolio_items`, so the valuation lands on My Desk as an ordinary saved
  property and **`?property=<id>`** on index.html opens it.
  Seven rules a future editor will otherwise break:
  - **One number, one place.** A bulk row runs `runCompSearch` and
    `finishReportForViewer` — the same two functions `/api/comps` runs — and
    values the result with `VALUATION.valueFromComps`. Those two came OUT of
    the /api/comps handler for this feature. A second path would make fifty
    rows disagree with the fifty reports behind them, and nothing on either
    screen could show it.
  - **A pasted line is ONE address, whatever commas it holds.** Splitting
    `123 Main St, Boise, ID 83702` searches for `123 Main St` in no city and
    reads `83702` as a square footage. Columns are read ONLY when a header row
    names an address column; then the vault's own `parseCsv` handles the BOM,
    the quotes and the `#` note lines.
  - **A job is an invoice.** Every address that misses the cache is its own
    billed search (~$0.36, 40-70s). Hence `BULK.MAX_ADDRESSES` = 50 as a hard
    ceiling, `bulkMaxAddresses` as the per-visitor half (the parser clamps the
    entitlement to its own ceiling, so entitlements can never widen a job),
    ONE live job per member read from the DATABASE, **`BULK_DAILY_ADDRESSES`
    as the per-member daily bound** (see its env bullet — one job at a time
    bounds concurrency, not spend, and without it a member could run ~$63/hour
    indefinitely), and the count and wall clock said BEFORE the button. There
    is deliberately **no header-only bypass** like `/api/comps`' `internal`: a
    bypass a browser was never meant to have must not grow one on a spend
    amplifier. The two caps split cleanly and should stay split: the per-job
    number is a PRODUCT limit and lives in `entitlements.js`, the per-day
    number is a SPEND backstop and lives in an env var, exactly as
    `maxComps` and `DAILY_SEARCH_CAP` do.
  - **`canBulkValue` is withheld on a dark deployment.** The vault's
    asymmetry sharpened: this is not merely an access surface but a SPEND
    surface, so `PRO_ENABLED=off` (the default) must not hand an unmetered
    invoice to every visitor. (It was withheld from a tester too until
    2026-09-01; testers are Pro outright now, and `BULK_DAILY_ADDRESSES` is
    the per-member backstop that bounds them exactly as it bounds a paying
    member.) The retired $20 unlock does not
    reach it either (the Address Explorer's argument: a tool for running fifty
    OTHER addresses cannot be scoped to one address+type).
  - **The worker outlives the request, so it holds no `req`/`res`.** That is
    why `vaultCompsForReport` takes a `user` (2026-08-21) and
    `orgCompsForReport` dropped the `req` it never read. The per-market vault
    and firm reads are memoized as PROMISES, not rows: caching rows and
    filling them in later hands the second and third concurrent rows in a
    market an empty vault, which is invisible because an empty vault is a
    normal state.
  - **A stalled job is decided at READ time**, never by a timer or a boot
    sweep (migration 025's argument): a worker writes `heartbeat_at` after
    every row, and a read older than `BULK.STALL_MS` marks the job
    `interrupted` once. Nothing is lost — finished rows are already written,
    and re-running the list serves them from cache for free. Reaping also runs
    before the one-job-at-a-time check, so a deploy mid-run cannot lock
    somebody out of their own tool for the stall window.
  - **Nothing is dropped silently, and a failure is not $0.** Places rather
    than properties, duplicates, unparseable sizes and truncation past the cap
    are each reported by line number; `BULK.summarize` sums only rows that
    produced a figure and says how many. `sale_comps` is what a row shows, not
    the comp count — the band comes from the sales.
  **The worker is proven end to end** by `test/bulk-run.test.js`, which
  stands a stub provider in front of `SEARCH_API_URL` and runs a whole job:
  the search, the valuation, the desk upsert, the harvest, the cache write,
  the job's completion, and a second run of the same list costing zero
  searches. It also pins that one failed address costs the row and not the
  run, and that the vendor's own error text never reaches the member.
  Deliberately not built (see the spec's §5): mixed types in one job,
  per-address lookback/details, an automatic resume (re-running IS the resume,
  free from cache), a shareable portfolio, and any scheduling.

- **The time-left bar (2026-11-10, the owner: "a loading bar for the Comp
  Report so they can see how much longer it is going to be searching for").**
  A run used to show a "running" chip and nothing that moved. The run view
  now has `#bkProg` between the heading and the totals: what it is doing, the
  time left ("About 35 seconds left"), and a bar. It is part of the ONE run
  view (`renderBulkRunMarkup`, `BULK_RUN_CSS`, `BULK_RUN_JS`), so index.html's
  inline list run has it too. Rules:
  - **The time is the server's, the countdown is the page's.** `GET
    /api/bulk?id=` and the `POST` answer carry `progress: { elapsed_ms,
    left_ms, late }` from `bulkProgressFor` → `BULK.runProgress` (pure,
    tested): the worker's own model, `BULK_CONCURRENCY` lanes each taking the
    next queued row, every row costing the usual time, a running row credited
    with what it has already spent. `drawProgress` counts down once a second
    between the 4-second polls. Nothing is stored and there is no migration:
    the clock (`control.startedAt`, `control.since`) lives in `bulkRunning`
    with the worker that owns the job.
  - **`progress` is null when this process is not working the job** (a
    restart mid-run, read during the stall window). The bar then shows the
    count (`done_count / total`) and no time. It never quotes a time it was
    not given.
  - **The usual time is MEASURED, never a constant** (`SEARCH_PACE` in
    server.js, `BULK.typicalSearchMs`). A search is ~10s on Gemini at
    `THINKING_LEVEL=low`, ~35s at medium and 40-70s on Anthropic, so a
    constant would be wrong the day a setting changes. It is the 75th
    percentile of the last 20 billed searches (so most runs finish inside the
    bar), fed from ONE seam, `runCompSearch`'s billed leg, and seeded once
    per process from `analytics_events.duration_ms` (the last 14 days),
    because Render restarts the process on every deploy. The seed read is
    raced against 1.5s and never throws; with nothing timed the default is 45s
    and it still counts as one sample until five real ones are in.
  - **The bar never slides back and never fills by itself.** An estimate can
    grow; the time says so and the bar holds. Only a finished job reaches
    100% ("Done", then the bar goes after 1.5s). An old run opened from the
    ledger never shows one.
  - **Past its time it says so.** `late` is true when every row in flight has
    outrun the usual time and nothing is queued; the bar reads "Taking a
    little longer than usual" rather than promising seconds again. A row is
    past its time once less than `BULK.lateLeftMs(typical)` of it is left
    (15%, never under 3 seconds).
  - **`BULKRUN.leftWords(ms, late)` is the one sentence a countdown says**
    ("About 35 seconds left", "A few seconds left", the late line). The
    single report's loading card reads it off this run view too, so do not
    inline the words on either side.
  - **A failed poll drops the clock.** The poll does not re-arm after a
    failed read, so the countdown stops with it; `BULKRUN.stop()` (index.html,
    when a single report takes the page) stops the ticker too.
  - **The time said BEFORE the button is the same estimate.** The list read
    and the boot payload carry `pace: { typical_ms, concurrency }`, and the
    cost line's `runSpan(n)` is `ceil(n / lanes) × typical` in
    `BULKRUN.span`'s words, which is what `runProgress` opens on for n queued
    rows (`test/bulk-inline.test.js` holds the two together). It replaced
    "About a minute" and "Roughly 0.9-1.1 min per address", which ignored the
    three lanes and promised 45-55 minutes for a run that takes about 15.
  Tests: `test/bulk.test.js` (the arithmetic), `test/bulk-inline.test.js`
  (the bar executed against a stand-in page), `test/bulk-run.test.js` (a real
  job held mid-search; the pace seeded from stored searches). **The single
  report's loading card counts down from the same pace** (the same day): it
  is the first event of `/api/comps`' progress stream, and its rules are in
  search-pipeline.md under "Live search progress".

- **One screen (2026-11-15; the owner's pick of Draft D of the Run a report
  drafts, https://claude.ai/artifact/1xVfPSSr7SdVFfnjK3oy6p: "everything
  needs to fit on the page at first glance and it needs to be simplified",
  and "make the CSV run again rename and delete in a 3 dot click thingy").**
  Measured on a 1440 by 800 window against the stand-in database: a finished
  eight-address run ended 2,109px down the page and ends at 781px; the form
  with three earlier runs under it ended at 1,100px and ends at 748px. Where
  the notes above say the form is most of a screen, the ledger carries each
  run's range, or a run's actions are links, read it as history. Rules:
  - **The page shows the form or a run.** `renderJob` marks the run view's
    own container `.bk-open` while a run is drawn (`syncOpen`; `#app` on
    /bulk, `#bkInline` on the app page) and /bulk's stylesheet hides `.desk`
    and the lede on it. The run view still knows no form. `.bk-form` is
    /bulk's own class and keeps the form over a run: **New report**
    (`#bkNew`, in the shared markup, shown and answered only by `BULK_JS`),
    Run again, and an address handed over by `?address=` (`showForm(true)`,
    kept until a run is started from the form, so a running job attaching at
    load never hides it). `formFor` says for how long; starting a run folds
    it (`foldForm`).
  - **Under an open run, Earlier runs is one closed line** (`#bkPastTg`, a
    real button with `aria-expanded`; `.bk-past-open` opens it and a
    different run on screen closes it again). With no run open the list is
    always shown and the button does nothing.
  - **A three-dot menu (`menu()`, `.mn`).** One per earlier run (Download
    CSV, Run again, Rename, Delete: the same `data-again` / `data-rename` /
    `data-del` hooks the handlers always bound) and one on the open run (Add
    valued rows to portfolio, Go to Home, and the app page's Earlier runs
    link). ONE document listener opens and closes all of them, bound in
    `wire()`. **Escape claims the key** (`preventDefault`, from the capturing
    phase): the header's own listener sends an unclaimed Escape back a page.
    A ledger with a menu open is not redrawn under the pointer (`pastStale`;
    a running job redraws every four seconds). The earlier-runs table sits
    in `.pastw`, which does NOT scroll sideways, because a scrolling box
    clips the menu; under 640px the table is cards.
  - **`wire()` binds the view's own controls once, from `init()` and from
    the first draw.** index.html mounts this view and never calls `init()`,
    so until this its Cancel and Add to portfolio were bound to nothing.
  - **One line per address.** The range is its own column, a size reads
    `36,500` with its source beside it in a fixed-width `.src` every row has
    (so the figures line up), and a finished row is a tick (`rowStatus`; the
    word stays as its `aria-label`). The cells carry classes (`c-n c-a c-v
    c-r c-p c-s c-c c-st`, and `r-*` in the ledger) because the phone layout
    places them by name.
  - **Four site-wide rules are answered in `BULK_RUN_CSS`** and come back if
    removed: `.sub`'s 22px bottom margin, `td:first-child`'s 180px,
    `table`'s 640px floor (why the table slid off a phone) and `th`'s wash.
    The form's borderless-field rule is scoped to `.bulk .desk`, or it
    strips the size box's outline again.
  - **The form:** no head row; the count and the two links share the
    label's line by the stylesheet's grid and follow the box in the markup
    (Tab reaches the box first); the box is three lines and grows with a
    list to 420px (`refreshCount`). The red button is `--red-fill` (the link
    red lightens on a dark page: white words on pale pink).
  - **The buttons are the canon's** (`.btn.sm.ghost`), on both pages.
    `renderJob` writes those class names; a link in a menu takes no class,
    or `hide`.
  - **The note at the bottom is one sentence** and must keep saying
    "automated estimate ... not an appraisal". The sentence about addresses
    with no priced sale comps went (the owner's pick; the row itself says
    it).
  - `.wrap>.cs-tabs` and `body main.wrap` in `BULK_CSS` reach outside
    `.bulk` on purpose (the section tabs' margin, and the page's top padding
    from 641px up). Only /bulk ships them.
  A phone still scrolls: one screen is a laptop promise, and a long list
  scrolls anywhere (eight addresses fit, fifty do not). Tests: the last
  block of `test/bulk-inline.test.js`. The five drafts are at the link
  above; the before-and-after pictures are linked from the pull request.

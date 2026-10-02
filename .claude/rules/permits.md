---
paths:
  - "permit-*.js"
  - "pdf-text.js"
  - "migrations/054-permit-watches.sql"
  - "permits-page.js"
  - "scripts/capture-permit-fixtures.js"
  - ".github/workflows/permit-sweep.yml"
  - "test/permit*.test.js"
---
# Permits

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Architecture

- **The permit sweep** (2026-09-16; migration `052-permit-filings.sql`;
  spec `docs/superpowers/specs/2026-09-16-permit-signals-design.md`, slices
  1 and 2 of four). `POST /api/permits/sweep` reads the Boise and Meridian
  building-permit portals and stores every newly filed commercial permit in
  `permit_filings`, one row per (jurisdiction, permit number), enriched off
  the record's own detail page (applicant, contractor, parcel number) and
  zoned through the Ada County parcel layer; a re-seen filing whose status
  moved gets a `permit_filing_events` row. Ported from the owner's separate
  `adler-permit-tracker` repo, which keeps running for Adler unchanged. The
  rules live in three pure modules with the fetch INJECTED —
  **`permit-portals.js`** (the Accela and EnerGov clients and the city
  registry), **`permit-zoning.js`** (Ada County zoning, `I-1`/`M-2`/`BP` are
  industrial, a GIS outage answers `{}`) and **`permit-filings.js`** (what is
  stored, the dedupe key, the match rule) — and `npm test` replays them
  against pages captured from the LIVE portals on 2026-09-16
  (`scripts/capture-permit-fixtures.js`, gzipped under
  `test/fixtures/permit-portals/`; re-run it to diagnose a redesign, since a
  test that fails on a fresh capture names the selector that moved).
  `test/permit-sweep-run.test.js` runs the whole route against a stub portal
  through **`PERMIT_PORTAL_ORIGIN`** (test-only, `RESEND_API_URL`'s
  precedent — it re-points every portal AND the parcel layer at one origin;
  unset in production) with `PERMIT_SWEEP_PAUSE_MS=0` (the politeness pause,
  two seconds live). Six rules:
  - **A route, never a timer** — the watchlist digest's argument, verbatim:
    a `setInterval` fires at an hour nobody chose, again after every deploy,
    and twice on two instances. The schedule lives outside the process (a
    Render cron, an Action, the /admin card's buttons). Idempotent by the
    unique key and `ignore-duplicates`, so a double fire is portal requests
    and nothing else. `{ dryRun: true }` is the Preview: it discovers,
    enriches and reports and writes nothing; opening `/admin` never calls the
    route (pinned, the digest card's rule).
  - **Filings are public record, not vault-class.** No `user_id`, no
    `org_id`, no privacy wall. What is per-firm is the MATCH to a board,
    which is a read (`matchFilingsToBuildings`) and slice 3's; nothing here
    names the firm's board table and nothing may.
  - **The match key is the STREET LINE.** A portal prints "8000 S FEDERAL
    WAY" and a board row carries "8000 S Federal Way, Boise, ID 83716", so
    `street_key` is broker-vault.js's `addressKey` over everything before the
    first comma, and `market` is the JURISDICTION's "City, ST" through
    `marketOf`, never parsed from the portal string. Miss rather than guess:
    no abbreviation expansion, no proximity.
  - **Nampa ships switched off** (SUPERSEDED 2026-10-01: Nampa is read from
    the city’s published reports, see the last section) (`sweep: false` in the registry, with the
    reason). Its Tyler host now sits behind an AWS load balancer that
    answers 403 to any user agent naming a bot and serves a browser string;
    disguising the sweep as a browser to pass a filter the operator chose is
    an owner's call, not this code's. The client and its tests stay. The
    tracker Adler still runs is presumably blind to Nampa for the same
    reason.
  - **The capture found what the port could not.** Meridian pages its grid
    at ten rows (a 7-day tenant-improvement search overflowed it), so the
    sweep follows the pager's Next postback up to `MAX_PAGES` and only the
    cap counts as `truncated`; a single-hit detail page prints the address
    with a blue footnote asterisk and no comma before the city, both fixed
    so the detail path keys like the grid path; and the result page writes
    `value` before `selected` on its dropdowns, which an order-bound option
    match read as the first option — the pager postback then asked for the
    wrong type.
  - **Migration 052 before deploy, mildly.** Nothing on a hot path reads
    the table; deploy-first costs the /admin card ("unavailable") and turns
    every sweep into a named error line until it is run.
  **Slices 3 and 4 shipped 2026-09-23** — the reads, which never write:
  - **The building sheet's Permits section** (`buildingPermitsFor` →
    `PERMIT_FILINGS.sheetPermits`): the filings whose `street_key` and
    `market` equal the building's, each with its status history from
    `permit_filing_events`, the applicant and contractor, zoning, and a link
    to the portal record. **`permits: null` — the section does not render —
    for a building outside the SWEPT cities** (`PERMIT_SWEPT_MARKETS`, from
    `SWEEP_KEYS`, so Nampa is out while it is switched off): an empty
    "Permits" on a Dallas building would claim we looked. It names its
    source and its last sweep, and says when that sweep is more than a
    business day old (`sweepFreshness` / `businessDayBefore`); a table
    never swept reads "not checked yet". A failed read is
    `{ unavailable: true }`, said as such, never "no permits".
    `sheetPermits` re-matches what the query returned, so a caller that
    fetched too wide cannot put a neighbour's permit on the sheet.
  - **/buildings' Permit activity strip** (`boardPermitActivityFor`, on the
    page's boot only): a filing applied for or a status that moved in the
    last 30 days on the board's own buildings. Past events, so its own strip
    rather than rows in the forward-looking Critical dates. The board rows
    come from the buildings read already made; nothing here names the
    board's table.
  - **The Workspace's Your permits** (2026-09-24, owner's call; `GET
    /api/org/permits?id=`, `yourPermitsFor` → `PERMIT_FILINGS.yourPermits`,
    `#deskPermits`). It REPLACED the development shop's New filings — every
    industrial filing in the swept cities for the last 14 days, shown only
    to a development shop — which pointed the Workspace at the market rather
    than at the firm's own record; that market-wide list lives on `/permits`
    for every account, and the section links there ("Every filing in Boise
    and Meridian →"). Four rules. **It is the /buildings strip's rows**:
    `yourPermits` hands its board to `boardPermitActivity`, and
    `sweptBuildings` is the one filter both use, so the Workspace and
    /buildings cannot tell one firm two stories (a unit test deep-equals the
    two). **Every shop kind gets it** — the filings are about the firm's own
    buildings, so §9's "does a broker shop get the market feed?" does not
    arise, and there is no `kind` in the answer any more. **`permits: null`,
    and no section, when no board building is in a swept city** (§7's
    Dallas rule, for a whole board), and then no filing is read at all —
    the route is in `DESK_BOOT_ORG_URLS`, so a firm outside Boise pays one
    board read per workspace load and nothing more. **Unlike the strip it
    THROWS** (`recentPermitFilings` is the shared read; `boardPermitActivityFor`
    wraps it fail-open, the route 503s): the Workspace hides a section it
    could not read, because "nothing filed at your buildings" must never be
    what an outage looks like. Each row's address opens the building's
    sheet, where the whole status history is; past eight, the rest are on
    /buildings.
  - **Filter permit_filings by `jurisdiction`, never `market=in.(…)`.** A
    market name carries a comma ("Boise, ID") and the stand-in PostgREST
    splits `in.()` on commas; the jurisdiction key is the same set with no
    comma in it.
  - **The schedule is `.github/workflows/permit-sweep.yml`**, weekdays
    13:00 UTC, POSTing the route with the `ADMIN_KEY` repository secret —
    the external driver the route was built for. It fails loudly without
    the secret and on any per-city error line, because a scheduled job that
    passes while doing nothing is a tracker that silently stopped.
  **The Permit tracker page, `GET /permits`** (2026-09-24, owner's "it
  should be under tools"): the THIRD Tools row — Market explorer, Comp
  report, Permit tracker, the owner's order — on BOTH nav authors (marketBar and index.html, pinned in
  `test/permits-page.test.js`), for any signed-in account — public record,
  not a plan feature. Body in **`permits-page.js`** (a marketShell body,
  style in the body, one read in the boot, filtered in the browser);
  `permitTrackerPayload` reads the last 30 days of every swept city through
  `PERMIT_FILINGS.trackerFeed`, NOT only industrial (the page carries that
  as a switch), and marks each filing sitting on the reader's firm board
  with a link to its sheet. The board is read through `orgBuildingRows`,
  fail-open. In `CTA_FREE_PAGES`, since it is a working page.
  `test/permit-sheet-run.test.js` runs all of it against the stand-in,
  including the spec's two-firm case (both firms see the filing on their own
  copy of the building; neither can open the other's), and Your permits for
  a broker shop, a development shop and a board wholly outside the swept
  cities. Still not built: any email, the parcel number as a second match
  key.

## Tracking your own permit (2026-09-27)

Owner's call: "add a way to add your own permit into the tracker and have
custom notifications that would notify you by email, and on compninja once
that step in the permit is complete." Migration **`054-permit-watches.sql`**
(`permit_watches`, `permit_watch_events`) — **run it before deploying**; the
failure is contained (the /permits section says it is unavailable, the
sweep's `summary.watches` carries a read error line) but the feature is dark
until it runs. Rules in the pure **`permit-watch.js`**
(`test/permit-watch.test.js`); the one-record read is permit-portals.js's
**`lookupPermit`** (the old tracker's `fetchFilingStatus` search, read for
the address and the record link too, `parseAccelaLookup` pinned against the
captured pages); the routes and the sweep hook are in server.js beside the
tracker's read; `test/permit-watch-run.test.js` runs all of it against the
stand-in and a stub portal. Eight rules:

- **Per member, not public record.** A watch carries `user_id`, and every
  route reads and writes `user_id=eq.` the signed-in member (a second
  member's PATCH/DELETE is a 404, pinned). The permit's own facts are copied
  from the portal onto the watch, deliberately NOT joined to
  `permit_filings`: a member's permit can be residential or older than the
  sweep window, and the sweep never stored it.
- **Only the cities the sweep reads** (`PERMIT_WATCH_CITIES`, from
  `PERMIT_SWEPT`): a Nampa permit would sit in the list never checked, which
  is §7's "claims we looked" per permit.
- **Looked up at add time.** `POST /api/permits/watch` searches the portal by
  number while the member is looking at the form: `found: false` is a 400
  naming the city and number (`code: "not_found"`); a portal error is NOT a
  refusal — the watch is stored with no status and a `check_error`, and the
  sweep reads it first (stalest-first, nulls first). Rate-limited 20/hour per
  account because each add is a live portal search; 25 watches per account.
- **Five steps, under-claimed.** `classifyStatus` maps free portal text onto
  Submitted / In review / Approved / Issued / Finaled, or onto NO step when
  the words do not say (the badge rule: never tell somebody "issued" when it
  is not). Order is the rule: "Ready to Issue"/"Prep for Issuance" are
  approved, "Final Inspection Scheduled" is issued, "Review Complete" is
  approved, "Incomplete" is attention. Flags: `attention` (returned,
  corrections, on hold) and `ended` (expired, withdrawn, denied, void, not
  approved). The raw status is always shown beside the steps.
- **A step completes once, ever** — `passed_steps` is the ledger. A jump over
  a step completes both (one notice names both), a drop back does not
  un-complete anything, and the add-time read marks every step so far passed
  WITHOUT a notice. A watch whose first status arrives on a sweep (portal was
  down at add time) records a `first` event with no notice.
- **The re-check rides `POST /api/permits/sweep`** (`checkPermitWatches`,
  called at the end of `sweepPermitFilings`) — CLAUDE.md rule 12, the renewal
  watch's "one trigger" argument. One lookup per (city, number) however many
  members watch it, paused like the sweep, capped at `SWEEP_CHECK_CAP` (200)
  per run. Its errors live in `summary.watches.errors`, NOT `summary.errors`,
  because the latter fails the scheduled workflow; the workflow prints the
  watch line and WARNS on its errors and on `mailOff`. The event row is
  written BEFORE the watch's new status, so a failed second write costs a
  duplicate next run, never a lost notice. `{ dryRun: true }` reads the
  portals and writes and sends nothing.
- **Marked after the send.** An event carries `email_due`;
  `sendPermitNoticeEmails` sends one email per member for every due, unsent
  event from the last `EMAIL_WINDOW_DAYS` (7), and stamps `emailed_at` only
  when `sendOutboundEmail` returns true. With `EMAIL_FROM`/`RESEND_API_KEY`
  unset nothing is marked (`mailOff: true`, `emailsPending`), the digest's
  trap avoided; a member who has since switched email off is skipped and
  the notice stays unsent. The email names the permit, the step, both
  statuses, the portal link, and where to switch it off (/permits).
- **"On CompNinja" is `app` + `seen_at`.** The unread count is `GET
  /api/permits/unread` (in `DESK_BOOT_URLS`), shown as `#navPermitDot` inside
  the Permit tracker row on BOTH nav authors (ACCOUNT_NAV_JS skips the fetch
  on /permits itself; index.html's `refreshPermitsDot`). /permits boots the
  member's watches as `mine` beside the feed (read in its own catch, so it
  can never cost the list) and clears the count with **`POST
  /api/permits/seen` from the page** once shown — never in the GET render,
  which may be a prerender (rule 15). `GET /api/permits/mine` returns the
  same payload. No file fallback (rule 4): every route is 503 without a
  database.

- **It is NOT on the Workspace** (2026-09-30, owner's call: "remove
  tracked permits from the workspace"). For one day from 2026-09-29 the
  Workspace carried a **Tracked permits** side card (`#deskTracked`,
  `renderTrackedPermits`) and one **Needs you** entry per permit with an
  unread notice (`deskPermitNotices`), both off `GET /api/permits/mine` in
  `DESK_BOOT_URLS`. All of it came off, and that URL left the boot list,
  since a workspace load that waits on a read nothing draws is pure TTFB.
  The code is in PR #346's history (fd98bb2) if it is ever wanted back.
  What stays: the rail's **`#navPermitDot`** (`/api/permits/unread`, still
  booted) is how a member hears about a step on CompNinja, and `/permits`
  keeps the **`#pw-<id>`** and **`?track=1`** deep links the card used, so
  a saved link still lands. **Your permits** (`#deskPermits`, filings at the
  firm's own buildings, above) is a different card and was not touched.
  `test/org-desk.test.js` pins the removal.

Not built: tracking a permit in a city the sweep does not read (it would need
the member to mark steps by hand, and a notice about a step you marked
yourself is no notice), a "check now" button (each is a live portal search),
and the parcel number as a match to the member's board buildings.

## Pro, and a permit tracked for the whole firm (2026-09-29)

Owner's calls, the same day: tracking is "pro tool only", and "firm owners can
set alerts to the whole firm if they want to but it is mostly for employees
tracking permits". Migration **`055-permit-watch-firm.sql`**
(`permit_watches.org_id`, `permit_watch_mutes`) — run it before deploying,
though the order is SOFT: the watch reads are `select=*`, the firm and mute
reads fail open to none, and the firm switch answers "unavailable" until it
runs. Rules in `permit-watch.js` (`canShareWithFirm`, `firmRecipients`,
`firmEvent`, the firm-aware `buildNoticeEmail` and `watchView`), tested in
`test/permit-watch.test.js`; the whole loop runs against the stand-in in
**`test/permit-watch-firm-run.test.js`** (the portal stub is shared with the
older suite through `test/helpers/permit-portal-stub.js`). Seven rules:

- **`canTrackPermits` is the gate, and it guards the doors in, never the
  way out.** Pro, tester, trial, comped admin and a firm seat have it; a
  single-report purchase and a dark deployment do not (`entitlements.js`,
  every branch — the trial and admin branches are early returns, so a key
  missing there reads as locked). `POST` and `PATCH /api/permits/watch`
  answer 403 `code: "pro_required"` without it and never reach a portal.
  Reading the list, `DELETE`, `/api/permits/seen` and muting stay open: a
  lapse locks the list, it does not take away the way out of it. The public
  filings feed on /permits is not behind it.
- **A lapsed member's own permits keep being checked.** The sweep does not
  read the owner's plan: the comped-team grant is a browser cookie the sweep
  cannot see, and gating on it would silence the team's own permits. What a
  lapse costs is adding and changing — the page shows the list with only
  Stop tracking, and a Pro line where the add button was. Revisit if lapsed
  accounts start mattering; the fix is an owner check in
  `checkPermitWatches` beside the colleague one.
- **A firm permit is the owner's watch with `org_id`, not a second watch.**
  One portal read, one status, one `passed_steps` ledger. Only an active
  **owner** attaches it (`canShareWithFirm` — narrower than
  `canManageMembers`, because the owner said owners, and a notice to every
  colleague is the firm speaking); detaching (`{ firm: false }`, "Just me")
  is always the watch owner's, and it deletes the colleagues' copies of its
  events so no phantom nav dot survives for a permit they can no longer open.
- **Events stay per recipient.** `checkPermitWatches` writes the owner's
  event, then one copy per colleague from `permitFirmRecipients` (roster,
  plans and mutes each read once per run, memoized as promises). A colleague
  is told only when their OWN entitlements carry `canTrackPermits`; never the
  owner twice; never a member who tracks the same permit themselves (their
  own watch already wrote their event — `ownWatcherIds` is the permit group
  `dueChecks` built); and not at all when the watch's owner is no longer an
  active owner of that firm. The email and the unread count then work
  unchanged, which is why `sendPermitNoticeEmails` now accepts an event whose
  `user_id` is not the watch's owner **only** when the watch carries a firm.
- **A mute is the member's veto** (031's rule). `POST /api/permits/mute`
  (`{ id, muted }`), not Pro-gated since it only makes the product quieter,
  404 for a permit not attached to a firm the caller is ACTIVE in, and 404
  for their own permit (their own settings are the control there). Muting
  clears that permit's unread notices and unsent emails. A muted member's
  events are still written, with `app` and `email_due` off, so the history
  reads whole if they unmute. **A failed mute read treats every colleague as
  muted for that run** — the member's veto is the one thing not to guess at.
- **The page says whose permit it is.** `watchView` takes a
  `viewerId` and returns `mine`, `firm`, `sharedBy`, `muted`; a colleague's
  card carries the firm tag and "tracked by …" with Mute as its only
  control. (The Workspace's Tracked permits card did too, until it came off
  on 2026-09-30.)
- **The email names the firm.** A permit that reached somebody through their
  firm reads "Tracked for Colliers Boise" and ends with how to mute it; the
  owner's copy reads as their own.

## Adding several permits at once (2026-09-30)

Owner's call: "create an option to bulk upload permits." An **Add several**
button beside Track a permit on /permits opens a form that takes a pasted list
or a CSV / Excel file, and **`POST /api/permits/watch/bulk`** adds them. No
migration: the rows are ordinary `permit_watches`. Rules in the pure
`permit-watch.js` (`parseBulkPermits`, tested in `test/permit-watch.test.js`);
the route runs against the stand-in and the portal stub in
**`test/permit-watch-bulk-run.test.js`**. Five rules:

- **Two passes, the count before the button** (the bulk valuation's rule).
  `{ preview: true }` parses and answers `permits` + `skipped` (each with its
  row and reason) and asks no portal; the page shows both and the button
  becomes "Track N permits". Editing the list or the city sends it back to
  the first pass, so what is added is what was shown. An .xlsx (base64,
  `xlsxGridFromBase64`, 1 MB, untyped) comes back as CSV `text`, which the
  page puts in the box and sends on the second pass.
- **Each permit is looked up exactly as the one-permit form does**:
  `found: false` is not added and is named in `notFound`; a portal error is
  stored unchecked with its `check_error`. Lookups run one at a time with the
  sweep's pause; past `BULK_LOOKUP_BUDGET_MS` (45 s) the rest are stored
  unchecked for the weekday sweep (stalest-first reads them first), so a slow
  portal costs a delay, never the request.
- **Nothing is guessed.** A header row (a cell says permit / number / record)
  maps City / Permit number / Nickname columns; without one, a city cell, the
  first cell shaped like a number (it has a digit), and the next cell as the
  nickname. A row with no city takes the form's city. A city we know but do
  not read (Nampa, `otherCities`) is SKIPPED with the reason, never filed
  under the form's city. Repeats, permits already tracked and rows past the
  25 cap are skipped by name.
- **Same gates as the one-permit POST**: `canTrackPermits` (403
  `pro_required` before anything is read), the swept cities, the account's own
  rows, the 25 cap. Rate-limited 5 lists/hour per account (the cap already
  bounds a list to 25 portal searches). `firm: true` attaches the member's
  OWNED firm to each new permit (`permitFirmContext`, 403 otherwise).
- **Adding announces nothing** — `newWatchRow` marks the steps so far passed
  without an event, as on the one-permit form.

## The permit section on the market pages (2026-10-01)

Owner's pick of Draft C ("do C") from the Permit Pulse drafts
(https://claude.ai/artifact/2FXBSapUFj6hbKjMi53oz2): every market page in a
city the sweep reads gets **Building permits in <City>** after "What's
driving prices": four figures (filed a month, tenant build-outs, new
buildings, the typical wait), a 12-month bar chart, a "how long until they're
issued" chart, four plain-English reads (leasing demand, new supply, how busy
the city is, voided permits) and the other swept city beside it. Rules and
HTML in the pure **`permit-pulse.js`** (`test/permit-pulse.test.js`); the
cached read is `PERMIT_PULSE` / `refreshPermitPulse` / `permitPulseFor` in
server.js; `test/permit-pulse-run.test.js` runs the pages against the
stand-in. No migration. Six rules:

- **Three answers, never a zero.** A swept city (Boise, Meridian) gets the
  section; a city whose portal we know but do not read (Nampa) gets one
  sentence naming the cities we do read, linked to their same-type market
  pages where those exist; any other city gets nothing. A failed read, an
  empty cache or a thin table is no section, never "0 permits" — §7 again.
- **Only a contiguous run of complete months is drawn.** It ends last month
  (the current month is partial: it never draws a bar or counts toward the
  pace, though its permits count toward the wait), goes back at most 12, and
  stops at the first month with no filing at all, because in these cities
  that is a month the sweep has not read, not a quiet one. Under six months
  and `buildPulse` answers null.
- **The wait is estimated across the year, and the page says so.** The
  portals list a filing date and today's status, never an issue date, so the
  wait is the age at which half the permits of that age are issued today,
  in 14-day buckets, made non-decreasing. A bucket under 5 permits says
  nothing; a curve whose first usable bucket is past ~5 weeks (`ANCHOR_DAY`)
  has no wait (null, shown as a dash with a reason) and draws no line: the
  chart says "Too few recent <kind> in <city> to draw its line" under it
  instead (`drawablePoints`, the one rule this section and /permits/compare
  both draw by; it used to float a short stroke around day 90 for Boise's new
  buildings, fixed 2026-10-01). Voided and withdrawn permits are left
  out of it. The status words are permit-watch.js's `classifyStatus`, so
  "issued" means one thing across the tracker and this page. Later:
  `permit_filing_events` now record real status-change dates for every
  stored permit, so an exact wait becomes possible once a year of them exists.
- **Every commercial permit, of every property type,** and the source line
  says so: the industrial and office pages show the same city figures until
  permits can be split by type (needs zoning per permit; the backfill rows
  have none).
- **Never waited on.** `PERMIT_PULSE` is MARKET_INTEL's stale-while-
  revalidate: warmed at boot, refreshed after a TTL (30 min) or right after a
  sweep that wrote, paged by id past PostgREST's 1,000 rows, filtered by
  JURISDICTION. A failed read keeps the last pulse and retries after a minute.
- **"See each permit" says it needs an account** for a signed-out reader
  (`/?auth=signup`); a member goes to `/permits`.

**The history pass** is what feeds it. The sweep's own window is four days,
so a permit used to be read once and its status never again. The history pass
re-reads whole calendar months of listings (`historyWindows` in
permit-filings.js) and is reached three ways:

- **`{ history: "rotate" }`** — this month and last month every time, plus
  one older month stepping a calendar day at a time over the eleven before
  (any 22 days reach every one on a weekday). The weekday workflow sends it as
  a SECOND call, `{ only: "history", history: "rotate" }`, after the short
  sweep: one month of one city's listings is about 100 seconds of portal reads
  at the two-second pause, so the two calls each get their own time budget.
  `only: "history"` skips the short window and the tracked permits.
- **`{ history: "all" }`** — every month of the last year: **the one-off
  backfill, run once after this ships** (the workflow's Run workflow button,
  history = all). About 45 minutes of portal reads, so it answers **202 at
  once and runs in the background**; no request, workflow or proxy waits that
  long. The running flag still holds a second sweep off (409), and its summary
  lands in `lastSummary` like any run (/admin, `/api/stats` →
  `permits.lastRun.history`). A deploy mid-run cuts it short; run it again,
  since every write is idempotent.
- **Nothing** — a plain `POST /api/permits/sweep` (the /admin button, the
  first workflow call) reads no history, exactly as before.

`sweepCityWindow` is the one per-city routine both passes share. A permit the
history pass has never seen is stored; only one filed inside the tracker's
30-day window gets the detail-page and zoning reads (40 a run), so the feed
keeps its applicants; older ones are stored from the listing alone (no
applicant, contractor, parcel or zoning; `is_industrial` from the keyword).
Status moves become `permit_filing_events` exactly as before. Its errors live
in `summary.history.errors`, which the workflow WARNS on, never in
`summary.errors`, which fails it.

## Permit alerts (2026-10-01)

Owner's pick of Draft B from the Permit Alerts drafts
(https://claude.ai/artifact/BnbuAaxmGu5xKyYPieiC3i): **Your alerts** on
/permits, under Your permits. A member saves what they follow — a city (or
every city we read), a property type, a kind (tenant build-outs or new
buildings, permit-pulse.js's grouping) and optional words — and gets the new
permits that fit it by email each weekday morning. Migration
**`057-permit-alerts.sql`** (`permit_alerts`), run before deploying (the
order is soft: the section says it is unavailable and the sweep carries a
named line until it runs). Rules in the pure **`permit-alerts.js`**
(`test/permit-alerts.test.js`); routes `POST|PATCH|DELETE
/api/permits/alerts`; the email is `sendPermitAlertDigests` at the end of
the sweep; `test/permit-alerts-run.test.js` runs all of it. Seven rules:

- **Per member.** Every route is `user_id=eq.` the signed-in member (a
  second member's PATCH/DELETE is a 404, pinned). 10 alerts each.
- **Pro to add or change, never to delete** — `canTrackPermits`, the tracked
  permits' gate and reasoning. The feed itself stays free.
- **Only the cities the sweep reads**, and only the property types the form
  offers (permit-zoning.js's list less "Other", which is the absence of a
  type). A blank name is made from the filters (`defaultName`).
- **"New" means STORED after the alert's `notified_through` and FILED within
  `EMAIL_FRESH_DAYS` (14).** Stored, because the sweep reads a portal a day or
  more late and a late read is still news; filed recently, because the history
  pass stores old permits it never saw. The mark starts at the alert's
  creation and moves to now when its filters change, so neither saving nor
  widening an alert ever mails the past.
- **One email per member, marked after the send** (rule 12). It rides the
  sweep's FIRST call (never the history-only one), after the short window has
  stored today's permits; `cutoff` is taken before the read, so a permit
  stored meanwhile is the next run's. Mail off: nothing sent, nothing marked,
  `mailOff` in `summary.alerts`, which the workflow warns on and never fails
  on. Like tracked permits, a lapsed member's alerts keep being sent (the
  comped-team cookie is invisible to the sweep); revisit beside that rule.
- **The page draws the counts and the tags itself**, from the feed it already
  has: "N new this week" is the alert's permits filed in the last seven days,
  and a permit in the list carries the first alert it fits. That uses
  `alertMatches` in permits-page.js, a **⚠ pair** with `matches` here,
  pinned by a test that runs both over the same permits.
- **Each feed permit now carries `kind`** (`permitTrackerPayload`), so the
  page matches on the same word the server does.

Not built (step 2 of the owner's ask): an area within a city ("within a mile
of an address") — needs coordinates per permit; see the conversation's plan:
parcel location from the Ada County query the sweep already makes, Census for
the backfilled rows.

## Area alerts (2026-10-01)

Step 2 of permit alerts, the owner's pick of Draft B from the Permit Area
Drafts (https://claude.ai/artifact/Xkc7kR96LS2ExjdaY1bH5V): an alert may also
follow a circle — within ½, 1, 2 or 5 miles of an address — and every permit
gets a place on the map to be inside it. Migration **`058-permit-areas.sql`**
(`permit_filings.lat/lng/geo_source`, `permit_alerts.area_*`), **deploy order
HARD**: the sweep's insert names the new columns and its locate step filters
on one, so an unrun 058 fails every city's sweep. The routes and the email
are permit alerts' own; `test/permit-areas-run.test.js` runs all of it
against a Census stand-in. Six rules:

- **One place per permit, and where it came from.** A permit the sweep reads
  in full gets its parcel's center point from Ada County's parcel layer, on
  the SAME request as its zoning (`returnCentroid`, `outSR=4326`, no outline:
  750 bytes; `parseParcelAnswer` returns `lat/lng`, `geo_source "parcel"`).
  Every other stored permit (the history pass's backfill, a parcel the county
  could not answer) is placed by `locatePermitFilings` through the Census
  geocoder (`geo_source "address"`), newest first, 60 on the weekday's first
  call and 300 on the history-only call. Census placed 99 of the last 111
  permits when this was drafted; the misses were a new site whose road Census
  does not have yet and bare Meridian street lines, which is why the parcel
  point comes first.
- **A miss is marked; an outage is not.** No match is `geo_source "none"`,
  never asked again. `censusPlace` calls Census directly rather than through
  `geocodeCensus`, which answers null for an outage and a miss alike; three
  failures in a row stop the step and mark nothing more. Its problems live in
  `summary.located`, which the workflow warns on and never fails on.
- **The address line** is `geocodeLine` (permit-filings.js): the street line
  without a suite, with the jurisdiction's city added where the portal left it
  off. An alert's typed address gets the alert's city the same way, in the
  route (`placeAlertArea`) and in the page's live preview.
- **An area is placed once, when the alert is saved** (POST or PATCH; the
  site's own `geocodeCensus`), stored as the geocoder's matched address and a
  point. An address it cannot find is a 400 naming it. Moving, widening or
  dropping the circle moves the email mark to now, like any filter change.
- **A permit with no place never matches an area**, and the page says how
  many of the list's permits could not be placed, so a quiet area reads as
  quiet. The distance rule is in `matches` and in the page's `alertMatches`
  (with `alMiles`) — the ⚠ pair, pinned on areas too.
- **Maps load only when opened** — the form's map once an address is found,
  a saved alert's "Show on map". Leaflet comes from the CDN the market pages
  use, the tiles from CNBASE (BASEMAP_JS, sent in /permits' head with
  LEAFLET_DARK_CSS), and several permits at one address (a campus) are one
  dot with its count. With the CDN blocked the form still works.

## Comparing cities (2026-10-01)

Owner's call: "add a way to compare cities or markets by the permit
information for the permit scraper." **`GET /permits/compare`**, linked from
the /permits header ("Compare cities →") and, for a signed-in member, from
under the market-page section's "Next to …" table ("Compare the cities in
full →"; a signed-out reader keeps that section's one sign-up door). Rules and
HTML in the pure **`permit-compare.js`** (`test/permit-compare.test.js`); the
read is `permitComparePayload` in server.js; `test/permit-compare-run.test.js`
runs the page, its two doors and the thin case against the stand-in. No
migration. Seven rules:

- **The market pages' pulse, not a second read.** Every figure is
  `PERMIT_PULSE.byCity` (permit-pulse.js's `buildPulse`), so a number here and
  the same number on a city's market page are one number. `buildPulse` now
  also carries `curves.all` / `waits.all` (every live permit) for this page's
  "All permits" wait; the market section still draws only its two kinds.
- **A member page may wait; a market page never does.** `refreshPermitPulse`
  now returns its in-flight promise (the flag clears in a promise callback, so
  a read that fails at once cannot leave it stuck), and a cold cache (nothing
  read yet: the first seconds after a deploy) is waited on for up to 8 s rather
  than called unavailable. A sweep that wrote zeroes fetchedAt, which is NOT
  cold: the cached pulse answers while the re-read runs behind it.
- **The tracker's door.** Signed in, like /permits; no database is "the permit
  tracker is unavailable"; no plan gate (public record). `permits_compare_visit`
  goes through `logPageVisit` (rule 15; `test/instant-nav.test.js` counts it).
- **Two cities or a sentence.** Only a city with a pulse (six complete
  months) is compared; one city, or none, is a sentence naming what is
  missing, never a column of zeros. Every swept city with a pulse is a column,
  so switching Nampa on adds it with no code change.
- **Cities, not property types.** Every commercial permit, and the page says
  why: a permit's type comes from its parcel's zoning, which the history
  pass's backfill does not have, so a per-type count would rise month by month
  as zoned permits replaced unzoned ones — a trend made by the sweep. Split by
  type once the backfill is zoned (the permit-pulse section's own "Later").
- **Colour follows the city.** A city's slot is its index in
  `JURISDICTION_KEYS` (Boise blue, Meridian orange, Nampa aqua), never its
  place on the page; the three hues were run through the dataviz validator
  all-pairs against `--card` in light and dark. Text stays ink; the colour is
  on the line, the dot and the small key beside a city's name. One axis:
  "Against its own average" indexes each city to 100 = its own monthly mean.
- **The words claim only what the numbers carry.** Counts within 15% are
  "about the same", trends within five points get no verdict, waits within
  five days are "about the same time", shares within three points are
  "similar"; a city filing under two-thirds of the busiest gets "its
  percentages swing more". A wait line is drawn only when its first usable
  point is within ~5 weeks (halfwayDays' anchor); otherwise the chart says
  "Too few recent … in <city> to draw its line" instead of floating a stub.
  The rule is permit-pulse.js's `drawablePoints` (with `ANCHOR_DAY` and
  `WAIT_MAX_DAY`), shared with the market section's chart.

The toggles (kind: all / build-outs / new buildings; scale: count / own
average) are progressive: the server draws every variant at both widths and
marks all but the defaults `hidden`; the script only flips `hidden`, reveals
the buttons, and draws the hover tooltip. "Each month's numbers" is the line
chart's table view. MARKET_CSS styles every `table`/`th` as the comp table
(640px floor, washed upper-case `th`), so the page overrides both inside
`.pc-page`; on a phone the side-by-side table is fixed-layout so every city
stays on screen.

## Nampa, from the reports the city publishes (2026-10-01)

Owner's call: "Add Nampa to the Permit scraper." Nampa's live portal (Tyler
EnerGov) still answers 403 to any agent that is not a web browser — re-checked
2026-10-01 with the sweep's own honest agent, with and without a browser-style
prefix. **Disguising the sweep as a browser was chosen by the owner and refused
by the session's permission system; do not reintroduce it.** The owner then
picked reading the city's own published reports. cityofnampa.us serves them to
the named agent: its **Permit Reports page**
(`https://www.cityofnampa.us/427/Permit-Reports`) links a monthly *Commercial
Permit – Plan Review Status* PDF (every commercial application that month,
with its date in, the status on the report's date, project, address,
applicant, scope, value) and weekly and monthly *Permit Activity* PDFs (every
permit issued, with the companies on it). No migration: the rows are ordinary
`permit_filings`, with `status_changed_at` carrying the date a status was TRUE
on and `source_url` the report it came from. Rules in the pure
**`permit-reports.js`** (`test/permit-reports.test.js`, against reports
captured 2026-10-01 under `test/fixtures/nampa-reports/`) and the zero-dependency
**`pdf-text.js`** (positioned text and ruled lines out of a PDF; Node's zlib only;
throws `pdf-unsupported:` for encrypted files and object streams);
`sweepReportCity` in server.js; `test/permit-reports-run.test.js` runs it all
against `test/helpers/nampa-reports.js`, which writes real PDFs in the city's
layout dated relative to today (the parser suite proves they parse exactly like
the captured ones), and every portal stub hands Nampa's paths to it, by default
one empty report, so a suite about Boise reads Nampa cleanly. Eleven rules:

- **The registry says how a city is read.** `nampa` carries `via: "reports"`,
  `reportsUrl`, `reportsOrigin` and `portalBlocked`; `PERMITS.REPORT_KEYS` is
  the reports cities, `PERMITS.LOOKUP_KEYS` the portal cities. `SWEEP_KEYS`
  includes Nampa, so every read of `permit_filings` (feed, market section,
  compare page, building sheet, Your permits, alerts, the locate step) has it.
  The EnerGov client and its tests stay: switching back the day the portal
  answers a named agent is dropping `via` and the reports fields.
- **Which reports a run reads.** The weekday call (`mode: "newest"`) reads the
  newest `NEWEST` (6) by DocumentCenter id — the id grows with each upload, so
  a batch of late weeks posted together still fits, and a posted report never
  changes. The history call (`"backfill"`) reads every report inside the
  market section's window only while the table lacks the oldest plan review
  month there (one index request a day after that); `history: "all"` always
  re-reads the window. The backfill reads each covered month's monthly activity
  report instead of its four weeklies.
- **Stored only from a plan review row**, the one with a filing date. An
  activity row updates a permit the table holds (issued, its contractor, the
  full address) and is counted (`issuedUnfiled`) otherwise.
- **A filing date the city did not record drops the permit.** The January 2026
  report carries 2025 permits migrated into the new system with a Date In of
  01/01/2026 (a holiday), some issued months before it: a date in on January 1,
  or after the issue date, is no filing date (`realDateIn`).
- **Intake failures are not filings.** As of the report they were refused at
  intake, and they come back under new numbers (The Highline's March buildings
  were refiled in April): counting them counts a project twice.
- **Only the kinds the portal cities count** (`kindOf`). Boise's and Meridian's
  sweeps read new and added buildings, shells, additions, tenant improvements,
  racking and modular buildings; Nampa's report lists every commercial permit.
  A Nampa permit is stored only when its project name and scope NAME one of
  those kinds, with the portals' own labels ("Tenant Improvement", "New
  Commercial", "Commercial Addition", "Commercial Modular", "Rack/Shelving"), so
  permit-pulse.js groups them with no Nampa rule. Left out: re-roofs, fences,
  solar, carports, pergolas, signs, demolitions, "occupancy only / no work",
  civil site-only permits (the building has its own permit), and
  **multi-family** (apartments, 3-/4-plexes, walk-ups, residential care
  homes), which the registry keeps off in both portal cities on purpose. Of
  425 plan review rows Jan–Aug 2026, 123 were kept. Under-claim: words that do
  not say are left out, never guessed into a kind.
- **A status replaces the stored one only when it should**
  (`shouldReplaceStatus`, used by the merge and by the sweep): newer wins;
  an ISSUE in an activity report beats a plan review snapshot that missed it
  (issued Sep 2, still "In Review" in the Sep 3 report); an issued permit is
  never walked back to an open step, only ended by a newer void. Events are
  dated the day the status was true (an issue's own date), never the read.
- **The address is split for the match key.** The activity report prints
  "993 S Almond St Nampa, Id 83686"; `situsAddress` makes it
  "993 S Almond St, Nampa, ID 83686", so the street line is the street alone.
- **Measured where the data stops.** Nampa's market-section pulse
  (`reportCityPulse`) runs to the newest month its plan review reports cover
  and is measured at the newest date any report is true on (`buildPulse`'s
  `through` and `now`). The section, the compare page and the building sheet
  name the city's reports and say they run about a month behind; the feed's
  Nampa window is the last thirty days its reports cover (`trackerFeed`'s
  `windowFrom`, `reportCities` in the payload) with each permit's true age.
- **Not trackable by number.** A report cannot look up one permit, so
  `PERMIT_WATCH_CITIES` is the portal cities: the add form, the bulk upload
  ("We can't track Nampa permits by number yet…") and the POST all refuse
  Nampa, and /permits says why.
- **Alerts wait longer for Nampa.** Its monthly report lands up to a month
  after a filing, so its permits are news for `REPORT_FRESH_DAYS` (45) instead
  of 14 (`digestFor`'s `lateCities`).

A Permit Reports page that fails, or every picked report failing, is
`summary.errors` (the scheduled job goes red, as for a portal redesign); one
unreadable report among several is a line in `cities.nampa.reportErrors` on the
weekday call and in `history.errors` on the history call. Not built: the city's
zoning (Canyon County has no parcel service wired, permit-zoning.js), so
Nampa's property type comes from the words; and its Census placement rides the
ordinary locate step.

## The tabbed page (2026-10-02)

Owner's pick of Draft C ("do C") from the Permit Tracker Drafts
(https://claude.ai/artifact/762RCzFWGbnb7PrwcshtkA), asked for as making the
page "look less vibecoded". /permits had grown one feature at a time into three
stacked boxes (Your permits, Your alerts, Every commercial filing), each opening
with a paragraph, four number tiles, and Georgia addresses whose old-style
digits drop below the line. It is now three tabs in `permits-page.js`, same
routes, same boot, no migration. Where an older section above says "under Your
permits" or "the list below", read "on its own tab". Seven rules:

- **Which tab opens.** `startTab()`, in order: `#pw-<id>` (that permit's card,
  on Your permits), `?track=1` (Your permits with the add form, for a member
  who may track and has room), a tab named in the hash (`#filings`,
  `#your-permits`, `#alerts`; a tab click writes it with `replaceState`, so a
  reload stays put), then Your permits when `mine.unread > 0`, Filings
  otherwise. Both deep links are the Workspace's old ones and still land.
- **Seen is sent only when Your permits is shown** (`markSeen`, from
  `showTab("mine")`): news on a tab nobody opened stays unread. Still the one
  fetch POST (rule 15). `test/permits-page.test.js` runs the page's own script
  against a stand-in DOM to pin which tab opens and when the POST goes.
- **Filters, not menus.** The Filings tab's groups: city, property type (all
  six with counts, zero included, the 2026-09-29 rule), work (`kind`), status
  (`stage`), permit type (the portal's own type, the menu the owner kept), and
  your firm's buildings. OR within a group, AND across; counts are the whole
  window's. On a phone each group is a button that opens its list. The four
  number tiles are gone, and with them their "in the last 7 days", which
  counted `daysAgo <= 7` (eight days) while alerts' "new this week" counts
  `<= 6`.
- **A status's stage** is `stageOf` in permit-watch.js (open / attention /
  approved / issued / ended, from `classifyStatus`): the colour of every status
  tag and the Status filter. `permitTrackerPayload` puts it on each filing and
  `watchView` on each watch, so the page never reads portal words itself. The
  tag always shows the portal's raw status.
- **The timeline's dates are when we SAW a step**, `stepSeenAt` in
  permit-watch.js on `watchView`'s `steps[].at`: the first status change whose
  new status reaches the step when its old status had not. A step passed
  before the permit was tracked, or at a `first` read, has no date. Read from
  the statuses, never from an event's `steps`, which hold only the steps the
  member asked to hear about.
- **Alerts show what they found.** Each alert lists its three newest matches;
  "See all N in Filings" clears the filters and filters the list to that alert
  (`ALERT`, a removable chip). Filing rows still carry the first alert they fit
  (the ⚠ pair `alertMatches`, unchanged). The Pro member's first visit no
  longer opens the New alert form with Boise and Industrial filled in; New
  alert is a button.
- **Capitals read normally.** `tidy()` puts an all-capitals portal or geocoder
  address ("8000 S FEDERAL WAY") in ordinary case for display, keeping
  directions, the state and anything with a digit; an area alert's stored name
  and summary are tidied the same way on the page (`alCaps`). Nothing stored
  changes, and search still reads the raw text.

---
paths:
  - "permit-*.js"
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
  - **Nampa ships switched off** (`sweep: false` in the registry, with the
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

- **It shows up on the Workspace** (2026-09-29, owner's call: when a step
  the member asked about is hit it "shows up in your workspace"). Two
  surfaces in index.html, both drawn from ONE read, `GET /api/permits/mine`
  (in `DESK_BOOT_URLS`, so it ships with the page): the **Tracked permits**
  side card (`#deskTracked`, `renderTrackedPermits` its one writer — each
  permit's five steps as pips from `watchView`'s ledger, the one with an
  unread notice first and marked New, empty state a door to
  `/permits?track=1`) and, for a member of a firm, one **Needs you** entry
  per permit with an unread notice (`deskPermitNotices`, between the lease
  dates and the messages; the banner line counts them). Four rules. **Per
  member, so it does not wait for a firm**: the card starts in
  `renderShares` before the signed-out exit and sits in `#deckSide`, which
  `refreshDeckVisibility` then shows for a member in no firm. **Looking is
  not seeing**: nothing on the Workspace posts `/api/permits/seen`; each
  row links to `/permits#pw-<id>` (the card's own id, scrolled to and
  highlighted), and that page clears the count as before. **A failed read
  hides the card and sets `deskPermitNotices` to null**, and the agenda
  then says "Couldn't read permit updates" rather than "Nothing needs
  you" — the outage-as-absence trap. **Presentation only**: the steps, the
  flag and what is unread are `watchView`'s; the Workspace re-decides
  nothing. `test/org-desk.test.js` runs both surfaces against fixtures
  built by the real `watchView`.

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
- **The page and the Workspace say whose permit it is.** `watchView` takes a
  `viewerId` and returns `mine`, `firm`, `sharedBy`, `muted`; a colleague's
  card carries the firm tag and "tracked by …" with Mute as its only
  control. The Workspace's Tracked permits card lists firm permits too
  (same `/api/permits/mine` read) and hides outright for an account that
  cannot track and tracks nothing, since its only content would be a door
  onto a Pro gate — with `deskPermitNotices = []`, never null, because the
  read succeeded.
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

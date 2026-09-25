---
paths:
  - "permit-*.js"
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

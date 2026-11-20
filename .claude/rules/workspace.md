---
paths:
  - "index.html"
  - "home-map.js"
  - "home-sites.js"
  - "test/home-map.test.js"
  - "test/home-sites.test.js"
  - "test/org-desk.test.js"
  - "test/desk-*.test.js"
  - "test/home-head.test.js"
  - "test/auth-boot.test.js"
  - "app-page.js"
  - "test/app-page.test.js"
---
# The signed-in Home (`/desk`)

The signed-in member's Home: one list beside one map, drawn by `index.html`,
plus how that page is served (`DESK_BOOT`, `AUTH_BOOT`, `/app.<hash>.js`).
Full detail and history: `docs/rules-detail/workspace.md` — read the matching
section there before a non-trivial change to this area.

## What exists now

- **Home** is `/desk`, and `/` for a signed-in member. `#homeMap` is the
  first child of `#myDesk`: a list with tabs Today, Properties, People (the
  URL fragment: bare path, `#properties`, `#people`) beside a Leaflet map
  whose switch (`#hmLayers`) shows Properties or Permits, one at a time.
  `drawHomeMap()` draws it; `resetHomeMap()` rides `hideAll`.
- **`home-map.js`** (pure, dual-exported, global `HOMEMAP`, `maxAge: 0`): what
  goes in the lists and on the map (`properties`, `agenda`, `scopeOf`,
  `statusLine`, `landsHere`, `glance`, `later`, `movers`, `ownedTotal`,
  `stacks`, `dealsOn`, `addWhere`, `readLayers`, `layerNotes`, `permitAt`,
  `wheelGesture`).
- **`home-sites.js`** (`HOMESITES`): the pane under a member's own row and
  the add form in `#hmMineAdd`; `/home-sites.css` is shared with `/sites`.
- **index.html, the list**: firm row `#hmFirmHead` (`drawFirmHead`,
  `saveFirmLogo`, `#hmFirmGear` opens `openFirmModal`); greeting
  (`deskGreetingFor`, `drawDeskClock`); find box `#hmFind`; quiet Today
  `#hmBrief`; `#hmNext`; `#hmTodayEmpty`; start screen `#hmFirst`;
  `#deskContacts` under People; `#buildingAddForm` behind "Add a property".
- **index.html, the map**: `hmDrawPins`, `hmSetView`, `hmSelect`, `hmPin`;
  permits from `GET /api/permits/map`.
- **The fill**: `renderMyDesk` → `renderHomeFirm` (was `renderShares`) →
  `renderDeskRest`, read through `bootFetch`. DOM-free reads
  `readFirmBuildings()`, `renderDeskThreads()`, `readFirmCritical()` fill
  `firmBuildings`, `deskThreadsStat`, `deskCritical`.
- **The search view** (`showHomeView`): the one real `#compForm` and
  `#historyDeck`.
- **`server.js`**: `deskBootPayload` / `deskBootScript` (`<!--DESK_BOOT-->`,
  `DESK_BOOT_URLS`, `DESK_BOOT_ORG_URLS`, `DESK_BOOT_DEADLINE_MS`);
  `authBoot()` (`<!--AUTH_BOOT-->`); `pagePath`; `loadAppPage()` with
  `app-page.js`; `orgLogoRevs`, `GET /api/org/logo`.

## Rules and traps

**Copy and removed things**
- Copy says "Home", never "Workspace" or "Vault"; ids, routes, tables and
  module names keep "desk"/"vault".
- No longer exist; do not reintroduce: a Comps tab or layer on Home or any
  read of `GET /api/vault` there; a Reports tab or Sharing card (Messages'
  Reports view now, report-inbox.js); a "Both" map view; a comp report door
  on Home; links to `/vault…` or `?add=own`; the old Home (banner, skyline,
  figure strip, agenda card, decks, buildings table, deal board, Your
  permits); an "Owned" chip on rows under the Owned heading.
- Saved `/desk#comps` goes to `/comps`, `/desk#reports` to `/messages#reports`.
- `/run-report` answers but is in no nav. The footer's "Run a report" points
  at `/` on purpose (`/bulk` would be a Pro gate for a stranger).

**Serving index.html**
- index.html stays ONE file on disk: Tailwind finds classes in its JS
  strings and tests read it from disk.
- Only the one big plain `<script>` moves; give it an attribute and the page
  is served whole with a logged warning.
- Every serve-time marker stays in the page half, never inside the script (it
  would be cached a year with one visitor's value). `test/app-page.test.js`
  pins the list; add a new marker there.
- A stale hash gets the current script `no-store`, never a 404.
  `EXTERNAL_APP_SCRIPT=off` is the rollback.
- A test of what the app DOES reads `servedApp()`
  (`test/helpers/served-app.js`), never the page text alone.
- A new page route matches on `pagePath` (`test/routes.test.js`).
- Never 302 `/desk` to `/`: its links carry query strings (Stripe returns).

**Boot (`AUTH_BOOT`, `DESK_BOOT`, one paint)**
- The boot decision, `showDeskView` and `applySearchLock()` read
  `looksSignedIn()`, never `currentUser` alone; `accountWall` is seeded from
  the boot object. `/r/<id>` is excluded by name; `popstate` mirrors it.
- `AUTH_BOOT` keys on cookie presence, safe only because index.html is
  `no-store`. `refreshAccountUI()` must retire `cn-in`/`cn-locked` on every
  path, or an expired session cannot sign back in. `test/auth-boot.test.js`.
- `DESK_BOOT` (never for `/index.html` or `/r/<id>`) is never a second copy
  of a read: each entry is the route's own answer over loopback with the
  visitor's cookie. A 401 on `/api/account/me` drops the payload whole; one
  deadline covers the fan-out; only status-200 JSON GETs under
  `DESK_BOOT_MAX_BODY`, with the visitor's IP on `x-forwarded-for` and
  `x-cn-desk-boot` so it cannot nest; `<` is escaped in the JSON.
  `test/desk-boot-run.test.js`, `test/desk-boot.test.js` (hold the two URL
  lists together).
- `bootFetch` hands each embedded answer to its FIRST caller and deletes it:
  never read a section's route twice; draw from state already parsed.
- `initGate` must not re-run the desk fill (`refreshAccountUI`'s call is the
  fill; `refreshProConfig` keeps the checkout-return repaint).
- One paint (`test/desk-one-paint.test.js`): a repeat call for the same
  identity never re-hides (`deskFilledFor`); a stale fill reveals nothing;
  `renderDeskRest` returns its batch and swallows a rejection;
  `DESK_FILL_MAX_MS` races it. Every early exit awaits the membership read
  before `hideAll()`, or the in-flight read undoes the hide.
- The desk branch alone sets `history.scrollRestoration = "manual"`
  (`test/desk-scroll.test.js`).
- A report yields Home at BOTH seams, `renderResults` and `beginAssembly`.
- `showDeskView()` hides `#searchSection` and `#historyDeck`; the history
  deck is revealed in exactly two places and hidden at three seams
  (`test/index-html.test.js` counts both).
- A pending landing address (`pendingLandingAddress.v1`) keeps a member on
  the search view; the boot block only READS the key.

**Reports opened from Home**
- `openPortfolioItem` and `openHistoryReport` leave through
  `leaveDeskForReport()`; only `rerunHistory` uses `leaveDesk()` →
  `showHomeView()`.
- `reportOnly` is declared beside `accountWall` (temporal dead zone);
  `setReportOnly` is its one writer, `applySearchLock` its one reader. The
  form is hidden, never removed: restores write it and the hero reads it.
- `refreshPortfolioItem` fills and submits the hidden form without leaving
  Home. `test/report-from-home.test.js`.

**Values and privacy**
- One plan gate: `drawHomeMap` passes `hmRows` through
  `HOMEMAP.withoutOwnValues` when `hmShowValues()` is false. Never add a plan
  check to a value surface; a new writer of `hmRows` goes through the gate (a
  test counts writers). Only an owned row's `value`, `valueNote`, `change`
  go; a deal's asking price stays.
- `hmShowValues()` reads `proConfig.portfolioValues` in try/catch and fails
  closed. `initGate` redraws Home when `/api/config` lands late.
- The Owned head's "Estimated values are part of Pro" is held to the pricing
  window's words by a test; "See plans" only when `hmCanBuy`. The owned sum
  is `HOMEMAP.ownedTotal` written with `HOMESITES.short` on both tabs.
- Private addresses geocode only through `geocodeAddress(…, { noThirdParty:
  true })`, at most 40 per view; `hmGeoTried` stops a retry loop. Photos only
  through POST `/api/building-photo` (`hmPhoto` the one writer; an empty box
  while loading, never the aerial; maps.md).
- Every list is built with createElement/textContent. A stack's words go in
  the marker's `title` (a DOM property), never markup.
- `hmLoadLeads` must keep `?noseed=1`: without it that GET WRITES coverage.
  `hmCanLeads = hmCanVault()` and not a development firm.
- Reads that wait for the page to be shown (`hmWhenShown`), never in the
  boot: permits, leads, the first screen's markets.
- `GET /api/org` carries `logoAt`, never the logo (it ships in every
  `DESK_BOOT`). `saveFirmLogo` READS `GET /api/org/branding` and PUTs it back
  whole, because the PUT replaces the profile.

**The list**
- One writer each: `drawHomeMap` (`#homeMap`), `drawFirmHead`, `hmDrawBrief`
  (before `hmDrawNext`), `hmDrawNext`, `hmFirstShow` (`#hmFirst`,
  `.hm-first-on`), `hmSetLayer` (`hmLayers`, `cn.home.layers` in try/catch),
  `markNavCurrent` (`html.hm-page`), `setContactAddOpen`.
- Home's state `let`s (e.g. `hmLater`) sit above `resetHomeMap`: below a
  function the boot path calls is a temporal dead zone throw.
- home-map.js: ONE row per property; every row says who can see it
  (`scopeOf`); a property always shows a status. Deals only for a development
  firm (`dealsOn(firmKind)`); a Tracking property is The Board's, not Home's;
  a shared deal (migration 061) is listed only for its owner here.
- "Nothing needs you right now." is `HOMEMAP.statusLine`'s alone; nothing in
  index.html writes it (tested). Coming up rows carry no number.
- `hmWorkHere()`: a member's own row opens `HOMESITES.pane(row)` in place;
  without home-sites.js it offers no door and `#hmAddOwn` hides. `pane()`
  returns the SAME element while the row is unchanged and `drawHomeMap` hands
  focus back (`hmFocus`), so a redraw keeps a half-typed form. `hmReloadMine`
  re-reads live, never the boot copy.
- The first-building submit runs no search (`hmFirstGone`, `hmOpenFirmAdd` /
  `hmOpenMineAdd`).
- Type (`test/home-list-type.test.js`): no Georgia in the panel; sizes 14,
  13, 12, and 20 for a figure only (`.hm-fig b`, `.hs-vb`); no capitals. One
  section-label rule (`.hm-bk, .hm-next-k, .hm-gh b, .hm-fold > summary`,
  Contacts' label): none sets size, weight, face, case or colour of its own.
  `.hm-bc` and `.hm-next` are sections on the list's line, not cards.
  Restyle borrowed `.hs-` / `.dk-` rules from the panel's side only
  (`.hm-panel .hs-…`, `#hmPanePeople #deskContacts .dk-…`).
- A class that sets `display` needs its own `.hidden` companion (`.hm-ch`,
  `.hm-st`, `.hm-fh-set` over `.hm-btn`).
- Firm row (`test/home-head.test.js`): `#hmFirmHead` and `#hmFirmMsg` are
  `.hm-panel`'s first two children, outside `.hm-head`; `drawFirmHead(null)`
  empties both. Its 14px/34px band is `.hm-layers`' (move the switch and the
  row must follow). Never an ellipsis on a fact; no red or indigo but the
  focus ring. No rule of `.hm-fh-msg` may set a colour (it out-ranks
  `.dk-msg.bad`). The door and mark press areas are `::after` and need
  `position: relative` on the button, or a click anywhere opens the file
  picker. While the door shows, the mark is `tabIndex -1` and `aria-hidden`;
  a redraw hands focus on. `#hmFirmGear` shows for EVERY member (the panel's
  only door; `test/nav-parity.test.js`).
- Head spacing: move the head, never the list (a test pins `.hm-body`'s
  padding). Line boxes are ratios rounded UP, never lengths. `.hm-body`'s
  left and right padding stay one number (`hmFitListBar` reads the left for
  the right); its ResizeObserver watches the border box. `scripts/shot.js`
  draws no scrollbars.
- Contacts: capped at `COLLAPSE_AT`; add form ships closed; labelled
  "Contacts"; `tenant_*` CSV aliases in `org-contacts.js` stay;
  `/contacts` (the owner's ADMIN_KEY rolodex, migration 007) must never meet
  this list. `.dk-row` rows stay FLAT (org-desk indexes children by
  position).

**The map**
- The tabs choose the list, the switch chooses the map: a tab turns its
  layer on once per arrival (`hmLayerTab`), never on a redraw. `readLayers`
  keeps only `LAYERS` and turns both-on or both-off into Properties.
- `hmDrawPins` fits to the tab's SUBJECT, never to permits switched on
  around it. The first card opens only after the fit settles (`hmAfterMove`);
  an open card re-pans after a refit (`hmPopup.update()`).
- Never a silent empty layer: `#hmLayerNote` says why (permits.md).
- Stacks: `stackValue` sums only when every property has a figure of one
  kind. `hmRestack` runs on `zoomend` after `setTimeout 0` (a draw inside a
  draw opened a card twice). Never opens on hover; permit pins are not
  stacked.
- `hmSelect` returns early for a map open of the card already up (it redraws
  the pins under the pointer).
- `hmOnWheel` is added BEFORE `L.map()`. The pinch drives Leaflet 1.9.4
  private methods: a Leaflet upgrade must re-check `hmPinchStart`/`To`/`End`.
  Home's map only; other maps keep `scrollWheelZoom: false`.
  `.hm-map-empty` is `pointer-events: none`.
- Tests: `test/desk-map-layers.test.js` (wiring), `test/home-map.test.js`
  (rules), `test/building-photo.test.js`. `test/helpers/boot.js` points
  `CENSUS_API_URL` at a closed port.

## Where the detail is

Sections there open with a bold lead-in, not a heading. Grep
`docs/rules-detail/workspace.md` for:

- Served script: "script is served as its own file"
- Names: "Customer-facing names"
- Type: "The list's type and its one left edge"
- Firm row, scrollbar: "The head of Home's list"; "The firm header"
- Plan gate: "A free account's Home is an address list"
- Quiet Today, stacks: "A quiet day, and pins that land"
- Reports: "A report opened from Home stands alone"
- Removed: "The vault is taken apart"; "Comps leave Home"
- First screen, Next: "An empty Home asks for its first building"
- Switch, permits: "The map's switch is Properties"; "The map's layers"
- Photos: "Street photos on Home's cards"
- Hover, trackpad, BOV, deals: "Home as one map"
- Old Home (retired): "## Architecture" to "The Sharing card"
- `/`, search view: "`GET /` — serves"
- One paint: "fills in ONE PAINT"
- Boot payload: "data ships WITH the page"
- Scroll: "load starts at the TOP"
- `/desk`, `pagePath`: "`/desk` is kept working"
- `AUTH_BOOT`: "templated three times"

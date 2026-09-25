---
paths:
  - "index.html"
  - "firm-skyline.js"
  - "test/org-desk.test.js"
  - "test/desk-*.test.js"
  - "test/firm-skyline.test.js"
  - "test/auth-boot.test.js"
---
# The signed-in workspace

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Architecture

  **The Workspace read as one page (2026-09-02).** Slices 3–8 each placed
  their own section by local reasoning; this was the first look at the whole,
  and three things changed, each test-pinned. **Contacts is capped**: it was
  the one firm section with no overflow rule (Buildings shows 8 and sends the
  rest to `/buildings`, Conversations 5, the shelf grows a filter at 6), so
  an imported spreadsheet rendered every row on the front page, up to 2,000,
  with Membership, Sharing, Broker, Account and the search chamber below all
  of them. It now shows `COLLAPSE_AT` rows and folds the rest behind "Show N
  more" — `renderHistory`'s fold, not `/buildings`' subpage, because there is
  no `/firm/contacts` yet and `/contacts` is the owner's ADMIN_KEY rolodex
  that migration 007 says must never meet this list; the count line still
  describes the whole list. **Its add/import form ships CLOSED** behind one
  "+ Add or import" control, `setContactAddOpen` the single writer (the
  vault's `#addSec` rule). **It is labelled "Contacts"**: "Tenant contacts"
  was written for the tenant-rep shop kind, withdrawn 2026-08-31, and a broker
  or development shop keeps a contact list too; the `tenant_*` CSV aliases in
  `org-contacts.js` stay, since an old spreadsheet still has to import. And
  **Recent searches moved from the top of the workspace to directly under the
  Run-a-report chamber**, as that chamber's output — it was a personal list
  above "Your firm" on a page the 2026-08-28 decision made firm-first. It is
  its own `#historyDeck`, outside both `#deskView` (hidden wholesale on the
  home view and on a report) and `#searchSection` (hidden by the wall's boot
  CSS while the list still renders signed out), toggled at exactly the four
  seams that change the view; `test/index-html.test.js` counts them. **Since
  2026-09-04 it is off the workspace altogether, with the chamber** — see the
  `GET /` bullet below: `showHomeView` is its one reveal. Contacts keeps its place — after the deal board, last in the deck since Membership & settings moved into the account menu’s Firm & branding panel on 2026-09-03 —
  and Buildings stays first. Recorded for later, not built: a `/firm/contacts`
  page for the fold's "See all". (The firm-level "needs attention" band that
  sat in this sentence shipped on 2026-09-04 as the strip below.)
  **The Ledger pass (2026-09-04; owner's pick from a two-direction design
  canvas, "match /bulk and /vault").** Photographed populated with a seeded
  firm — `test/helpers/fake-supabase.js` behind a CDP capture with a
  `cn_session` cookie, since `scripts/shot.js` cannot sign in — the page had
  no opening statement (a subtitle about where things are NOT, then an empty
  address form), the same building drawn as a Georgia address on the shelf
  and an underlined sans one in Buildings, meta 700px from its name at
  10.5px, every address and action underlined, and building rows collapsing
  to "4…" at 390px. Five things changed, all in index.html and all
  test-pinned (`test/org-desk.test.js`, `test/index-html.test.js`,
  `test/desk-boot*.test.js`):
  - **`#deskStrip`** — four Georgia figures on a bordered card (bulk-page.js's
    `.cap` idiom) as the first child of `#myDesk`: buildings on the board,
    shelf reports this month, unread conversations, and lease dates due in
    the next twelve months (red only when there is one; the soonest named).
    Each cell links to its section. `drawFirmStrip()` is its one writer and
    draws from state the section renderers ALREADY parsed (`firmBuildings`,
    `firmShelfItems`, `deskThreadsStat`) plus exactly one read of its own —
    `readFirmCritical()` on `/api/org/leases`, now in `DESK_BOOT_ORG_URLS`.
    Never a second read of a section's route: `bootFetch` hands each embedded
    answer to its FIRST caller and deletes it, so a re-read would cost a live
    round trip on every first paint. The read starts beside the firm batch in
    `renderShares` and is joined AFTER the pinned `Promise.all` literal, which
    is untouched, so the strip lands in the one paint. A figure whose read
    failed is a dash, never a zero; no firm or a failed buildings read hides
    the strip whole. It sits OUTSIDE the decks so `refreshDeckVisibility`
    cannot be held open by it.
  - **One row family, `.dk-row`** (name line, `.dk-row-meta` under it by flex
    ORDER, `.dk-row-act` words at the right) for buildings, conversations,
    the shelf and contacts; `.dk-shelf-row` is retired and `.db-row` stays for
    the deal board's figure rows only. Rows are FLAT — `org-desk` indexes a
    row's children by position — and their TEXT is byte-identical.
  - **Addresses are plain ink until hovered** (`a.dk-addr`, `.dk-row-name`),
    everywhere including the shares table; actions are never underlined.
  - **The Buildings add form ships CLOSED** behind `#buildingAddToggle`,
    `setBuildingAddOpen` its single writer — the Contacts rule, which this
    section never got. The deal board's By market / Shared by month sit
    under `<details id="dealBoardMore" class="dk-fold">` and its explainer is
    one sentence with the full caveat in `title`.
  - **The subtitle is gone**; workspace copy moved off hex utilities onto
    `.dk-copy`/`.dk-empty`/`.dk-msg` (token colours — the hexes were those
    tokens' exact light values, so light mode did not move).
  The rail's 224px sidebar and the phone bar are unchanged.
  **Draft 1: two columns (2026-09-24; the owner's pick from the workspace
  redesign canvas).** The single 3,300px column became a top row and two
  columns; every section kept its id and its own writer. Test-pinned in
  `test/org-desk.test.js`'s last block:
  - **The top row** is `#deskAgenda` ("Needs you": lease dates inside
    `AGENDA_DAYS` = 90, then unread conversations, each with one next step),
    full width under the figure cards since Draft C (below). `drawDeskDates(critical)` runs after
    `drawFirmStrip` with the SAME leases answer and draws the agenda, the
    new `#deskCritical` side card and the buildings' Next-date column — four
    readings of one read, and no route of their own (bootFetch hands each
    embedded answer to its first caller). The agenda hides with the strip.
    "Nothing needs you" is said ONLY when both the leases and the threads
    read came back — on the banner since Draft C, with the card hidden; a
    failed read keeps the card up and names the read in `#deskAgendaNote`.
    `.dk-top` is not a deck and must never carry `data-deck`.
  - **Two columns, each a `[data-deck]`**: `.dk-main` holds `#deckFirm`
    (no-firm body, Buildings, the shelf) and `#deckSharing`; `#deckSide`
    holds Conversations, Critical dates, the deal board, Your permits and
    Contacts as cards. The "Your firm"/"Sharing" deck headings are gone —
    the columns are the grouping — and `refreshDeckVisibility` is unchanged:
    an all-hidden side deck hides and the main column takes the width.
    Spacing is a BOTTOM margin set in the style block, so a hidden first
    section leaves no gap. Below 1180px the columns stack.
  - **Buildings is a table** (`.dk-row.dk-brow`, still flat: name, meta,
    five `.dk-bc` cells, the ⋯ `<details class="dk-menu">` holding "Open the
    building sheet" and Remove). The Shelf and Next-date cells are filled by
    `decorateBuildingRows()` from `firmShelfItems` (exact address, any case —
    it can under-count, never over-count) and `deskCritical`. `.dk-btable` is
    a size-query container: under 520px the same children reflow to an
    address line over one line of figures.
  - **The head** carries the firm and shop (`#deskFirmLine`) and one find box
    (`#deskFind`) that searches `firmBuildings` (the whole board, not the
    eight shown), `firmShelfItems` and `firmContacts` in the browser, terms
    ANDed. It asks the server nothing. Everything new hides in
    `renderShares`' `hideAll`.
  **Draft C: your city, pictured (2026-09-25; the owner's pick from three
  drafts — the comparison page and the prototypes are in
  `docs/designs/2026-09-25-workspace-drafts/`).** The Workspace read as
  bland, and worst when empty: a heading, grey sentences, zeros. Same
  sections, same ids, same writers; what changed is the look, and eight
  rules hold it up (`test/org-desk.test.js`'s last block,
  `test/org-buildings.test.js`, `test/org-buildings-run.test.js`):
  - **The banner (`#deskHero`, class `dk-hero`) opens on the firm's home
    city.** `GET /api/org/buildings` carries `home: { market, photo }`:
    `market` is `BUILDINGS.homeMarket(rows)` (the market most of the board
    is in; a tie goes to whichever reached the count first in the server's
    order) over the WHOLE set, and `photo` is `firmHomeFor` in server.js
    asking `MARKETHERO.heroFor` — the market pages' own decision, quality
    grade and credit. **Photographs only**: heroFor's satellite fallback is
    a market page's answer to "where is this", and Nampa (which has
    coordinates and no photograph) is the test that the banner refuses it.
    No photo means the drawn contour map (a CSS data URI on `.dk-hero-bg`),
    never another city's skyline. It fails to "no photo", never to a 503.
  - **`drawDeskHome(home)` takes only our own `/market-heroes/` files**,
    drops a srcset naming anything else, links the credit only to
    commons.wikimedia.org, and draws the credit ON the picture, as the market
    pages do. `null` (no firm, a failed buildings read, a sign-out) takes it
    down. The photo rides the buildings answer — no read of its own.
  - **The banner sits on --slab, dark in both themes, so its text is literal
    white** (FOOTER_DARK_CSS's reason). The picture is clipped in its own
    layer (`.dk-hero-bg`), not by the banner, because the find box's results
    drop out of it; and the banner has NO z-index, so the figure cards
    (z 2) rest on its edge while the find results (z 40) still open over
    them.
  - **The greeting is a first name, on the browser's clock**
    (`deskGreetingFor`, called by `drawDeskHead`): "Good morning, Brad", or
    just "Good morning" when the account has no name — never a guess from
    the email — and "Workspace" to nobody. The account circle stays in the
    rail (the 2026-08-29 decision the header test still pins). The day sits
    in the kicker beside the firm line. `resetDeskHero()` — called by
    `hideAll` — puts the greeting, the status line and the picture back, so
    no name or city outlives a session.
  - **`#deskHeroSub` has one writer, `drawAgenda`**, because it is the one
    place that knows whether its reads came back: the counts when something
    is due; "Nothing needs you right now." when both reads came back empty
    (and the agenda card hides — a box whose only sentence is "nothing" was
    the bland page); "{Firm} is ready. Put your first building on the board
    to begin." on an empty board; no line at all when a read failed (the
    card stays up and names it); "Pick a place to start below." for a
    member in no firm. It is status, not the subtitle removed on 2026-09-04.
  - **The figure cards are `#deskStrip`, moved, not a new component**: first
    in `#myDesk`, outside every deck, a negative top margin resting them on
    the banner (reset when `#checkoutNotice` shows, so they never ride over
    it). Same ids, same one writer; `drawFirmStrip` also marks a literal zero
    `.zero` (it steps back to --ink-4) and never a dash, which is a failed
    read and keeps its ink.
  - **Empty sections are `.dk-ghost` previews**: faint rows drawn with
    gradients (no text anywhere in them — a preview must never read as
    data; `aria-hidden`) under one card with the next step. The ids are the
    old empty paragraphs' ids and every renderer still only toggles
    `hidden`. `.dk-ghost`, `.dk-start` and `.dk-hero-where` set `display`, so
    each has its own `.hidden` rule (the `.dk-strip` trap). In a side card
    the preview is dropped and the card lies flat.
  - **A member in no firm gets three start cards (`#deskFirmEmpty`, class
    `dk-start`)**: Explore a market (the /markets thumbnails, decorative
    there and here); a second card `syncStartCards` picks by
    `proConfig.canBulkValue` — the Comp report tool when this member has it,
    the Permit tracker otherwise, so the card never opens onto a Pro gate.
    **Not `firmState.canCreate`**: that is canUseOrg, which a vault-only beta
    grant carries without the Comp report tool (Cursor Bugbot, PR #320). It
    is called from renderFirmEmpty AND from refreshBillingUI beside the
    rail's Comp report row, because /api/config can answer after the desk
    drew. The third card is the firm door it has always been, label, copy
    and button keeping their ids and words.
  Colour comes only from existing status/badge tokens (`.dk-tone-*`: the
  strip's icons, the side cards' head icons, the previews and the
  buildings' type tags, `TYPE_TONES`), so dark mode needed nothing of its
  own. No new Tailwind utility — everything is in the style block.
  **The firm's skyline (2026-09-25 evening; the owner's pick, Draft B of the
  banner drafts at https://claude.ai/artifact/Ef7zJpN17C3wXg5xaakWCZ).** The
  city photograph was the same picture every day, and only ~30 cities have
  one, so most firms got the drawn map. Now the banner draws the firm
  itself: one tower per building on the board. Height is the building's
  size, lit windows are recent work on it, a red light is a lease date
  inside 90 days, a crane is a building added this month, and the newest
  rise on the right, so the skyline grows as the firm does. The sky follows
  the time of day. (Draft C, "a building a day" — an aerial of one building
  each morning — shipped for about an hour first, PR #326, and was replaced
  by this at the owner's word; its code is in that PR's history.) Rules, all
  tested (`test/firm-skyline.test.js`, `test/org-desk.test.js`'s last block):
  - **The rules are the pure, dual-exported `firm-skyline.js`** (browser
    global `SKYLINE`, `max-age: 0`, guarded with `typeof` — a missing file
    leaves the city photograph, never a broken page). Oldest on the left;
    height on a log scale against the firm's own largest building, floored at
    60,000 SF so a board of small buildings is not a city of skyscrapers; a
    building with no size stands at the board's median height and its
    callout says no size. "Recent work" is deliberately narrow and the key's
    tooltip says so: a report on the shelf naming the building (the Shelf
    column's exact-address rule), the building added, or a lease date due,
    in the last 30 days. CompNinja does not know revenue or deals won, so
    the skyline never pretends to show either.
  - **It reads ONLY what the desk parsed** — `firmBuildings`, `deskCritical`,
    `firmShelfItems` — so it has no route (bootFetch's rule), and
    `renderShares` calls `drawDeskSky()` once, after `drawDeskDates`. It
    sits OVER the city photograph (`has-sky` hides it and its credit), so
    no firm, a failed board read, a missing module or a sign-out
    (`resetDeskHero` → `clearDeskSky`) leaves the old banner.
  - **The towers are a layer ABOVE the words (z 1) with pointer events only
    on the towers**, so the greeting and the find box stay clickable and a
    tower stays hoverable; that is why the skyline starts right of the
    widest line of text, measured with a Range (the heading and status line
    are banner-wide block boxes), and why the key is kept short. Each tower
    is an SVG link to its building sheet with a spoken label; hover or focus
    moves the callout (`#deskSkyCall`), leaving returns it to `focusOf` (the
    soonest date, else the newest building, else nothing). On a phone the
    layer drops behind the words, dims, and takes no pointer or tab stop.
  - **No colour rides in the markup the script builds.** The banner is dark
    in both themes, so its colours are literal `rgba()` like the rest of it,
    but they live in the style block as classes (`sky-win lit`, `sky-red`,
    gradient stops as `stop-color` classes), and a test fails any hex or
    rgba in the drawing code. The page stylesheet takes no custom
    properties of its own (`theme.test.js`), so the horizon's gradient stop
    is a fixed 79%, and the towers stand at that SAME share of the banner's
    height (`DESK_SKY_HORIZON`), never a fixed distance from the bottom. It
    shipped as "62px above the bottom", which is right only at the 292px
    floor. A longer status line or a phone makes the banner taller, and the
    ground then drew a few pixels under the horizon as a second line
    (2026-09-25, from the owner's screenshot). The ground stroke spans only
    the towers, with faded ends (a `userSpaceOnUse` gradient, since a flat
    line has no bounding-box height). A test holds the three gradient stops
    and the constant together.
  - **Towers are glass, and `.on` is not hover.** `.on` marks the tower the
    callout describes, and a lone building is ALWAYS that tower. So `.on`
    only brightens the outline, and the lit-up fill belongs to a real
    `:hover`/`:focus-visible`. Sharing one rule made a new firm's only
    building sit in its hover state all day, as a solid block.
  - **The sky turns with the greeting**: `drawDeskClock`'s timer (noon, five,
    midnight) calls `paintDeskSky`, guarded with `typeof`.
  - **`test/helpers/boot.js` points `CENSUS_API_URL` at a closed local port by
    default** (found while building Draft C): the Vault's import geocode sent
    real addresses to the live service from any suite that stored one.
- `GET /` — serves `index.html`. **For a signed-in member `/` opens the
  WORKSPACE, not the search page** (2026-08-28) — the firm's shelf, the deal
  board and their own properties. That is the whole firm-first
  reorganization, and three rules hold it up:
  - **The search desk is OFF the workspace (owner's call, 2026-09-04), and
    so is Recent searches.** From 2026-08-28 to 2026-09-04 `showDeskView()`
    showed `#searchSection` under the firm decks, wearing a "Run a report"
    deck header (`#searchDeckHead`, deleted with it), and `#historyDeck`
    under that; the argument was that a member's home page must not lack an
    address field. Two things changed the answer: the finder got a URL of its
    own the same day (`/run-report`, PR #291), and the owner wants the
    workspace to be the firm's record with **Bulk valuation as the
    comp-report tool** — reached from the rail's Comp report row
    and the red CTA on every server-rendered bar. (The workspace header
    carried its own red `#deskRunReport` link to /bulk from 2026-09-04; it
    came off on 2026-09-24, owner's call, as a third door to one place, so
    the header is the heading alone.) **`/run-report` is in NO nav** (owner's call, the
    same evening): it was a Tools row for one day, and a second "run a
    report" door was two doors to one act. The route still answers but is
    linked from nowhere: `bulk-page.js` linked it from its foot for a few
    hours as the form with the inputs a bulk row lacked, and that evening
    the bulk page took every one of those inputs (migration 051 — see the
    Bulk valuation section), so the link went with its reason.
    On `/bulk`, one address is a report: the button reads "Run the report", a
    one-address run started on the page opens `/?recent=<id>` the moment it
    lands (`singleJob`/`onRunState` in `BULK_JS`; a failed one stays as a row
    with its reason, and a single run re-opened from "Earlier runs" is never
    redirected), and the market-explorer chamber that sat beside the single
    form is deliberately not carried over — `/markets` is that page. The
    footer's "Run a report" link still points at `/`, on purpose: the footer
    is one set of bytes for everybody, and for a stranger `/` is the home
    page's comp finder while `/bulk` would be a Pro gate. So
    `showDeskView()` HIDES `#searchSection` and `#historyDeck`; the history
    deck is revealed in exactly two places, `showHomeView()` and the boot
    block's home-stack branch (so the unadvertised `/run-report` shows it
    under the finder, and `/r/<id>` never does), and three seams hide it (desk,
    `beginAssembly`, `renderResults`; `test/index-html.test.js` counts both
    lists). The form is not gone — it is the
    REAL `#compForm`, not a compact copy: one form, one set of ids, read by
    `targetRange()`, the footprint estimate, every report restore and the
    confirm dialog — and every report door (`openPortfolioItem`,
    `openHistoryReport`, `rerunHistory`, `?recent=`, `?property=`) still
    enters through `leaveDesk()` → `showHomeView()`, which shows it. One
    exception to the member-at-`/` boot rule came with this: a **pending
    landing address** (`pendingLandingAddress.v1`, written by a market page's
    "value a property here" form) keeps the member on the HOME view, because
    consuming it into a hidden form would lose it; the boot block only READS
    the key, the consumer below the auth bootstrap still clears it. Free
    members note: `/bulk` is Pro-only (`canBulkValue`), so for them the
    workspace door and the bar's CTA answer with the upgrade card; the
    anonymous home page's comp finder and the wall's `/?auth=signup` door
    are unchanged.
  - **A report yields the workspace** rather than rendering under it, at BOTH
    seams: `renderResults` and, up to a minute earlier, `beginAssembly`.
    Without both, comps stream in below the firm shelf.
  - **The boot decision reads `looksSignedIn()`, never `currentUser`** (it runs
    before the account bootstrap resolves, so every member would see the
    marketing stack for a beat), and **`/r/<id>` is excluded by name** — a
    shared report is somebody else's link and must never open the reader's own
    desk. `popstate` mirrors the same rule, so Back to `/` does not drop a
    member on marketing.
  **The workspace fills in ONE PAINT (2026-09-03).** It used to reveal itself
  a section at a time — `renderMyDesk` unhid `#myDesk` on entry, every
  renderer unhid its own section when its own fetch landed, and the fetches
  ran as a chain ten deep (portfolio → shares → firm → buildings →
  conversations → shelf → board → contacts). Filmed against the stand-in
  database with a 60ms round trip, sections appeared at 0.6s, 0.9s, 1.3s,
  1.8s, 2.3s, 2.6s, 2.9s and 3.2s; the owner described it as the page
  inserting parts. Now the FIRST fill for an identity is held: `#myDesk`
  stays hidden, `#deskLoading` (a `.skeleton` the shape of a deck) stands
  in, and the desk is revealed once when `renderDeskRest`'s batch settles —
  filmed the same way, everything appeared together at 1.7s, on the same 130
  database requests. Four rules, all in `test/desk-one-paint.test.js`, which
  EXECUTES `renderMyDesk` with renderers the test lands by hand: a later call
  for the same identity repaints in place and never re-hides a desk already
  on screen (`deskFilledFor`); a sign-out or a different sign-in mid-fill
  means the stale fill reveals nothing; `renderDeskRest` returns its batch
  and swallows a rejection, so a section added there is held for free and
  can never hold the desk forever; and `DESK_FILL_MAX_MS` (8s) races the
  batch, so a hung fetch shows what has landed rather than nothing. The
  concurrency is the other half of the speed-up: `renderShares` starts the
  membership read beside the shares read (every early exit awaits it before
  `hideAll()`, or the in-flight read undoes the hide), and the firm-scoped
  reads go out together — the shelf and the contacts wait for the buildings
  (the "Add to firm" doors and the building_id → address map) and for
  nothing else. `showDeskView` decides the sign-in card and the stand-in on
  `looksSignedIn()` for the boot rule's own reason: on `currentUser` a
  member's first frame was the "Sign in" card, filmed at 0.3s.
  **The workspace's data ships WITH the page (2026-09-04; `DESK_BOOT`).**
  One paint was still a paint AFTER the page: index.html ships one set of
  bytes to everybody and then asks for its account, its config and a dozen
  desk reads, so the desk could not exist before those round trips came
  back — 1.7s in the film above, and no client-side change could move it,
  because a browser cannot fetch what it has not yet been told to ask for.
  The owner's ask was "instantly". So for a cookie holder on `/` or
  `/desk` (never `/index.html`, never `/r/<id>`), `deskBootPayload` in
  server.js asks the server's OWN routes over loopback with the visitor's
  cookie — `DESK_BOOT_URLS` plus the six org-scoped URLs, all in ONE wave,
  keyed by the firm the session resolves to in-process
  (`activeMembershipsFor`, a hint that decides which URL strings to prefetch
  and never access) — and `deskBootScript` embeds the answers at the
  `<!--DESK_BOOT-->` marker in `<head>` as `window.DESK_BOOT`, keyed by the
  exact URL. In index.html, **`bootFetch(url, init)`** hands each entry to
  the first GET that would have fetched it and fetches live from then on;
  `acctApi`, `initGate`'s config read, the account bootstrap and every desk
  renderer read through it. Filmed at the same 60ms database delay: the
  first frame after the document IS the finished workspace, and the page
  makes no API request at all. Five rules, all in
  `test/desk-boot-run.test.js` (a real server behind the fake PostgREST)
  and `test/desk-boot.test.js` (bootFetch executed, the two URL lists held
  together): **it is never a second copy of a read** — the embedded body is
  the route's own answer to the same cookie, and the run test deep-equals
  every entry against a live GET, so the session, entitlements, `openOrg`,
  `memberOf` and every `user_id` scope apply by construction; **cookie
  presence decides whether to try, the routes decide what it is worth** — a
  dead session 401s on `/api/account/me` and the payload is dropped whole;
  **one deadline (`DESK_BOOT_DEADLINE_MS`, 2500ms, env-overridable so a
  test can prove the degrade) covers the whole fan-out**, past which the
  page ships without whatever has not answered, and any URL missing is
  simply fetched — every failure is the page as it was (sized against the
  live deployment, where a Supabase round trip measured ~100ms from Render
  and the slowest desk route answered in over a second, so a shorter
  deadline would drop exactly the reads the desk then waits on from the
  browser — and that per-query latency is worth checking against the two
  regions before optimizing any route further); **only status-200
  JSON GETs under `DESK_BOOT_MAX_BODY`**, with the visitor's IP on
  `x-forwarded-for` (so per-IP limiters see the person, not 127.0.0.1) and
  an `x-cn-desk-boot` header so a fan-out can never nest; and **`<` is
  escaped in the JSON** so a contact named `</script>` cannot close the
  script (exercised, not just asserted). The cost is TTFB: the page waits
  on the desk's reads instead of the browser waiting for them a beat later,
  which is the same wait moved earlier, minus a dozen browser round trips.
  Found on the way and fixed: `initGate` re-ran the desk fill "once the
  real Pro flag is in" although nothing the desk fills reads it any more,
  so every desk read went out TWICE on every boot; `refreshAccountUI`'s
  call is the fill now, and `refreshProConfig` keeps the checkout-return
  repaint. Two routes measured from a member's browser were also fixed:
  `GET /api/messages` read each thread's messages IN TURN (1.3-2.1s, the
  slowest read on the workspace) and now reads them together, and
  `GET /api/org` (560-1090ms) now runs the membership list and the
  entitlements read side by side.
  **A workspace load starts at the TOP (2026-09-04).** A consequence of
  the payload: Chrome restores the scroll position across a reload once the
  document is tall enough at load, and now it is — measured, a refresh from
  1407px down came back at 1407px, the run-a-report chamber at the foot of
  the workspace, so a member who had just searched and refreshed landed "at
  the bottom". The boot block that opens the workspace sets
  `history.scrollRestoration = "manual"` BEFORE the load event and scrolls
  to the top once; only on that branch, so `/r/<id>` keeps the browser's
  own behaviour. `test/desk-scroll.test.js` pins the one writer.
  **`/desk` is kept working rather than redirected to `/`.** It is linked from
  Stripe checkout returns *with a query string*, the watchlist digest, org
  invite emails and `/bulk`; a 302 would drop the query and dead-end those.
  Home moved by opening the same view, not by moving the URL. The five desk
  decks now lead with **Your firm** (was third of five), and the label a person
  reads is **Workspace** everywhere — prose says "your workspace" lowercase.
  One duplicate is left undecided on purpose: for a member, `marketBar`'s
  `Home` and the new `Workspace` link are the same destination. Suppressing
  Home for members was tried and reverted — two tests defend that link for
  signed-in visitors by name. See the comment on that line.
  The same handler covers `/index.html`,
  `/desk`, and `/r/<id>`, and matches on the **path only** (`req.url` split at
  `?`). That matters: Stripe returns from checkout to `/desk?checkout=success`,
  and an exact `req.url` match 404'd it — along with every campaign link to
  `/?utm_source=…`. **Every page route now does the same** (2026-08-28):
  `pagePath` is declared beside `staticPath` and is what `/markets`,
  `/market/<slug>`, `/broker/<slug>`, `/market-preview/<slug>`,
  `/how-it-works`, `robots.txt` and `sitemap.xml` match on — the first three
  of those were still testing `req.url`, so Facebook's own `?fbclid=…` made
  every shared market page a 404 for whoever clicked it. A new PAGE route
  belongs on `pagePath`; the API routes deliberately keep their exact
  `req.url` matches, since a client calls those by an address it constructs
  rather than one a person shares. `test/routes.test.js` walks every public
  page with a tag on the end and checks the canonical still points at the
  clean URL, so the fix cannot trade a dead link for duplicate entries in
  Search Console.
  **It is templated three times at serve time**, and the third one varies by
  visitor: `NAV_LINKS`, `INAPP_BOOT`, and — since 2026-08-23 —
  **`authBoot()`** at an `<!--AUTH_BOOT-->` marker in `<head>`. That last one
  exists because this file ships one set of bytes to everybody and then
  corrects them from `/api/config` and `/api/account/me`, so until those
  landed a signed-in member saw a signed-OUT app: measured with the account
  read slowed, "Sign in" in the header at 78ms and — in the frame where
  config had answered and the account read had not — the search form replaced
  by the wall's signup card at 1170ms. A race, so it is worst when the
  database is slow. It carries two facts, both free of a database read on a
  route that runs on every page view: `ACCOUNT_WALL` (a server constant, so
  exact) and session-cookie **presence** (the wall's own cheap rule twenty
  lines above it). Four rules:
  - **Keying on a cookie is safe here ONLY because index.html is
    `no-store`.** `/how-it-works` does the same signed-in swap and has to
    carry `vary: cookie` and drop its hour cache to do it; there is no cached
    copy of this file to hand to the wrong visitor.
  - **It is a stand-in, and index.html retires it.** `refreshAccountUI()` —
    the one function that runs after `/api/account/me` on every path,
    including the failed one — drops `cn-in`/`cn-locked` and writes the truth
    itself. That is what makes the `!important` safe: left standing, an
    expired session would keep the "Sign in" button hidden by CSS the JS
    cannot reach, i.e. a member who cannot sign back in.
  - **`applySearchLock()` reads `looksSignedIn()`, never `currentUser`
    alone**, and `accountWall` is seeded from the boot object rather than
    defaulting to false. That pair is what fixes the big flash — the card
    appeared because that function ran once with the wall off and once with
    it on. The hint is consulted only until `authKnown` flips.
  - **Presentation only**, like everything else the wall drives: a forged
    cookie buys the sight of an account menu with nothing behind it, because
    every limit is still enforced server-side.
  `test/auth-boot.test.js` pins the server half (the right classes for the
  right visitor, in both wall states) and the index.html half (the marker,
  the retirement, and that every id the boot CSS names still exists).

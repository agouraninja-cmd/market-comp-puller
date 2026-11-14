---
paths:
  - "theme.js"
  - "components.js"
  - "instant-nav.js"
  - "test/components.test.js"
  - "test/nav-*.test.js"
  - "test/theme.test.js"
  - "test/instant-nav.test.js"
---
# Navigation and the signed-in header

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

> **The phone bar (2026-11-13, the owner: "improve the CompNinja web
> experience for mobile users").** Below 900px a signed-in member's nav is a
> bar fixed along the bottom of the screen: Home, Messages, Pipeline (or
> Sites), Markets, Comps, Permits and the account circle, an icon over a
> 10px word, 54px tall. Where the notes below say that under 900px the class
> does nothing, the wrapping bar returns, or the bar "reads as words", read
> it as history (2026-08-28 to 2026-11-13). Built straight (the ask was to
> improve, not for options); the before-and-after pictures are at
> https://claude.ai/artifact/HCMqHEZY51dwZ2agmjegxn.
> **Why.** A phone audit of 21 pages found no sideways scroll and no field
> under 16px; what was wrong was the navigation. A member's seven links
> were 21px-tall words wrapping to two rows at the top of every page: about
> 130px of the first screen, at the far end of the phone from a thumb, with
> the page you are on unmarked.
> **What it is**, in `RAIL_CSS`'s `@media screen and (max-width:899px)`
> block and index.html's twin (`test/nav-parity.test.js` compares them rule
> by rule, `test/nav-shell.test.js` holds the numbers):
> - **Same element, same markup, same class** (`html.nav-rail`), so there is
>   still no drawer, focus trap or scroll lock, a stranger's bar is
>   untouched, and `NAV_SHELL=bar` is still the rollback.
> - **`screen` only.** A printed page is about 800px wide, which a bare
>   max-width query calls a phone; the bar would print on every sheet.
> - **The header keeps the brand** and scrolls away. The nav is
>   `position:fixed` at the bottom; the body is padded by its 54px (4 + a
>   46px row + 4), plus the safe-area inset, which is 0 until a page asks
>   for `viewport-fit=cover` (none does; adding it would need every fixed
>   element checked against the notch).
> - **The rail's vocabulary:** `--wash` with a `--line` hairline (an inset
>   shadow), the page you are on a `--card` tile ringed in `--edge` with the
>   red tick, here on its top edge and still a border.
> - **Cells share the width equally and are never squeezed below their
>   word** (`flex:1 1 0`, no `min-width:0`). With it, on a 320px screen the
>   heavier "Messages" of the current page ran out of its tile.
> - **The account circle is the last cell**, with the word Account (CSS
>   content; its accessible name is the control's own aria-label). The menu
>   opens upward from the corner with 45px rows. The server's cell is the
>   `<details>` and its `<summary>` fills it; the app's is `#acctMenuWrap`,
>   whose `<button>` reaches over the cell with an `::after` (so its
>   overflow is visible and the photo rounds itself). The app's wrap must
>   carry no font size: its menu is its child and inherited 10px rows.
> - **Not in the bar:** Explore (its links are in the footer), the red call
>   to action (the Comps cell is the door) and the Pricing row (Upgrade to
>   Pro is in the account menu). Seven cells is what fits 320px.
> - **z-index 1050:** over a map's controls (Leaflet's are 1000 and are not
>   contained by the map) and the Feedback button, under the modals (1200).
> - **Two things stand on the bar**, 12px above it (`66px`): the Feedback
>   ninja (`TESTER_BADGE_CSS`) and /comps' sticky comp set (`.vd-tray.on`,
>   vault-page.js). A new fixed or sticky-bottom element on a member page
>   needs the same rule, or it sits behind the bar.
> **With it:** `main.wrap`'s top padding is 20px under 640px (32px before;
> a page that sets its own later in the document keeps it), and /permits'
> inner `main.wrap.pt-page` gives its padding back there (the page had two
> 16px gutters a side and 88px above its heading).
> **A sheet from the bottom of a phone stands over the bar (2026-11-14, the
> owner: "fix the messages menu opening under the bottom bar").** Messages'
> More menu and About this chat are sheets under 900px, and at z-index 60
> they opened behind the bar: the last row covered, the bar live under the
> dimmed page. `.msg-scrim` is 1059 and the `.is-sheet` pair 1060
> (messages-page.js): over the bar's 1050, under the dialogs' 1200. The
> menu beside a mouse pointer keeps 60. Any new bottom sheet on a member
> page needs a z-index between 1050 and 1200; `test/nav-shell.test.js`
> holds Messages' to that.
> **/comps' comp set stops short of the Feedback button (2026-11-14, the
> owner: "fix the feedback button covering the comp set").** Under 900px
> the button floats 16px from the right, 44px wide, in the corner the
> sticky set stands in; `.vd-tray.on{margin-right:56px}` (44 + 12, in
> vault-page.js's phone block) puts them side by side. Nothing is hidden
> and nothing is measured in script.
> **A stranger's header on a phone is two rows (2026-11-14, the owner:
> "fix the signed-out header on mobile too").** It was three under about
> 407px (brand; Home, Explore, Tools, Log in; the red button alone), 138px.
> In `MARKET_CSS`'s `@media (max-width:559.98px)` block the red button is
> placed beside the brand (absolute against `.wrap`, which the menus' rule
> already positions on a phone) and Log in is pushed to the right end of
> the links' row: 87px at every width from 320px. Home stays (the owner's
> earlier call; hiding it would not have bought a row, since the home page
> has no Home link and was two rows). The markup and tab order are
> untouched. The rules are keyed on the END of the two signed-out links'
> addresses (`[href$="=signin"]`, `[href$="=signup"]`), so a member's bar
> has nothing they match. Never the whole address: the stylesheet goes to
> members too, and three suites refuse a member's page with either address
> anywhere in its bytes. Cost: the HOME page alone fitted one line from about 500px to
> 559px and is two rows there now. `test/nav-shell.test.js` pins it;
> pictures at https://claude.ai/artifact/HCMqHEZY51dwZ2agmjegxn.
> **The APP page's signed-out header is two rows too (the same day, the
> owner: "yes hide them").** Signed out, index.html (`/?auth=signup`, a
> shared report at `/r/<id>`) showed Explore, Home, Messages, Pipeline,
> Markets, Comps, Permits and Sign in: 376px of words that no layout fits
> on one 358px line, 131px of bar. Under 640px a signed-out visitor is no
> longer shown the four member places (Messages, Pipeline or Sites, Comps,
> Permits; the public pages' bar never showed them) and Sign in stands
> beside the brand: 88px. Explore, Home and Markets stay. On a wide screen
> all eight still show. One block after index.html's rail rules, every
> rule scoped `html:not(.cn-in):not(.nav-rail) .rd-appbar:has(> nav >
> #signInLink:not(.hidden))`: the Sign in button is showing
> (`refreshAccountUI` hides it for a member) and neither class `authBoot`
> stamps for a cookie holder is there, so a member's bar never loses its
> places, not even while the account read is out. Without `:has()` the bar
> is as it was. `test/nav-shell.test.js` holds every rule to that scope.

> **The rail's look (2026-11-12, the owner: "The left side bar looks kind of
> ugly fix it").** The strip is no longer a dark slab. It is one of the
> page's own surfaces, `--wash` with a `--line` hairline (an inset shadow,
> so the 84px stay 84), and so it follows the theme: pale beside paper, and
> in dark mode the `#243044` it already was, where `--wash` and `--slab`
> meet. Where the notes below say the strip is dark, sits on `--slab` or has
> white ink, read it as history (2026-10-07 to 2026-11-12).
> **Why, all of it read off the owner's own screenshot.** Their browser
> keeps its tabs in a dark strip down the left, so the app's dark rail made
> two dark bands side by side, each with rounded grey tiles, and the app
> never visibly began. The row for the page you are on was one of those
> grey tiles with nothing of the brand in it, and a hovered row was the same
> tile a shade lighter. The icons were drawn to no grid and shown at 22px
> from 20 units, so every stroke fell between pixels on a 1x monitor.
> **How it was chosen.** Seven designs were applied to the live page and
> photographed in the same situations (five from a panel, each told a
> direction, and two more), then compared by three judges on craft, on fit
> in the owner's own screenshot, and on usability. All three picked the same
> pale one and all three said pale over dark; what shipped is that design
> with the hover, label ink and tick size they asked for from the other pale
> one. The dark runner-up (the current row as a paper tab cut into a navy
> strip) is the one to build if the owner wants the navy back.
> **What it is**, in `RAIL_CSS`'s icon-rail block and index.html's twin:
> - **One rhythm.** A 60px head (the 30px mark), rows 68 by 56 with 4
>   between, a 16px divider, a 60px foot (the 32px account circle) with
>   Feedback standing on it. A row is a 24px icon over an 11px word on a
>   14px line, in `--ink-2`.
> - **Where you are** is a `--card` tile ringed in `--edge`, the word at
>   600, and a red tick inside the tile's left edge: the red rule under a
>   page's own current tab (`--red`). The tick is a border, never a
>   background, so a forced-colours mode keeps it.
> - **Pointing at a row** draws an outline (`--ink-4`) and nothing else, so
>   it never looks like a second current row. **Keyboard focus** is an ink
>   ring inside the row, not the product's red one: here red already means
>   where you are. The account circle's focus ring is a shadow (it has to
>   clear the circle), so its focus also keeps a transparent outline: a
>   forced-colours mode drops shadows and paints outlines, and a review
>   caught the circle with no focus mark at all there.
> - **A row is its own target.** The bar's links carry an invisible
>   `::after` that reaches 5px past each one (MARKET_CSS, for 20px-tall
>   links). RAIL_CSS switches it off for rows, where it reached into the
>   row below; index.html's links never had it.
> - **Icons** are `NAV_ICONS`, one hand: a 24-unit grid shown at 24px, a 1.5
>   stroke, straight strokes centred on a half pixel. Sites is a map pin,
>   Comps is bars on an axis, Permits is the one sheet, with a tick. Home's
>   map switch and its first-run door draw Permits too, at 16px and 18px on
>   those icons' 20-unit grid; index.html keeps the same sheet there. The
>   Feedback ninja is the brand's filled glyph and was left alone.
> - **The unread count** is a 16px pill at the icon's shoulder, placed by
>   its left edge so "9+" grows away from the drawing.
> - **The account circle** is navy with a white initial, as on every bar,
>   with a 1px `--ink-4` ring: on the dark theme's strip navy is the strip's
>   own colour and the ring is what draws it. A ring rather than a
>   `[data-theme]` rule, because index.html keeps every one of those inside
>   one `@media screen` block (paper is never dark) and
>   `test/theme.test.js` fails a second home for them.
> - **A short window.** The column needs 560px with seven rows (a free
>   member's Pricing row on a server-rendered page is the seventh). The
>   strip cannot scroll (the account menu opens outside it), so in a shorter
>   window the account circle was pushed off the bottom, and Settings and
>   Sign out with it: for a free member a 768px laptop zoomed to 125% was
>   enough, and at 150% it was everyone. Under 560px a second block now
>   closes the column up (44px rows, 419px in all). Both sums count the
>   nav's gap between the last row and the account slot, a flex child like
>   the rows; the first draft of them did not, and was 4px short.
>   Feedback still leaves the strip under 620px, as before; at exactly that
>   height seven rows used to run 17px into it and now end 8px above.
> **What holds it together.** `test/nav-parity.test.js` reads every rail
> rule in both files (the 2026-08 block, the icon block, the short-window
> block and print), merges them in source order the way the cascade does,
> and compares what each box ends up with against a table of twin
> selectors; a rule on one side only fails unless it is named as that
> side's own. It refuses rail chrome styled anywhere else in either file,
> and a rule inside those blocks without the `html.nav-rail` class. It
> holds every row's icon in index.html to `NAV_ICONS`, adds the column up
> from the stylesheets' own numbers (Feedback's included, lengths read
> strictly, a row border refused), and pins the three decisions a tidy-up
> of both files at once would undo: the tick is a border, the circle's
> focus keeps its outline, the hairline is a shadow. Fourteen deliberate
> breakages were run against copies of the files and a test fails on each.
> A new rail rule goes in BOTH files and, if its selector is new, in that
> table.
> **Left alone, and worth knowing.** `/markets` and `/bulk` did not load
> Inter (measured 2026-11-12: Home, Messages, Sites, Permits and Comps do,
> through `INTER_FONT_HEAD`), so on those two pages the rail's words, like
> the rest of the page, were in the system font, and the strip changed
> typeface as a member moved through them. **Fixed 2026-11-13** for those
> two (markets.md, "Inter on /markets"): every page a rail row opens now
> loads it, and the rail's labels measure the same on each (Home 31.5px,
> Messages 54.7, Sites 26.5, Markets 43.4, Comps 37.8, Permits 40.7; the
> row you are on is bolder and a fraction wider). Still in the system font
> for a member: `/market/<slug>`, `/rankings` and the public pages. Under
> 419px of height the column is still cut off.

> **Hidden means hidden (2026-11-13).** The browser's own rule for the
> `hidden` attribute loses to ANY rule that sets a `display`, and since the
> buttons and tabs moved into `components.js` (2026-11-10) every family sets
> one. So `el.hidden = true` did nothing on Home's People tab (shown, and
> dead, to a member in no firm) and on `/sites`' "+ Add a site" (shown over
> the wall that says Sites is for development firms). `components.js` now
> writes `hiddenRule(sel)`, `<sel>[hidden]{display:none}`, after every
> selector it gives a display (the canon, and every button, tab and
> segmented family, lists included), and `test/components.test.js` walks the
> stylesheet and fails on a display rule with no such companion. The same
> trap on a page's OWN rules is that page's to restate: `/sites` hid its
> figures row and its board by attribute while `.sp-figs` and `.sp-board`
> set displays, so an empty Sites page drew a row of dashes and four empty
> columns around its "No sites yet" card (`sites-page.js`;
> `test/sites-page.test.js` reads the stylesheet the page ships, because
> its stand-in DOM knows nothing of CSS and passed all along). A sweep of
> 54 page-and-account combinations after the fix found nothing else marked
> hidden and still drawn. Prefer a `.hidden` / `.hide` class with its own
> rule (the vault's way) or check the attribute against the class's
> display before relying on it.

> **Comps, and no vault (2026-10-13, the owner: "Integrate it to the
> report section and change the report section and name it Comps", and
> "the vault doesn't even exist any more"): Home, Messages, Pipeline |
> Markets, Comps, Permits.** The row that was Comp report is **Comps**,
> `#navComps` on both nav authors, `href="/comps"` with `NAV_ICONS.reports`.
> Comps is a section of two tabs, `compsSectionTabs(current)` in server.js
> (`COMPS_TABS`: "Run a comp report" `/bulk`, then "Your comps" `/comps`, a
> `<nav class="cs-tabs">` styled in MARKET_CSS as a segmented pill, since
> `/comps` has its own row of underlined tabs under its title). marketBar
> marks the row current on BOTH `/comps` and `/bulk`; the bar is prepended
> to both pages' bodies for a member (cookie presence) and never to a
> stranger's `/bulk`. index.html never serves either page, so it never
> marks the row. `/comps` and `/pipeline` are `VAULT_PAGE_PATHS` (the route,
> `CTA_FREE_PAGES`), both drawn by vault-page.js (vault.md); `/comps`
> replaced `/vault` in instant-nav.js's `TAB_PATHS` and in the app's warm
> list (`INSTANT_NAV_APP`), and `/vault` answers with a 302 to `/comps`
> (`VAULT_MOVED_PATH`). Where the boxes below say `/vault` or Comp report,
> read it as history. Pinned in `test/nav-parity.test.js`,
> `test/routes.test.js` (the sequence, both pages, the section's tabs, the
> redirect), `test/vault-shell.test.js` and `test/instant-nav.test.js`.

> **Pipeline, under Messages (2026-10-09, owner's call): Home, Messages,
> Pipeline | Markets, Comp report, Permits**, and a development firm reads
> **Sites** in Pipeline's place ("give development firms a site tab on the
> sideline ... and the pipeline would have its own side tab under messages";
> and, once Sites had moved onto Home the same evening, "Have the sites under
> messages for development firms and Pipeline for brokerage firms under
> messages"). Pipeline is `/vault`'s tab, served at `/pipeline`
> (`VAULT_PAGE_PATHS`; vault.md has the page's half), in `TAB_PATHS` and
> `CTA_FREE_PAGES`: a path rather than `/vault#pipeline` on purpose, since
> instant-nav.js never prerenders a link with a fragment and the server
> cannot mark a row for a fragment it never sees. **Sites is `/sites`
> since 2026-10-12** (the owner: "Sites is the exact same thing as home,
> this is a problem", and the pick of a page of its own over dropping the
> row). Until then it opened Home's Properties tab, so it was Home twice.
> `sites-page.js` draws the deals on a board of the four buying stages,
> with figures across them, the opened deal worked under the board with
> Home's own pane (`HOMESITES.pane`, styles in the shared
> `home-sites.css`), Passed folded away, and an add form for deals only
> (`ctx.buyOnly`); what a member owns stays on Home. The route reads
> `user_sites` behind requireSites' three refusals and says them as walls,
> plus a fourth for a member not in a development firm. It is in
> `TAB_PATHS` and `CTA_FREE_PAGES`, logs `sites_visit` through
> `logPageVisit`, and writes nothing on load. `test/sites-page.test.js`
> runs its script. The rules below that speak of the app marking Sites and
> swapping Home's tab in place are history: marketBar marks it on `/sites`
> like any row, and index.html neither marks nor intercepts it.
> Six rules:
> - **Both rows render on both nav authors, with marketBar's ids on both**
>   (`#navPipe`, `#navSites`), and ONE class decides which shows:
>   `shop-dev` on `<html>`, styled by `SHOP_NAV_CSS`, which reaches the
>   server pages through `ACCOUNT_NAV_CSS` and index.html through
>   `AUTH_BOOT_CSS`. index.html restates neither (a test fails it if it does).
> - **The kind is a database read no synchronous render may make**, so the
>   two pages that already read it write it down: index.html's
>   `loadMyFirms` (GET /api/org, on the page a member lands on after signing
>   in) and vault-page.js's `applyShop`, both through `window.cnShopNav`.
>   `SHOP_NAV_JS` defines that and stamps the class from the note in
>   `<head>` (marketShell for a member, authBoot for everyone), so a
>   development member never watches Pipeline turn into Sites.
> - **The note is a per-browser convenience, never a gate** (localStorage
>   `cnShop`). Without it a development member reads Pipeline, and
>   `/pipeline` sends them to `/sites` anyway (`applyShop`). Sign-out
>   (`doSignOut`, `doDeleteAccount`) and a dead session (`ACCOUNT_NAV_JS`'s
>   `!me`) clear it. **A third writer since 2026-10-21: `/sites`**, which
>   reads the firm's kind for its own wall, passes `marketShell({ shop })`
>   and the shell calls `cnShopNav` in `<head>`, right after `SHOP_NAV_JS`
>   and before the rail paints, so a member opening /sites on a new browser
>   no longer reads "Pipeline" on the page that is Sites. A page that read
>   no firm says nothing (`shop` absent). Pinned in
>   `test/sites-shop-run.test.js`.
> - **The mark is the path's.** marketBar marks Pipeline for `/pipeline`.
>   Until 2026-10-13 vault-page.js's `setTab` moved `aria-current`
>   (`markRail`) as /vault's tabs changed; since then each page is its own
>   row's (/comps is Comps'), its tabs never leave it, and `markRail` is gone.
> - **Sites is marked by the app, never the server.** `markNavCurrent` marks
>   `#navSites` instead of Home while the Properties tab shows for a
>   `shop-dev` member, reading `#hmTabProps`' `aria-selected` and the class
>   (never `hmTab`, a TDZ throw from the boot path), and `loadMyFirms` calls
>   it once the kind is known. A plain click on the app's Sites row swaps to
>   Properties in place (`enterDesk`, then `setHomeTab`), the Home row's
>   handler, so it works from a report too.
> - **Every member gets the row**, Comp report's rule: a free member opening
>   `/pipeline` gets its Pro invitation ("Your pipeline is part of Pro"). Pinned in
>   `test/nav-parity.test.js`, `test/routes.test.js` (the sequence, the
>   page, and `/sites` being no page) and `test/vault-page.test.js`.

> **The rail since 2026-10-08 (owner's call): Home, Messages | Markets, Comp
> report, Permits.** Reports left: it was `/desk#reports`, which only opened
> a tab of Home ("the home and report sections are literally the exact same
> thing"), and the shared reports it held are Messages' Reports view now
> (firms.md). Comp report came back under Tools, second, where it sat before
> Draft C ("we are moving the comp report back to tools"): `<a href="/bulk">`
> with `NAV_ICONS.reports` in marketBar, `#navBulkLink` with the same paths
> in index.html, the label "Comp report", which fits the 64px column on one
> line at 10.5px. Unlike the pre-Draft-C row it is **every member's, never
> hidden and hydrated**: nothing on Home runs a report any more, so a row
> hidden from a free member would leave them no door, and `/bulk` answers
> them with its upgrade card. `markNavCurrent` marks Home for every Home
> tab again. `test/nav-parity.test.js`, `test/routes.test.js` (the sequence)
> and `test/messages-routes.test.js` pin both nav authors.

> **The icon rail (2026-10-07; Draft C of the Home and Data drafts).** The
> rail is now an 84px dark strip (`--slab`, so literal white at stepped
> opacities, the footer's reason) of five places, an icon over a word:
> **Home, Messages, Reports | Markets, Permits.** Data (`#navVault` /
> `#menuVaultLink`) and Comp report (`#navBulk` / `#menuBulkLink`) left the
> rail and both pages' markup: a member's deals, holdings and comps are tabs
> of Home, and running a comp report is Home's address box and its Reports
> tab's button. Reports is `/desk#reports` on both sides. The icons are
> `NAV_ICONS` in server.js and the same paths by hand in index.html
> (`.nvi`, hidden outside the rail, so the phone bar reads as words), and
> every row's label is `<span class="nvl">`. The rail hides the red call to
> action (it is not a place). `RAIL_CSS` and index.html's rail block carry
> twin "icon rail" rules; RAIL_CSS joined the colour tests' stylesheet list
> for its white. Where the rest of this file says 224px, Workspace, Vault,
> Market explorer or Comp report rows, read it as history.

- `NAV_SHELL` — optional `rail` (**default**) or `bar`, added 2026-08-28. Which
  shape the SIGNED-IN chrome takes on every server-rendered page. `rail` lays
  the header out as a persistent 224px left sidebar at **900px and up**; `bar`
  is the horizontal header exactly as it shipped before that date, and is the
  instant rollback lever. An unrecognized value **exits at boot** (the
  `SEARCH_PROVIDER` / `THINKING_LEVEL` no-fallthrough rule).
  **It gates ONE CSS class on `<html>` and nothing else.** The rail is not a
  new component: every surface already renders the same header shape — brand,
  `<nav>`, account slots, in a centered container — so the rail is that same
  element re-laid-out, and **the markup is byte-identical in both modes**.
  `test/nav-shell.test.js` diffs the two renders to hold that, because the
  moment a second markup branch appears the eight-page header assertions in
  `routes.test.js` are only checking one of them. Never grow one.
  **No content wrapper moves.** `.wrap` keeps its own `margin:0 auto`, so with
  the body padded on the left every centered band re-centres itself — measured
  on `/markets`, where `main` lands 1120px wide beside the rail with nothing
  else edited. The 224px width is a **literal**, never a `var()`: `theme.js`
  holds colours, and `theme.test.js` fails any custom property that is not one
  of its tokens.
  **Below 900px the class does nothing** and the wrapping bar returns. That is
  the whole mobile answer — no drawer, no focus trap, no scroll lock.
  **Anonymous visitors never get it** (it marks being inside the product, and a
  marketing page read by a stranger is not that); it is decided on cookie
  presence, and those routes already send `vary: cookie`. Cookie presence is
  not the same question as "is this session still valid", so BOTH shells
  retire the class once the account read answers: `refreshAccountUI()` in the
  app, `ACCOUNT_NAV_JS` on every server-rendered page. Removed only, never
  added — a member's copy is stamped before first paint and must not flicker
  in after it. The rules live in **one** const, `RAIL_CSS`, interpolated by
  `MARKET_CSS` and `HOW_CSS` — and since 2026-08-30 that is the whole list:
  `/vault` was briefly a third consumer, taking `RAIL_CSS`, `FOOTER_LINK_COLS`
  and `FOOTER_LINKS_CSS` through a chrome object because it drew its own
  document, and Task 9 folded it onto `marketShell` so it gets all of them the
  way every other page does. `FOOTER_LINK_COLS` / `FOOTER_LINKS_CSS` remain
  extracted, now with `MARKET_FOOTER` and the two stylesheets as their
  consumers.
  **The app draws its own half of this shell, and the two must agree.**
  `index.html` is not rendered by `marketBar`, so every rule above has a second
  implementation in that file's `<style>` and markup, and the whole class of
  bug here is a difference between them: a row named one thing on one side and
  another thing on the other, a control that is a row here and a modal setting
  there, a current-page highlight only one of them writes.
  `test/nav-parity.test.js` reads both files together and exists for exactly
  that; `test/nav-shell.test.js` pins that the rail exists at all. The rules
  that fall out of it: the app writes `aria-current` from `markNavCurrent()`
  (ONE writer, called from all four seams that change which view is showing —
  the two report seams included, since assembly yields the workspace a minute
  before `renderResults` repaints); every nav row is a real link on both sides,
  so `#myDeskLink` is an `<a href="/desk">` whose handler stands aside for a
  modified or middle click; `/` and `/desk` both serve the workspace, so
  neither rewrites the URL into the other; **the theme toggle is a nav row on
  NEITHER** (owner's call, 2026-08-30 — it was a row on both for one morning,
  which fixed the old asymmetry the wrong way round; dark mode is one
  preference, so it gets one control, `#themeToggleApp` in `index.html`'s
  settings panel, and `accountNavSlots` renders no toggle, no moon/sun CSS
  and no toggle handler — one hand-copy fewer, since `THEME_BOOT` alone is
  what every page needs in order to APPLY a stored choice); and the settings
  panel, which lives only in `index.html`, is reachable from every account
  menu through `/desk?settings=1` — a query the wall can see, read and
  cleared exactly as `?pricing=1` is. **A signed-out visitor has no account
  menu and now no toggle either**, so the wall exempts a bare `/?settings=1`
  (never `/desk?settings=1`, which stays a personal workspace) and the panel
  opens for them showing its two account-free rows, appearance and plan.
  Nothing in the chrome points there: it is the escape hatch for a browser
  that stored `dark` and would otherwise have no way back to light. Choosing
  a theme is a member affordance now.
  Two things moved because the rail forced them: the Explore `<details>` has
  nowhere to open in a 224px column so it is hidden there and **its links moved
  to `MARKET_FOOTER`** (which finally puts `/download` in a footer at all — it
  had been in the Explore menu and in neither footer), and **Markets, Vault and
  Bulk became nav destinations**. `/bulk` previously had NO link anywhere on
  the site: not a menu, not a footer, not a header, only a link from inside
  itself. `#navVault` moved out of the account dropdown to join them, so a hub
  — which builds its header from `accountNavSlots` and not from `marketBar` —
  no longer shows a vault link.
  **The red "Run a report" CTA is dropped on the four pages a member is
  WORKING IN** (owner's call, 2026-08-30; `CTA_FREE_PAGES` above `marketBar`,
  pinned from both sides in `test/routes.test.js`): `/vault`, `/markets`,
  `/bulk` (and `/1031-exchange` until that page was removed on 2026-09-12).
  A broker mid-task is not deciding whether to run
  a report, so there the button is a nag for a different task; every other
  server-rendered page keeps it, because those are where somebody is still
  deciding. Two things it is NOT. It is not a way home — that argument
  (2026-08-28/29) is unchanged, the way back is the **Workspace** row, and it
  is the only reason dropping the button strands nobody, so a future edit that
  suppresses Workspace on these pages must put the CTA back. And a market
  DETAIL page (`/market/<slug>`) keeps it: it passes no `current`, it is a
  browse surface reached FROM the explorer, and it already carries its own
  "value a property here" form. Keyed on the same paths the nav rows point at,
  so "the row you are standing on" and "the page that drops the CTA" cannot
  become two lists.

## Architecture

- **Signed-in header chrome on every server-rendered page** (2026-08-09;
  `ACCOUNT_NAV_CSS` / `accountNavSlots()` / `ACCOUNT_NAV_PRICING` /
  `ACCOUNT_NAV_JS`, declared just above `MARKET_CSS`). The /how-it-works
  complaint above, generalized: `MARKET_BAR` carried three links and nothing
  else, so leaving the home page dropped Pricing, My Desk and the account
  circle in one go — reading as a mid-browse logout on `/markets`, all
  `/market/<slug>` pages, `/brokers-firms`, `/terms`, `/privacy`.
  Fixed the OPPOSITE way from /how-it-works, on purpose: the markup is
  byte-identical for every visitor (hidden slots) and a client script asks
  `/api/config` + `/api/account/me` (both `no-store`) after paint, then
  unhides. Why not server-render like /how-it-works: it would drag ~38
  cached market pages onto the `no-store`/`vary: cookie` split, and the
  circle wants an email, which is `getSessionUser()`, a DB read on a
  synchronous render path. The cost is the chrome popping in a beat late.
  Visibility rules are index.html's `refreshBillingUI()` restated (that copy
  is locked in its module scope): Pricing/Upgrade = billing live && !isPro;
  vault = `canUseVault`, NOT gated on billing; Manage billing = status set,
  not "none", not admin. Pricing links to **`/#pricing`** (the modal lives
  only in index.html — the `/#submit-comp` idiom; consumed in
  `refreshBillingUI` once `live`/`pro` are known, cleared either way).
  Sign-out reloads the page rather than re-hydrating, because the page
  around the bar may itself be signed-in-shaped (the vault above all).
  Traps: `.hdr nav .dd a` sets
  `display:block`, which out-specifies `[hidden]`, so the
  `.hdr nav [hidden]{display:none!important}` line in ACCOUNT_NAV_CSS is
  load-bearing — without it every page shows both auth states at once.
  `test/routes.test.js` pins presence on all seven pages
  and the no-double-desk rule.
  **The headers unified (2026-08-20).** `/how-it-works`' hand-kept header is
  gone: `marketBar(signedIn, current)` is THE header for every server-rendered
  page (the two copies had drifted to within one `aria-current`, which is what
  the new `current` argument renders — pass the page's own path from its
  `marketShell` call and the Explore menu marks where the reader is). The
  Explore menu's browse links themselves live in **`NAV_LINKS`**, one list
  beside marketBar with three consumers: `navLinksHtml()` for marketBar,
  and `APP_NAV_LINKS_HTML`, which the `/` handler injects into index.html's
  `#exploreMenu` at serve time in place of the `<!--NAV_LINKS-->` marker —
  index.html authors no copy of the menu any more, so adding a nav link is a
  one-line edit to NAV_LINKS. **`/faq` joined it 2026-09-01** (design 3b),
  beside Brokers and For firms because it answers the same reader. The
  `<summary>` itself now takes an `.on` class when the page being rendered is
  one of these — the menu ITEM was already marked, but a closed dropdown hides
  that, so the bar said nothing on /brokers, /firms, /faq or /download. The
  class goes on the summary and **never** on the `<details>`:
  `test/routes.test.js` pins the literal string
  `<nav><a href="/">Home</a><details>` on every signed-out page.
  **A fourth marker, `<!--BULK_RUN-->`, carries bulk valuation's run view**
  (2026-08-25). `bulk-page.js` renders that table once; `/bulk` uses it
  directly and index.html receives the same bytes, which is what lets a list
  pasted into the main search render its run inline. Two copies would
  eventually quote two different portfolio values for one run. It brings its
  own `<style>` (index.html gets no `MARKET_CSS`) with a fallback on every
  colour; its DOM ids are prefixed `bk`, because index.html already owns
  `#gate` and `rows`/`msg`/`run` were one refactor from colliding; and
  `BULK_RUN_JS` reads no form at all — it reports state through an injected
  callback, since the homepage has no `#bulkText` to dereference.
  `test/bulk-inline.test.js` pins the marker on both sides, compiles what is
  actually served, and fails the build if index.html grows a hand-copy.
  Two traps: `APP_NAV_LINK_CLASS` must stay
  identical to `#pricingLink`'s class string, because tailwind.css is purged
  against index.html alone and a utility that existed only in the server-side
  string would silently stop styling on a regen; and the marker must survive
  in index.html, or the app quietly loses its browse links —
  `test/routes.test.js` pins both the replacement and link parity with the
  server-rendered headers. index.html's header ELEMENT still lives in
  index.html (its auth chrome, account menu and pricing button are SPA
  behavior owned by `refreshBillingUI()`); what is single-sourced is the
  markup every header shares.

## The shared button and tabs (2026-11-10)

`components.js` defines the button and the tabs once (step 4 of the design
system work; `docs/DESIGN-SYSTEM.md` §6 has the values). Pure like theme.js.
Read its header before touching it; the rules a future editor will trip on:

- **A table, not a stylesheet.** Each component is its canon (`BUTTON`,
  `TABS`, `SEGMENTED`) plus the page families that predate it
  (`.hm-btn`, `.mc-btn`, `.pw-btn`, `.msg-btn`, `.bd-btn`, `.bs-btn`;
  `.vt-tabs`, `.pt-tabs`, `.hm-tabs`; `.cs-tabs`, `.msg-views`), each listing
  only where it still `differs`. `componentCss()` generates one rule set per
  family UNDER THE FAMILY'S OWN CLASS NAMES, so no markup, script or test
  changed and nothing moved on screen the day it shipped.
- **New work uses `.btn`, `.btn.sm`, `.btn.lg`, `.btn.ghost`, `.tabs` /
  `.tab`, `.seg`.** Never a new family. `test/components.test.js` refuses a
  new family, a new `differs`, a page rule the component already draws, and a
  page-level restyle of `.btn` that is not on its list of six. All four lists
  may only shrink.
- **Every button and every underlined tab IS the canon (the design pass the
  same day, owner's ask: "implement the design changes").** The 34 button and
  tab `differs` were deleted; only `.msg-views` (Messages' Chats / Reports
  switch) still lists any, on purpose. A button is 8px-cornered, states its
  own `line-height:1.4` (it read its row's before: 35px on The Board, 45px on
  a marketing page), carries a 1px border in BOTH looks (the red one's is
  transparent, so a page that repaints it, like the dark bands, need not
  repaint an edge), and has one focus ring, one disabled look and a .12s
  colour fade. `button.btn` must never set `border` again: it out-ranks `.btn`
  and would strip the edge from every real `<button>`. Tabs draw their
  hairline as an inset shadow on the row and the red line as the tab's own
  bottom border, with NO negative margin: under `overflow-x:auto` (Home's and
  Permits' rows on a phone) a -1px margin made the row scroll a pixel up and
  down. A count is a flex item 6px from its label and is `display:none` while
  empty. The marketing pages' big buttons are `.btn.lg` (their own `.btn2` /
  `.faqghost` copies went; `.btn2` survives only as a COLOUR on top of `.btn`
  in the home page's dark band).
- **Form fields are 16px on a phone, from one rule here** (`fieldCss()`:
  `@media (max-width:640px),(pointer:coarse)`, `!important`, the only one in
  the file). An iPhone zooms in on a tap into a smaller field and stays
  zoomed; 442 fields across 25 pages were under 16px at phone width, none
  after. It is one line on purpose (`test/vault-shell.test.js` reads a rule
  from the line it starts on), its selector chains `:not()`s rather than
  listing them (the tests split selectors on commas), and `hub-page.js`,
  which takes nothing else from this file, is handed it as `FIELD_CSS`.
  **It is a floor, never a ceiling:** `.rd-in-lg` (the report's main address
  box, 17px) is excluded by name, because the first version shrank it to 16px
  on every phone and the under-16px sweep could not see that. A field meant
  to be larger than 16px needs the same `:not()`; check with a sweep for
  fields OVER 16px before and after, not only under.
- **Two deliveries, one string.** `MARKET_CSS` interpolates `COMPONENT_CSS`
  (every marketShell page), and the `/` handler writes it into index.html at
  `<!--COMPONENT_CSS-->` (the NAV_LINKS rule: a marker, never a hand-copy).
  The marker sits AFTER the tailwind.css link and BEFORE the page's own
  `<style>`, and nothing above it may contain the text `<style>`
  (theme.test.js slices the page's stylesheet from the first one).
- **Order is the risk, not the values.** A family's base rule used to sit in
  its page's stylesheet; it now sits earlier, in the head. A page rule of
  EQUAL specificity now wins where the base used to. The one case that bit:
  on `/sites` the copy was `.sp-page .hm-btn` (0,2,0), which out-ranked
  MARKET_CSS's `a:hover` colour; as `.hm-btn` (0,1,0) it did not, and a link
  button's label turned red on hover. Hence the canon's secondary hover
  restates `color`. Any change here wants the before/after sweep, hover
  included, not a read of the diff.
- **Deleting a `differs` entry is a visible change** on that family's pages:
  before and after pictures. `componentCss({ unified: true })` emits the CSS
  with every `differs` ignored, for a preview and for the tests; nothing
  serves it.
- **Not on it, on purpose:** `vault-page.js` restates `.btn` whole at its own
  size (vault.md's complete-design-system rule; `test/vault-shell.test.js`
  now expands `COMPONENT_CSS` on the MARKET side and exempts only the
  vault's own `.vt-tab` family); the admin pages and `hub-page.js` draw
  their own documents and never receive it; the app's Tailwind-string
  buttons are the right red since 2026-11-10 (`bg-red-fill`, when
  `bg-brand-600` and every other off-palette colour class in index.html
  became a token class and the dark-mode bridge shrank to the footer's five
  rules) but are still utility strings, not `.btn`. The vault's `.btn` took
  the canon's corner, line height and always-there border the same day
  (its outlined button had been 2px taller than its red one).
- **The text scale has no half pixels (2026-11-10).** `--text-micro`,
  `--text-note`, `--text-ui` and `--text-body` are GONE from theme.js: 10.5,
  12.5, 13.5 and 14.5px each took the whole size beside it (11, 13, 14, and 15
  for reading copy or 14 for a control), and literal 11.5px became
  `--text-label`. A `var()` naming a retired size computes to nothing and the
  text silently takes its parent's size, so `test/theme.test.js` fails the
  build on one. Text only grew, by half a pixel; the sweep that cleared it
  compared every short label's line count at 1280, 1024, 768 and 390px, and
  three labels that no longer fit took the size below instead.

## Instant tab switching (2026-09-26)

The owner's ask: "make switching between tabs instantaneous — e.g. Workspace
to Vault." Every rail tab is its own document and each waits on the database
before it sends a byte (the workspace is also 1.38 MB of no-store HTML), so a
click was a blank wait of half a second to a second. `instant-nav.js` has the
whole design in its header; the load-bearing parts:

- **Chrome speculation rules, one-URL `prerender` list rules, inserted and
  removed by a script** (`instantNavBoot`, served inline via `bootScript`).
  Two triggers: INTENT (a pointer resting 65 ms on a tab, key focus, or the
  press itself) and WARM (after `load` + 1.5 s, the likely next tab — the
  vault from the app, the workspace from every marketShell page — if its
  link is actually rendered, so a member without the vault never costs a
  vault render). Measured in Chromium against a seeded local server:
  Workspace -> Vault 450-580 ms before, 16-34 ms after on a quick 150 ms
  hover-and-click; Vault -> Workspace 740-850 ms before, 16-24 ms after.
- **Safari and Firefox get the server half (2026-09-26, "make it work in
  Safari too").** Neither can prerender (no `document.prerendering`, no
  prerender rule), so the SAME triggers `POST /api/warm {path, warm}`
  instead, and the server builds that tab for that visitor in the background
  and holds it (`createWarmCache` in instant-nav.js for the rules,
  `startWarmRender` / `routeWarm` in server.js for the I/O). The click's
  navigation is answered from memory, or joins the render still running for
  up to `WARM_JOIN_MAX_MS` (4 s) and then renders fresh. It removes the
  server's database wait, not the network or the browser's parse, so it is
  faster rather than instant — the same local measurement with prerendering
  switched off: Workspace -> Vault 515-613 ms before, 199-365 ms after;
  Vault -> Workspace 800-1030 ms before, 380-500 ms after. Its rules:
  - **The render is the route answering itself over loopback** (the
    deskBootPayload pattern) with the visitor's own cookie, sent as
    `Purpose: prefetch` — so it is speculative exactly like a Chrome
    prerender: the visit is parked (`logPageVisit`), `/vault` skips its
    backfills — and marked `x-cn-warm` so it is never answered from, or
    joined to, the entry it is filling (that would deadlock).
  - **Keyed on a hash of the WHOLE cookie header plus the path**, single use,
    TTL the hover's 30 s or the warm tab's 60 s. A different cookie (another
    account, the admin unlock, a rotated cookie) is a miss, and a miss is a
    normal render. Only a 200 HTML page that sets no cookie is held, under
    `WARM_MAX_BODY`, inside `WARM_MAX_BYTES` (32 MB, oldest first).
  - **`routeWarm` runs before every route** and drops a cookie's pages on any
    non-GET and on any `HOLD_PATHS` GET from that cookie — the server-side
    twin of the browser's drop-after-write, so a page built before a save
    (or a sign-out) is never shown after it. `/api/warm` and `/api/visit`
    are exempt: they change no data, and asking for a page must not throw
    the last one away. So are `READ_POSTS` (below).
  - Member tabs only (`TAB_PATHS`, no query, a session cookie), rate-limited
    per IP, at most `WARM_MAX_IN_FLIGHT` (8) renders nobody has opened yet.
  Chrome and Edge never call it: `canPrerender` picks one mechanism per
  browser, and a second render of a page Chrome is already prerendering
  would be pure cost.
- **The desktop app is instant too, through its shell (1.1.0).** Electron
  has no prerendering, so the page there takes the warm path whatever it
  parses (`isDesktop`, the UA token passed in as `desktopToken`), and the
  app's shell intercepts the ask and builds the tab in a hidden view it
  swaps in on click. The site's half: `serveDesktopPreload` answers
  `x-cn-desktop-preload` only from the warm store with
  `desktopPreloadScript()` first in `<head>` (a `document.prerendering`
  polyfill ended by `window.__cnShow()`), and an empty 204 otherwise —
  never a normal render, which would run unguarded in a hidden view; and
  after a write the page sends `{"drop": true}` so the shell drops what it
  built. `.claude/rules/desktop.md` has the shell's half. Tested in `test/instant-nav.test.js` against a real
  server (served once, to the same cookie, never after a write, the visit
  logged only when the page is shown).
- **Member pages only, one source.** `marketShell` emits `INSTANT_NAV_SHELL`
  when `signedIn`; index.html's `<!--INSTANT_NAV-->` marker (above every
  `<script src>`, because the script wraps fetch) becomes `INSTANT_NAV_APP`
  on a cookie. The app's copy skips `/` and `/desk` (its Workspace row swaps
  views in place, so a prerender of either would be thrown away).
- **A prerendered page writes nothing until it is shown.** The script wraps
  `fetch`: a non-GET made while `document.prerendering` waits for
  `prerenderingchange`. This is not hygiene: the warm tab is prerendered on
  EVERY page view, and the vault stamps the watchlist feed seen on load —
  `last_seen_at` is a digest cutoff, so without the guard every workspace
  visit would have silenced the member's digest. Hence the pinned rule:
  **pages write through fetch only** — `test/instant-nav.test.js` fails the
  build on a `sendBeacon` or `XMLHttpRequest` anywhere, since those slip past
  the guard. **A GET that writes is held too, by name** (`HOLD_PATHS`,
  from an audit of every GET route on 2026-09-26, after the Cursor security
  review on PR #340 caught the first): `/api/messages/thread` and `/api/hub`
  stamp read/seen on every read and so cut off follow-up mail — the Messages
  page opens its newest conversation on load, so a hover on that tab would
  have marked it read — and `/api/broker/me`, `/api/broker/leads`,
  `/api/broker/bovs` and `/api/bulk` seed, adopt or repair on read. A new GET
  that writes goes on that list; the test pins each entry to its route AND
  its write. **The reverse, a POST that only reads, is named too**
  (`READ_POSTS`, 2026-10-13): Home's photo lookup, `POST
  /api/building-photo`, a POST only so an address stays out of the URL (rule
  7). Held, a prerendered Home showed empty photo boxes after the very click
  that was meant to be instant; counted as a write, every lookup (each card
  scrolling into view) dropped the tabs built ahead, here and in
  `routeWarm`. A path there is not held, drops nothing, and must never
  write: the test pins it to its route and fails on a database call, an
  event or a file write in its handler. **A write a page's SERVER render makes cannot be held from the
  browser**, so it checks `INSTANTNAV.isSpeculative(req.headers)` instead:
  `/vault`'s geocode and building-facts backfills skip on a speculative
  render (`attachPropertyCoords(…, { backfill })`) — a building the Census
  cannot place stays unlocated and would otherwise be retried on every
  workspace view's warm-up; any real read still backfills. The other page
  renders were audited read-only except `/bulk`'s stalled-job reap, which is
  left on purpose: it makes the page show the job's true state.
- **A visit is counted when it is seen.** The six `*_visit` events go through
  `logPageVisit(req, kind, dims)`: on a speculative GET (`Sec-Purpose:
  prefetch…`) the event is parked under a one-time in-memory token and the
  returned tag, appended to the body, posts it to `POST /api/visit` on
  activation, where it is logged under the ORIGINAL request's visitor and
  user. A new page visit event must use it (a test fails any
  `logEvent("…_visit"`). Events an API GET logs are NOT deferred: a
  prerendered vault reads `/api/watchlist/feed`, which logs `feed_view`, so
  that count includes warm-ups nobody opened. Nothing reports it today; a
  future report on a GET-logged event must account for that first.
- **A prerender never outlives what it shows**: dropped after 30 s (intent)
  or 60 s (warm), FIFO past two intent ones (the warm one is outside that
  count), when the page is hidden, and after ANY non-GET from the holding
  page lands (but a `READ_POSTS` one) — sign-out is a POST, so a vault rendered with the old session
  is never one click away. An expired warm tab is re-armed only by the
  pointer entering the `<nav>`, never by a timer: the cost is one background
  render per page view plus at most one a minute while a member is reaching
  for a tab.
- **A new rail tab** must be added to `TAB_PATHS` or it simply loads the old
  way (the test pins the current rows).
- **Testing it: Chrome refuses every prerender while any DevTools client is
  attached** (`PrerenderingDisabledByDevTools`, whatever domains are enabled
  and even with `Page.setPrerenderingAllowed`), so Playwright, Puppeteer and
  `scripts/shot.js` can never show it working. It also cancels a prerender
  whose page hits a certificate error on any subresource, which a
  TLS-intercepting proxy in front of Google Fonts or unpkg causes (the cloud
  sandbox has one). The measurement above launched Chromium with no DevTools
  at all, behind a small proxy that injected the member's cookie and a
  harness that hovered, clicked and reported `activationStart`.

## Member page titles are Inter (2026-11-14)

The owner, after Home's list and then its greeting went to Inter
(workspace.md, "The list's type"): "make the other pages' titles Inter
too". Every page a member works in now titles itself the way Home greets:
Inter, `--text-h1` (28px) at 600, `-.02em`, on a 34px line. They were
Georgia at 34 (Comps, Pipeline, Run a report, Markets), 28 (Sites, Permit
tracker), 26 (Messages) and 24 (Buildings).

- **The rule rides with the font.** `INTER_FONT_HEAD` in server.js ends
  with `<style>body h1{…}</style>`. The pages that pass that constant ARE
  the member pages (the list above it), so a public page, which loads no
  Inter, never gets the rule: a signed-out `/markets`, `/market/<slug>`,
  `/rankings`, `/pricing`, `/faq` and the home page keep `MARKET_CSS`'s
  Georgia `h1`, and the public `/markets` is byte for byte what it was.
  `body h1` out-ranks the bare `h1` (and its 34px step at 640px) wherever it
  sits in the document; marketShell's `head` is emitted BEFORE `MARKET_CSS`,
  so a bare `h1` there would lose.
- **A page with a title rule of its own says it there**, because a class
  out-ranks `body h1`: `h1.h` (vault-page.js, `/comps` and `/pipeline`),
  `.sp-head h1` (sites-page.js), `.pt-head h1` (permits-page.js),
  `.bl-head h1` and `.bs-head h1` (buildings-page.js; the list keeps its
  24px and a building's sheet its 26, an address being longer than a
  title). Messages' title carried `font-size:26px` inline, which out-ranked
  everything; it is `margin` only now.
- **Titles only.** The headings under them ("Market Explorer", "The
  Board", a card's `h2`) and the big figures on these pages are still
  Georgia: the ask was the titles, and that was said to the owner. The
  printed comp sheet (`#compSheet h1`) is a document for a client and keeps
  its Georgia. `/market/<slug>` and `/rankings` read by a member load no
  Inter at all yet (markets.md), so their titles are unchanged.
- Tests: `test/vault-shell.test.js` asks every page a rail row opens for
  the rule, once, asks the public `/markets` for none, and reads each
  page's own title rule for Georgia.

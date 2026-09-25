---
paths:
  - "theme.js"
  - "test/nav-*.test.js"
  - "test/theme.test.js"
---
# Navigation and the signed-in header

> Moved verbatim from CLAUDE.md on 2026-09-25. Claude Code loads this file
> when it opens a file matching `paths` above; read it by hand before changing
> this area's code in `server.js`. The never-break rules stay in CLAUDE.md.
> Add new notes for this area here, not there.

## Configuration

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

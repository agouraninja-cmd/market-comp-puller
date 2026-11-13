// Parity between the app's rail and every server-rendered one.
//
// Run: npm test
//
// Cost: zero. The one server here boots with no Anthropic key, no Supabase and
// no Stripe; the route under test is a pure render.
//
// WHY THIS FILE EXISTS. The rail is one shape drawn by two files — index.html
// for the app, marketBar/RAIL_CSS for everything else — and on 2026-08-30 the
// owner reported that clicking between its rows walked you across the seam.
// Every fault was a difference BETWEEN the two, and none of them is visible in
// either file on its own, which is why every test in here reads both together.
// nav-shell.test.js pins that the rail exists and that NAV_SHELL turns it off;
// this pins that the two copies of it agree.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");

const SESSION = { cookie: "cn_session=not-a-real-token" };
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SERVER_JS = read("server.js");
const INDEX_HTML = read("index.html");
const VAULT_JS = read("vault-page.js");

test("the app's rail says which row the reader is standing on", () => {
  // marketBar has answered this since the rail shipped: it takes a `current`
  // path and writes aria-current on the matching link, which RAIL_CSS paints
  // with a red edge. The app answered it nowhere, so the one page a member
  // lives in was the one page whose sidebar could not say where they were.
  assert.match(SERVER_JS, /html\.nav-rail \.hdr nav>a\[aria-current="page"\]/,
    "the shared rail lost its current-row rule");
  assert.match(INDEX_HTML, /html\.nav-rail \.rd-appbar > nav > a\[aria-current="page"\]/,
    "the app's rail has no current-row rule to match the shared one");

  // ONE writer, so the attribute cannot drift from the view actually on
  // screen — and it must not borrow onDesk(), which is declared BELOW
  // showDeskView. showDeskView runs from the boot path, so reaching down to
  // that const would be a temporal-dead-zone throw on a member's first frame.
  const at = INDEX_HTML.indexOf("function markNavCurrent() {");
  assert.notEqual(at, -1, "markNavCurrent is the single writer of the current-row state");
  const body = INDEX_HTML.slice(at, INDEX_HTML.indexOf("\n  }\n", at));
  assert.ok(!/\bonDesk\(\)/.test(body),
    "markNavCurrent must read the deck's own class, not the const declared after it");

  // All four seams that change which view is showing. The two report seams
  // matter as much as the two view functions: assembly yields the workspace up
  // to a minute before renderResults repaints, and a highlight left standing
  // over a view that is gone is worse than no highlight at all.
  // And a fifth since 2026-10-07: Home's tabs, because its Reports tab is
  // the rail's Reports row (setHomeTab), so changing tab changes the row.
  // (loadMyFirms re-marked it too from 2026-10-09, while a development
  // firm's Properties tab was the Sites row; Sites is /sites since
  // 2026-10-12, so the firm's kind no longer moves the mark.)
  // A sixth since 2026-11-10: leaveDeskForReport, which hides Home for a
  // saved report before the report's own render re-marks it.
  assert.equal(INDEX_HTML.split("markNavCurrent();").length - 1, 6,
    "every seam that hides or shows the workspace, and Home's tab switch, must re-mark the rail");
});

test("Workspace is a link on the app, as it is on every other page", () => {
  // It was the only row in either rail that could not be middle-clicked,
  // opened in a new tab, or previewed on hover — on the row a member uses
  // most. The href is /desk, a URL that already serves this view and is
  // already linked from the digest, org invites and the Stripe returns, so it
  // is a destination that exists rather than one invented for the markup.
  assert.match(INDEX_HTML, /<a id="myDeskLink" href="\/desk"/,
    "the app's Workspace row is not a link");
  assert.ok(!/<button id="myDeskLink"/.test(INDEX_HTML),
    "the button form is gone, not merely joined by a link");

  // ...and the handler behaves like one: a plain left-click is still handled
  // in place, anything the browser would treat as "open this elsewhere" is
  // left alone. Without this the href is decoration.
  const at = INDEX_HTML.indexOf('getElementById("myDeskLink").addEventListener');
  assert.notEqual(at, -1, "the Workspace handler is gone");
  const handler = INDEX_HTML.slice(at, at + 600);
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey", "e.button !== 0"]) {
    assert.ok(handler.includes(key),
      "the Workspace handler swallows a " + key + " click, so the href it grew does nothing");
  }
  assert.ok(handler.includes("e.preventDefault()"),
    "a plain click must still swap the view in place rather than reloading the app");
});

test("clicking Workspace at / does not mint a second URL for the same view", () => {
  // "/" IS the workspace for a member since 2026-08-28, so pushing /desk over
  // the top of it changed the address bar while the page did nothing visible —
  // and then Back appeared to do nothing either. Both URLs still work and both
  // still render this view; what stopped is rewriting one into the other.
  assert.match(INDEX_HTML, /const atWorkspaceUrl = \(\) =>/,
    "the two URLs that serve the workspace are not asked about in one place");
  assert.match(INDEX_HTML, /if \(!atWorkspaceUrl\(\)\) history\.pushState\(\{\}, "", "\/desk"\)/,
    "enterDesk still pushes /desk unconditionally");
  assert.ok(!/if \(location\.pathname !== "\/desk"\) history\.pushState/.test(INDEX_HTML),
    "the unconditional push is gone, not merely guarded somewhere else as well");
});

test("the tools group is labelled on both rails, and shows on neither bar", () => {
  // Group, do NOT move (2026-09-01). The rail hides the Explore dropdown, so
  // for a signed-in member the rail is the only navigation there is and every
  // removal from it is a real loss rather than a tidy-up -- which is why the
  // three-tab story got a reading fix instead of a reshuffle. Two rules make
  // that work and both are easy to half-apply across the two nav authors.

  // 1. The label exists in both, immediately before Market explorer, so the
  //    group starts at the same row on both sides of a click.
  for (const [name, src, row] of [
    ["server.js", SERVER_JS, '<a href="/markets"'],
    ["index.html", INDEX_HTML, '<a href="/markets"'],
  ]) {
    const at = src.indexOf('class="navsec">Tools<');
    assert.ok(at > -1, name + " has no tools label — the rail's one grouping rule");
    const next = src.indexOf(row, at);
    assert.ok(next > at && next - at < 400,
      name + " puts the label somewhere other than directly above Market explorer");
  }

  // 2. It is rail-ONLY, and the default has to sit OUTSIDE the 900px guard.
  //    Everything in those blocks is guarded, so a display rule written inside
  //    one could only ever turn the label ON — leaving a section heading
  //    stranded between two links in the wrapping bar a phone gets.
  for (const [name, src] of [["server.js", SERVER_JS], ["index.html", INDEX_HTML]]) {
    const off = src.search(/\.navsec\s*\{\s*display:\s*none/);
    assert.notEqual(off, -1, name + " never hides the label, so a phone shows it");
    const on = src.indexOf("nav-rail");
    // The RAIL's guard: the 900px block that pads the body for the rail. Not
    // merely the first "min-width:900px" in the file, since other chrome (the
    // feedback badge's rail placement, 2026-10-17) has its own 900px query.
    const guard = src.search(/@media \(min-width: ?900px\) ?\{\s*html\.nav-rail body ?\{/);
    assert.ok(guard > -1, name + " lost its 900px guard");
    assert.ok(off < guard,
      name + " declares the hidden default INSIDE the rail media query, where it can only turn the label on");
    assert.ok(on > -1, name + " lost its rail rules entirely");
  }
});

test("the account circle sits in the same box on both rails", () => {
  // RAIL_CSS gave #navAcct margin-top:auto and nothing else, so on /vault,
  // /messages, /bulk, /buildings, /permits and /markets the circle sat at x=0,
  // flush against the window's edge with no hairline above it, while the
  // app's sat 20px in under one (2026-10-06). Measured on a seeded server, the
  // two boxes now match to the pixel; this holds the declarations together.
  const decls = (body) => Object.fromEntries(body.split(";").map((d) => d.trim()).filter(Boolean)
    .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).replace(/\s+/g, " ").trim()]));
  const app = INDEX_HTML.match(/html\.nav-rail #acctMenuWrap \{([^}]*)\}/);
  const shared = SERVER_JS.match(/html\.nav-rail \.hdr nav>#navAcct\{([^}]*)\}/);
  assert.ok(app, "the app's account-slot rule moved");
  assert.ok(shared, "RAIL_CSS's account-slot rule moved");
  for (const prop of ["margin-top", "padding", "border-top"]) {
    assert.ok(decls(app[1])[prop], `the app's rail no longer sets ${prop} on the account slot`);
    assert.equal(decls(shared[1])[prop], decls(app[1])[prop],
      `the account slot's ${prop} differs between index.html and RAIL_CSS`);
  }

  // Each menu is positioned from that box, so its offsets must match too, or
  // the same menu opens in two places depending on which page you are on.
  const appMenu = INDEX_HTML.match(/html\.nav-rail #acctMenu \{([^}]*)\}/);
  const sharedMenu = SERVER_JS.match(/html\.nav-rail \.hdr nav>#navAcct \.dd\{([^}]*)\}/);
  assert.ok(appMenu && sharedMenu, "an account menu's rail rule moved");
  for (const prop of ["left", "right", "top", "bottom"]) {
    assert.equal(decls(sharedMenu[1])[prop], decls(appMenu[1])[prop],
      `the account menu's ${prop} differs between index.html and RAIL_CSS`);
  }
});

test("neither rail has a Data or a Reports row, and both have Comps under Tools", () => {
  // Draft C (2026-10-07): a member's deals, holdings and comps are tabs of
  // Home. 2026-10-08 (owner's call): Reports only opened a tab of Home, so it
  // left the rail for Messages, and Comp report came back under Tools. On
  // 2026-10-13 Comp report became Comps, a section (the member's comps at
  // /comps and the comp report tool at /bulk). The rail is Home, Messages,
  // Pipeline | Markets, Comps, Permits on BOTH sides. A row on one side only
  // is the seam this file exists to catch.
  assert.ok(!INDEX_HTML.includes('id="menuVaultLink"'), "the app's rail grew a Data row back");
  assert.ok(!SERVER_JS.includes('id="navVault"'), "the shared rail grew a Data row back");
  assert.ok(!/>Your vault<|>Vault</.test(INDEX_HTML),
    "the old label is still rendered somewhere in the app");
  assert.ok(!INDEX_HTML.includes('id="navReportsLink"') && !INDEX_HTML.includes('href="/desk#reports"'),
    "the app's rail grew its Reports row back");
  assert.ok(!SERVER_JS.includes('<a href="/desk#reports">'), "the shared rail grew its Reports row back");
  // Both say Comps for /comps, with the same id and icon, under the Tools
  // label; the shared rail marks it on /bulk too, the section's other tab.
  assert.match(INDEX_HTML, /<span class="navsec">Tools<\/span>[\s\S]{0,4000}?id="navComps" href="\/comps"[\s\S]{0,600}?<span class="nvl">Comps</);
  assert.match(SERVER_JS, /<a id="navComps" href="\/comps"\$\{current === "\/comps" \|\| current === "\/bulk" \? ' aria-current="page"' : ""\}>\$\{NAV_ICONS\.reports\}<span class="nvl">Comps<\/span><\/a>/);
  assert.ok(!/<span class="nvl">Comp report</.test(INDEX_HTML + SERVER_JS), "a rail still says Comp report");
});

test("the theme switch is one control, in the settings panel, on neither rail", () => {
  // The parity rule here reversed on 2026-08-30 (owner's call), and reversed
  // is not the same as abandoned: for one morning the switch was a nav row on
  // BOTH halves, which fixed the asymmetry the wrong way round. Dark mode is
  // one preference, so it gets one control, and the server-rendered pages
  // reach it through the Settings row below rather than carrying a button of
  // their own. What this test defends is that neither half grows a copy back
  // on its own — a toggle in one nav and not the other is the seam.
  const btnAt = INDEX_HTML.indexOf('<button id="themeToggleApp"');
  assert.notEqual(btnAt, -1, "the app's theme toggle is gone entirely");
  const modalEnd = INDEX_HTML.indexOf("<!-- Header -->");
  assert.ok(btnAt < modalEnd,
    "the toggle left the settings panel — it is the only control there is");
  assert.equal(INDEX_HTML.split('id="themeToggleApp"').length - 1, 1,
    "exactly one theme toggle element in index.html");
  // And none in the shared chrome. Counted over the WHOLE file rather than
  // over accountNavSlots, so a copy pasted into marketBar or a page's own
  // header fails here too.
  assert.equal(SERVER_JS.split('id="themeToggle"').length - 1, 0,
    "a theme toggle is back in the server-rendered chrome; the app's is in Settings");
  assert.equal(SERVER_JS.includes("theme-moon"), false,
    "the moon/sun icons are back in server.js — that means a button is too");
  // The panel is the only home, so every page needs a door to it. That is the
  // Settings row (checked by the next test) plus, for a signed-out browser
  // that stored "dark" and has no account menu, the bare ?settings=1 URL the
  // wall exempts. Without that exemption there is no way back to light.
  assert.match(SERVER_JS, /qs\.get\("settings"\) === "1"/,
    "the wall no longer lets ?settings=1 through — a signed-out browser cannot undo dark");
});

test("Settings is reachable from every account menu, not only from the app", () => {
  // The panel lives only in index.html and so did its only door, so a member
  // reading /markets or sitting in their vault could not reach their own
  // account settings from a menu otherwise identical to the app's.
  assert.match(SERVER_JS, /<a id="navSettings" href="\/desk\?settings=1">Settings<\/a>/,
    "the shared account menu has no Settings row");
  // A query the server can see, never a fragment: the wall reads the URL and a
  // fragment never reaches it (the ?submit=comp lesson).
  assert.match(INDEX_HTML, /get\("settings"\) === "1"/,
    "index.html does not read the door the shared menu now points at");
  // Consumed after the account resolves, and cleared either way, exactly as
  // ?pricing=1 clears itself — a reload must not reopen a panel already closed.
  const at = INDEX_HTML.indexOf("function refreshAccountUI()");
  const body = INDEX_HTML.slice(at, INDEX_HTML.indexOf("\n  }\n", at));
  assert.match(body, /pendingSettingsPanel/,
    "the panel must open from the one function that runs after /api/account/me on every path");
  assert.match(body, /qs\.delete\("settings"\)/,
    "the param is not cleared, so a reload reopens a panel the reader closed");
});

test("a session that turns out to be invalid loses the rail on every surface", () => {
  // Both shells stamp the rail from cookie PRESENCE, which is the right cheap
  // rule for a synchronous render and is not the same question as "is this
  // session still valid". The app already re-decided after /api/account/me;
  // the server-rendered pages did not, so an expired cn_session left the
  // product's own sidebar standing around a bar reading "Log in".
  assert.match(SERVER_JS, /if\(!me\)document\.documentElement\.classList\.remove\("nav-rail"\);/,
    "ACCOUNT_NAV_JS never retires the rail for a visitor with no session");
  // Removed only. A member's copy is stamped server-side before first paint
  // and must not flicker in after it.
  assert.ok(!/classList\.add\("nav-rail"\)/.test(SERVER_JS),
    "the shared script must never ADD the rail after paint");
});

// "the vault's footer is not a dead end" lived here for two days and has moved
// to test/vault-shell.test.js (Task 9, 2026-08-30). It asserted that the vault
// was handed MARKET_FOOTER's link columns as a shared const, because the page
// still built its own footer around them. It renders MARKET_FOOTER itself now,
// so the plumbing it pinned no longer exists — and the promise it was really
// making, that /vault has a way onward, is asserted there against the served
// page instead. Nothing was dropped; it stopped being this file's business
// when the vault stopped being the odd one out.

test("pricing is one control in the app, in the settings panel", () => {
  // The theme switch's journey, the same week and for the same reason
  // (owner's call, 2026-08-30). Pricing was a dropdown row until 2026-08-21
  // and a bar row after that, on the argument that a B2B site hiding its price
  // reads as one that would rather not say. True of the SITE, never true of
  // this surface: index.html is the signed-in app, and the settings panel has
  // carried a Plan row with a "See pricing" button — on the identical
  // `live && !pro` rule — since 2026-08-23. Two controls, one question.
  assert.ok(!INDEX_HTML.includes('id="pricingLink"'),
    "the app's nav still carries a Pricing row; Settings is the one control now");

  // The button that replaced it, and the rule it obeys. Checked as a rule
  // rather than a presence: the failure that matters is Pricing being offered
  // to somebody who already pays, or on a deployment with nothing for sale.
  assert.match(INDEX_HTML, /id="settingsUpgradeBtn"[^>]*>See pricing</,
    "the settings panel lost its pricing button");
  // The rule is `live && (!pro || trial)` since 2026-09-25: a Pro TRIAL is Pro
  // in every capability and still somebody to sell to, so plain `!pro` would
  // hide the one button a trial exists to lead to. One named rule, read by
  // every upgrade control, rather than the expression repeated.
  assert.match(INDEX_HTML,
    /const offerUpgrade = live && \(!pro \|\| isTrialPro\(\)\);/,
    "the upgrade rule changed shape; every upgrade control reads offerUpgrade");
  assert.match(INDEX_HTML,
    /getElementById\("settingsUpgradeBtn"\)\.classList\.toggle\("hidden", !offerUpgrade\)/,
    "the settings pricing button no longer follows the billing rule the nav row followed");

  // The SITE keeps selling. marketBar renders its own row for every visitor on
  // every server-rendered page, and that is the surface the original argument
  // was really about — a stranger on a market page.
  assert.match(SERVER_JS, /id="navPricing" href="\/pricing"/,
    "the shared chrome lost its Pricing link; that is the one a stranger needs");

  // ...and the deep links still work, which is what keeps that shared row and
  // the /pricing page's own CTA pointing at something.
  for (const door of ['get("pricing") === "1"', 'location.hash === "#pricing"']) {
    assert.ok(INDEX_HTML.includes(door), "the app stopped honouring " + door);
  }
  assert.match(INDEX_HTML, /if \(offerUpgrade\) openPricingModal\(\)/,
    "the ?pricing=1 door no longer opens the modal");
});

test("a signed-out reader can still find the price", () => {
  // The consequence of the move, and the reason it needed a second edit.
  // Settings is signed-in chrome: its door is the account menu. An anonymous
  // visitor reading a shared report at /r/<id> gets index.html with no account
  // menu, so once the nav row went there was no pricing door on the page at
  // all. Every server-rendered footer has carried /pricing since that page
  // existed; this footer had not.
  const footerAt = INDEX_HTML.indexOf("<footer");
  assert.notEqual(footerAt, -1, "index.html has no footer");
  const footer = INDEX_HTML.slice(footerAt);
  assert.ok(footer.includes('href="/pricing"'),
    "the app's footer cannot reach the rate card, and Settings needs an account");
  // The rate card is a real page that works signed out — a modal would not
  // have solved this, which is why the fix is a link and not a button.
  assert.match(SERVER_JS, /pagePath === "\/pricing"|req\.url[^\n]*"\/pricing"/,
    "/pricing is not a route any more, so the footer link goes nowhere");
});

test("Firm & branding opens from Home's firm header, not the account menu", () => {
  // The panel was a row under Settings on both sides of the rail from
  // 2026-09-03 until 2026-10-13, when the owner moved its one door to the
  // button in Home's firm header. A row on one side only is this file's seam,
  // so neither menu may carry it.
  assert.ok(!SERVER_JS.includes('id="navFirm"'), "the shared account menu still has a Firm & branding row");
  assert.ok(!INDEX_HTML.includes('id="menuFirmBtn"'), "the app's account menu still has a Firm & branding row");
  // The header button is the door, for EVERY member (the panel is also where
  // a member sees the roster and leaves a firm), not only an owner or admin.
  assert.match(INDEX_HTML, /getElementById\("hmFirmGear"\)\.addEventListener\("click", [^\n]*openFirmModal\(\)/,
    "the firm header's button does not open the Firm & branding panel");
  assert.match(INDEX_HTML, /getElementById\("hmFirmGear"\)\.classList\.toggle\("hidden", !firm\)/,
    "the firm header's button is not shown to every member of the firm");
  // The door is a query the wall can see, consumed and cleared where
  // ?settings=1 is — after the account resolves, so a signed-out arrival
  // opens nothing and a reload does not reopen a closed panel.
  assert.match(INDEX_HTML, /get\("firm"\) === "1"/,
    "index.html does not read the door the shared menu points at");
  const at = INDEX_HTML.indexOf("function refreshAccountUI()");
  const body = INDEX_HTML.slice(at, INDEX_HTML.indexOf("\n  }\n", at));
  assert.match(body, /pendingFirmPanel/, "the panel must open from refreshAccountUI, like settings");
  assert.match(body, /if \(currentUser\) openFirmModal\(\);/,
    "the firm panel opened for a visitor with no account to show a firm for");
  assert.match(body, /qs\.delete\("firm"\)/, "the param is not cleared, so a reload reopens the panel");
});

test("Pipeline sits under Messages on both rails, and Sites takes its place for a development firm", () => {
  // Sites opens /sites, a development firm's deals by stage (sites-page.js,
  // 2026-10-12); it opened Home's Properties tab until then, Home twice.
  // Owner's call, 2026-10-09. Both rows ship on both nav authors with the
  // SAME ids, so one rule (SHOP_NAV_CSS) decides which shows on every page,
  // and one script (SHOP_NAV_JS) stamps the class before first paint. A row
  // on one side only, or a rule reaching one side only, is this file's seam.
  for (const [name, src, msgRow] of [
    ["server.js", SERVER_JS, '<a href="/messages"'],
    ["index.html", INDEX_HTML, '<a id="navMessagesLink" href="/messages"'],
  ]) {
    const msg = src.indexOf(msgRow);
    const pipe = src.indexOf('<a id="navPipe" href="/pipeline"');
    const sites = src.indexOf('<a id="navSites" href="/sites"');
    const tools = src.indexOf('class="navsec">Tools<');
    assert.ok(msg > -1 && pipe > -1 && sites > -1, name + " is missing the Messages, Pipeline or Sites row");
    assert.ok(msg < pipe && pipe < sites && sites < tools,
      name + " does not put Pipeline, then Sites, directly under Messages and above Tools");
    assert.equal(src.split('id="navPipe"').length - 1, 1, name + " renders the Pipeline row twice");
    assert.equal(src.split('id="navSites"').length - 1, 1, name + " renders the Sites row twice");
  }
  // The same words and the same icons on both sides.
  const icon = (name) => {
    const m = SERVER_JS.match(new RegExp(name + ": NAV_ICON\\('([^']*)'\\)"));
    assert.ok(m, "NAV_ICONS has no " + name + " icon");
    return m[1];
  };
  assert.match(SERVER_JS, /\$\{NAV_ICONS\.pipeline\}<span class="nvl">Pipeline<\/span><\/a>/);
  assert.match(SERVER_JS, /\$\{NAV_ICONS\.sites\}<span class="nvl">Sites<\/span><\/a>/);
  const appPipe = INDEX_HTML.slice(INDEX_HTML.indexOf('<a id="navPipe"'), INDEX_HTML.indexOf("</a>", INDEX_HTML.indexOf('<a id="navPipe"')));
  const appSites = INDEX_HTML.slice(INDEX_HTML.indexOf('<a id="navSites"'), INDEX_HTML.indexOf("</a>", INDEX_HTML.indexOf('<a id="navSites"')));
  assert.ok(appPipe.includes(icon("pipeline")) && appPipe.includes('<span class="nvl">Pipeline</span>'),
    "the app's Pipeline row differs from marketBar's");
  assert.ok(appSites.includes(icon("sites")) && appSites.includes('<span class="nvl">Sites</span>'),
    "the app's Sites row differs from marketBar's");

  // One rule, reaching both stylesheets: ACCOUNT_NAV_CSS for every
  // server-rendered page and AUTH_BOOT_CSS, the one the server hands
  // index.html. Neither file restates it by hand.
  assert.match(SERVER_JS, /const SHOP_NAV_CSS =\s*`html:not\(\.shop-dev\) #navSites,html\.shop-dev #navPipe\{display:none!important\}`;/);
  assert.match(SERVER_JS, /\.hdr nav \[hidden\]\{display:none!important\}\n\/\*[^*]*\*\/\n\$\{SHOP_NAV_CSS\}/,
    "ACCOUNT_NAV_CSS no longer carries the rule");
  assert.match(SERVER_JS, /`html\.cn-locked #searchLock\{display:block!important\}` \+\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*SHOP_NAV_CSS;/,
    "AUTH_BOOT_CSS no longer carries the rule, so the app shows both rows");
  assert.ok(!INDEX_HTML.includes(".shop-dev"), "index.html restates the shop rule by hand");
  // The script reaches both too: marketShell's <head> and authBoot's.
  assert.match(SERVER_JS, /\(signedIn \? `<script>\$\{SHOP_NAV_JS\}<\/script>\\n` : ""\)/);
  assert.match(SERVER_JS, /SHOP_NAV_JS \+\s*`<\/script>\\n`;/);
  // Sites is a page of its own (2026-10-12), so the app never marks it and
  // never swaps Home's tab for it: it is an ordinary link, marked by
  // marketBar on /sites alone.
  const at = INDEX_HTML.indexOf("function markNavCurrent() {");
  const body = INDEX_HTML.slice(at, INDEX_HTML.indexOf("\n  }\n", at));
  assert.ok(!/navSites|hmTabProps/.test(body), "markNavCurrent marks Sites on Home again");
  assert.ok(!/getElementById\("navSites"\)\.addEventListener/.test(INDEX_HTML),
    "the app's Sites row opens Home's Properties tab in place again");
  assert.match(SERVER_JS, /<a id="navSites" href="\/sites"\$\{current === "\/sites" \? ' aria-current="page"' : ""\}>/,
    "marketBar does not mark Sites on /sites");
  // And the two pages that know the firm's kind write it down.
  assert.match(INDEX_HTML, /if \(window\.cnShopNav\) window\.cnShopNav\(Boolean\(myFirm\(\) && myFirm\(\)\.kind === "development"\)\);/,
    "loadMyFirms no longer tells the rail which kind of firm this is");
  assert.match(VAULT_JS, /if\(window\.cnShopNav\)window\.cnShopNav\(shop\);/,
    "applyShop no longer tells the rail which kind of firm this is");
});

// --- The rail's look (2026-11-12) ---------------------------------------------
//
// The owner's "the left side bar looks kind of ugly" was answered by redrawing
// the strip: a page surface instead of a dark slab, a tile and a red tick for
// the page you are on, icons on a pixel grid. All of it exists twice, once in
// RAIL_CSS and once in index.html, and until now only the account slot's
// three properties were compared between them. The tests below compare every
// rail rule the two files have, in every media block, so a restyle of one
// half cannot ship without the other.

// The rail's stylesheet, read as { media: { selector: { property: value } } }.
// The top level is a plain rule or one @media block of plain rules; nothing
// nests deeper. Rules are merged in source order, so where a later block
// restates a property (the icon rail over the 2026-08 rail above it) the later
// value wins, as it does in the browser for two rules with one selector. The
// answer is therefore what each box ends up with, not what one block says.
// Values keep their spaces ("0 0 12px" is not "00 12px"); only the spacing the
// two files write differently is ironed out: around a comma or a slash, inside
// brackets, and around the child combinator.
const tidyValue = (v) => v.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")
  .replace(/\s*,\s*/g, ",").replace(/\s*\/\s*/g, "/").trim();
const tidySelector = (s) => s.replace(/\s*>\s*/g, ">").replace(/\s+/g, " ").trim();
function railSheet(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const sheet = {};
  const add = (media, selectors, body) => {
    const decls = {};
    for (const d of body.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls[d.slice(0, i).trim()] = tidyValue(d.slice(i + 1));
    }
    const into = (sheet[media] = sheet[media] || {});
    for (const sel of selectors.split(",")) {
      const key = tidySelector(sel);
      into[key] = Object.assign(into[key] || {}, decls);
    }
  };
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    if (head.startsWith("@media")) {
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      const media = head.slice("@media".length).replace(/\s+/g, "");
      for (const m of text.slice(open + 1, j - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) add(media, m[1], m[2]);
      i = j;
    } else {
      const close = text.indexOf("}", open);
      add("", head, text.slice(open + 1, close));
      i = close + 1;
    }
  }
  return sheet;
}
const WIDE = "(min-width:900px)";                              // the rail
const SHORT = "(min-width:900px)and(max-height:559px)";        // the rail in a short window
const PHONE = "screenand(max-width:899px)";                    // the phone bar (2026-11-13)
const SERVER_RAIL = () => {
  const m = SERVER_JS.match(/const RAIL_CSS = `([\s\S]*?)\n`;/);
  assert.ok(m, "could not read RAIL_CSS");
  return railSheet(m[1]);
};
const APP_RAIL = () => {
  // From the app's first rail comment to the end of its print rule: every
  // rail rule index.html has, and nothing else.
  const from = INDEX_HTML.indexOf("/* --- The rail (NAV_SHELL=rail, 2026-08-28)");
  const print = INDEX_HTML.indexOf("@media print { html.nav-rail body {", from);
  assert.ok(from > -1 && print > from, "could not find index.html's rail rules");
  return railSheet(INDEX_HTML.slice(from, INDEX_HTML.indexOf("\n", print)));
};
const railOnly = (rules) => Object.keys(rules || {}).filter((k) => k.startsWith("html.nav-rail"));

// server.js's selector, then index.html's for the same box.
const RAIL_TWINS = [
  ["html.nav-rail body", "html.nav-rail body"],
  ["html.nav-rail .hdr", "html.nav-rail body>header"],
  ["html.nav-rail .hdr .wrap", "html.nav-rail .rd-appbar"],
  ["html.nav-rail .hleft", "html.nav-rail .rd-appbar>a"],
  ["html.nav-rail .hdr .brand .wordmark", "html.nav-rail .rd-appbar>a .rd-wordmark"],
  ["html.nav-rail .hdr .brand svg", "html.nav-rail .rd-appbar>a svg"],
  ["html.nav-rail .hdr nav", "html.nav-rail .rd-appbar>nav"],
  ["html.nav-rail .hdr nav>a", "html.nav-rail .rd-appbar>nav>a"],
  ["html.nav-rail .hdr nav>button", "html.nav-rail .rd-appbar>nav>button"],
  ["html.nav-rail .hdr nav>a .nvi", "html.nav-rail .rd-appbar>nav>a .nvi"],
  ["html.nav-rail .hdr nav>a:hover", "html.nav-rail .rd-appbar>nav>a:hover"],
  ['html.nav-rail .hdr nav>a[aria-current="page"]', 'html.nav-rail .rd-appbar>nav>a[aria-current="page"]'],
  ['html.nav-rail .hdr nav>a[aria-current="page"]::before', 'html.nav-rail .rd-appbar>nav>a[aria-current="page"]::before'],
  ["html.nav-rail .hdr nav>a:focus-visible", "html.nav-rail .rd-appbar>nav>a:focus-visible"],
  ["html.nav-rail .hdr nav>.navsec", "html.nav-rail .rd-appbar>nav>.navsec"],
  ["html.nav-rail .hdr nav .navdot", "html.nav-rail .rd-appbar .navdot"],
  ['html.nav-rail .hdr nav>a[aria-current="page"] .navdot', 'html.nav-rail .rd-appbar>nav>a[aria-current="page"] .navdot'],
  ["html.nav-rail .hdr nav>a:focus-visible .navdot", "html.nav-rail .rd-appbar>nav>a:focus-visible .navdot"],
  ["html.nav-rail .hdr nav>#navAcct", "html.nav-rail #acctMenuWrap"],
  // The circle is a <span> inside <summary> there and a <button> here, so
  // the pointer and the keyboard land on different elements.
  ["html.nav-rail .hdr nav>#navAcct .ini", "html.nav-rail #acctMenuBtn"],
  ["html.nav-rail .hdr nav>#navAcct summary:hover .ini", "html.nav-rail #acctMenuBtn:hover"],
  ["html.nav-rail .hdr nav>#navAcct summary:focus-visible .ini", "html.nav-rail #acctMenuBtn:focus-visible"],
  ["html.nav-rail .hdr nav>#navAcct .dd", "html.nav-rail #acctMenu"],
];
// What only one side has a reason to say.
const RAIL_SERVER_ONLY = [
  "html.nav-rail .hdr nav>a.btn.sm",                 // the red call to action: the app's nav has none
  "html.nav-rail .hdr nav>details:not(#navAcct)",    // the Explore menu, hidden there by its tag
  "html.nav-rail .hdr nav>a::after",                 // switches off the bar's enlarged hit area, which the app's links never had
  "html.nav-rail .hdr nav>#navAcct summary",         // the <summary> is the thing focused there; it is rounded,
  "html.nav-rail .hdr nav>#navAcct summary:focus-visible", // and carries the outline the app's button carries itself (below)
];
const RAIL_APP_ONLY = [
  "html.nav-rail #exploreMenuWrap",                  // the Explore menu, hidden here by its id
  "html.nav-rail .rd-appbar>nav>.hidden",            // Tailwind's .hidden, outranked by the row's display
  "html.nav-rail #acctMenuWrap.hidden",
  "html.nav-rail .rd-appbar>nav>button:hover",       // the Sign in button, a row only in the app
];
// A declaration one twin has that the other does not need. The account slot
// positions its menu, and in the app a Tailwind class already says so. The
// circle's focus keeps an outline for a forced-colours mode (see the test);
// the app's circle is the focused element itself, so the outline rides the
// rule that draws its ring, and the server's rides its <summary>.
const RAIL_FOCUS_OUTLINE = { outline: "2px solid transparent", "outline-offset": "2px" };
const RAIL_SERVER_EXTRA = { "html.nav-rail .hdr nav>#navAcct": { position: "relative" } };
const RAIL_APP_EXTRA = { "html.nav-rail #acctMenuBtn:focus-visible": RAIL_FOCUS_OUTLINE };

test("every rail rule is the same on both nav authors, in the rail and in a short window", () => {
  const server = SERVER_RAIL(), app = APP_RAIL();
  for (const media of [WIDE, SHORT]) {
    const s = server[media], a = app[media];
    assert.ok(s, `RAIL_CSS has no @media ${media} block`);
    assert.ok(a, `index.html has no @media ${media} block for the rail`);
    for (const [sSel, aSel] of RAIL_TWINS) {
      if (!s[sSel] && !a[aSel]) {
        assert.notEqual(media, WIDE, `neither file styles ${sSel} in the rail, so the table above is stale`);
        continue;
      }
      assert.ok(s[sSel], `RAIL_CSS has no ${media} rule for ${sSel}, and index.html has one for ${aSel}`);
      assert.ok(a[aSel], `index.html has no ${media} rule for ${aSel}, the twin of ${sSel}`);
      const want = Object.assign({}, s[sSel]), got = Object.assign({}, a[aSel]);
      for (const [side, extra, sel] of [[want, RAIL_SERVER_EXTRA, sSel], [got, RAIL_APP_EXTRA, aSel]]) {
        for (const prop of Object.keys((media === WIDE && extra[sel]) || {})) {
          assert.equal(side[prop], extra[sel][prop], `${sel} should still say ${prop}`);
          delete side[prop];
        }
      }
      assert.deepEqual(got, want, `@media ${media}: ${aSel} (index.html) and ${sSel} (RAIL_CSS) end up different`);
    }
    // And nothing unaccounted for on either side: a rule added to one file
    // only has to be either twinned above or named as that side's own.
    const sTwinned = new Set(RAIL_TWINS.map((t) => t[0])), aTwinned = new Set(RAIL_TWINS.map((t) => t[1]));
    assert.deepEqual(railOnly(s).filter((k) => !sTwinned.has(k)).sort(), media === WIDE ? [...RAIL_SERVER_ONLY].sort() : [],
      `@media ${media}: RAIL_CSS has a rail rule index.html does not`);
    assert.deepEqual(railOnly(a).filter((k) => !aTwinned.has(k)).sort(), media === WIDE ? [...RAIL_APP_ONLY].sort() : [],
      `@media ${media}: index.html has a rail rule RAIL_CSS does not`);
  }
  // The hover the app adds for its Sign in button is the anchors' own.
  assert.deepEqual(app[WIDE]["html.nav-rail .rd-appbar>nav>button:hover"], app[WIDE]["html.nav-rail .rd-appbar>nav>a:hover"]);

  // No third place: a rail rule outside the rail, short-window and print
  // blocks would be compared with nothing here (and, unguarded, would reach a
  // phone, which nav-shell.test.js refuses on the server's side).
  // (PHONE is the phone bar's block, 2026-11-13, compared in the next test.)
  assert.deepEqual(Object.keys(server).filter((m) => railOnly(server[m]).length).sort(), [PHONE, SHORT, WIDE, "print"].sort(),
    "RAIL_CSS grew rail rules in a media block this file does not compare");
  assert.deepEqual(Object.keys(app).filter((m) => railOnly(app[m]).length).sort(), [PHONE, SHORT, WIDE, "print"].sort(),
    "index.html grew rail rules in a media block this file does not compare");
  // Inside those blocks every rule is the rail's: one without the class would
  // be compared with nothing above, and would style the bar's rows as well.
  for (const [name, sheet] of [["RAIL_CSS", server], ["index.html", app]]) {
    for (const media of [WIDE, SHORT, PHONE, "print"]) {
      assert.deepEqual(Object.keys(sheet[media]).filter((k) => !k.startsWith("html.nav-rail")), [],
        `${name}: a rule in the rail's @media ${media} block does not start with html.nav-rail`);
    }
  }
  // Nor anywhere else in either file. The rail's chrome (the strip, its
  // column, its account slot) is styled in RAIL_CSS and in the app's rail
  // slice and nowhere else; Home's own html.nav-rail.hm-page layout rules
  // and the Feedback button's html.nav-rail .tninja rules are not chrome.
  const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const railCss = SERVER_JS.match(/const RAIL_CSS = `[\s\S]*?\n`;/)[0];
  assert.ok(!/html\.nav-rail \.(hdr|hleft)\b/.test(noComments(SERVER_JS.replace(railCss, ""))),
    "server.js styles the rail's chrome somewhere outside RAIL_CSS, where nothing compares it with index.html");
  const appFrom = INDEX_HTML.indexOf("/* --- The rail (NAV_SHELL=rail, 2026-08-28)");
  const appTo = INDEX_HTML.indexOf("\n", INDEX_HTML.indexOf("@media print { html.nav-rail body {", appFrom));
  const appStyle = INDEX_HTML.slice(0, INDEX_HTML.indexOf("</style>"));
  assert.ok(!/html\.nav-rail (body\s*>\s*header|\.rd-appbar|#acctMenu)/.test(noComments(appStyle.slice(0, appFrom) + appStyle.slice(appTo))),
    "index.html styles the rail's chrome somewhere outside its rail rules, where nothing compares it with RAIL_CSS");

  // Three decisions a tidy-up of BOTH files at once would undo, and parity
  // would not notice. The tick is a border and never a background, the
  // account circle's focus keeps an outline, both because a forced-colours
  // mode (Windows High Contrast) drops backgrounds and shadows and paints
  // borders and outlines: without them the page you are on, and the focused
  // circle, are unmarked there. And the strip's hairline is an inset shadow,
  // because a border would take a pixel from the 84px.
  const tick = server[WIDE]['html.nav-rail .hdr nav>a[aria-current="page"]::before'];
  assert.ok(/^3px solid var\(--red\)$/.test(tick["border-left"]) && !("background" in tick) && !("background-color" in tick),
    "the tick for the page you are on is no longer a border");
  assert.deepEqual(server[WIDE]["html.nav-rail .hdr nav>#navAcct summary:focus-visible"], RAIL_FOCUS_OUTLINE,
    "the server's account circle lost the outline a forced-colours mode draws for keyboard focus");
  const strip = server[WIDE]["html.nav-rail .hdr"];
  assert.ok(strip["border-right"] === "0" && /^inset -1px 0 0 var\(--line\)$/.test(strip["box-shadow"]),
    "the strip's hairline is no longer an inset shadow");

  // Paper. Both take the body's padding off. The server-rendered header also
  // prints (as a bar across the top), so it sheds what made it a strip, the
  // hairline's shadow included; the app's header is .no-print and needs none.
  assert.deepEqual(app.print, { "html.nav-rail body": { "padding-left": "0" } });
  assert.deepEqual(server.print["html.nav-rail body"], { "padding-left": "0" });
  assert.deepEqual(server.print["html.nav-rail .hdr"],
    { position: "static", width: "auto", "border-right": "0", "box-shadow": "none" });
  assert.deepEqual(railOnly(server.print).sort(), ["html.nav-rail .hdr", "html.nav-rail body"]);
});

// --- The phone bar (2026-11-13) -------------------------------------------------
//
// Below 900px the same nav lies along the bottom of the screen: six places and
// the account circle, an icon over a word. Like the rail it exists twice, and
// a member crosses between the two authors with every tap of the bar, so a
// bar that is 54px tall on Home and 58px on Messages jumps under the thumb.
// What genuinely differs is the account slot's markup (a <summary> holding a
// <span> there, a <div> holding a <button> here), named below.
const PHONE_TWINS = [
  ["html.nav-rail body", "html.nav-rail body"],
  ["html.nav-rail .hdr .wrap", "html.nav-rail .rd-appbar"],
  ["html.nav-rail .hdr nav", "html.nav-rail .rd-appbar>nav"],
  ["html.nav-rail .hdr nav>a", "html.nav-rail .rd-appbar>nav>a"],
  ["html.nav-rail .hdr nav>a .nvi", "html.nav-rail .rd-appbar>nav>a .nvi"],
  ['html.nav-rail .hdr nav>a[aria-current="page"]', 'html.nav-rail .rd-appbar>nav>a[aria-current="page"]'],
  ['html.nav-rail .hdr nav>a[aria-current="page"]::before', 'html.nav-rail .rd-appbar>nav>a[aria-current="page"]::before'],
  ["html.nav-rail .hdr nav>a:focus-visible", "html.nav-rail .rd-appbar>nav>a:focus-visible"],
  ["html.nav-rail .hdr nav .navdot", "html.nav-rail .rd-appbar .navdot"],
  ['html.nav-rail .hdr nav>a[aria-current="page"] .navdot', 'html.nav-rail .rd-appbar>nav>a[aria-current="page"] .navdot'],
  ["html.nav-rail .hdr nav>#navAcct .ini", "html.nav-rail #acctMenuBtn"],
  ["html.nav-rail .hdr nav>#navAcct .dd", "html.nav-rail #acctMenu"],
  ["html.nav-rail .hdr nav>#navAcct .dd button", "html.nav-rail #acctMenu button"],
];
const PHONE_SERVER_ONLY = [
  "html.nav-rail .hdr nav>a::after",                       // the bar's enlarged hit area, which the app's links never had
  "html.nav-rail .hdr nav>a.btn.sm",                       // the red call to action: the app's nav has none
  "html.nav-rail .hdr nav>#navPricing",                    // the Pricing row: the app's nav has none
  "html.nav-rail .hdr nav>details:not(#navAcct)",          // the Explore menu, hidden there by its tag
  "html.nav-rail .hdr nav>#navAcct",                       // the cell is the <details>; its <summary> fills it,
  "html.nav-rail .hdr nav>#navAcct summary",               // stacks the circle over the word and carries the word's type,
  "html.nav-rail .hdr nav>#navAcct summary::after",        // and the word is its ::after
  "html.nav-rail .hdr nav>#navAcct summary:focus-visible",
  "html.nav-rail .hdr nav>#navAcct .dd a",                 // the menu's Settings row is a link there, a button here
];
const PHONE_APP_ONLY = [
  "html.nav-rail #exploreMenuWrap",                        // the Explore menu, hidden here by its id
  "html.nav-rail #acctMenuWrap",                           // the cell is the wrap, which stacks the circle over the word,
  "html.nav-rail #acctMenuWrap.hidden",                    // (Tailwind's .hidden, outranked by the cell's display)
  "html.nav-rail #acctMenuWrap::after",                    // the word is the wrap's ::after and carries its own type,
  "html.nav-rail #acctMenuBtn::after",                     // and the button reaches over the cell to be the target
  "html.nav-rail #acctMenuBtn:focus-visible",
  "html.nav-rail #acctMenuPhoto",                          // the photo rounds itself once the button's overflow is visible
];
// The app's circle is the button itself: it lets its ::after out, and it is
// the thing a thumb lands on.
const PHONE_APP_EXTRA = {
  "html.nav-rail #acctMenuBtn": { overflow: "visible", "-webkit-tap-highlight-color": "transparent" },
};

test("the phone bar is the same on both nav authors", () => {
  const s = SERVER_RAIL()[PHONE], a = APP_RAIL()[PHONE];
  assert.ok(s, "RAIL_CSS has no phone bar block");
  assert.ok(a, "index.html has no phone bar block");
  for (const [sSel, aSel] of PHONE_TWINS) {
    assert.ok(s[sSel], `RAIL_CSS has no phone rule for ${sSel}`);
    assert.ok(a[aSel], `index.html has no phone rule for ${aSel}, the twin of ${sSel}`);
    const got = Object.assign({}, a[aSel]);
    for (const prop of Object.keys(PHONE_APP_EXTRA[aSel] || {})) {
      assert.equal(got[prop], PHONE_APP_EXTRA[aSel][prop], `${aSel} should still say ${prop}`);
      delete got[prop];
    }
    assert.deepEqual(got, s[sSel], `phone bar: ${aSel} (index.html) and ${sSel} (RAIL_CSS) end up different`);
  }
  const sTwinned = new Set(PHONE_TWINS.map((t) => t[0])), aTwinned = new Set(PHONE_TWINS.map((t) => t[1]));
  assert.deepEqual(railOnly(s).filter((k) => !sTwinned.has(k)).sort(), [...PHONE_SERVER_ONLY].sort(),
    "RAIL_CSS has a phone bar rule index.html does not");
  assert.deepEqual(railOnly(a).filter((k) => !aTwinned.has(k)).sort(), [...PHONE_APP_ONLY].sort(),
    "index.html has a phone bar rule RAIL_CSS does not");

  // The account cell, which the two write differently, comes out the same:
  // an equal share of the bar, the circle over the word Account, in the
  // places' own type. (The server's cell is the <details> and its padding is
  // split between it and the <summary>; the app's is one box.)
  const sCell = s["html.nav-rail .hdr nav>#navAcct"], sSum = s["html.nav-rail .hdr nav>#navAcct summary"];
  const aCell = a["html.nav-rail #acctMenuWrap"], aWord = a["html.nav-rail #acctMenuWrap::after"];
  const place = s["html.nav-rail .hdr nav>a"];
  assert.equal(sCell.flex, place.flex);
  assert.equal(aCell.flex, place.flex);
  assert.deepEqual([sCell.padding, sSum.padding], ["0 2px", "5px 0 4px"]);
  assert.equal(aCell.padding, place.padding);
  assert.equal(place.padding, "5px 2px 4px");
  for (const prop of ["font-size", "font-weight", "line-height", "color"]) {
    assert.equal(sSum[prop], place[prop], `the server's Account word is not set in the places' ${prop}`);
    assert.equal(aWord[prop], place[prop], `the app's Account word is not set in the places' ${prop}`);
  }
  assert.equal(s["html.nav-rail .hdr nav>#navAcct summary::after"].content, '"Account"');
  assert.equal(aWord.content, '"Account"');
  // The word is in the flow there: the bar's links give every <summary> an
  // absolutely placed ::after as a hit area, and this one is the word.
  assert.equal(s["html.nav-rail .hdr nav>#navAcct summary::after"].position, "static");
  // No cell may be squeezed below its word: with min-width:0 the heavier
  // word of the page you are on ran out of its tile on a 320px screen.
  for (const [name, rule] of [["RAIL_CSS", place], ["index.html", a["html.nav-rail .rd-appbar>nav>a"]], ["RAIL_CSS's account cell", sCell], ["index.html's account cell", aCell]]) {
    assert.ok(!("min-width" in rule), `${name} sets a min-width, which lets a word be cut by its cell`);
  }
  // The app's wrap carries no type of its own: its menu is its child and
  // would inherit 10px rows.
  assert.ok(!("font-size" in aCell), "the app's account cell sets a font size its menu inherits");
});

test("every rail icon in the app is the server's drawing", () => {
  // This file already held Pipeline and Sites to NAV_ICONS; the other five
  // rows were copied by hand and held by nothing, so a redraw could land on
  // the server-rendered pages alone and the strip would change its icons as a
  // member moved between Home and anywhere else.
  const tpl = SERVER_JS.match(/const NAV_ICON = \(paths\) => `([^`]*)`;/);
  assert.ok(tpl, "could not read NAV_ICON's template");
  const svg = (name) => {
    const m = SERVER_JS.match(new RegExp("\\n  " + name + ": NAV_ICON\\('([^']*)'\\)"));
    assert.ok(m, "NAV_ICONS has no " + name + " icon");
    return tpl[1].replace("${paths}", m[1]);
  };
  for (const [name, rowStart] of [
    ["home", '<a id="myDeskLink" href="/desk"'],
    ["messages", '<a id="navMessagesLink" href="/messages"'],
    ["pipeline", '<a id="navPipe" href="/pipeline"'],
    ["sites", '<a id="navSites" href="/sites"'],
    ["markets", '<a href="/markets"'],
    ["reports", '<a id="navComps" href="/comps"'],
    ["permits", '<a href="/permits"'],
  ]) {
    const at = INDEX_HTML.indexOf(rowStart);
    assert.ok(at > -1, "index.html has no row starting " + rowStart);
    const row = INDEX_HTML.slice(at, INDEX_HTML.indexOf("</a>", at));
    assert.ok(row.includes(svg(name)), `the app's ${name} icon is not NAV_ICONS.${name}`);
  }
  // One hand: a unit to a pixel, and the stroke every drawing was made for.
  assert.match(tpl[1], /viewBox="0 0 24 24"/);
  assert.match(tpl[1], /stroke-width="1\.5"/);
  const shown = SERVER_RAIL()[WIDE]["html.nav-rail .hdr nav>a .nvi"];
  assert.deepEqual([shown.width, shown.height], ["24px", "24px"],
    "the icons are drawn on 24 units; shown at any other size their strokes fall between pixels");
  // And no row keeps a drawing from the old 20-unit set beside them.
  assert.ok(!INDEX_HTML.includes('<svg class="nvi" viewBox="0 0 20 20"'), "a rail row in index.html still has a 20-unit icon");

  // Permits is one drawing wherever Home draws it. Its rail row, the switch
  // over the map and the first-run door all sit on one screen; the last two
  // are 16px and 18px icons on a 20-unit grid among others like them, so they
  // carry the same sheet with a tick redrawn on that grid rather than the
  // rail's paths. The old sheet (two lines and a seal) must be gone from all.
  const TICK_20 = '<rect x="4.75" y="2.75" width="10.5" height="14.5" rx="1.25"/><path d="M7.25 6.25h5.5"/><path d="M7.25 11.75l1.75 1.75 3.5-3.75"/>';
  for (const anchor of ['id="hmLayerPermits"', 'class="hm-first-door" href="/permits"']) {
    const at = INDEX_HTML.indexOf(anchor);
    assert.ok(at > -1, "index.html lost " + anchor);
    assert.ok(INDEX_HTML.slice(at, at + 700).includes(TICK_20), anchor + " draws a different Permits sheet from the rail's");
  }
  assert.match(SERVER_JS, /\n  permits: NAV_ICON\('<rect x="5\.5" y="3\.5" width="13" height="17" rx="1\.5"\/><path d="M8\.5 7\.5h7"\/><path d="M8\.75 14\.25 11 16\.5l4\.25-4\.75"\/>'\)/,
    "the rail's Permits is no longer the sheet with one line and a tick that TICK_20 restates");
  assert.ok(!/<circle cx="10" cy="13" r="1\.(75|8)"\/>/.test(INDEX_HTML + SERVER_JS), "the old Permits sheet with a seal is still drawn somewhere");
});

// The rail's column, added up from the stylesheet's own numbers: WIDE alone,
// or WIDE with the short-window block laid over it.
// Strict: parseFloat would read "9px2px" as 9, and a browser drops that whole
// declaration, so a slip of a space would pass here and change the page.
const railPx = (v) => {
  assert.ok(/^(0|-?\d*\.?\d+px)$/.test(String(v)), "not a length a browser would accept: " + v);
  return parseFloat(v);
};
const railBox = (v) => {                                // a 1-to-4 value shorthand, read as top and bottom
  const p = String(v || "0").split(" ").map(railPx);
  return { top: p[0], bottom: p.length > 2 ? p[2] : p[0] };
};
// A label's line: a length as written, or a multiple of the font size.
const railLine = (lineHeight, fontPx) => (/px$/.test(lineHeight) ? railPx(lineHeight) : fontPx * railPx(lineHeight));
const TEXT_TINY_PX = railPx(require("../theme.js").SCALE_TOKENS["text-tiny"]);
function railColumn(sheet, short) {
  const rule = (sel) => {
    const base = Object.assign({}, sheet[WIDE][sel]);
    const over = short ? (sheet[SHORT][sel] || {}) : {};
    // A longhand laid over a shorthand: fold padding-top / padding-bottom in.
    const pad = railBox(base.padding);
    if (over.padding) Object.assign(pad, railBox(over.padding));
    if (over["padding-top"]) pad.top = railPx(over["padding-top"]);
    if (over["padding-bottom"]) pad.bottom = railPx(over["padding-bottom"]);
    return Object.assign(base, over, { pad });
  };
  const row = rule("html.nav-rail .hdr nav>a");
  assert.equal(row["font-size"], "var(--text-tiny)", "the row's label is no longer the size this sum assumes");
  // A border above or below a row is height this sum would not see.
  assert.deepEqual(Object.keys(row).filter((k) => /^border/.test(k) && k !== "border-radius").sort(), ["border-left"],
    "a row gained a border; add its width to this sum before trusting it");
  assert.equal(row["border-left"], "0");
  const margin = railBox(row.margin);
  const inner = row.pad.top + railPx(rule("html.nav-rail .hdr nav>a .nvi").height) + railPx(row.gap)
    + railLine(row["line-height"], TEXT_TINY_PX) + row.pad.bottom;
  const rowH = Math.max(inner, row["min-height"] ? railPx(row["min-height"]) : 0) + margin.top + margin.bottom;
  const gap = railPx(rule("html.nav-rail .hdr nav").gap);
  const sec = rule("html.nav-rail .hdr nav>.navsec");
  const divider = railPx(sec.height) + railBox(sec.margin).top + railBox(sec.margin).bottom;
  const wrap = rule("html.nav-rail .hdr .wrap");
  const head = wrap.pad.top + railPx(rule("html.nav-rail .hdr .brand svg").height) + rule("html.nav-rail .hleft").pad.bottom;
  const circle = railPx(rule("html.nav-rail .hdr nav>#navAcct .ini").height);
  // The foot: the slot's own padding above the circle, the circle, the strip's padding under it.
  const foot = rule("html.nav-rail .hdr nav>#navAcct").pad.top + circle + wrap.pad.bottom;
  // `rows` rows and the divider are rows + 1 flex items, so `rows` gaps. The
  // account slot is a flex item of the same nav, so one more gap sits between
  // the last row and it: the whole column is columnEnd.
  const rowsEnd = (rows) => head + rows * rowH + rows * gap + divider;
  return { rowH, gap, foot, circleTop: circle + wrap.pad.bottom, rowsEnd, columnEnd: (rows) => rowsEnd(rows) + gap + foot };
}

test("seven rows, Feedback and the account circle fit, in the tallest and the shortest window", () => {
  // The sums RAIL_CSS's comments ask the next editor to re-add, done here. A
  // free member reading a server-rendered page has a seventh row (Pricing).
  // Until 2026-11-12 that row pushed Permits 17px into the Feedback button in
  // a 620px window, and in any window under 570px the account circle was
  // pushed off the bottom, with nothing anywhere to say so.
  const sheet = SERVER_RAIL();
  const tall = railColumn(sheet, false), short = railColumn(sheet, true);

  // Feedback, from its own rules: it is laid out like a row, but nothing
  // makes it one, so its height is read rather than assumed.
  const blocks = [...SERVER_JS.matchAll(/@media \(min-width:900px\) and \(min-height:(\d+)px\)\{([\s\S]*?)\n    \}/g)];
  assert.equal(blocks.length, 2, "the Feedback button should have two rail blocks: its placement, and the rule above it");
  const minHeight = Number(blocks[0][1]), ruleFrom = Number(blocks[1][1]);
  const fb = railSheet(blocks[0][2])[""];
  const btn = fb["html.nav-rail .tninja"], glyph = fb["html.nav-rail .tninja svg"];
  assert.ok(btn && glyph, "the Feedback button's rail rules lost the button or its glyph's size (the svg is 22px by its own attributes)");
  assert.equal(btn["font-size"], "var(--text-tiny)");
  assert.equal(btn.border, "0", "the Feedback button gained a border; add its width to this sum before trusting it");
  const fbHeight = railBox(btn.padding).top + railPx(glyph.height) + railBox(glyph.margin).top + railBox(glyph.margin).bottom
    + railPx(btn.gap) + railLine(btn["line-height"], TEXT_TINY_PX) + railBox(btn.padding).bottom;
  const fbBottom = railPx(btn.bottom);
  assert.ok(Math.abs(fbHeight - tall.rowH) < 0.01, `Feedback is ${fbHeight.toFixed(1)}px tall and a row is ${tall.rowH.toFixed(1)}px: it is drawn as a row`);

  // 1. In the shortest window that keeps Feedback in the strip, seven rows
  //    end above it with at least the gap rows keep between themselves.
  const fbTop = minHeight - fbBottom - fbHeight;
  assert.ok(tall.rowsEnd(7) + tall.gap <= fbTop,
    `seven rows end at ${tall.rowsEnd(7).toFixed(1)}px and Feedback starts at ${fbTop.toFixed(1)}px in a ${minHeight}px window`);
  // 2. Feedback stands on the foot: on or above the foot block, and never
  //    nearer the circle than rows are to each other.
  assert.ok(fbBottom >= tall.circleTop + tall.gap, `Feedback sits ${fbBottom}px up and the account circle reaches ${tall.circleTop}px up`);
  assert.equal(fbBottom, tall.foot, "Feedback no longer stands on the strip's foot block");
  // 3. The rule above Feedback only shows where it stands clear of the last row.
  const line = railSheet(blocks[1][2])[""]["html.nav-rail .tninja::before"];
  assert.ok(line && line.top && line.height, "the rule above Feedback is gone");
  const lineTop = ruleFrom - fbBottom - fbHeight + railPx(line.top);
  assert.ok(tall.rowsEnd(7) + tall.gap <= lineTop,
    `seven rows end at ${tall.rowsEnd(7).toFixed(1)}px and the rule above Feedback is at ${lineTop.toFixed(1)}px in a ${ruleFrom}px window`);
  // 4. Where Feedback has left the strip, seven rows and the circle still fit
  //    down to the height at which the short-window block takes over...
  const shortFrom = Number(SHORT.match(/max-height:(\d+)px/)[1]) + 1;
  assert.ok(tall.columnEnd(7) <= shortFrom,
    `seven rows and the account circle need ${tall.columnEnd(7).toFixed(1)}px, and the short-window block only starts under ${shortFrom}px`);
  // 5. ...and under it the closed-up column holds them in a 430px window,
  //    which is a 768px laptop zoomed to 150%.
  assert.ok(short.columnEnd(7) <= 430,
    `in a short window seven rows and the account circle need ${short.columnEnd(7).toFixed(1)}px`);
  assert.ok(short.rowH < tall.rowH, "the short-window block no longer closes the rows up");
});

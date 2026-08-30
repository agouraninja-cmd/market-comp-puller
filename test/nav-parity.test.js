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
  assert.equal(INDEX_HTML.split("markNavCurrent();").length - 1, 4,
    "every seam that hides or shows the workspace must re-mark the rail");
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

test("the vault row is called the same thing on both sides of the click", () => {
  // It read "Your vault" in the app and "Vault" everywhere else, so the row a
  // member was looking at renamed itself the moment they clicked it.
  assert.match(INDEX_HTML, /id="menuVaultLink"[^>]*>Vault</,
    "the app's vault row does not use the shared label");
  assert.ok(!/>Your vault</.test(INDEX_HTML),
    "the old label is still rendered somewhere in the app");
  assert.match(SERVER_JS, /id="navVault"[^>]*>Vault</,
    "the shared rail's label moved; the app's copy now disagrees with it");
});

test("the theme switch is a rail row on the app too, not a modal setting", () => {
  // accountNavSlots renders this control as a row on /markets, /vault, /bulk
  // and the rest. The app kept its copy inside the settings panel — which was
  // right on 2026-08-23, five days before the rail existed, and left the app
  // as the one surface in the product where the switch was not on screen.
  const navAt = INDEX_HTML.indexOf('<button id="themeToggleApp"');
  assert.notEqual(navAt, -1, "the app's theme toggle is gone");
  const acctAt = INDEX_HTML.indexOf('<div id="acctMenuWrap"');
  const modalEnd = INDEX_HTML.indexOf('<!-- Header -->');
  assert.ok(navAt < acctAt,
    "the toggle sits above the account cluster, as it does in the shared rail");
  assert.ok(navAt > modalEnd,
    "the toggle must have LEFT the settings panel, not been copied out of it");
  // ONE button. A second toggle would be a second thing to keep in step with
  // server.js's, which theme.test.js pins line for line — and it is exactly
  // what a future editor reaches for when asked to put this back in Settings.
  assert.equal(INDEX_HTML.split('id="themeToggleApp"').length - 1, 1,
    "exactly one theme toggle element in index.html");
  assert.match(INDEX_HTML, /html\.nav-rail #themeToggleApp \{/,
    "the shared rail gives its toggle its own spacing; the app's needs the same");
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

test("the vault's footer is not a dead end", async (t) => {
  // It was four lines of prose and NOT ONE LINK. Survivable while the page
  // wore a top bar with an Explore dropdown in it; a dead end the moment the
  // rail took that dropdown away, because below 900px the header is the only
  // navigation on the page and above it the footer is where every other
  // surface keeps these.
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/vault", { headers: SESSION })).text();
  const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
  assert.ok(footer.length > 0, "/vault has no footer at all");
  for (const href of ["/markets", "/brokers", "/firms", "/how-it-works", "/terms", "/privacy", "/download"]) {
    assert.ok(footer.includes('href="' + href + '"'), "/vault's footer cannot reach " + href);
  }
  // One source, not a fourth hand-copy: these are the same columns
  // MARKET_FOOTER renders, so a link added there arrives here too.
  assert.match(SERVER_JS, /const FOOTER_LINK_COLS =/, "the columns were not extracted");
  assert.equal(SERVER_JS.split("FOOTER_LINK_COLS").length - 1, 3,
    "FOOTER_LINK_COLS should be declared once, then used by MARKET_FOOTER and by the vault");
  // ...and the rules that draw them travel with the markup, or this page's own
  // anchor colour paints them red on the navy slab.
  assert.match(VAULT_JS, /\$\{FOOTER_LINKS_CSS\}/,
    "the vault renders the columns with no rules for them");
  // The rules themselves are shared rather than pasted a third time: MARKET_CSS
  // and HOW_CSS take the same const, which is what RAIL_CSS's own note argues.
  assert.equal(SERVER_JS.split("FOOTER_LINKS_CSS").length - 1, 4,
    "FOOTER_LINKS_CSS should be declared once, then used by MARKET_CSS, HOW_CSS and the vault");
});

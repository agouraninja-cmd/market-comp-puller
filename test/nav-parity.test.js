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
  assert.match(INDEX_HTML,
    /getElementById\("settingsUpgradeBtn"\)\.classList\.toggle\("hidden", !live \|\| pro\)/,
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
  assert.match(INDEX_HTML, /if \(live && !pro\) openPricingModal\(\)/,
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

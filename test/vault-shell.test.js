// /vault on the shared chrome (Task 9 of the rail plan, 2026-08-30).
//
// Run: npm test
//
// Cost: zero. The server here boots with no Anthropic key, no Supabase and no
// Stripe; the route under test is a pure render.
//
// WHAT THIS FILE IS FOR. vault-page.js used to build a whole HTML document,
// which made it the one page that had to re-implement the site's chrome — and
// therefore the one page that drifted from it. It renders a BODY now, and
// marketShell supplies the rest. Two classes of thing can go wrong with that,
// and this file covers both:
//
//   1. The chrome is really the shared chrome (header, footer, current row),
//      asserted against the SERVED page rather than against either file.
//   2. MARKET_CSS is now on this document, and the vault has its own complete
//      design system — so any selector the two stylesheets share leaks every
//      property the vault does not itself set. That is not hypothetical: it
//      cost .ledger and .card a 22px/18px margin, .lcell a right border, and
//      the comps table a 180px first column, all measured in a browser before
//      this suite existed. The last test computes the whole set.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");

const SESSION = { cookie: "cn_session=not-a-real-token" };
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SERVER_JS = read("server.js");
const VAULT_JS = read("vault-page.js");
const HUB_JS = read("hub-page.js");

test("/vault is rendered by marketShell, header and footer included", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/vault", { headers: SESSION })).text();

  // One document, and the shell's.
  assert.equal((html.match(/<!DOCTYPE/gi) || []).length, 1, "not exactly one doctype");
  assert.equal((html.match(/<header/g) || []).length, 1, "not exactly one header");
  assert.equal((html.match(/<footer/g) || []).length, 1, "not exactly one footer");
  assert.equal((html.match(/<main/g) || []).length, 1, "not exactly one main");

  // The shared header, not a local one. marketBar's own structure (.hleft) is
  // the tell: the hand-written copy had it too, so the real proof is the rows
  // it renders that the copy never did.
  assert.match(html, /<div class="hleft">/, "not marketBar's header");
  const nav = html.slice(html.indexOf("<nav>"), html.indexOf("</nav>"));
  for (const href of ["/desk", "/vault", "/markets", "/1031-exchange", "/bulk"]) {
    assert.ok(nav.includes('href="' + href + '"'), "the vault's nav lost " + href);
  }
  // Where the reader is, from marketShell's `current` rather than a literal.
  assert.match(nav, /id="navVault"[^>]*aria-current="page"/,
    "the vault does not mark its own row as the current page");
  // The account cluster arrives with accountNavSlots. The theme toggle does
  // NOT, since later the same day (owner's call): the switch went back into
  // index.html's settings panel and out of every nav, so what this page owes
  // its reader is the Settings row inside that cluster, which is the door to
  // it. A toggle reappearing here would mean two controls again.
  assert.ok(nav.includes('id="navAcct"'), "no account cluster");
  assert.ok(!nav.includes('id="themeToggle"'),
    "a theme toggle is back in the nav; the one control lives in the settings panel");
  assert.ok(nav.includes('href="/desk?settings=1"'),
    "the vault's account menu has no door to the settings panel");

  // The shared footer, with links in it. Before the fold this page's footer
  // was four lines of prose and not one anchor.
  const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
  for (const href of ["/markets", "/brokers", "/firms", "/pricing", "/terms", "/download"]) {
    assert.ok(footer.includes('href="' + href + '"'), "/vault's footer cannot reach " + href);
  }
});

test("Escape steps back from the vault, as it does from every other page", async (t) => {
  // The vault hand-wrote a truncated copy of marketBar's key handler: it
  // closed the dropdown and stopped, so Escape did nothing on the one page a
  // broker is most likely to want out of. Nothing was fixed here — the copy
  // was deleted, and the shared one came with the shell.
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/vault", { headers: SESSION })).text();
  assert.match(html, /function goBack\(\)/,
    "the vault does not get marketBar's Escape handler");
  assert.ok(!VAULT_JS.includes('e.key!=="Escape"'),
    "vault-page.js still carries its own truncated Escape script");
});

test("the vault keeps Inter, which no other marketShell page loads", async (t) => {
  // MARKET_CSS names Inter in body{} and NO server-rendered page fetches it —
  // they were all designed against the system fallback. /vault was its own
  // document and did load it, so folding it onto the shell would have silently
  // restyled the page brokers use daily. This is the one thing the fold had to
  // carry across, and it rides marketShell's `head`.
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/vault", { headers: SESSION })).text();
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter/,
    "/vault lost its typeface in the fold");
  assert.match(SERVER_JS, /const INTER_FONT_HEAD =/,
    "the font head should be a named constant, not pasted into the route");
});

test("vault-page.js is a body renderer and takes nothing but a boot payload", () => {
  // The twelve-key chrome object this route used to build (CN_LOGO, RAIL_CSS,
  // ACCOUNT_NAV_*, FOOTER_*, THEME_*, NAV_SHELL_CLASS) existed only to
  // reconstruct by hand what marketShell already had. Its absence is the
  // measure of the fold.
  assert.match(VAULT_JS, /function renderVaultBody\(boot\) \{/,
    "the export should take the boot payload alone");
  assert.ok(!/renderVaultHTML/.test(VAULT_JS + SERVER_JS),
    "the document-building entry point is gone, not merely unused");
  for (const key of ["chrome.CN_LOGO", "chrome.RAIL_CSS", "chrome.ACCOUNT_NAV_JS",
    "chrome.THEME_BOOT", "chrome.NAV_SHELL_CLASS", "chrome.FOOTER_LINK_COLS"]) {
    assert.ok(!VAULT_JS.includes(key), "vault-page.js still reads " + key);
  }
  assert.match(SERVER_JS, /body: renderVaultBody\(boot\)/,
    "the route should hand marketShell a body");
});

test("the hub is deliberately NOT folded onto the rail", () => {
  // The plan's other half, and it is a decision rather than a port: a hub is
  // shown to somebody else's CLIENT, who is not inside your product, so it
  // gets neither the rail nor the member chrome that comes with it. It keeps
  // building its own document on purpose.
  assert.ok(!HUB_JS.includes("nav-rail"), "hub-page.js grew the member rail");
  assert.ok(!/marketShell/.test(HUB_JS), "hub-page.js should keep its own minimal shell");
  const at = SERVER_JS.indexOf("renderHubHTML");
  assert.notEqual(at, -1, "the hub route is gone");
});

test("no MARKET_CSS declaration leaks into a vault component", () => {
  // THE test this fold turns on. Both stylesheets are on the document now, and
  // they independently use .card, .ledger, .lcell, .btn, .kicker, .sub, .wrap,
  // table, th and td for DIFFERENT components. A shared selector is only a
  // problem for the properties the vault does not set — those fall through to
  // MARKET_CSS's rule. Measured in a browser first: .ledger and .card each
  // gained a margin, .lcell a right border and a flex basis, the comps table
  // tabular figures everywhere and a 180px first column.
  //
  // Computed rather than listed, so a property ADDED to a MARKET_CSS rule
  // years from now fails here instead of quietly restyling a broker's book.
  const marketAt = SERVER_JS.indexOf("const MARKET_CSS = `");
  const marketCss = SERVER_JS.slice(marketAt, SERVER_JS.indexOf("`;", marketAt));
  const vaultCss = VAULT_JS.slice(VAULT_JS.indexOf("<style>"), VAULT_JS.indexOf("</style>"));

  // Single-selector rules only, class or element, keyed by their whole text so
  // like is compared with like. A comma list is expanded, because
  // `td:first-child,th:first-child{min-width:180px}` is one of the rules that
  // actually bit.
  function rules(css) {
    const out = {};
    for (const m of css.matchAll(/(^|\n)\s*([.a-zA-Z][\w .>,:()-]*?)\s*\{([^}]*)\}/g)) {
      const props = new Set();
      for (const d of m[3].split(";")) {
        const p = d.split(":")[0].trim().toLowerCase();
        if (p) props.add(p);
      }
      for (const sel of m[2].split(",").map((x) => x.trim())) {
        if (!sel || /[[#]/.test(sel)) continue;
        out[sel] = new Set([...(out[sel] || []), ...props]);
      }
    }
    return out;
  }
  const M = rules(marketCss);
  const V = rules(vaultCss);

  const leaks = [];
  for (const sel of Object.keys(V)) {
    if (!M[sel]) continue;
    const leaked = [...M[sel]].filter((p) => !V[sel].has(p));
    if (leaked.length) leaks.push(sel + " -> " + leaked.join(", "));
  }
  assert.deepEqual(leaks, [],
    "MARKET_CSS reaches vault components through shared selectors. Either state "
    + "the property on the vault's own rule (what the others do) or rename the "
    + "vault's class. Leaks: " + leaks.join(" | "));

  // And the invariant is only meaningful if it is actually comparing something.
  assert.ok(Object.keys(V).filter((s) => M[s]).length >= 5,
    "the shared-selector set collapsed to nothing — this test stopped checking anything");
});

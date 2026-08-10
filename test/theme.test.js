// The dark-mode token table. Pure like entitlements.test.js: no server, no
// database, no clock. The light values here are copied verbatim from the
// :root block vault-page.js and the four dashboards already share, so a
// changed light value is a regression in the theme that already ships.
const test = require("node:test");
const assert = require("node:assert");
const { THEME_TOKENS, rootCss } = require("../theme.js");

// The vocabulary that already exists in five shipped pages. If any light
// value here drifts, those pages restyle silently.
const EXISTING = {
  ink: "#1A2433", "ink-2": "#4C5665", "ink-3": "#68707E", "ink-4": "#C7CBD2",
  red: "#B91C1C", "red-deep": "#991B1B", green: "#15803D",
  paper: "#FBFBF9", line: "#E4E2DA", hair: "#F0EFE9",
  wash: "#F5F4EF", edge: "#D8D4C9",
};

test("the pre-existing token vocabulary keeps its exact light values", () => {
  for (const [name, light] of Object.entries(EXISTING)) {
    assert.ok(THEME_TOKENS[name], `missing token --${name}`);
    assert.equal(THEME_TOKENS[name].light, light, `--${name} light value moved`);
  }
});

test("every token declares both a light and a dark value", () => {
  for (const [name, v] of Object.entries(THEME_TOKENS)) {
    assert.equal(typeof v.light, "string", `--${name} has no light value`);
    assert.equal(typeof v.dark, "string", `--${name} has no dark value`);
    assert.match(v.light, /^#[0-9A-Fa-f]{3,8}$/, `--${name} light is not a hex`);
    assert.match(v.dark, /^#[0-9A-Fa-f]{3,8}$/, `--${name} dark is not a hex`);
  }
});

test("the text/fill split exists, because a filled button must stay saturated", () => {
  // --red lightens for contrast as TEXT on a dark page; --red-fill stays
  // saturated because white text sits on top of it.
  assert.notEqual(THEME_TOKENS["red"].dark, THEME_TOKENS["red-fill"].dark);
  assert.equal(THEME_TOKENS["red-fill"].light, THEME_TOKENS["red"].light);
});

test("surfaces already dark in light mode lift rather than stay put", () => {
  // --slab is #1A2433 on light paper. If its dark value equalled --paper it
  // would dissolve into the page and the emphasis would vanish.
  assert.notEqual(THEME_TOKENS["slab"].dark, THEME_TOKENS["paper"].dark);
});

test("rootCss emits both blocks with every token", () => {
  const css = rootCss();
  assert.match(css, /^:root\{/);
  assert.match(css, /\[data-theme="dark"\]\{/);
  for (const [name, v] of Object.entries(THEME_TOKENS)) {
    assert.ok(css.includes(`--${name}:${v.light}`), `light --${name} missing`);
    assert.ok(css.includes(`--${name}:${v.dark}`), `dark --${name} missing`);
  }
});

test("rootCss is safe to interpolate into a template literal", () => {
  // Every in-scope stylesheet is a JS template literal. A backtick or a
  // ${ in this string would end it and break the module that embeds it.
  const css = rootCss();
  assert.equal(css.includes("`"), false);
  assert.equal(css.includes("${"), false);
});

const fs = require("node:fs");
const path = require("node:path");
// Normalize CRLF -> LF: this checkout is on Windows (core.autocrlf), so
// server.js is checked out with CRLF even though the repo stores LF: a
// literal "\n" search below would otherwise never match.
const root = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r\n/g, "\n");

// The stylesheets in scope. The four admin dashboards are deliberately NOT
// here: they declare their own :root and are out of scope (spec section 1).
const SERVER_JS = root("server.js");
const VAULT_JS = root("vault-page.js");

// Slice one template-literal CSS constant out of server.js by name.
function cssBlock(name) {
  const start = SERVER_JS.indexOf(`const ${name} = \``);
  assert.notEqual(start, -1, `${name} not found`);
  const from = SERVER_JS.indexOf("`", start) + 1;
  // The closing backtick isn't always preceded by a newline (a block whose
  // last line is `${ACCOUNT_NAV_CSS}` puts the backtick right after the
  // interpolation), so match on the "`;" pair itself rather than assuming
  // a preceding "\n". None of these blocks contain a literal backtick.
  const end = SERVER_JS.indexOf("`;", from);
  assert.notEqual(end, -1, `${name} has no closing backtick`);
  return SERVER_JS.slice(from, end);
}

test("no in-scope stylesheet references an undefined variable", () => {
  const defined = new Set(Object.keys(THEME_TOKENS).map((n) => `--${n}`));
  const blocks = {
    MARKET_CSS: cssBlock("MARKET_CSS"),
    HOW_CSS: cssBlock("HOW_CSS"),
    ACCOUNT_NAV_CSS: cssBlock("ACCOUNT_NAV_CSS"),
    "index.html": root("index.html").split("</style>")[0],
    "vault-page.js": VAULT_JS,
  };
  for (const [where, css] of Object.entries(blocks)) {
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      // vault-page.js and the market CSS also carry non-colour scales
      // (--t1..--t6 type, --s1..--s9 spacing, --r radius, --serif). Those
      // are page-local and not the theme's business.
      if (/^--(t\d|s\d|r|serif)$/.test(m[1])) continue;
      assert.ok(defined.has(m[1]), `${where} uses undefined ${m[1]}`);
    }
  }
});

test("no in-scope stylesheet paints a background with the TEXT red", () => {
  // --red lightens to brand-400 in dark mode for contrast as text. Used as
  // a background it turns a filled button pale pink, and only in dark mode
  // on one page -- exactly what manual review misses. --red-fill exists
  // for backgrounds.
  //
  // VAULT_JS is deliberately NOT checked here yet. It already has
  // `.btn{background:var(--red)}` (shipped 2026-08-06, long before this
  // project), and spec section 4.2 assigns fixing that one declaration to
  // the vault task, not this one -- adding the check here would fail
  // `npm test` on a file this task neither touches nor is allowed to stage.
  // Re-add VAULT_JS to this array once that task lands.
  const blocks = [
    cssBlock("MARKET_CSS"), cssBlock("HOW_CSS"), cssBlock("ACCOUNT_NAV_CSS"),
  ];
  for (const css of blocks) {
    for (const m of css.matchAll(/background[^;{}]*var\((--red|--red-deep)\)/g)) {
      assert.fail(`background uses ${m[1]}; use --red-fill / --red-fill-hover`);
    }
  }
});

test("every in-scope server page can set the theme before first paint", () => {
  // The snippet is render-blocking and lives in <head> on purpose: anything
  // deferred paints the light theme first and flashes white on a dark page.
  assert.ok(SERVER_JS.includes("const THEME_BOOT ="), "THEME_BOOT not declared");
  // marketShell covers /markets, /market/<slug>, /brokers, /broker/<slug>,
  // /1031-exchange, /terms, /privacy. The how-it-works render covers / and
  // /how-it-works.
  const shell = SERVER_JS.slice(SERVER_JS.indexOf("function marketShell("));
  assert.ok(shell.slice(0, 2000).includes("THEME_BOOT"), "marketShell lacks the boot script");
  // vault-page.js is deliberately NOT checked here yet. This task (Task 3)
  // does not touch vault-page.js -- see its Files list -- and the boot
  // script lands there in Task 6, next in the task order. Asserting on it
  // now would fail `npm test` on a file this task neither edits nor is
  // allowed to stage. Task 6 must add that assertion here once it lands
  // THEME_BOOT (or an equivalent inline script) in vault-page.js's <head>.
});

test("the toggle is rendered once per page, in the shared nav", () => {
  const slots = SERVER_JS.slice(SERVER_JS.indexOf("function accountNavSlots("));
  assert.ok(slots.slice(0, 1500).includes(`id="themeToggle"`), "no toggle in accountNavSlots");
  // accountNavSlots is the ONE place it may live. A second copy in
  // marketBar or the how-it-works header would render two toggles on the
  // pages that call both.
  const occurrences = SERVER_JS.split(`id="themeToggle"`).length - 1;
  assert.equal(occurrences, 1, "themeToggle is declared more than once in server.js");
});

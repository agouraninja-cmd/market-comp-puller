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

test("rootCss's dark block is screen-only, so a print run never resolves dark values", () => {
  // The OBVIOUS test here -- grep every in-scope stylesheet's @media print
  // span for the literal text "[data-theme" -- is exactly what the print-
  // safety tests below already do, and it is not enough. Custom properties
  // resolve by CASCADE, not by media type: an unscoped
  // [data-theme="dark"]{--ink:#E2E8F0} declaration keeps --ink resolving to
  // its dark value everywhere, including inside @media print, for every
  // var()-driven rule in the codebase -- not just the ones a Tailwind-
  // utility bridge covers. None of THOSE rules contain the string
  // "[data-theme" themselves (they just say `color: var(--ink)`), so a scan
  // for that text inside the print span would stay green while a printed
  // report came out in dark-mode colours on forced-white paper. This test
  // checks STRUCTURE instead: the dark declaration must be nested inside
  // @media screen, and :root must NOT be (or print loses every colour, not
  // just the wrong ones).
  const css = rootCss();
  assert.match(css, /^:root\{[^}]*\}@media screen\{\[data-theme="dark"\]\{/,
    ":root must be unscoped and the dark block must sit inside @media screen");
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

const INDEX = root("index.html");
const INDEX_STYLE = INDEX.slice(INDEX.indexOf("<style>"), INDEX.indexOf("</style>"));

// Deliberately NOT darkened. These sit on a filled red button or a dark
// slab, both of which stay dark in dark mode, so white text remains
// correct. Listed explicitly so the coverage test below stays honest
// rather than being loosened.
const NOT_DARKENED = new Set(["text-white", "hover:text-white"]);

// Every colour utility index.html actually uses, base and state-variant.
// The prefix group must list every variant actually used with a colour
// utility in this file -- `focus-visible` was missing (fix round 2), which
// let `.outline-[#B8C0CC]` (a bridge rule with neither the focus-visible
// prefix nor the :focus-visible pseudo-class) match nothing in the DOM while
// still "passing" coverage, because this scan's unprefixed fallback and the
// bridge-selector scan below both landed on the same bare substring by
// accident. Checked against the file directly (not from memory) with:
//   grep -oE '(hover|focus|focus-visible|group-hover|active|disabled|
//     checked|peer-checked|focus-within):(bg|text|border|ring|outline|
//     decoration|divide|accent|fill|stroke)-...' index.html | sort -u
// -- focus-visible was the only variant beyond the three already listed.
function colorUtilities(html) {
  const P = "(?:bg|text|border|ring|outline|decoration|divide|accent|fill|stroke)";
  const V = "(?:\\[#[0-9A-Fa-f]{3,8}\\]|white|black|(?:slate|brand|red|emerald|amber|gray)-\\d{2,3})";
  const re = new RegExp(`(?:(?:hover|focus-visible|focus|group-hover):)?${P}-${V}`, "g");
  return new Set([...html.matchAll(re)].map((m) => m[0]));
}

// Strips the Tailwind-utility bridge's OWN text before scanning for "used"
// utilities (fix round 2, MINOR finding). Escaped selectors like
// `.hover\:bg-slate-50:hover` contain the BARE class name as a literal
// substring -- the backslash breaks colorUtilities' prefix match but not
// its base P-V match -- which manufactured phantom "used" entries for
// classes that appear nowhere in the real markup (`bg-slate-50`,
// `ring-brand-600`, `decoration-brand-700`), and the coverage test passed
// anyway because those three rules were added purely to satisfy a scan the
// bridge's own text was polluting. This is the actual fix; the three dead
// rules are gone from the bridge now that the scan no longer needs them.
function withoutBridge(html) {
  const bridgeAt = html.indexOf("/* ---- Dark mode bridge");
  if (bridgeAt === -1) return html;
  const screenAt = html.indexOf("@media screen", bridgeAt);
  let depth = 0, started = false, i = html.indexOf("{", screenAt);
  for (; i < html.length; i++) {
    if (html[i] === "{") { depth++; started = true; }
    if (html[i] === "}") { depth--; if (started && depth === 0) { i++; break; } }
  }
  return html.slice(0, bridgeAt) + html.slice(i);
}

test("index.html declares the same token values theme.js does", () => {
  // The one place a token is written twice, because index.html is static
  // and server.js never templates it. Pin it or it drifts.
  for (const [name, v] of Object.entries(THEME_TOKENS)) {
    assert.ok(INDEX_STYLE.includes(`--${name}:${v.light}`), `index.html light --${name} missing or wrong`);
    assert.ok(INDEX_STYLE.includes(`--${name}:${v.dark}`), `index.html dark --${name} missing or wrong`);
  }
});

test("index.html's dark token block is screen-only too, mirroring rootCss's shape exactly", () => {
  // Same blind spot as the rootCss test above, but for index.html's own
  // literal copy, which rootCss() cannot reach -- index.html is static and
  // server.js never templates it, so this structure has to be pinned here
  // separately or it can drift out of sync with theme.js silently (the
  // substring test just above would still pass: it only checks that each
  // --token:value pair appears SOMEWHERE, not that the dark block is scoped
  // correctly). Whitespace-tolerant because this copy is hand-formatted
  // across multiple lines for readability, unlike rootCss()'s single line.
  assert.match(
    INDEX_STYLE,
    /:root\{--paper:#FBFBF9[^]*?\}\s*@media screen\{\s*\[data-theme="dark"\]\{--paper:#020617/,
    ":root must be unscoped and the dark token block must sit inside @media screen"
  );
});

test("every colour utility in index.html has a dark rule", () => {
  // THE test. The known weakness of a hex-keyed bridge is that a colour
  // added later gets no dark rule and renders dark-on-dark -- and the
  // failure is silent, because light mode still looks perfect. This turns
  // it into a build failure.
  const used = colorUtilities(withoutBridge(INDEX));
  // What the bridge covers. Tailwind escapes [ # ] in the emitted class
  // name, so the bridge selectors do too; unescape to compare. The
  // TRAILING pseudo-class must also come off: the markup carries
  // `hover:bg-[#F5F4EF]` while the selector is
  // `.hover\:bg-\[\#F5F4EF\]:hover`, and comparing those raw reports every
  // state variant as missing. `focus-visible` added in fix round 2 --
  // without it, the corrected `.focus-visible\:outline-\[\#B8C0CC\]
  // \:focus-visible` selector left a trailing ":focus-visible" on the
  // bridged entry that never matched colorUtilities' pseudo-free output,
  // so a CORRECT selector still failed this test until this line moved too.
  const bridged = new Set(
    [...INDEX_STYLE.matchAll(/\[data-theme="dark"\][^{]*?\.([A-Za-z0-9\\:#\[\]-]+)/g)]
      .map((m) => m[1].replace(/\\/g, "").replace(/:(focus-visible|hover|focus|active|disabled|checked)$/, ""))
  );
  const missing = [...used].filter((u) => !NOT_DARKENED.has(u) && !bridged.has(u));
  assert.deepEqual(missing, [], `utilities with no dark rule: ${missing.join(" ")}`);
});

test("the bridge cannot reach the print stylesheet", () => {
  // Wrapping the bridge in @media screen is what makes the 70-line
  // @media print block unreachable by the theme, so printing cannot
  // regress and that block needs no edits. Removing the wrapper would
  // print light text onto white paper.
  const printAt = INDEX_STYLE.indexOf("@media print");
  assert.notEqual(printAt, -1, "the print block vanished");
  const printBlock = INDEX_STYLE.slice(printAt);
  assert.equal(printBlock.includes("[data-theme"), false,
    "a data-theme selector reached the print block");
  const bridgeAt = INDEX_STYLE.indexOf(`[data-theme="dark"] .`);
  const screenAt = INDEX_STYLE.lastIndexOf("@media screen", bridgeAt);
  assert.notEqual(screenAt, -1, "the bridge is not inside @media screen");
});

test("no raw hex colour remains in index.html's style block outside :root/dark declarations or @media print", () => {
  // 2026-08-10: a whole second colour system -- the "Research Desk" CSS
  // (.rd-*, plus a handful of un-prefixed rules like .spread-fill and the
  // loading ninja) -- went untouched by the bridge above because the
  // coverage test only scans Tailwind CLASS NAMES. About 120 raw hex values
  // sat there unthemed until this was caught by eye in a browser. This test
  // is the permanent fix: any FUTURE raw hex added anywhere in this
  // stylesheet (outside the token declarations and the print stylesheet,
  // which is deliberately pinned light) fails the build instead of quietly
  // rendering unthemed.
  const anchor = "Design tokens — the whole site draws from these";
  const anchorAt = INDEX_STYLE.indexOf(anchor);
  assert.notEqual(anchorAt, -1, "the Design tokens comment moved or was renamed");
  const commentOpenAt = INDEX_STYLE.lastIndexOf("/*", anchorAt);
  let scoped = INDEX_STYLE.slice(commentOpenAt);

  // @media print is pinned light on purpose (previous test) and must never
  // be asked to theme -- exclude its whole span rather than flag its
  // intentional literals (e.g. "body { background: #fff }").
  const printAt = scoped.indexOf("@media print");
  assert.notEqual(printAt, -1, "the print block vanished");
  {
    let depth = 0, started = false, i = scoped.indexOf("{", printAt);
    for (; i < scoped.length; i++) {
      if (scoped[i] === "{") { depth++; started = true; }
      if (scoped[i] === "}") { depth--; if (started && depth === 0) { i++; break; } }
    }
    scoped = scoped.slice(0, printAt) + scoped.slice(i);
  }

  const noComments = scoped.replace(/\/\*[\s\S]*?\*\//g, "");

  // Only look inside declaration bodies ({ ... }), never selector text --
  // an ID like #addressInput would otherwise read as a 3-digit hex colour
  // ("#add"). insideBraces keeps everything at brace-depth >= 1 (any
  // nesting, e.g. inside @media), which is exactly "declaration bodies".
  function insideBraces(css) {
    let d = 0, out = "";
    for (const c of css) {
      if (c === "{") { d++; out += ""; continue; }
      if (c === "}") { d = Math.max(0, d - 1); out += ""; continue; }
      if (d > 0) out += c;
    }
    return out;
  }
  const blocks = insideBraces(noComments).split(/[]/).filter((b) => b.trim());

  // Deliberate literals, keyed by (property, hex) rather than hex alone --
  // a NEW rule that reuses one of these hex values under a DIFFERENT
  // property must still be caught. Each is explained in index.html at its
  // declaration and in task-4-report.md.
  const ALLOWLIST = new Set([
    "color:#fff",          // text on a filled red/dark surface (::selection)
    "box-shadow:#b91c1c",  // .rd-cell:focus-within's focus ring -- box-shadow is exempt, same as .card-hover / tileSpot
    "fill:#334155",        // .loading-ninja .ninja-body's light-only base value, fully replaced by an explicit dark-mode rule right below it
    "fill:#dc2626",        // .loading-ninja .ninja-band -- this IS --red-fill's dark value, so tokenizing it would change the light theme
    "color:#9a3412",       // .rd-badge.e (estimate) -- deliberately sienna, distinct from .li's amber; no matching token
    "background:#f8e9dc",  // .rd-badge.e's background, same reasoning
    "color:#4c3a8c",       // .rd-badge.bv (broker vault) -- deliberately purple, not green; no matching token
    "background:#ede9f8",  // .rd-badge.bv's background, same reasoning
    "color:#46536a",        // .rd-badge.p's text -- kept literal alongside its background (see the fix-round-2 note at the declaration: a half conversion measured 1.28:1)
    "background:#eaeef4",  // .rd-badge.p's background -- pale blue-gray, no matching token
    "background:#fca5a5",  // .spread-fill's gradient start -- this is --red-deep's dark value, so tokenizing it would change the light theme
    "background:#8a929e",  // .rd-scat-tick's mark colour -- no matching token
  ]);

  const offenders = [];
  for (const block of blocks) {
    for (const decl of block.split(";")) {
      const hexMatches = decl.match(/#[0-9A-Fa-f]{3,8}\b/g);
      if (!hexMatches) continue;
      const propMatch = decl.match(/([a-zA-Z-]+)\s*:/);
      const prop = propMatch ? propMatch[1].trim().toLowerCase() : "(unknown)";
      for (const hex of hexMatches) {
        const key = `${prop}:${hex.toLowerCase()}`;
        if (!ALLOWLIST.has(key)) offenders.push(`${prop}: ${hex}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `raw hex colour(s) outside the token system: ${offenders.join(", ")}`);
});

test("index.html sets the theme before first paint", () => {
  const head = INDEX.slice(0, INDEX.indexOf("<style>"));
  assert.ok(head.includes(`setAttribute("data-theme"`), "no boot script in <head>");
  assert.ok(head.includes("prefers-color-scheme"), "boot script ignores the OS preference");
});

test("the PNG export is never dark", () => {
  // html2canvas CLONES the document, so data-theme would ride along into
  // the capture. A dark PNG pasted into a client's light deck reads as
  // broken. The existing onclone hook strips it.
  const clone = INDEX.slice(INDEX.indexOf("onclone:"), INDEX.indexOf("onclone:") + 800);
  assert.ok(clone.includes(`removeAttribute("data-theme")`),
    "onclone does not strip data-theme -- the PNG export would render dark");
  assert.ok(INDEX.includes(`backgroundColor: "#FBFBF9"`),
    "the PNG background is no longer the light paper");
});

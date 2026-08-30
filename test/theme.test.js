// The dark-mode token table. Pure like entitlements.test.js: no server, no
// database, no clock. The light values here are copied verbatim from the
// :root block vault-page.js and the four dashboards already share, so a
// changed light value is a regression in the theme that already ships.
const test = require("node:test");
const assert = require("node:assert");
const { THEME_TOKENS, DARK_LIFT: DARK_LIFT_SHADOW, DARK_CHROME, AUTOFILL_COVER, rootCss } = require("../theme.js");

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

// The 2026-08-13 lift (paper/card/wash), the 2026-08-14 ink notch, and the
// 2026-08-21 ramp/rule pass. Light values stay on EXISTING above; paper,
// card and wash do not move in any of the three. A silent revert to
// slate-950 would still satisfy "has a dark hex" and the index.html mirror
// (if both copies moved together), so this table is the lock.
//
// Moved on 2026-08-21, and why, so a future reader can tell a deliberate
// retune from a drift:
//   ink        #D5DDE8 -> #E4E9F0  11.41:1 -> 12.81:1 on --card
//   ink-faint  #7C8899 -> #5E6978   4.34:1 ->  2.80:1 (a whisper again)
//   hair       #1E2938 -> #253346   1.06:1 ->  1.22:1 (was not a line)
//   line       unchanged at #2A3648  1.28:1  (see the 08-21 revert below)
// The four middle ink steps and --edge are deliberately unchanged.
const DARK_LIFT = {
  paper: "#121826", card: "#1A2433", wash: "#243044",
  "wash-2": "#334155", slab: "#243044",
  edge: "#333E4F", line: "#2A3648", hair: "#222F40",
  ink: "#E4E9F0", "ink-body": "#B6C1CF", "ink-2": "#A8B6C6",
  "ink-mute": "#96A3B4", "ink-3": "#8B98A8",
  "ink-faint": "#5E6978", "ink-4": "#475569",
  // Brought DOWN to its siblings on 2026-08-21 (--ok-rule 1.96:1,
  // --warn-rule 1.79:1) after shipping at 4.80:1 made the error box the
  // only alert wearing a bright outline. Locked here so it stays a rule.
  "err-rule": "#943F3F",
};

test("dark tokens match the lifted-slate table", () => {
  for (const [name, dark] of Object.entries(DARK_LIFT)) {
    assert.ok(THEME_TOKENS[name], `missing token --${name}`);
    assert.equal(THEME_TOKENS[name].dark, dark, `--${name} dark value moved`);
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

test("estimate and vault badge tokens keep their hues, and do not borrow warn or ok", () => {
  assert.equal(THEME_TOKENS["est-text"].light, "#9A3412");
  assert.equal(THEME_TOKENS["est-bg"].light, "#F8E9DC");
  assert.equal(THEME_TOKENS["bv-text"].light, "#4C3A8C");
  assert.equal(THEME_TOKENS["bv-bg"].light, "#EDE9F8");
  assert.notEqual(THEME_TOKENS["est-text"].dark, THEME_TOKENS["warn-text"].dark);
  assert.notEqual(THEME_TOKENS["est-bg"].dark, THEME_TOKENS["warn-bg"].dark);
  assert.notEqual(THEME_TOKENS["bv-text"].dark, THEME_TOKENS["ok-text"].dark);
  assert.notEqual(THEME_TOKENS["bv-bg"].dark, THEME_TOKENS["ok-bg"].dark);
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

test("dark mode lifts cards instead of retuning the floor", () => {
  const css = rootCss();
  assert.ok(css.includes("--lift:none"), "light --lift must be none so light cards do not gain a shadow");
  assert.ok(css.includes(`--lift:${DARK_LIFT_SHADOW}`), "dark --lift missing or drifted");
  assert.ok(css.includes("color-scheme:dark"), "native controls stay light without color-scheme");
  assert.ok(DARK_LIFT_SHADOW.includes("inset"), "the inset highlight is the card/paper separator");
  assert.equal(THEME_TOKENS.paper.dark, "#121826", "elevation must not move the lifted-slate floor");
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

test("rootCss carries the dark chrome (autofill, caret, scrollbar) so server pages inherit it", () => {
  const css = rootCss();
  assert.ok(css.includes(DARK_CHROME), "DARK_CHROME missing from rootCss()");
  assert.ok(DARK_CHROME.includes("-webkit-autofill"), "autofill rule dropped");
  assert.ok(DARK_CHROME.includes("scrollbar-color"), "scrollbar-color dropped");
  assert.ok(DARK_CHROME.startsWith("@media screen{"), "chrome must be screen-only so print stays light");
  assert.equal(DARK_CHROME.includes("`"), false);
  assert.equal(DARK_CHROME.includes("${"), false);
});

test("Chrome's address-paste autofill sheet is covered on the card colour in light too", () => {
  // Chrome paints a light-blue sheet when it recognises a pasted street
  // address. DARK_CHROME already covers charcoal; without an UNSCOPED rule
  // the desk address field goes blue on a white card. var(--card) is #fff
  // in light. :focus is the state after paste; DARK_CHROME's selector has
  // no :focus, so this string uniquely identifies the light-mode cover.
  const css = rootCss();
  assert.ok(css.includes(AUTOFILL_COVER), "AUTOFILL_COVER missing from rootCss()");
  assert.ok(AUTOFILL_COVER.includes("input:-webkit-autofill:focus"), "paste restyles on :focus");
  assert.ok(AUTOFILL_COVER.includes("box-shadow:0 0 0 1000px var(--card) inset"),
    "must cover with --card (white in light), not a hardcoded cream");
  assert.ok(!AUTOFILL_COVER.includes("[data-theme"),
    "a dark-only selector leaves the blue sheet on the white desk");
  assert.equal(AUTOFILL_COVER.includes("`"), false);
  assert.equal(AUTOFILL_COVER.includes("${"), false);
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
const INDEX_HTML = root("index.html");

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

// The footer is the one surface that is DARK IN BOTH THEMES (--slab), so the
// ink ramp runs backwards on it: --ink-4, which is a pale outline colour in
// light, is a dark slate in dark. Measured on /brokers before the fix, every
// footer link sat at 1.75:1 and the legal small print at 2.38:1. index.html
// was protected by its class bridge; the three server-rendered footers set
// var(--ink-4) DIRECTLY, so no bridge could reach them.
//
// The footer block already carried a "Mirrored in HOW_CSS and in index.html's
// footer; keep the three in step" comment that it had NOT been kept in step
// with, which is exactly why the fix is one shared constant and why this test
// checks it arrives in all three rather than trusting the comment.
// index.html and the market pages each own a Leaflet map, and index.html is
// static so the two cannot share a constant -- the same hand-copy relationship
// DARK_CHROME already has. The market pages had NO Leaflet dark rules at all
// until 2026-08-21, so in dark the container showed leaflet.css's #ddd behind
// every tile gap. This pins the copies together: a rule added to one and not
// the other is the failure mode a comment alone has never prevented in this
// file.
test("the market pages' Leaflet dark chrome matches index.html's copy", () => {
  // Both sides are parsed into selector -> declaration-set, because the two
  // files format identically-meaning CSS differently: index.html keeps its
  // selector lists on separate lines with spaces and a trailing semicolon,
  // server.js writes them compact. Comparing text would fail on whitespace.
  const parse = (css) => {
    const map = new Map();
    css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").forEach((chunk) => {
      const at = chunk.indexOf("{");
      if (at < 0) return;
      const sels = chunk.slice(0, at).split(",").map((x) => x.replace(/\s+/g, " ").trim());
      const decls = chunk.slice(at + 1).split(";")
        .map((d) => d.replace(/\s+/g, " ").replace(/\s*:\s*/, ":").trim())
        .filter(Boolean).sort().join(";");
      sels.filter(Boolean).forEach((sel) => { if (sel.includes("leaflet")) map.set(sel, decls); });
    });
    return map;
  };

  const block = SERVER_JS.match(/const LEAFLET_DARK_CSS = `([\s\S]*?)`;/);
  assert.ok(block, "LEAFLET_DARK_CSS must exist in server.js");
  const market = parse(block[1]);
  const index = parse(INDEX_HTML.split("</style>")[0]);

  assert.ok(market.size >= 6, `expected the whole block, got ${market.size} selectors`);
  for (const [sel, decls] of market) {
    assert.ok(index.has(sel), `index.html has no dark Leaflet rule for ${sel}`);
    assert.equal(index.get(sel), decls, `${sel} disagrees between index.html and LEAFLET_DARK_CSS`);
  }
});

// The market map used to hardcode a light basemap, so a dark market page
// rendered a white rectangle in the middle of it. It follows the theme now,
// and swaps by setUrl rather than rebuilding the layer, because the theme
// toggle lives in the shared header and can fire long after the pins have
// been placed. (The provider moved from CARTO to Esri on 2026-08-26, when
// CARTO began watermarking keyless raster tiles — including the printed
// exports a broker hands a client.)
test("the market map's basemap follows the theme", () => {
  assert.match(SERVER_JS, /dark \? "World_Dark_Gray_Base" : "World_Light_Gray_Base"/,
    "the market basemap must be chosen from the theme, not pinned");
  assert.match(SERVER_JS, /dark \? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference"/,
    "the label layer must follow the theme too, or dark pages get light labels");
  assert.match(SERVER_JS, /attributeFilter: \["data-theme"\]/,
    "a theme change must reach the tile layer");
  assert.match(SERVER_JS, /tiles\.setTheme\(\)/,
    "swap the URLs rather than re-adding the layers, which would drop the pins");
  // The watermark that forced the move: no keyless CARTO raster may come back
  // on any surface, and that includes the print/PNG export path in index.html.
  for (const [where, src] of [["server.js", SERVER_JS], ["index.html", INDEX]]) {
    assert.equal(/basemaps\.cartocdn\.com/.test(src), false,
      where + " still requests CARTO raster tiles, which are watermarked without an API key");
  }
});

// Esri numbers its tiles {z}/{y}/{x} — ROW before column — where every XYZ
// service (and this repo's own aerials) uses {z}/{x}/{y}. Getting it backwards
// mirrors the world, which looks like a plausible map of nowhere rather than
// an error, so it is pinned rather than left to review.
test("every Esri Canvas tile URL is row-before-column", () => {
  for (const [where, src] of [["server.js", SERVER_JS], ["index.html", INDEX]]) {
    // The service name and the tile path are separate string pieces in both
    // files (concatenated in server.js, interpolated in index.html), so the
    // tile path is what gets checked rather than a whole URL.
    const paths = src.match(/\/MapServer\/tile\/[^"'`\s)]*/g) || [];
    assert.ok(paths.length >= 2, where + " lost its Esri MapServer tile paths");
    // The row/column variables are named y/x in the Leaflet templates and
    // ty/tx in the hand-stitched aerials; what must hold is the ORDER —
    // zoom, then row, then column.
    for (const p of paths) {
      assert.ok(/^\/MapServer\/tile\/\$?\{z\}\/\$?\{t?y\}\/\$?\{t?x\}/.test(p),
        where + " has an Esri tile path that is not zoom/row/column: " + p);
    }
    assert.ok(/World_(Light|Dark)_Gray_Base/.test(src), where + " lost its Canvas basemap");
    assert.ok(/World_(Light|Dark)_Gray_Reference/.test(src), where + " lost its Canvas label layer");
  }
});

test("the dark-mode footer ink reaches all three server-rendered footers", () => {
  const rule = /\[data-theme="dark"\] footer a[^{]*\{color:var\(--ink-body\)\}/;

  // Defined once, not restated per stylesheet.
  const definitions = SERVER_JS.match(/const FOOTER_DARK_CSS =/g) || [];
  assert.equal(definitions.length, 1, "FOOTER_DARK_CSS must be defined exactly once");
  assert.match(SERVER_JS, rule, "server.js does not define the dark footer link rule");

  // Interpolated into both server-side stylesheets.
  const uses = SERVER_JS.match(/\$\{FOOTER_DARK_CSS\}/g) || [];
  assert.equal(uses.length, 2, "expected MARKET_CSS and HOW_CSS to interpolate it");
  // The vault used to be HANDED this block, because it built its own document
  // and therefore its own footer. Since Task 9 (2026-08-30) it renders a body
  // inside marketShell and gets the real MARKET_FOOTER, so it receives the
  // rule the way every other page does — by being inside the stylesheet that
  // interpolates it. There is no third footer left to keep in step, which is
  // the point of the fold; test/vault-shell.test.js proves the served page is
  // a marketShell render, footer included.
  assert.ok(!/chrome\.FOOTER_DARK_CSS/.test(VAULT_JS),
    "vault-page.js should no longer take footer chrome — marketShell owns it");

  // And it must not have quietly gone back to a token that inverts.
  assert.equal(/\[data-theme="dark"\] footer[^{]*\{color:var\(--ink-4\)\}/.test(SERVER_JS), false,
    "--ink-4 is 1.75:1 on the dark footer slab; it must not be the dark value");
});

test("the footer's dark ink clears AA on the slab it actually sits on", () => {
  const lum = (hex) => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const slab = THEME_TOKENS.slab.dark;
  // Links carry navigation and the contact address; the small print is a
  // legal disclaimer. Both have to be readable, which --ink-faint no longer
  // is by design -- it is a whisper token in both themes now.
  assert.ok(ratio(THEME_TOKENS["ink-body"].dark, slab) >= 4.5,
    "footer links must clear AA on --slab");
  assert.ok(ratio(THEME_TOKENS["ink-3"].dark, slab) >= 4.5,
    "footer small print must clear AA on --slab");
  assert.ok(ratio(THEME_TOKENS["ink-faint"].dark, slab) < 4.5,
    "--ink-faint is a whisper; if it now clears AA this test's premise changed");
});

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
      // (--t1..--t6 type, --s1..--s9 spacing, --r radius, --serif, and the
      // vault redesign's --shadow, and --lift which is elevation not a
      // colour). Those are page-local / non-colour and not the theme table's
      // business.
      if (/^--(t\d|s\d|r|serif|shadow|lift)$/.test(m[1])) continue;
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
  // VAULT_JS is included: Task 6 fixed its one offending declaration
  // (`.btn{background:var(--red)}`, shipped 2026-08-06, long before this
  // project) to `--red-fill` / `--red-fill-hover`, so this file is now held
  // to the same rule as every other in-scope stylesheet.
  const blocks = [
    cssBlock("MARKET_CSS"), cssBlock("HOW_CSS"), cssBlock("ACCOUNT_NAV_CSS"), VAULT_JS,
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
  // /1031-exchange, /terms, /privacy.
  const shell = SERVER_JS.slice(SERVER_JS.indexOf("function marketShell("));
  assert.ok(shell.slice(0, 2000).includes("THEME_BOOT"), "marketShell lacks the boot script");
  // renderHowItWorksHTML covers / and /how-it-works, and is a SEPARATE shell
  // from marketShell -- checking one is not evidence about the other. A
  // future edit that removed the boot script from just this function would
  // otherwise pass the suite and reintroduce a white flash on / and
  // /how-it-works. Bounded by the NEXT top-level function rather than a
  // fixed character window: this function is long (it also carries HOW_FAQ
  // and the scroll-choreography script), so a short window like marketShell's
  // would land before THEME_BOOT and produce a false failure.
  const howStart = SERVER_JS.indexOf("function renderHowItWorksHTML(");
  const howEnd = SERVER_JS.indexOf("\nfunction ", howStart + 10);
  const howShell = SERVER_JS.slice(howStart, howEnd);
  assert.ok(howShell.includes("THEME_BOOT"), "renderHowItWorksHTML lacks the boot script");
  // vault-page.js had its own head, and Task 6 put THEME_BOOT in it. Task 9
  // (2026-08-30) retired that head: the page is a body inside marketShell now,
  // so the marketShell window checked above IS the vault's boot script too.
  // Asserted from the other side, because a file that stops emitting a head is
  // exactly how this could regress unnoticed.
  assert.ok(!VAULT_JS.includes("THEME_BOOT"),
    "vault-page.js is a body now; a boot script in it would be the second on the page");
});

test("the toggle is rendered once in the whole product, in the settings panel", () => {
  // It was a nav row on every server-rendered page from 2026-08-23 and, for
  // one morning on 2026-08-30, on the app's rail as well. The owner asked for
  // it back in Settings that afternoon: one preference, one control. So
  // server.js renders none at all — the pages reach the panel through the
  // account menu's Settings row (/desk?settings=1) — and index.html holds the
  // single button.
  assert.equal(SERVER_JS.split(`id="themeToggle"`).length - 1, 0,
    "a theme toggle is back in server.js; the one control lives in the settings panel");
  assert.equal(INDEX.split(`id="themeToggleApp"`).length - 1, 1,
    "index.html does not hold exactly one theme toggle");
  // In the PANEL, not the header: this is the thing the move was about, and
  // the <!-- Header --> marker is the boundary between the modals above it
  // and the chrome below.
  assert.ok(INDEX.indexOf(`<button id="themeToggleApp"`) < INDEX.indexOf("<!-- Header -->"),
    "the toggle is below the header marker again — it belongs in the settings panel");
});

test("the theme toggle shows a moon in light and a sun in dark", () => {
  // Spec §6.1: "sun/moon". A moon-only button reads as "switch to dark"
  // even when you are already there, and a crescent is easy to miss on
  // charcoal. The button must carry both icons; CSS (not JS) swaps them so
  // the first paint is already correct.
  // ONE button since 2026-08-30, so one check. accountNavSlots renders no
  // toggle and therefore owes no icons, and ACCOUNT_NAV_CSS's .theme-sun rule
  // went with the button it styled -- those class names appearing there again
  // would mean a copy has come back into the chrome.
  const toggleBtnAt = INDEX.indexOf(`<button id="themeToggleApp"`);
  assert.notEqual(toggleBtnAt, -1, "index.html's theme toggle button not found");
  const btn = INDEX.slice(toggleBtnAt, toggleBtnAt + 1800);
  assert.ok(btn.includes("theme-moon"), "the toggle is missing the moon icon");
  assert.ok(btn.includes("theme-sun"), "the toggle is missing the sun icon");
  assert.equal(cssBlock("ACCOUNT_NAV_CSS").includes("theme-sun"), false,
    "ACCOUNT_NAV_CSS styles the icons again -- has a nav toggle come back?");
  assert.match(INDEX_STYLE, /\.theme-sun \{ display: none \}/,
    "index.html does not hide the sun in light mode");
  assert.ok(INDEX_STYLE.includes(`[data-theme="dark"] .theme-sun { display: block }`),
    "index.html does not reveal the sun in dark mode");
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

test("index.html mirrors the card-lift custom property and applies it to report cards", () => {
  assert.ok(INDEX_STYLE.includes("--lift:none"), "index.html light --lift missing");
  assert.ok(INDEX_STYLE.includes(`--lift:${DARK_LIFT_SHADOW}`), "index.html dark --lift disagrees with theme.js");
  assert.ok(INDEX_STYLE.includes("color-scheme:dark"), "index.html dark block missing color-scheme");
  assert.ok(INDEX_STYLE.includes(".rd-bcard") && INDEX_STYLE.includes("box-shadow: var(--lift)"),
    "report cards (.rd-bcard) must take --lift");
  assert.ok(INDEX_STYLE.includes(".print-shadow-none"), "print/PNG still strip shadows");
});

test("index.html hand-copies the dark chrome that rootCss interpolates into server pages", () => {
  // index.html is static, so DARK_CHROME cannot reach it. The failure is
  // Chrome painting a cream autofill sheet on a charcoal field -- light
  // mode looks fine, so this has to be pinned.
  assert.ok(INDEX_STYLE.includes("input:-webkit-autofill"), "index.html missing autofill chrome");
  assert.ok(INDEX_STYLE.includes("scrollbar-color"), "index.html missing scrollbar-color");
  assert.ok(INDEX_STYLE.includes("caret-color: var(--ink)"), "index.html missing caret-color");
  assert.ok(INDEX_STYLE.includes(".rd-cell:focus-within { box-shadow: inset 0 0 0 2px var(--red); }"),
    "form focus ring must use --red so it lightens in dark instead of staying #B91C1C");
});

test("index.html covers Chrome's address-paste autofill sheet in light mode", () => {
  // index.html is static, so AUTOFILL_COVER cannot reach it. :focus is the
  // discriminator: the dark chrome copies input:-webkit-autofill without it.
  // Comments are blanked so a note that names the dark selector cannot
  // satisfy (or break) the unscoped check.
  const css = INDEX_STYLE.replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.match(
    css,
    /input:-webkit-autofill:focus[^}]*box-shadow:\s*0 0 0 1000px var\(--card\) inset/,
    "light-mode paste cover missing; the field would go blue"
  );
  assert.doesNotMatch(
    css,
    /\[data-theme="dark"\][^{]*input:-webkit-autofill:focus/,
    "the :focus cover must not live only under dark, or light mode stays blue"
  );
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
    /:root\{--paper:#FBFBF9[^]*?\}\s*@media screen\{\s*\[data-theme="dark"\]\{--paper:#121826/,
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
    "fill:#334155",        // .loading-ninja .ninja-body's light-only base value, fully replaced by an explicit dark-mode rule right below it
    "fill:#dc2626",        // .loading-ninja .ninja-band -- this IS --red-fill's dark value, so tokenizing it would change the light theme
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

test("no raw colour literal remains in index.html's generated markup (the JS half)", () => {
  // The test above only ever scans the <style> block, which structurally
  // cannot see a colour baked into markup the SCRIPT builds — an inline
  // style="" string, an SVG fill/stroke attribute, or a canvas/html2canvas
  // colour assignment. That blind spot has bitten this project four
  // separate times, most recently the vault's year chart, whose headline
  // number rendered at 1.14:1 in dark mode (test/theme.test.js's own
  // "generated markup" test for vault-page.js, added in that fix). This is
  // the same fix for index.html, which never had one: writing it turned up
  // the report's own market-position chart (renderMarketChart) and the
  // header/report-lockup logo icon rendering dark-on-dark in dark mode,
  // both fixed alongside this test by switching their fill/stroke to
  // var(--token) rather than by loosening the allowlist below.
  //
  // A blind hex scan of everything after </style> does not work here the
  // way it does for vault-page.js: index.html's <body> is thousands of
  // Tailwind arbitrary-value classes (bg-[#F5F4EF], text-[#5A6473], ...),
  // and every one of those is a literal hex substring that is ALREADY
  // covered by the "every colour utility has a dark rule" test above via
  // the class-name bridge, not by this one. So this scan is deliberately
  // scoped to colour-bearing PROPERTY CONTEXTS only — inline style=""
  // declarations (prop:#hex, split the same way the style-block test above
  // splits CSS declarations, so "border:2px solid #fff" is still caught),
  // bare SVG/HTML attributes (fill="#hex", stroke="#hex"), and JS
  // assignments (ctx.fillStyle = "#hex", backgroundColor: "#hex") — which
  // is exactly what a Tailwind class name never looks like: the hex in
  // `bg-[#F5F4EF]` sits directly after `[`, never after `:`/`=`, so it
  // never enters this scan at all. Comments (HTML <!-- --> only — this
  // file's // and /* */ JS comments were checked by hand and none mention a
  // hex value) are stripped first so prose like "dark mode's own --slab:
  // #1E293B" in a code comment can't read as a declaration.
  const styleEnd = INDEX.indexOf("</style>");
  assert.notEqual(styleEnd, -1, "index.html's </style> tag not found");
  let jsHalf = INDEX.slice(styleEnd).replace(/<!--[\s\S]*?-->/g, "");

  // pinColors() is the theming IMPLEMENTATION for the Leaflet map pins and
  // aerial-photo placeholder, not a literal that forgot to theme: it is a
  // plain isDark() ? {...} : {...} object literal, so BOTH themes' real
  // values necessarily sit in the source as hex, the same way :root's own
  // dark block does. Carved out here the same way the CSS test above carves
  // out @media print — a scan that can't evaluate a ternary has no way to
  // know these are already correct, so it would either flag genuinely
  // themed code or need every one of its six values individually
  // allowlisted with no real offender left to explain them.
  const pcStart = jsHalf.indexOf("const pinColors = ()");
  assert.notEqual(pcStart, -1, "pinColors() moved or was renamed");
  const pcEnd = jsHalf.indexOf(";", pcStart);
  jsHalf = jsHalf.slice(0, pcStart) + jsHalf.slice(pcEnd + 1);

  const offenders = [];

  // Pass 1: inline style="..." attributes. Consumed and removed (not just
  // read) so pass 2's simpler attr="#hex" scan below can't double-count a
  // hex that already got its property from this pass's declaration split.
  const rest = jsHalf.replace(/style="([^"]*)"/g, (whole, styleVal) => {
    for (const decl of styleVal.split(";")) {
      const hexMatches = decl.match(/#[0-9A-Fa-f]{3,8}\b/g);
      if (!hexMatches) continue;
      const propMatch = decl.match(/([a-zA-Z-]+)\s*:/);
      const prop = propMatch ? propMatch[1].trim().toLowerCase() : "(unknown)";
      for (const hex of hexMatches) offenders.push(`${prop}:${hex.toLowerCase()}`);
    }
    return "";
  });

  // Pass 2: bare SVG/HTML attributes (fill="#hex") and JS assignments
  // (ctx.fillStyle = "#hex", backgroundColor: "#hex") — anything shaped
  // like identifier, then `:` or `=`, then an optional quote, then hex,
  // immediately. The identifier may contain dots (ctx.fillStyle) so a
  // property access reads as one token instead of matching bare "fillStyle".
  for (const m of rest.matchAll(/([a-zA-Z_$][\w.]*)\s*[:=]\s*["']?(#[0-9A-Fa-f]{3,8})\b/g)) {
    offenders.push(`${m[1].toLowerCase()}:${m[2].toLowerCase()}`);
  }

  // Keyed by "property:hex" like the style-block test above, each with its
  // own one-line reason. Tight on purpose — a future addition should invert
  // its own colours with var(--token) first and reach for this list only
  // when a token genuinely can't apply.
  const ALLOWLIST = new Set([
    // Aerial-photo placeholder's red point marker and the "© Esri" caption
    // chip: both are drawn ON the stitched satellite photo itself, not on a
    // themed page surface, so a site theme has no business repainting them
    // (aerialThumb; the map basemap and pins around the photo DO theme, via
    // pinColors()).
    "background:#dc2626", "border:#fff", "color:#fff",
    // Footer wordmark + its CompNinja icon: this lockup sits on
    // bg-[#1A2433], a slab that is dark in BOTH themes (see the comment at
    // the declaration), so literal white text and brand red read correctly
    // regardless of site theme.
    "color:#ef4444", "fill:#ffffff", "fill:#b91c1c",
    // The Google "G" in the account modal's Continue-with-Google button:
    // a third party's trademark, drawn in Google's own four brand colours
    // per their sign-in branding guidelines. A theme has no business
    // repainting someone else's mark — it renders on the modal card in both
    // themes, like the G on Google's own dark-theme button.
    "fill:#ea4335", "fill:#4285f4", "fill:#fbbc05", "fill:#34a853",
    // Print letterhead's CompNinja icon: .print-only is display:none on
    // screen, so this markup is only ever seen by print, which is pinned
    // light on purpose and never reads data-theme at all.
    "fill:#1a2433",
    // My Desk portfolio sparkline's polyline: no matching token (same
    // allowance already given to .rd-scat-tick in the CSS bridge above) —
    // measured legible against both --card values, so left literal rather
    // than shifting the light-mode shade to fit an existing token.
    "stroke:#8a93a0",
    // Uploaded logo re-encode (readLogoFile): fills a transient <canvas>
    // white before flattening a transparent PNG to JPEG. Image-processing
    // math, not page theming — the canvas is never inserted into the page.
    "ctx.fillstyle:#fff",
    // PNG export (downloadImage/html2canvas): deliberately light-only, so a
    // report exported from a dark screen still reads as a normal client
    // deliverable. Pinned by the "the PNG export is never dark" test below.
    "backgroundcolor:#fbfbf9",
    // Static comp map (drawStaticMap and its smap* pin helpers): the raster
    // that reaches the PDF and the PNG is pinned to the LIGHT street basemap
    // whatever the page theme is — the same rule as the light-only PNG export
    // directly above, and for the same reason. So its pins carry light-mode
    // values by construction: dark roundel, red subject teardrop, white
    // borders, and the tile-gap backdrop and attribution text that sit on the
    // light tiles. pinColors() is deliberately NOT used here; a themed pin
    // would be the bug.
    "ctx.fillstyle:#1e293b", "ctx.strokestyle:#fff",
    "ctx.fillstyle:#dc2626", "ctx.fillstyle:#4c5665", "ctx.fillstyle:#f2f1ec",
  ]);

  const named = offenders.filter((o) => !ALLOWLIST.has(o));
  assert.deepEqual(named, [],
    `raw colour literal(s) in index.html's generated markup, outside the allowlist: ${named.join(", ")}`);
});

test("index.html sets the theme before first paint, defaulting to light", () => {
  // Light is the default (owner's call, 2026-08-23): the boot script applies
  // only an explicit stored "dark" and never consults the OS. The check
  // slices out the script itself rather than searching the whole <head>,
  // because the theme-color <meta> tags legitimately say
  // "prefers-color-scheme" and would mask a reintroduced OS fallback.
  const head = INDEX.slice(0, INDEX.indexOf("<style>"));
  const bootStart = head.indexOf("<script>(function(){try{var t=localStorage");
  assert.notEqual(bootStart, -1, "no boot script in <head>");
  const boot = head.slice(bootStart, head.indexOf("</script>", bootStart));
  assert.ok(boot.includes(`setAttribute("data-theme"`), "boot script never sets data-theme");
  assert.equal(boot.includes("matchMedia"), false,
    "boot script consults the OS -- the default is light, not prefers-color-scheme");
  assert.equal(boot.includes("prefers-color-scheme"), false,
    "boot script consults the OS -- the default is light, not prefers-color-scheme");
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

test("index.html's theme boot script and toggle handler mirror server.js's THEME_BOOT and toggle logic", () => {
  // index.html is static -- server.js never templates it -- so its boot
  // script and its #themeToggleApp click handler are hand-copies of
  // THEME_BOOT and ACCOUNT_NAV_JS's toggle handler. Nothing keeps the two in
  // step but a paired ⚠ comment at each of the four declarations; this test
  // is the actual guardrail. It checks the facts that matter -- same
  // localStorage key, same stored values, same attribute, same element --
  // rather than requiring byte-identical text, since the two live in
  // different quoting/scripting contexts (index.html's hand-written
  // multi-line JS vs server.js's concatenated template-literal strings), and
  // the two toggle handlers additionally differ in unrelated ways (var vs
  // const, a jQuery-style $() lookup vs getElementById, index.html's also
  // re-tiling the map) that a stricter comparison would falsely flag.
  function facts(s) {
    return {
      storageKey: [...new Set([...s.matchAll(/localStorage\.(?:get|set)Item\(\s*"([^"]+)"/g)].map((m) => m[1]))],
      attribute: [...new Set([...s.matchAll(/(?:setAttribute|removeAttribute)\(\s*"([^"]+)"/g)].map((m) => m[1]))],
      element: s.includes("document.documentElement"),
      values: { dark: s.includes(`"dark"`), light: s.includes(`"light"`) },
    };
  }

  // facts() above checks PRESENCE only -- it would still pass if one copy's
  // ternary picked "dark"/"light" in the opposite order, because the same
  // two strings are still present somewhere in the text; deepEqual on sets
  // of used values cannot see which branch produced which. That is exactly
  // the drift that matters most here: an inverted `dark ? "dark" : "light"`
  // (instead of the correct `dark ? "light" : "dark"`) stores the CURRENT
  // theme instead of the NEW one on every toggle, so the visitor's choice
  // never actually sticks across a reload, while every fact above still
  // matches. ternaries() extracts the true/false branch of every
  // `? "dark"|"light" : "dark"|"light"` ternary, IN ORDER, so the two
  // copies are compared on the relationship, not just the vocabulary.
  // Proved this catches the inversion by temporarily editing index.html's
  // toggle to `dark ? "dark" : "light"` and re-running this test: it failed
  // with a clear branch-order mismatch, and facts()-only comparison (run the
  // same way) did not; reverted immediately after.
  function ternaries(s) {
    return [...s.matchAll(/\?\s*"(dark|light)"\s*:\s*"(dark|light)"/g)].map((m) => [m[1], m[2]]);
  }

  const bootStart = SERVER_JS.indexOf("const THEME_BOOT =");
  assert.notEqual(bootStart, -1, "THEME_BOOT not found");
  const bootEnd = SERVER_JS.indexOf(";\n", bootStart);
  const serverBootText = SERVER_JS.slice(bootStart, bootEnd);
  const serverBoot = facts(serverBootText);

  const indexHead = INDEX.slice(0, INDEX.indexOf("<style>"));
  const indexBootStart = indexHead.indexOf("<script>(function(){try{var t=localStorage");
  assert.notEqual(indexBootStart, -1, "index.html's boot script not found");
  const indexBootEnd = indexHead.indexOf("</script>", indexBootStart);
  const indexBootText = indexHead.slice(indexBootStart, indexBootEnd);
  const indexBoot = facts(indexBootText);

  assert.deepEqual(indexBoot, serverBoot,
    "index.html's boot script disagrees with THEME_BOOT (storage key / stored values / attribute / element)");
  assert.deepEqual(ternaries(indexBootText), ternaries(serverBootText),
    "index.html's boot script picks \"dark\"/\"light\" in a different branch order than THEME_BOOT -- one of them has an inverted ternary");
  // Belt and braces on the light default: the mirror comparison would pass
  // with the OS fallback present in BOTH copies, so pin its absence here too.
  for (const [name, text] of [["THEME_BOOT", serverBootText], ["index.html's boot script", indexBootText]]) {
    assert.equal(text.includes("prefers-color-scheme"), false,
      `${name} consults the OS preference -- the default is light (owner's call, 2026-08-23)`);
  }

  // The toggle HANDLER had a second copy in ACCOUNT_NAV_JS and was compared
  // here the same way. It has none since 2026-08-30: the switch went back
  // into the settings panel, the nav button went with it, and one hand-copy
  // left the codebase. What stays is the pair above -- THEME_BOOT, which
  // every server-rendered page still needs in order to APPLY a stored choice.
  const navStart = SERVER_JS.indexOf("const ACCOUNT_NAV_JS =");
  assert.notEqual(navStart, -1, "ACCOUNT_NAV_JS not found");
  const navEnd = SERVER_JS.indexOf("</script>`;", navStart);
  assert.equal(SERVER_JS.slice(navStart, navEnd).includes("themeToggle"), false,
    "ACCOUNT_NAV_JS has a theme toggle handler again -- that is a second copy of index.html's");

  // index.html's is still the one that has to be right, and the inverted
  // ternary this function was written to catch (`dark ? "dark" : "light"`,
  // which stores the CURRENT theme instead of the new one, so the choice
  // never survives a reload) is still the failure worth pinning. With no twin
  // to compare against, compare it to the rule itself.
  const toggleAppAt = INDEX.indexOf(`getElementById("themeToggleApp")`);
  assert.notEqual(toggleAppAt, -1, "index.html's themeToggleApp handler not found");
  const toggleAppEnd = INDEX.indexOf("});", INDEX.indexOf("catch (e) {}", toggleAppAt));
  const indexToggleText = INDEX.slice(toggleAppAt, toggleAppEnd);
  assert.deepEqual(facts(indexToggleText).storageKey, ["theme"],
    "index.html's toggle writes a different localStorage key than THEME_BOOT reads");
  assert.deepEqual(facts(indexToggleText).attribute, ["data-theme"],
    "index.html's toggle sets an attribute THEME_BOOT does not");
  assert.ok(facts(indexToggleText).element, "index.html's toggle does not act on documentElement");
  assert.deepEqual(ternaries(indexToggleText), [["light", "dark"]],
    "index.html's toggle stores the CURRENT theme rather than the new one -- an inverted ternary, so the visitor's choice would not survive a reload");
});

test("the vault takes its tokens from theme.js rather than its own copy", () => {
  // vault-page.js was already tokenized against this exact vocabulary,
  // which is why theme.js adopted its names instead of inventing new ones.
  // It must not keep a literal copy that can drift.
  assert.equal(/:root\{\s*--ink:#/.test(VAULT_JS), false,
    "vault-page.js still declares its own literal :root token block");
  // It does not interpolate THEME_CSS either since Task 9 (2026-08-30): it is a
  // body inside marketShell, and MARKET_CSS opens with that block. The rule
  // this test exists for — no literal token copy in this file — is the
  // assertion above, and it is unchanged.
});

test("no raw hex colour remains in vault-page.js's style block outside the deliberate allowlist", () => {
  // 2026-08-10 fix round 1: the "no sweep needed" claim in this task's brief
  // was wrong -- 20 raw hex values needed sweeping in vault-page.js's
  // <style> block (3 more, all `color:#fff` text-on-red, were already
  // correct and are the allowlist below; the 2 paired theme-color META TAGS
  // outside this block were correct from the start and were never part of
  // the count), invisible to every other test here because the "no
  // undefined variable" test only scans var() usage and index.html's own
  // raw-hex test (above) is scoped to index.html only. This is the vault's
  // equivalent of that test, so the same class of regression can't recur
  // here unnoticed either.
  const styleStart = VAULT_JS.indexOf("<style>");
  const styleEnd = VAULT_JS.indexOf("</style>");
  assert.notEqual(styleStart, -1, "vault-page.js's <style> tag not found");
  const style = VAULT_JS.slice(styleStart, styleEnd);

  // vault-page.js carries no @media print block (unlike index.html), so
  // there is no print span to carve out here.
  const noComments = style.replace(/\/\*[\s\S]*?\*\//g, "");

  // Same brace-depth walk as index.html's test: only declaration BODIES,
  // never selector text (an id like #tbl would otherwise read as a hex).
  function insideBraces(css) {
    let d = 0, out = "";
    for (const c of css) {
      if (c === "{") { d++; out += ""; continue; }
      if (c === "}") { d = Math.max(0, d - 1); out += ""; continue; }
      if (d > 0) out += c;
    }
    return out;
  }
  const blocks = insideBraces(noComments).split(/[]/).filter((b) => b.trim());

  // The only deliberate literals left after the round-1 sweep: white TEXT
  // sitting on the filled red .btn (and its a.btn twin) -- that surface
  // stays dark in dark mode, so the text must stay literal white, not
  // lighten with --red. Keyed by (property, hex), matching index.html's
  // allowlist shape.
  const ALLOWLIST = new Set([
    "color:#fff", // .btn / a.btn / a.btn:hover -- text on --red-fill, a surface that stays dark
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
        if (!ALLOWLIST.has(key)) offenders.push(key);
      }
    }
  }
  assert.deepEqual(offenders, [], `raw hex colour(s) outside the token system in vault-page.js: ${offenders.join(", ")}`);
});

test("no raw hex colour remains in vault-page.js's generated markup (the JS half)", () => {
  // 2026-08-10 fix round 2: the round-1 test above only ever scanned the
  // <style> block, so it had nothing to say about the year-over-year chart
  // (drawChart, further down this file) building its own SVG in JavaScript
  // with six hardcoded fill/stroke hex literals on the generated elements --
  // invisible in dark mode (the endpoint label, the one number the panel
  // exists to show, measured 1.14:1 against --card dark before the fix).
  // This is the fourth time in this project colour hid outside whatever
  // surface was swept, so the fix is structural: the chart now sets a CSS
  // class per element (.chart-grid / .chart-axis / .chart-bar / .chart-bar.hi
  // / .chart-endpoint, all declared in the <style> block and covered by the
  // test above) instead of an inline fill="var(...)" attribute, which is not
  // reliably honoured anyway. This test is the other half of making that
  // stick: it scans everything AFTER </style> -- every template string that
  // builds HTML or SVG markup -- for a bare hex literal, so a color future
  // generated markup adds by mistake fails the build instead of quietly
  // shipping unthemed.
  const styleEnd = VAULT_JS.indexOf("</style>");
  assert.notEqual(styleEnd, -1, "vault-page.js's </style> tag not found");
  const jsHalf = VAULT_JS.slice(styleEnd);

  // Empty on purpose: nothing in the generated markup has a legitimate raw
  // hex today. If one is ever added deliberately (e.g. a colour that can't
  // be a CSS class for some structural reason), name it here the same way
  // the style-block allowlist above does, keyed loosely since generated
  // markup has no single "property:" shape the way a CSS declaration does.
  const ALLOWLIST = new Set([]);

  const offenders = [...jsHalf.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)]
    .map((m) => m[0].toLowerCase())
    .filter((hex) => !ALLOWLIST.has(hex));
  assert.deepEqual(offenders, [],
    `raw hex colour(s) in vault-page.js's generated markup, outside the <style> block: ${offenders.join(", ")}`);
});

test("a dark basemap never ships without the pin recolour", () => {
  // The comp roundel is drawn to read against a LIGHT basemap. On a dark
  // one it disappears. These two must land together. pinColors()'s
  // returned keys are named pinInk/pinInkText/pinEdge/pinSubject (not the
  // brief's generic ink/edge/subject) specifically so this substring check
  // is a real, load-bearing fact about the code rather than an incidental
  // one -- "pinInk" only appears in the file because the pin-recolour
  // function actually declares a property by that name.
  const dark = INDEX.includes("World_Dark_Gray_Base");
  const pins = INDEX.includes("pinInk") || INDEX.includes("--pin-ink");
  assert.equal(dark, pins,
    "dark tiles and the pin recolour must ship together, not one without the other");
  assert.ok(INDEX.includes(".leaflet-tile-pane"),
    "the dark basemap stays a provider choice; the charcoal lift is a tile-pane filter");
});

test("every CSS comment in vault-page.js's style block actually closes where it looks like it does", () => {
  // Found live during 2026-08-10 fix round 1: a comment reading
  // "--ok-*/--err-* triads" contains the literal sequence "*/" mid-sentence
  // (the trailing * of "--ok-*" immediately followed by the "/" of
  // "/--err-*"), which is a real CSS comment terminator. It closed the
  // comment three sentences early; the leftover comment TEXT then parsed as
  // CSS, and the browser's recovery silently dropped every rule after it
  // (verified via the live page's CSSOM: .hide and everything past .msg
  // were simply absent, with no console error) -- #app never hid, so a
  // signed-out visitor saw the whole workspace shell. `/* */` cannot nest,
  // so a stray "*/" inside comment prose is exactly as dangerous here as a
  // stray backtick is to the outer JS template literal (the hazard this
  // file's own comments already warn about), and nothing else catches it:
  // test/vault-page.test.js compiles the emitted JS, not this CSS. Simple
  // open/close count parity is enough to catch the exact failure mode
  // (a comment that closes somewhere other than intended still balances
  // open/close *counts* only if it reopens correctly after -- this file's
  // comments are never nested, so a mismatch here is unambiguous).
  const styleStart = VAULT_JS.indexOf("<style>");
  const styleEnd = VAULT_JS.indexOf("</style>");
  const style = VAULT_JS.slice(styleStart, styleEnd);
  const opens = (style.match(/\/\*/g) || []).length;
  const closes = (style.match(/\*\//g) || []).length;
  assert.equal(opens, closes,
    `vault-page.js's style block has ${opens} "/*" but ${closes} "*/" -- a comment closes early or never closes`);
  // The whole page is one template literal. A backtick inside a CSS comment
  // (the round-1 note wrapping MARKET_CSS in one) terminates it and the
  // module fails to parse -- test/vault-page.test.js never even loads.
  // Same class of hazard as a stray */ , caught the same way.
  assert.equal((style.match(/`/g) || []).length, 0,
    "vault-page.js's style block contains a backtick -- that ends the outer template literal");
});

test("every [data-theme] rule in index.html sits inside @media screen", () => {
  // Print isolation is cascade, not a grep: an unscoped [data-theme="dark"]
  // keeps custom properties resolving to their dark values inside @media
  // print even when no print rule mentions the attribute. The token block
  // and the utility bridge are already pinned above; this catches a THIRD
  // copy (the loading-ninja fill, any future one-off) drifting outside
  // @media screen. Comments are blanked (not deleted) so indices stay
  // aligned -- several notes in this stylesheet mention the selector in
  // prose, and a raw scan would flag those as unscoped rules.
  const css = INDEX_STYLE.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  function mediaQueryAt(src, pos) {
    let depth = 0;
    const mediaAt = new Map();
    for (let i = 0; i < pos; i++) {
      if (src.startsWith("@media", i)) {
        const brace = src.indexOf("{", i);
        if (brace === -1 || brace >= pos) break;
        const query = src.slice(i + 6, brace).trim();
        i = brace;
        depth++;
        mediaAt.set(depth, query);
        continue;
      }
      if (src[i] === "{") { depth++; continue; }
      if (src[i] === "}") {
        mediaAt.delete(depth);
        depth = Math.max(0, depth - 1);
      }
    }
    for (let d = depth; d >= 1; d--) {
      if (mediaAt.has(d)) return mediaAt.get(d);
    }
    return null;
  }
  const hits = [...css.matchAll(/\[data-theme/g)];
  assert.ok(hits.length > 0, "index.html lost every [data-theme] selector");
  for (const m of hits) {
    assert.equal(mediaQueryAt(css, m.index), "screen",
      `[data-theme] at index ${m.index} is not inside @media screen`);
  }
});

test("the header CompNinja mark themes, and the footer mark does not", () => {
  // CN_LOGO's rect is near-black (#1A2433). On the dark header that is
  // --paper, that measured ~1.27:1. The class plus a stylesheet rule is
  // the same pattern the vault chart and index.html's own header icon
  // already use: a presentation-attribute fill= is the fallback (admin
  // dashboards, out of scope, have no .cn-logo rule and keep rendering
  // as before), and the in-scope stylesheets override it. CN_LOGO_LIGHT
  // sits on the footer slab, which is dark in BOTH themes, so it must
  // stay literal white -- var(--ink) would be navy in light mode.
  const logo = SERVER_JS.slice(
    SERVER_JS.indexOf("const CN_LOGO ="),
    SERVER_JS.indexOf("const CN_LOGO_LIGHT =")
  );
  const light = SERVER_JS.slice(
    SERVER_JS.indexOf("const CN_LOGO_LIGHT ="),
    SERVER_JS.indexOf("const THEME_CSS =")
  );
  assert.match(logo, /class="cn-logo"/, "CN_LOGO is missing class=\"cn-logo\"");
  assert.equal(light.includes("cn-logo"), false,
    "CN_LOGO_LIGHT picked up the themed class -- the footer mark would invert");
  // vault-page.js left this list on 2026-08-30 (Task 9). It carried the rule
  // because it drew its own header and therefore its own logo; it draws
  // neither now, so a copy of this rule in that file would style nothing and
  // would be one more thing to keep in step. The two stylesheets that DO wrap
  // a header are the two that must carry it.
  for (const [where, css] of [
    ["MARKET_CSS", cssBlock("MARKET_CSS")],
    ["HOW_CSS", cssBlock("HOW_CSS")],
  ]) {
    assert.ok(css.includes(".cn-logo rect{fill:var(--ink)}"),
      `${where} is missing the .cn-logo rect rule`);
    assert.ok(css.includes(".cn-logo polygon{fill:var(--red-fill)}"),
      `${where} is missing the .cn-logo polygon rule`);
  }
});

function hexOffendersInCss(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  function insideBraces(src) {
    let d = 0, out = "";
    for (const c of src) {
      if (c === "{") { d++; out += "\u0001"; continue; }
      if (c === "}") { d = Math.max(0, d - 1); out += "\u0002"; continue; }
      if (d > 0) out += c;
    }
    return out;
  }
  const blocks = insideBraces(noComments).split(/[\u0001\u0002]/).filter((b) => b.trim());
  const offenders = [];
  for (const block of blocks) {
    for (const decl of block.split(";")) {
      const hexMatches = decl.match(/#[0-9A-Fa-f]{3,8}\b/g);
      if (!hexMatches) continue;
      const propMatch = decl.match(/([a-zA-Z-]+)\s*:/);
      const prop = propMatch ? propMatch[1].trim().toLowerCase() : "(unknown)";
      for (const hex of hexMatches) offenders.push(`${prop}:${hex.toLowerCase()}`);
    }
  }
  return offenders;
}

test("no raw hex colour remains in in-scope server stylesheets outside the deliberate allowlist", () => {
  // 2026-08-12 Task 8 fix round 1: index.html and vault-page.js already
  // pin their stylesheets; MARKET_CSS / HOW_CSS / ACCOUNT_NAV_CSS did not,
  // so a literal on a public page (the header logo, the market trend
  // chart, the brokers Verified chip) could ship unthemed. Admin
  // dashboards are out of scope and are not in this list.
  const ALLOWLIST = new Set([
    "color:#fff", // text on --red-fill buttons and on the --slab footer
  ]);
  const blocks = {
    MARKET_CSS: cssBlock("MARKET_CSS"),
    HOW_CSS: cssBlock("HOW_CSS"),
    ACCOUNT_NAV_CSS: cssBlock("ACCOUNT_NAV_CSS"),
  };
  const offenders = [];
  for (const [where, css] of Object.entries(blocks)) {
    for (const key of hexOffendersInCss(css)) {
      if (!ALLOWLIST.has(key)) offenders.push(`${where} ${key}`);
    }
  }
  assert.deepEqual(offenders, [],
    `raw hex colour(s) outside the token system in server stylesheets: ${offenders.join(", ")}`);
});

test("no raw colour literal remains in in-scope server.js generated markup", () => {
  // The stylesheet test above cannot see a colour baked into HTML the
  // server concatenates -- an SVG fill=, an inline style="", a theme-color
  // meta. That is how the header logo (1.27:1) and the market trend chart
  // shipped unthemed. Slice stops at renderAdminHTML: the four dashboards
  // after it are out of scope (spec section 1). CSS template-literal
  // bodies are carved out so this test does not double-count what the
  // stylesheet test already pins.
  const logoAt = SERVER_JS.indexOf("const CN_LOGO =");
  const adminAt = SERVER_JS.indexOf("function renderAdminHTML(");
  assert.notEqual(logoAt, -1, "CN_LOGO not found");
  assert.notEqual(adminAt, -1, "renderAdminHTML not found");
  let inScope = SERVER_JS.slice(logoAt, adminAt);
  // FOOTER_LINKS_CSS joined the list on 2026-08-30: the footer's link rules
  // were lifted out of MARKET_CSS and HOW_CSS into one const so /vault could
  // take them too, and `footer a:hover{color:#fff}` -- white on the navy slab,
  // which is dark in both themes -- was carved out with those blocks before
  // the move. It is a stylesheet, not generated markup.
  for (const name of ["MARKET_CSS", "HOW_CSS", "ACCOUNT_NAV_CSS", "FOOTER_LINKS_CSS"]) {
    const block = cssBlock(name);
    assert.ok(inScope.includes(block), `${name} missing from the in-scope slice`);
    inScope = inScope.replace(block, "");
  }

  const offenders = [];
  const rest = inScope.replace(/style="([^"]*)"/g, (whole, styleVal) => {
    for (const decl of styleVal.split(";")) {
      const hexMatches = decl.match(/#[0-9A-Fa-f]{3,8}\b/g);
      if (!hexMatches) continue;
      const propMatch = decl.match(/([a-zA-Z-]+)\s*:/);
      const prop = propMatch ? propMatch[1].trim().toLowerCase() : "(unknown)";
      for (const hex of hexMatches) offenders.push(`${prop}:${hex.toLowerCase()}`);
    }
    return "";
  });
  for (const m of rest.matchAll(/([a-zA-Z_$][\w.-]*)\s*[:=]\s*["']?(#[0-9A-Fa-f]{3,8})\b/g)) {
    offenders.push(`${m[1].toLowerCase()}:${m[2].toLowerCase()}`);
  }

  const ALLOWLIST = new Set([
    // CN_LOGO presentation-attribute fallback: in-scope pages override via
    // .cn-logo; admin dashboards (no rule) keep the original navy/red.
    "fill:#1a2433", "fill:#b91c1c",
    // CN_LOGO_LIGHT: footer slab is dark in both themes, so white stays.
    "fill:#ffffff",
    // Footer wordmark accent on that same slab (MARKET_FOOTER and the
    // how-it-works footer). Matches index.html's own allowlist.
    "color:#ef4444",
    // <meta name="theme-color"> paired with prefers-color-scheme, so the
    // browser chrome tracks the OS rather than data-theme. Same pair as
    // --paper's light/dark values; not a page colour.
    "content:#fbfbf9", "content:#121826",
  ]);

  const named = offenders.filter((o) => !ALLOWLIST.has(o));
  assert.deepEqual(named, [],
    `raw colour literal(s) in in-scope server.js generated markup: ${named.join(", ")}`);
});


// ---------------------------------------------------------------------------
// Motion that hides content must be undone in BOTH escape hatches.
//
// HOW_CSS hides things before revealing them on scroll (`.anim … {opacity:0}`),
// with an IntersectionObserver adding `.on`. Two contexts never fire that
// observer and must therefore get the finished page: a reader who asked for
// reduced motion, and paper.
//
// This is not a style nicety, it is why the standing before/after screenshot
// rule can be trusted. scripts/shot.js forces prefers-reduced-motion (it has
// to: an observer never fires in a beyond-viewport capture), so a hiding rule
// with no reduced-motion reset does not fail any test and does not look wrong
// in a browser -- it silently photographs as a BLANK BAND where a whole
// section should be. That has happened once already, to Method and the FAQ,
// and shot.js carries a comment about it.
//
// So: every selector that HOW_CSS hides under `.anim` must appear again inside
// both the reduced-motion block and the print block.
test("every .anim hiding rule in HOW_CSS is undone for reduced motion and print", () => {
  const start = SERVER_JS.indexOf("const HOW_CSS = ");
  assert.ok(start > -1, "HOW_CSS not found");
  const how = SERVER_JS.slice(start, SERVER_JS.indexOf("\nconst ", start + 20));

  // ALL blocks carrying this at-rule, joined. HOW_CSS has TWO @media print
  // blocks — one for general print styling, one that undoes the scroll
  // choreography — so reading only the first finds the wrong one and reports
  // every animated selector as unreset. (Caught by this test on its first run.)
  const blocksFor = (needle) => {
    let out = "";
    let at = how.indexOf(needle);
    assert.ok(at > -1, needle + " block missing from HOW_CSS");
    while (at > -1) {
      const open = how.indexOf("{", at);
      let depth = 0;
      for (let i = open; i < how.length; i++) {
        if (how[i] === "{") depth++;
        else if (how[i] === "}" && --depth === 0) { out += how.slice(open, i); break; }
      }
      at = how.indexOf(needle, at + needle.length);
    }
    return out;
  };
  const reduced = blocksFor("@media (prefers-reduced-motion:reduce)");
  const print = blocksFor("@media print");

  // Every rule that sets opacity:0 on an .anim selector, outside those blocks.
  const hidden = [];
  for (const m of how.matchAll(/(^|\})\s*([^{}]*\.anim [^{}]*)\{([^{}]*)\}/g)) {
    if (!/opacity\s*:\s*0\b/.test(m[3])) continue;
    for (const sel of m[2].split(",")) {
      const s = sel.trim();
      // :nth-child delay rules carry no opacity; only real hiders reach here.
      if (s.startsWith(".anim ")) hidden.push(s);
    }
  }
  assert.ok(hidden.length > 0, "found no .anim hiding rules — did the selector shape change?");

  // A selector counts as covered if it, or the bare element it hangs off,
  // is reset. `.anim .three .pane` is covered by `.anim .three .pane`.
  const missing = hidden.filter((s) => !reduced.includes(s) || !print.includes(s));
  assert.deepEqual(missing, [],
    "these .anim rules hide content with no reduced-motion/print reset, so they "
    + "will photograph as blank bands in scripts/shot.js: " + missing.join(" | "));
});

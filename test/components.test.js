// The shared components (components.js): the button and the tabs, each
// defined once. Pure rules first, then that the stylesheet really reaches both
// kinds of page, against a real server.
//
// Run: npm test   (node --test, no dependencies, no network)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../components.js");
const { THEME_TOKENS, SCALE_TOKENS } = require("../theme.js");
const { boot } = require("./helpers/boot");

const root = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r\n/g, "\n");
const CSS = C.componentCss();
const UNIFIED = C.componentCss({ unified: true });

// Every `selector{declarations}` in a stylesheet, comments dropped, as
// [selector, declarations, insideMedia]. A comma list is one rule per
// selector; @media and @supports are walked into, other at-rules skipped.
function rulesOf(css) {
  const out = [];
  (function walk(s, media) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf("{", i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === "{") depth++; else if (s[j] === "}") depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith("@")) { if (/^@(media|supports)/.test(head)) walk(body, true); }
      else for (const sel of head.split(",")) out.push([sel.trim().replace(/\s+/g, " "), body.trim(), media]);
      i = j;
    }
  })(css.replace(/\/\*[\s\S]*?\*\//g, ""), false);
  return out;
}
const decl = (body, prop) => {
  const hit = body.split(";").map((d) => d.trim()).find((d) => d.startsWith(prop + ":"));
  return hit ? hit.slice(prop.length + 1).trim() : null;
};
const ruleFor = (css, sel) => (rulesOf(css).find(([s]) => s === sel) || [null, null])[1];

test("the stylesheet is safe to interpolate into a template literal", () => {
  for (const css of [CSS, UNIFIED]) {
    assert.ok(css.length > 2000, "the component stylesheet came out empty");
    assert.equal(css.includes("`"), false);
    assert.equal(css.includes("${"), false);
    assert.equal(css.includes("</style"), false);
    assert.equal(css.includes("undefined"), false, "a missing table value was written into the CSS");
    assert.equal(css.includes("null"), false, "a missing table value was written into the CSS");
  }
});

test("every value is a token: no colour but the white on a red button, no size off the scale", () => {
  const defined = new Set([...Object.keys(THEME_TOKENS), ...Object.keys(SCALE_TOKENS)]);
  for (const css of [CSS, UNIFIED]) {
    for (const m of css.matchAll(/var\(--([a-z0-9-]+)\)/g)) assert.ok(defined.has(m[1]), `--${m[1]} is not a theme.js token`);
    const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    assert.deepEqual([...new Set(hex)], ["#fff"], "the only literal colour is the text on a filled red button");
    assert.doesNotMatch(css, /rgba?\(/, "a literal rgb() colour");
    assert.doesNotMatch(css, /font-size:\s*[0-9.]+px/, "a text size that is not on the scale");
    assert.doesNotMatch(css, /border-radius:\s*[0-9.]+px/, "a radius that is not on the scale");
  }
});

test("the canon: what a button and a tab ARE", () => {
  // Changing one of these moves every page. That is the point of having one
  // place, and the reason a change has to be made on purpose, here too.
  assert.deepEqual(C.BUTTON.sizes, {
    action: { pad: "11px 26px", size: "var(--text-body)", radius: "var(--r-sm)", weight: "600" },
    compact: { pad: "7px 12px", size: "var(--text-small)", radius: "var(--r-md)", weight: "600" },
  });
  assert.equal(C.BUTTON.looks.primary.bg, "var(--red-fill)", "a filled button is --red-fill, never the text red");
  assert.equal(C.BUTTON.looks.primary.ink, "#fff");
  assert.equal(C.BUTTON.looks.secondary.bg, "var(--card)");
  assert.equal(C.BUTTON.looks.secondary.edge, "var(--edge)");
  assert.equal(C.TABS.tab.line, "var(--red)");
  assert.equal(C.TABS.tab.size, "var(--text-compact)");
  assert.match(C.SEGMENTED.item.on, /background:var\(--ink\);color:var\(--paper\)/);

  // The canonical classes exist, for new work.
  assert.equal(ruleFor(CSS, ".btn"), "display:inline-block;background:var(--red-fill);color:#fff;font-weight:600;padding:11px 26px;border-radius:var(--r-sm);font-size:var(--text-body)");
  assert.equal(ruleFor(CSS, ".btn:hover"), "background:var(--red-fill-hover);color:#fff");
  assert.equal(ruleFor(CSS, "button.btn"), "border:0;cursor:pointer;font-family:inherit");
  assert.equal(ruleFor(CSS, ".btn.ghost"), "background:var(--card);color:var(--ink);border:1px solid var(--edge)");
  // A secondary button states its whole hover: .btn:hover has the same
  // weight and would otherwise turn it red.
  const ghostHover = ruleFor(CSS, ".btn.ghost:hover");
  assert.ok(decl(ghostHover, "background") && decl(ghostHover, "color"), ".btn.ghost:hover must restate background and colour");
  for (const sel of [".tabs", ".tab", '.tab[aria-selected="true"]', ".seg", ".seg>a", '.seg>[aria-selected="true"]']) {
    assert.ok(ruleFor(CSS, sel) != null, `the canonical ${sel} is missing`);
  }
});

test("a compact button is the same box whether it is red or outlined", () => {
  // Both looks carry a 1px border, or a red button beside an outlined one is
  // 2px shorter and the row jumps when one becomes the other.
  for (const f of C.BUTTON_FAMILIES.filter((x) => x.primary)) {
    const base = ruleFor(UNIFIED, f.sel), pri = ruleFor(UNIFIED, f.sel + f.primary);
    assert.match(decl(base, "border"), /^1px solid /, `${f.sel} has no border`);
    assert.ok(decl(pri, "border-color"), `${f.sel}${f.primary} drops the border instead of colouring it`);
    assert.equal(decl(pri, "padding"), null, `${f.sel}${f.primary} resizes the button`);
  }
});

test("unified, every family is the canon: the differences are all in `differs`", () => {
  const c = C.BUTTON.sizes.compact;
  for (const f of C.BUTTON_FAMILIES) {
    const base = ruleFor(UNIFIED, f.sel);
    assert.equal(decl(base, "padding"), c.pad, f.sel);
    assert.equal(decl(base, "border-radius"), c.radius, f.sel);
    assert.equal(decl(base, "font-size"), c.size, f.sel);
    assert.equal(decl(base, "font-weight"), c.weight, f.sel);
    assert.equal(decl(base, "line-height"), null, f.sel);
  }
  for (const f of C.TAB_FAMILIES) {
    const tab = ruleFor(UNIFIED, f.tab), on = ruleFor(UNIFIED, f.on);
    assert.equal(decl(tab, "padding"), C.TABS.tab.pad, f.tab);
    assert.equal(decl(tab, "font-size"), C.TABS.tab.size, f.tab);
    assert.equal(decl(tab, "color"), C.TABS.tab.ink, f.tab);
    assert.equal(decl(on, "border-bottom-color"), C.TABS.tab.line, f.on);
    assert.equal(decl(ruleFor(UNIFIED, f.list), "border-bottom"), `1px solid ${C.TABS.list.rule}`, f.list);
  }
  for (const f of C.SEGMENTED_FAMILIES) {
    assert.equal(decl(ruleFor(UNIFIED, f.item), "padding"), C.SEGMENTED.item.pad, f.item);
    assert.equal(ruleFor(UNIFIED, f.on), C.SEGMENTED.item.on, f.on);
  }
  // And the two outputs really differ, or `differs` is doing nothing.
  assert.notEqual(CSS, UNIFIED);
});

test("no new family, and no new difference: both lists may only shrink", () => {
  // A family is a page that wrote its own button or tabs before there was one
  // to use. New work uses .btn / .tabs / .seg. Adding a name here needs a
  // reason this file can state.
  const FAMILIES = [".hm-btn", ".mc-btn", ".pw-btn", ".msg-btn", ".bd-btn", ".bs-btn", ".vt-tabs", ".pt-tabs", ".hm-tabs", ".cs-tabs", ".msg-views"];
  const have = [...C.BUTTON_FAMILIES.map((f) => f.sel), ...C.TAB_FAMILIES.map((f) => f.list), ...C.SEGMENTED_FAMILIES.map((f) => f.list)];
  assert.deepEqual(have.filter((s) => !FAMILIES.includes(s)), [], "a new button or tab family: use the canonical classes instead");

  // Each entry is one place a family still looks different from the canon.
  // Deleting one from components.js is a visible change on that family's
  // pages (before and after pictures); adding one is refused here.
  const DIFFERENCES = [
    ".btn.sm: pad",
    ".hm-btn: pad", ".hm-btn: radius", ".hm-btn: primaryHover",
    ".mc-btn: pad", ".mc-btn: radius", ".mc-btn: weight", ".mc-btn: hover", ".mc-btn: primaryHover",
    ".pw-btn: weight", ".pw-btn: lineHeight", ".pw-btn: primaryHover",
    ".msg-btn: pad", ".msg-btn: weight", ".msg-btn: lineHeight", ".msg-btn: hover", ".msg-btn: disabledStyle",
    ".bd-btn: pad",
    ".bs-btn: radius", ".bs-btn: border", ".bs-btn: hover",
    ".vt-tabs: rule",
    ".pt-tabs: gap", ".pt-tabs: pad", ".pt-tabs: size", ".pt-tabs: underline", ".pt-tabs: line", ".pt-tabs: focus",
    ".hm-tabs: pad", ".hm-tabs: weight", ".hm-tabs: ink", ".hm-tabs: hover", ".hm-tabs: line", ".hm-tabs: countGap",
    ".msg-views: frame", ".msg-views: listDisplay", ".msg-views: radius", ".msg-views: pad", ".msg-views: size", ".msg-views: weight",
    ".msg-views: ink", ".msg-views: hover", ".msg-views: on", ".msg-views: focus",
  ];
  const now = C.deviations();
  assert.deepEqual(now.filter((d) => !DIFFERENCES.includes(d)), [], "a new difference from the canon");
  // Every `differs` key must be a look the generator knows, or it is silently
  // ignored and the list above under-counts.
  const total = [...C.BUTTON_FAMILIES, ...C.TAB_FAMILIES, ...C.SEGMENTED_FAMILIES].reduce((n, f) => n + Object.keys(f.differs || {}).length, 0);
  assert.equal(now.length, total + 1, "a `differs` key the generator does not read");
});

// --- no page keeps a copy -------------------------------------------------

// Stylesheets only: <style> spans, `const X_CSS = \`` literals, and a .css
// file whole.
function sheetsOf(file) {
  const text = root(file);
  if (file.endsWith(".css")) return [text];
  const out = [];
  for (const m of text.matchAll(/<style[^>]*>/g)) {
    // A <style> named in a // comment is prose, not a stylesheet.
    if (/^\s*\/\//.test(text.slice(text.lastIndexOf("\n", m.index) + 1, m.index))) continue;
    const e = text.indexOf("</style>", m.index); if (e > 0) out.push(text.slice(m.index + m[0].length, e));
  }
  if (!file.endsWith(".html")) for (const m of text.matchAll(/(?:^|\n)\s*(?:const|let) [A-Z0-9_]*CSS[A-Z0-9_]* =\s*`/g)) {
    const s = m.index + m[0].length; out.push(text.slice(s, text.indexOf("`", s)));
  }
  return out;
}

test("no page writes a rule the component already draws", () => {
  // The component's own selectors, minus the canonical .btn set that two
  // kinds of page restate ON PURPOSE (below).
  const drawn = new Set(rulesOf(CSS).map(([s]) => s));
  const FILES = ["index.html", "server.js", "home-page.js", "brokers-firms-page.js", "faq-page.js", "pricing-page.js", "messages-page.js",
    "permits-page.js", "sites-page.js", "buildings-page.js", "market-rank-page.js", "bulk-page.js", "home-sites.css", "vault-page.js"];
  // server.js also holds the admin pages, which draw their own documents and
  // their own .btn and never receive the component; they sit after
  // renderAdminHTML and are out of scope.
  const serverScope = (css, file) => css;
  const ALLOWED = {
    // The Comps and Pipeline pages restate the button whole, at their own
    // size (9px 16px, 13.5px, 6px corners): vault-page.js keeps a complete
    // design system of its own and test/vault-shell.test.js holds every
    // shared selector to that. It is the one page-level copy left.
    "vault-page.js": new Set([".btn", ".btn:hover", ".btn.ghost", ".btn.ghost:hover"]),
  };
  const offenders = [];
  for (const file of FILES) {
    let sheets = sheetsOf(file);
    if (file === "server.js") {
      const text = root(file), adminAt = text.indexOf("function renderAdminHTML() {");
      // Only the stylesheets declared before the admin pages.
      sheets = [];
      for (const m of text.slice(0, adminAt).matchAll(/(?:^|\n)\s*(?:const|let) [A-Z0-9_]*CSS[A-Z0-9_]* =\s*`/g)) {
        const s = m.index + m[0].length; sheets.push(text.slice(s, text.indexOf("`", s)));
      }
    }
    for (const sheet of sheets) {
      for (const [sel, , media] of rulesOf(serverScope(sheet, file))) {
        // A rule inside @media is a page adjusting the component for a
        // narrow screen (Permits' tabs tighten, the Comps tabs scroll).
        // That stays with the page; the component's own rules do not.
        if (media) continue;
        if (drawn.has(sel) && !(ALLOWED[file] && ALLOWED[file].has(sel))) offenders.push(`${file} ${sel}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `components.js draws these already; a second copy is how they drifted: ${offenders.join(", ")}`);
});

test("the pages that restyle .btn for one spot are counted, so a new one is a decision", () => {
  // A rule like `.hmctas .btn{padding:13px 24px}` is a page saying "the
  // button, but different here". Each is small; together they are how one
  // button became four sizes. The list may shrink (fold one into a size the
  // canon has) and may not grow.
  const KNOWN = [
    "brokers-firms-page.js .bfacts .btn", "brokers-firms-page.js .bfcta .btn",
    "home-page.js .hmclose .btn", "home-page.js .hmctas .btn", "home-page.js .hmrow .btn",
    "server.js .bd .btn.bd-addbtn", "server.js .bd .btn.bd-go", "server.js .mbuild .mb-types .btn",
    "vault-page.js .filters.vb-ledger .btn", "vault-page.js .vd-tray.on .btn.ghost",
  ];
  const LOOK = /(^|;)\s*(padding|border-radius|font-size|font-weight|background|border)\s*:/;
  const found = new Set();
  for (const file of ["index.html", "server.js", "home-page.js", "brokers-firms-page.js", "faq-page.js", "pricing-page.js", "vault-page.js",
    "messages-page.js", "permits-page.js", "sites-page.js", "buildings-page.js", "market-rank-page.js", "bulk-page.js", "home-sites.css"]) {
    const text = root(file), adminAt = file === "server.js" ? text.indexOf("function renderAdminHTML() {") : -1;
    let sheets = sheetsOf(file);
    if (file === "server.js") {
      sheets = [];
      for (const m of text.slice(0, adminAt).matchAll(/(?:^|\n)\s*(?:const|let) [A-Z0-9_]*CSS[A-Z0-9_]* =\s*`/g)) {
        const s = m.index + m[0].length; sheets.push(text.slice(s, text.indexOf("`", s)));
      }
    }
    for (const sheet of sheets) for (const [sel, body] of rulesOf(sheet)) {
      // A descendant selector ending on a plain .btn (states and the vault's
      // own .hide aside), that changes how the button LOOKS.
      if (!/\s\.btn(\.[\w-]+)*$/.test(sel) || !LOOK.test(body)) continue;
      found.add(`${file} ${sel}`);
    }
  }
  assert.deepEqual([...found].filter((x) => !KNOWN.includes(x)).sort(), [], "a new page-level restyle of .btn: use .btn, .btn.sm or .btn.ghost, or add a size to the canon");
});

// --- delivery --------------------------------------------------------------

test("server.js interpolates the stylesheet once into MARKET_CSS, and index.html holds a marker, never a copy", () => {
  const server = root("server.js");
  assert.match(server, /const COMPONENT_CSS = COMPONENTS\.componentCss\(\);/);
  const at = server.indexOf("const MARKET_CSS = `");
  const market = server.slice(at, server.indexOf("`;", at));
  assert.equal(market.split("${COMPONENT_CSS}").length - 1, 1, "MARKET_CSS must carry the components exactly once");
  assert.match(server, /\.replace\(COMPONENT_CSS_MARKER, \(\) => `<style>\$\{COMPONENT_CSS\}<\/style>`\)/);

  const index = root("index.html");
  assert.equal(index.split("<!--COMPONENT_CSS-->").length - 1, 1, "index.html must carry the marker exactly once");
  // After tailwind.css, so a component rule still out-ranks a utility of the
  // same weight (as the page's own rule did); before the page's own <style>,
  // so the page's own rules still out-rank the component.
  const marker = index.indexOf("<!--COMPONENT_CSS-->");
  assert.ok(index.indexOf('href="/tailwind.css"') < marker, "the marker must come after tailwind.css");
  assert.ok(marker < index.indexOf("\n  <style>\n"), "the marker must come before the page's own stylesheet");
  assert.ok(index.indexOf("<style>") > marker, "nothing above the marker may say <style>: theme.test.js slices the page's stylesheet from the first one");
});

test("both kinds of page are served the same stylesheet", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());
  const app = await (await fetch(srv.base + "/")).text();
  assert.equal(app.includes("<!--COMPONENT_CSS-->"), false, "the app was served with its marker unfilled");
  assert.equal(app.split(`<style>${CSS}</style>`).length - 1, 1, "the app does not carry the component stylesheet exactly once");
  const page = await (await fetch(srv.base + "/markets")).text();
  assert.equal(page.split(CSS).length - 1, 1, "a server-rendered page does not carry the component stylesheet exactly once");
});

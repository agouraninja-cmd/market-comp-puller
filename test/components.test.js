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
    action: { pad: "10px 24px", size: "var(--text-compact)", radius: "var(--r-lg)", weight: "600" },
    compact: { pad: "7px 12px", size: "var(--text-small)", radius: "var(--r-lg)", weight: "600" },
    large: { pad: "12px 26px", size: "var(--text-lead)" },
  });
  // One line height for every button, stated: a button that read its row's
  // leading was 35px on one page and 45px on another.
  assert.equal(C.BUTTON.lineHeight, "1.4");
  assert.equal(C.BUTTON.looks.primary.bg, "var(--red-fill)", "a filled button is --red-fill, never the text red");
  assert.equal(C.BUTTON.looks.primary.ink, "#fff");
  assert.equal(C.BUTTON.looks.secondary.bg, "var(--card)");
  assert.equal(C.BUTTON.looks.secondary.edge, "var(--edge)");
  assert.equal(C.TABS.tab.line, "var(--red)");
  assert.equal(C.TABS.tab.size, "var(--text-compact)");
  assert.equal(C.TABS.tab.weight, "500");
  assert.equal(C.TABS.tab.pad, "10px 12px");
  assert.match(C.SEGMENTED.item.on, /background:var\(--ink\);color:var\(--paper\)/);

  // The canonical classes exist, for new work.
  assert.equal(ruleFor(CSS, ".btn"), "display:inline-block;background:var(--red-fill);color:#fff;border:1px solid transparent;font-weight:600;padding:10px 24px;border-radius:var(--r-lg);font-size:var(--text-compact);line-height:1.4;text-align:center;transition:background-color .12s,border-color .12s,color .12s");
  assert.equal(ruleFor(CSS, ".btn:hover"), "background:var(--red-fill-hover);color:#fff");
  // No border:0 here: every .btn carries the 1px edge, so the red one and the
  // outlined one are the same size.
  assert.equal(ruleFor(CSS, "button.btn"), "cursor:pointer;font-family:inherit");
  assert.equal(ruleFor(CSS, ".btn.sm"), "padding:7px 12px;font-size:var(--text-small)");
  assert.equal(ruleFor(CSS, ".btn.lg"), "padding:12px 26px;font-size:var(--text-lead)");
  assert.equal(ruleFor(CSS, ".btn.ghost"), "background:var(--card);color:var(--ink);border-color:var(--edge)");
  assert.equal(ruleFor(CSS, ".btn[disabled]"), "opacity:.6;cursor:default");
  assert.equal(ruleFor(CSS, ".btn:focus-visible"), "outline:2px solid var(--red);outline-offset:2px");
  // A secondary button states its whole hover: .btn:hover has the same
  // weight and would otherwise turn it red.
  const ghostHover = ruleFor(CSS, ".btn.ghost:hover");
  assert.ok(decl(ghostHover, "background") && decl(ghostHover, "color"), ".btn.ghost:hover must restate background and colour");
  for (const sel of [".tabs", ".tab", '.tab[aria-selected="true"]', ".seg", ".seg>a", '.seg>[aria-selected="true"]']) {
    assert.ok(ruleFor(CSS, sel) != null, `the canonical ${sel} is missing`);
  }
});

test("a button is the same box whether it is red or outlined", () => {
  // Both looks carry a 1px border, or a red button beside an outlined one is
  // 2px shorter and the row jumps when one becomes the other.
  for (const f of C.BUTTON_FAMILIES.filter((x) => x.primary)) {
    const base = ruleFor(CSS, f.sel), pri = ruleFor(CSS, f.sel + f.primary);
    assert.match(decl(base, "border"), /^1px solid /, `${f.sel} has no border`);
    assert.ok(decl(pri, "border-color"), `${f.sel}${f.primary} drops the border instead of colouring it`);
    assert.equal(decl(pri, "padding"), null, `${f.sel}${f.primary} resizes the button`);
  }
  // The same for the canonical button: .ghost recolours the edge the red one
  // already has, and never adds or removes it.
  assert.match(decl(ruleFor(CSS, ".btn"), "border"), /^1px solid /);
  assert.equal(decl(ruleFor(CSS, ".btn.ghost"), "border"), null);
  assert.equal(decl(ruleFor(CSS, ".btn.ghost"), "padding"), null);
  assert.equal(decl(ruleFor(CSS, "button.btn"), "border"), null, "button.btn out-ranks .btn: a border here would strip the edge from every real <button>");
});

test("every button has the same shape, height, focus ring and disabled look", () => {
  const c = C.BUTTON.sizes.compact;
  for (const f of C.BUTTON_FAMILIES) {
    const base = ruleFor(CSS, f.sel);
    assert.equal(decl(base, "border-radius"), C.BUTTON.sizes.action.radius, `${f.sel}: one corner for every button`);
    assert.equal(decl(base, "line-height"), C.BUTTON.lineHeight, `${f.sel}: a button states its own line height`);
    assert.equal(decl(base, "padding"), c.pad, f.sel);
    assert.equal(ruleFor(CSS, f.sel + ":focus-visible"), C.BUTTON.focus, `${f.sel} has no keyboard focus ring`);
    assert.equal(ruleFor(CSS, f.sel + "[disabled]"), C.BUTTON.disabled, `${f.sel} does not dim when disabled`);
    // The hover restates the label's colour: a button that is a link would
    // otherwise take its page's a:hover colour.
    assert.ok(decl(ruleFor(CSS, f.sel + ":hover"), "color"), `${f.sel}:hover does not restate its colour`);
    if (f.primary) assert.equal(decl(ruleFor(CSS, f.sel + f.primary + ":hover"), "color"), "#fff", `${f.sel}${f.primary}:hover`);
  }
});

test("tabs: a hairline under the row, a red line under the current tab, and no negative margin", () => {
  // The hairline is an inset shadow and the line is the tab's own border, so
  // a row that scrolls sideways on a phone does not also scroll 1px up and
  // down (a -1px margin under overflow-x:auto does exactly that).
  assert.doesNotMatch(CSS, /margin-bottom:-1px/);
  for (const f of C.TAB_FAMILIES) {
    assert.equal(decl(ruleFor(CSS, f.list), "box-shadow"), `inset 0 -1px 0 ${C.TABS.list.rule}`, f.list);
    assert.equal(decl(ruleFor(CSS, f.list), "border-bottom"), null, f.list);
    assert.equal(decl(ruleFor(CSS, f.tab), "border-bottom"), "2px solid transparent", f.tab);
    assert.equal(decl(ruleFor(CSS, f.on), "border-bottom-color"), "var(--red)", f.on);
    // An empty count is taken out, or it holds the label's gap open.
    if (f.count) assert.equal(ruleFor(CSS, f.count + ":empty"), "display:none", f.count);
  }
});

test("hidden means hidden: every selector given a display says the attribute again", () => {
  // The browser's own rule for [hidden] loses to ANY rule that sets display,
  // so a component that sets one must restate it, or `el.hidden = true` does
  // nothing. From 2026-11-10 to 2026-11-13 it did nothing on Home's People
  // tab (shown, and dead, to a member in no firm) and on /sites' "+ Add a
  // site" (shown over the wall that says Sites is not for this member).
  for (const css of [CSS, UNIFIED]) {
    const rules = rulesOf(css);
    const shows = rules.filter(([, body]) => { const d = decl(body, "display"); return d && d !== "none"; });
    assert.ok(shows.length >= 12, "the walk found too few display rules to mean anything");
    for (const [sel] of shows) {
      assert.equal(ruleFor(css, sel + "[hidden]"), "display:none", `${sel} sets a display and has no ${sel}[hidden]{display:none}`);
    }
  }
  // The two that were live, by name.
  assert.equal(ruleFor(CSS, ".hm-tabs button[hidden]"), "display:none");
  assert.equal(ruleFor(CSS, ".hm-btn[hidden]"), "display:none");
  // And each one out-ranks the rule it answers: same selector plus an
  // attribute, written after it.
  for (const sel of [".hm-tabs button", ".hm-btn", ".btn", ".tab"]) {
    assert.ok(CSS.indexOf(sel + "[hidden]{") > CSS.indexOf(sel + "{"), `${sel}[hidden] must come after ${sel}`);
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
    assert.equal(decl(base, "line-height"), C.BUTTON.lineHeight, f.sel);
  }
  for (const f of C.TAB_FAMILIES) {
    const tab = ruleFor(UNIFIED, f.tab), on = ruleFor(UNIFIED, f.on);
    assert.equal(decl(tab, "padding"), C.TABS.tab.pad, f.tab);
    assert.equal(decl(tab, "font-size"), C.TABS.tab.size, f.tab);
    assert.equal(decl(tab, "color"), C.TABS.tab.ink, f.tab);
    assert.equal(decl(on, "border-bottom-color"), C.TABS.tab.line, f.on);
    assert.equal(decl(ruleFor(UNIFIED, f.list), "box-shadow"), `inset 0 -1px 0 ${C.TABS.list.rule}`, f.list);
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
  // pages (before and after pictures); adding one is refused here. On
  // 2026-11-10 the 34 button and underlined-tab differences were all deleted:
  // every button and every underlined tab is the canon. What is left is
  // Messages' Chats / Reports switch, which sits inside a card's header with
  // an unread count in it and is a quieter control than the ink pill.
  const DIFFERENCES = [
    ".msg-views: frame", ".msg-views: listDisplay", ".msg-views: radius", ".msg-views: pad", ".msg-views: size", ".msg-views: weight",
    ".msg-views: ink", ".msg-views: hover", ".msg-views: on", ".msg-views: focus",
  ];
  const now = C.deviations();
  assert.deepEqual(now.filter((d) => !DIFFERENCES.includes(d)), [], "a new difference from the canon");
  // Every `differs` key must be a look the generator knows, or it is silently
  // ignored and the list above under-counts.
  const total = [...C.BUTTON_FAMILIES, ...C.TAB_FAMILIES, ...C.SEGMENTED_FAMILIES].reduce((n, f) => n + Object.keys(f.differs || {}).length, 0);
  assert.equal(now.length, total, "a `differs` key the generator does not read");
  // No button and no underlined tab may grow a difference back.
  for (const f of [...C.BUTTON_FAMILIES, ...C.TAB_FAMILIES]) assert.deepEqual(f.differs, {}, `${f.sel || f.list} departs from the canon again`);
});

test("on a phone every form field is 16px, so an iPhone does not zoom in on a tap", () => {
  const css = C.fieldCss();
  assert.ok(CSS.includes(css), "the field rule is not in the served stylesheet");
  // A narrow window OR a touch screen: an iPhone on its side is wider than
  // any phone breakpoint.
  assert.match(css, /^@media \(max-width:640px\),\(pointer:coarse\)\{/);
  const [[sel, body]] = rulesOf(css).slice(0, 1);
  assert.equal(body, "font-size:var(--text-input)!important");
  assert.equal(SCALE_TOKENS["text-input"], "16px", "iOS zooms under 16px exactly");
  const sels = rulesOf(css).map(([s]) => s);
  assert.ok(sels.includes("select") && sels.includes("textarea"));
  // The kinds of <input> that are not text keep their own size.
  for (const t of ["checkbox", "radio", "range", "button", "submit", "file", "hidden"]) assert.ok(sel.includes(`[type=${t}]`), `input[type=${t}] must be left alone`);
  // A floor, never a ceiling: the report's main address box is 17px
  // (.rd-in-lg), and an !important 16px would shrink it. It is the only field
  // in the app set larger than 16px; one that joins it needs the same :not().
  assert.ok(sel.includes(":not(.rd-in-lg)"), "the 17px address box must be left out, or the rule makes it smaller");
  assert.match(root("index.html"), /\.rd-in-lg\s*\{[^}]*font-size:\s*17px/, ".rd-in-lg is no longer 17px: revisit the exemption");
  // One line: test/vault-shell.test.js reads a rule from the line it starts
  // on, and would otherwise hold the vault's own select and textarea to it.
  assert.equal(css.includes("\n"), false);
  // It is the only !important in the file.
  assert.equal(CSS.split("!important").length - 1, 1);
  // The deal room draws its own document and takes this one rule by hand.
  assert.match(root("server.js"), /FIELD_CSS: COMPONENTS\.fieldCss\(\)/);
  assert.match(root("hub-page.js"), /\$\{FIELD_CSS\}\n<\/style>/);
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
  // (Its @media rule is the phone field size, which names bare `select` and
  // `textarea`; every page has rules of its own for those, as it should.)
  const drawn = new Set(rulesOf(CSS).filter(([, , media]) => !media).map(([s]) => s));
  const FILES = ["index.html", "server.js", "home-page.js", "brokers-firms-page.js", "lenders-page.js", "faq-page.js", "pricing-page.js", "messages-page.js",
    "permits-page.js", "sites-page.js", "buildings-page.js", "market-rank-page.js", "bulk-page.js", "home-sites.css", "vault-page.js"];
  // server.js also holds the admin pages, which draw their own documents and
  // their own .btn and never receive the component; they sit after
  // renderAdminHTML and are out of scope.
  const serverScope = (css, file) => css;
  const ALLOWED = {
    // The Comps and Pipeline pages restate the button whole, at their own
    // size (8px 15px at 14px, between compact and action): vault-page.js
    // keeps a complete design system of its own and test/vault-shell.test.js
    // holds every shared selector to that. It is the one page-level copy
    // left, and it takes the canon's corner, line height and border (below).
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
  // 2026-11-10: the marketing pages' big buttons became .btn.lg and The
  // Board's add button .btn.sm, which took four off this list. The two dark
  // bands keep a rule each for their colour alone (a brighter red on a
  // surface that is dark in both themes).
  const KNOWN = [
    "brokers-firms-page.js .bfcta .btn",
    "home-page.js .hmclose .btn",
    "server.js .bd .btn.bd-go", "server.js .mbuild .mb-types .btn",
    "vault-page.js .filters.vb-ledger .btn", "vault-page.js .vd-tray.on .btn.ghost",
  ];
  const LOOK = /(^|;)\s*(padding|border-radius|font-size|font-weight|background|border)\s*:/;
  const found = new Set();
  for (const file of ["index.html", "server.js", "home-page.js", "brokers-firms-page.js", "lenders-page.js", "faq-page.js", "pricing-page.js", "vault-page.js",
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
  assert.deepEqual([...found].filter((x) => !KNOWN.includes(x)).sort(), [], "a new page-level restyle of .btn: use .btn, .btn.sm, .btn.lg or .btn.ghost, or add a size to the canon");
  // And the list is exact, so a rule that goes takes its name with it.
  assert.deepEqual(KNOWN.filter((x) => !found.has(x)), [], "a page-level restyle on the list is gone: delete its name");
});

test("the vault's own button takes the canon's shape", () => {
  // vault-page.js restates .btn at its own size. Shape is not size: the
  // corner, the line height and the always-there 1px edge are the canon's.
  const vault = sheetsOf("vault-page.js").join("\n");
  const btn = ruleFor(vault, ".btn");
  assert.equal(decl(btn, "border-radius"), C.BUTTON.sizes.action.radius);
  assert.equal(decl(btn, "line-height"), C.BUTTON.lineHeight);
  assert.equal(decl(btn, "border"), "1px solid transparent");
  assert.equal(decl(ruleFor(vault, ".btn.ghost"), "border"), null, "the vault's outlined button must recolour the edge, not add one: that made it 2px taller than the red one");
});

test("the marketing pages use the shared sizes, never a button of their own", () => {
  for (const file of ["home-page.js", "brokers-firms-page.js", "lenders-page.js", "faq-page.js", "pricing-page.js"]) {
    const text = root(file);
    assert.doesNotMatch(text, /class="faqghost"/, `${file}: the outlined button is .btn.ghost`);
    for (const m of text.matchAll(/class="([^"]*\bbtn2\b[^"]*)"/g)) assert.match(m[1], /\bbtn\b/, `${file}: .btn2 is a colour for the dark band, on top of .btn`);
  }
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

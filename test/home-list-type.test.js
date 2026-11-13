// The type and the edge of Home's list (2026-11-13).
//
// The owner, of the panel beside the map: "there are too many different
// types of fonts and font sizes and the layout is weird". Measured on an
// account like his, the panel set two typefaces in nine sizes (Georgia at 30,
// 24, 19, 17, 15.5 and 14; Inter at 15, 14, 13, 12 and 11), wrote a section's
// name three ways (capitals with wide spacing, a Georgia word, capitals over
// a black rule), and drew Today in boxes whose words started 16px inside the
// line everything else on the panel starts on.
//
// What it is now, and what this file holds the stylesheet to:
//   1. Georgia is the greeting and nothing else in the list.
//   2. Under the greeting there are four sizes: 14, 13, 12, and 20 for a
//      figure. Nothing is 11px, and nothing is in capitals.
//   3. Every section of every tab is named by ONE rule.
//   4. Every section starts on the head's line: none is a card.
//
// It reads the stylesheet, because none of this can go red any other way: a
// rule that brings a fifth size back draws a page that works.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// Home's own stylesheet, comments out (test/home-head.test.js reads the same
// stretch the same way).
const style = (() => {
  const at = html.indexOf("/* ---- Home as one map (2026-10-07");
  assert.notEqual(at, -1, "the Home stylesheet's opening comment moved");
  return html.slice(at, html.indexOf("</style>", at)).replace(/\/\*[\s\S]*?\*\//g, "");
})();

// Every rule in it, inside an @media block or not: [selector, body]. The
// innermost braces are the rules, so a block's own prelude never matches.
const RULES = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => [m[1].trim().replace(/\s+/g, " "), m[2]]);
const decl = (body, prop) => {
  const m = body.match(new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)"));
  return m ? m[1].trim() : null;
};

// What is NOT the list: the map and what floats on it (its switch, legend,
// pins, tags, stacks and cards), and the first-building screen, which is laid
// over the map and has its own head. Those keep their own type.
const ON_THE_MAP = /\.hm-(legend|layers|layer-note|map-empty|first|npin|tag\b|stk|pop|credit|mk\b|pip|mapw)|#hmFirst/;
const LIST = RULES.filter(([sel]) => !ON_THE_MAP.test(sel));

test("the sheet is read: the list's rules are found, and the map's are told apart", () => {
  assert.ok(LIST.length > 150, `only ${LIST.length} list rules were read`);
  assert.ok(LIST.some(([sel]) => sel === ".hm-title"));
  assert.ok(LIST.some(([sel]) => sel === ".hm-rt b"));
  assert.ok(!LIST.some(([sel]) => sel.includes(".hm-pop")), "the map card is not the list");
});

test("Georgia is the greeting and nothing else in the list", () => {
  const serif = LIST.filter(([, body]) => /font-family\s*:[^;]*(serif\)|Georgia)/.test(body)).map(([sel]) => sel);
  assert.deepEqual(serif, [".hm-title"],
    "a second Georgia in the list: the greeting is this page's title and the only one");
  // A family is otherwise only ever handed back to the page's own.
  for (const [sel, body] of LIST) {
    const family = decl(body, "font-family");
    if (family == null || sel === ".hm-title") continue;
    assert.equal(family, "inherit", `${sel} names a typeface of its own (${family})`);
  }
});

test("four sizes under the greeting: 14, 13, 12, and 20 for a figure", () => {
  const TEXT = ["var(--text-compact)", "var(--text-small)", "var(--text-label)"];
  // The figures: At a glance's, and the value in the pane under a property.
  const FIGURES = [".hm-fig b", ".hm-panel .hs-vb"];
  const figures = [];
  for (const [sel, body] of LIST) {
    const size = decl(body, "font-size");
    if (size == null) continue;
    if (sel === ".hm-title") { assert.equal(size, "30px"); continue; }
    // The firm's initials on a narrow phone, in a 28px tile: the head's own
    // rule, held by test/home-head.test.js. The one 11px left on the panel.
    if (sel === ".hm-fh-mark" && size === "var(--text-tiny)") continue;
    if (size === "var(--text-subhead)") { figures.push(sel); continue; }
    assert.ok(TEXT.includes(size), `${sel} is set in ${size}: the list's text is 14, 13 or 12`);
  }
  assert.deepEqual(figures.sort(), FIGURES.slice().sort(), "20px is a figure's size and nothing else's");
  // Said once: a figure is not made a different size on a phone.
  assert.equal(RULES.filter(([sel]) => sel === ".hm-fig b").length, 1);
});

test("nothing in the list is in capitals", () => {
  for (const [sel, body] of LIST) {
    const tt = decl(body, "text-transform");
    if (tt != null) assert.equal(tt, "none", `${sel} is set in ${tt}`);
    const ls = decl(body, "letter-spacing");
    // Wide spacing is what capitals were set with. A figure is tightened a
    // hair, the greeting a hair more, and the firm's initials opened a hair.
    if (ls != null) assert.ok(Math.abs(parseFloat(ls)) <= 0.02, `${sel} is letter-spaced ${ls}`);
  }
});

test("one section label: every part of every tab is named by the same rule", () => {
  const LABELS = [".hm-bk", ".hm-next-k", ".hm-gh b", ".hm-fold > summary",
    "#hmPanePeople #deskContacts > .dk-rule .rd-lab"];
  const hit = RULES.filter(([sel]) => sel.split(",").map((s) => s.trim()).includes(".hm-bk")
    && sel.includes(","));
  assert.equal(hit.length, 1, "the section label's rule is gone, or written twice");
  const [sel, body] = hit[0];
  assert.deepEqual(sel.split(",").map((s) => s.trim()).sort(), LABELS.slice().sort());
  assert.equal(decl(body, "font-size"), "var(--text-small)");
  assert.equal(decl(body, "font-weight"), "600");
  assert.equal(decl(body, "font-family"), "inherit");
  assert.equal(decl(body, "text-transform"), "none");
  assert.equal(decl(body, "letter-spacing"), "0");
  assert.equal(decl(body, "color"), "var(--ink-2)");
  // No label is given a size, a weight, a face or a colour of its own again
  // by a rule of its own: that is how there came to be three.
  for (const one of LABELS) {
    for (const [s, b] of RULES) {
      if (s !== one) continue;
      for (const prop of ["font-size", "font-weight", "font-family", "text-transform", "letter-spacing", "color"]) {
        assert.equal(decl(b, prop), null, `${one} sets its own ${prop}`);
      }
    }
  }
  // And the markup still hands each section its label.
  assert.match(html, /<h3 id="hmGlanceK" class="hm-bk">At a glance<\/h3>/);
  assert.match(html, /<h3 id="hmLaterK" class="hm-bk">Coming up<\/h3>/);
  assert.match(html, /<h3 id="hmMovedK" class="hm-bk">What moved <span>since first valued<\/span><\/h3>/);
  assert.match(html, /<div class="hm-next-k">Next<\/div>/);
  assert.match(html, /const h = hmEl\("div", "hm-gh"\);\s*h\.append\(hmEl\("b", null, title\)/);
});

test("one left edge: a section is on the list's line, never a card inside it", () => {
  const one = (sel) => {
    const hits = RULES.filter(([s]) => s === sel);
    assert.equal(hits.length, 1, `${sel} is written ${hits.length} times`);
    return hits[0][1];
  };
  const sides = (v) => { const p = String(v).trim().split(/\s+/).map(parseFloat); return p.length === 1 ? p[0] : p[1]; };
  // Today's sections and Next: no box (a border all round, a fill, a corner)
  // and no padding at the sides. test/home-head.test.js adds the 10px margin
  // these keep to the body's padding and compares it with the head's.
  for (const sel of [".hm-bc", ".hm-next"]) {
    const body = one(sel);
    assert.equal(decl(body, "border"), null, `${sel} is a box again`);
    assert.equal(decl(body, "background"), null, `${sel} is filled again`);
    assert.equal(decl(body, "border-radius"), null, `${sel} has a corner again`);
    assert.equal(sides(decl(body, "padding")), 0, `${sel}'s words no longer start on the list's line`);
  }
  // A group's head on Properties is on the same line, with its note under it.
  const gh = one(".hm-gh");
  assert.equal(sides(decl(gh, "margin")), 10);
  assert.equal(sides(decl(gh, "padding")), 0);
  assert.equal(decl(gh, "flex-wrap"), "wrap");
  assert.match(one(".hm-gh small"), /flex:\s*0 0 100%/, "a group's note is back beside its name, where it broke in two");
  // What parts one section from the next is the list's rule, drawn only
  // between two that show: a hidden first section leaves no rule behind.
  assert.equal(decl(one(".hm-bc:not(.hidden) ~ .hm-bc"), "border-top"), "1px solid var(--line)");
  assert.equal(decl(one(".hm-brief:not(.hidden) ~ .hm-next"), "border-top"), "1px solid var(--line)");
  assert.equal(decl(one(".hm-rows > .hm-gh:not(:first-child)"), "border-top"), "1px solid var(--line)");
  assert.equal(decl(one("#hmPanePeople #deskContacts > .dk-rule"), "border-top"), "1px solid var(--line)");
  assert.equal(decl(one("#hmPanePeople #deskContacts > .dk-rule"), "border-bottom"), "0");
});

test("what the list borrows is brought onto its scale from the panel's side", () => {
  // The pane under a property is home-sites.css's, shared with /sites, and
  // the contacts are the desk's .dk- rules. Both keep their own type for
  // everybody else: the list's rules are scoped to the panel.
  const css = fs.readFileSync(path.join(__dirname, "..", "home-sites.css"), "utf8");
  assert.match(css, /\.hs-vb \{[^}]*font-family: var\(--serif\)/, "home-sites.css changed: /sites sets its value in its own type");
  for (const [sel] of RULES) {
    if (/\.hs-/.test(sel)) assert.ok(sel.split(",").every((s) => s.trim().startsWith(".hm-panel ")), `${sel} restyles the pane for /sites too`);
    if (/\.dk-(rule|note|toggle|copy|row|gt)/.test(sel)) {
      assert.ok(sel.split(",").every((s) => /#hmPanePeople /.test(s) || !/\.dk-(rule|note|toggle|copy|row|gt)/.test(s)), `${sel} restyles the desk's rows everywhere`);
    }
  }
});

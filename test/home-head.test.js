// The head of Home's list panel (2026-11-13): the firm bar, the day, the
// greeting and the status sentence.
//
// The owner sent a picture of his own Home and said the panel "looks off".
// His is the case the old firm row handled worst: a firm named after its
// owner, one person, no logo. The row was three lines tall with four text
// colours in 60px (an ink name, an indigo shop kind, a grey head count and a
// red "+ Add your firm's logo" that was the loudest thing on the panel), it
// was a line shorter once a logo was saved, and it sat two pixels out of line
// with the cards under the tabs.
//
// Two halves here. The first RUNS drawFirmHead against a stand-in document in
// every state it has, because until now only its source was matched: nothing
// executed it. The second holds the stylesheet to the handful of decisions a
// tidy-up would undo without anything going red (the alignment line above
// all: it drifted in the first place because nothing tied the head's inset to
// the list's).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { SCALE_TOKENS } = require("../theme.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// ---------------------------------------------------------------------------
// A stand-in document: what drawFirmHead touches and no more (ids, classes,
// text, append, attributes, listeners). Not jsdom: this repo has no npm
// dependencies. An element's `title` and `type` are plain properties, as they
// are in a browser; `className` and `classList` are one set.
// ---------------------------------------------------------------------------
function makeEl(tag, doc) {
  const classes = new Set();
  const handlers = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    _text: "",
    attrs: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
    append(...nodes) {
      for (const n of nodes) el.children.push(typeof n === "string" ? { nodeType: 3, textContent: n, children: [] } : n);
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; if (k === "title") el.title = ""; },
    addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    fire(ev) { (handlers[ev] || []).forEach((fn) => fn({ target: el })); },
    click() { el.clicks = (el.clicks || 0) + 1; el.fire("click"); },
    // An element or anything under it, as Node.contains answers.
    contains(node) { return node === el || el.children.some((c) => c.contains && c.contains(node)); },
    // Only a button takes the focus, as in a browser (a span is not a stop).
    focus() { if (doc && el.tagName === "BUTTON") doc.activeElement = el; },
    title: "",
    tabIndex: 0,
  };
  Object.defineProperty(el, "className", {
    get: () => [...classes].join(" "),
    set: (v) => { classes.clear(); String(v || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
  });
  Object.defineProperty(el, "textContent", {
    get: () => el._text + el.children.map((c) => c.textContent).join(""),
    set: (v) => { el.children = []; el._text = v == null ? "" : String(v); },
  });
  return el;
}

// Every element under `node`, depth first, the node itself excluded.
function walk(node, out = []) {
  for (const c of node.children || []) { if (c.tagName) out.push(c); walk(c, out); }
  return out;
}
const byClass = (node, cls) => walk(node).filter((e) => e.classList.contains(cls));

// The classes the page's markup ships each id with (`hidden` above all).
const MARKUP_CLASSES = (() => {
  const map = new Map();
  for (const m of html.matchAll(/<[a-z][a-z0-9]*\s[^>]*>/gi)) {
    const id = m[0].match(/\bid="([^"]+)"/);
    if (id) map.set(id[1], (m[0].match(/\bclass="([^"]*)"/) || [, ""])[1]);
  }
  return map;
})();

const slice = (re) => {
  const m = html.match(re);
  assert.ok(m, `could not find ${re} in index.html: was it renamed or moved?`);
  return m[0];
};

// drawFirmHead with everything it reads, run in its own context. The shop's
// words are the page's own (SHOP_COPY), never a copy typed here.
function loadFirmHead(members) {
  const els = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (!els.has(id)) { const e = makeEl("div", document); e.className = MARKUP_CLASSES.get(id) || ""; els.set(id, e); }
      return els.get(id);
    },
    createElement: (tag) => makeEl(tag, document),
  };
  const ctx = vm.createContext({ document, console, encodeURIComponent, __members: members || [] });
  new vm.Script([
    "let firmMembers = __members;",
    slice(/  const SHOP_COPY = \{[\s\S]*?\n  \};/),
    slice(/  const shopCopy = \(kind\) => [^\n]*;/),
    slice(/  function hmEl\(tag, cls, text\) \{[\s\S]*?\n  \}/),
    slice(/  function firmInitials\(name\) \{[\s\S]*?\n  \}\n  function drawFirmHead\(firm\) \{[\s\S]*?\n  \}/),
    "this.draw = drawFirmHead; this.setMembers = (m) => { firmMembers = m; };",
  ].join("\n"), { filename: "index.html" }).runInContext(ctx);
  const el = (id) => document.getElementById(id);
  return {
    draw: ctx.draw, setMembers: ctx.setMembers, el, document,
    // The facts line as a reader meets it: each fact's words, in order.
    facts: () => el("hmFirmMeta").children.map((c) => c.textContent),
    mark: () => el("hmFirmMarkWrap").children[0] || null,
  };
}

const joined = (n) => Array.from({ length: n }, (_, i) => ({ id: "m" + i, pending: false }));
const JORDAN = { id: "org-1", name: "Jordan R Avery", kind: "development", canManage: true, logoAt: "" };
const HARBOR = { id: "org-2", name: "Harbor & Pine Development", kind: "development", canManage: true, logoAt: "1794500000000" };
const KWCA = { id: "org-3", name: "Kensington Whitfield Commercial Advisors", kind: "broker", canManage: false, logoAt: "" };

test("no firm: no bar, and nothing of a firm left in it", () => {
  const ctx = loadFirmHead(joined(3));
  ctx.draw(JORDAN);
  ctx.draw(null);
  assert.ok(ctx.el("hmFirmHead").classList.contains("hidden"), "the bar shows to a member in no firm");
  assert.ok(ctx.el("hmFirmGear").classList.contains("hidden"));
  assert.equal(ctx.el("hmFirmName").textContent, "");
  assert.equal(ctx.el("hmFirmName").title, "", "the last firm's name is still the tooltip");
  assert.deepEqual(ctx.facts(), []);
  assert.equal(ctx.mark(), null);
  assert.ok(!ctx.el("hmFirmMeta").classList.contains("has-door"));
  // What the row last said goes with it: a "Saved." left standing would sit
  // alone at the top of a Home that has no firm (a member who then leaves).
  const said = loadFirmHead(joined(1));
  said.draw(JORDAN);
  said.el("hmFirmMsg").textContent = "Saved. Everyone in your firm sees it here.";
  said.el("hmFirmMsg").classList.remove("hidden");
  said.draw(JORDAN);
  assert.ok(!said.el("hmFirmMsg").classList.contains("hidden"), "a redraw of the same firm took the message down mid-read");
  said.draw(null);
  assert.equal(said.el("hmFirmMsg").textContent, "");
  assert.ok(said.el("hmFirmMsg").classList.contains("hidden"), "the saving message outlived the firm row");
});

test("the owner's own screen: a firm of one with no logo is two lines, the logo's door the last fact on the second", () => {
  const ctx = loadFirmHead(joined(1));
  ctx.draw(JORDAN);
  assert.ok(!ctx.el("hmFirmHead").classList.contains("hidden"));
  assert.ok(!ctx.el("hmFirmGear").classList.contains("hidden"), "Firm settings is every member's door");
  assert.equal(ctx.el("hmFirmName").textContent, "Jordan R Avery");
  // The shop and ONE more thing. While the logo's door is offered it takes
  // the head count's place: the row stays two lines, and the second fits
  // beside the button without a word cut in half.
  assert.deepEqual(ctx.facts(), ["Development shop", "Add a logo"]);
  const meta = ctx.el("hmFirmMeta");
  assert.deepEqual(meta.children.map((c) => c.tagName), ["EM", "BUTTON"]);
  // Each fact is its own element, so the stylesheet draws the dot between
  // them and one can drop out on a narrow phone without leaving a dot.
  assert.ok(meta.children.every((c) => c.nodeType !== 3), "a bare text node in the facts line: its dot would be typed, not drawn");
  // The door: a real button, in words, and a fact in its own right.
  const door = byClass(meta, "hm-fh-logo")[0];
  assert.ok(door, "an owner with no logo is not offered one");
  assert.equal(byClass(meta, "hm-fh-logo").length, 1, "exactly one door");
  // It lives IN the facts line, never after it: a door beside the line is the
  // third line this row used to grow.
  assert.doesNotMatch(slice(/  function drawFirmHead\(firm\) \{[\s\S]*?\n  \}/), /meta\.after\(/);
  assert.equal(door.tagName, "BUTTON");
  assert.equal(door.type, "button");
  assert.equal(door.textContent, "Add a logo");
  assert.equal(meta.children[1], door, "the door is wrapped: the dot is the stylesheet's, after the fact before it");
  assert.ok(meta.classList.contains("has-door"));
  // Both the words and the mark open the file picker.
  const file = ctx.el("hmFirmLogoFile");
  door.click();
  assert.equal(file.clicks, 1, "the words do not open the file picker");
  const mark = ctx.mark();
  assert.equal(mark.tagName, "BUTTON");
  assert.equal(mark.id, "hmFirmMark");
  assert.equal(mark.textContent, "JR");
  mark.click();
  assert.equal(file.clicks, 2, "the mark does not open the file picker");
  // Two buttons for one job, side by side. While the words are offered they
  // are the one the keyboard stops on and a screen reader names; the initials
  // stay a place to click, and say what they do on hover.
  assert.equal(mark.tabIndex, -1, "the initials and the words are two keyboard stops for one job");
  assert.equal(mark.getAttribute("aria-hidden"), "true");
  assert.equal(mark.title, "Add your firm's logo");
  assert.equal(door.tabIndex, 0);
});

test("a firm with a logo: the picture, no door, and the same two lines", () => {
  const ctx = loadFirmHead(joined(4));
  ctx.draw(HARBOR);
  assert.deepEqual(ctx.facts(), ["Development shop", "4 people"]);
  assert.ok(ctx.el("hmFirmMeta").children[1].classList.contains("hm-fh-n"), "the head count is not marked, so a narrow phone cannot drop it whole");
  assert.ok(!ctx.el("hmFirmMeta").classList.contains("has-door"));
  const mark = ctx.mark();
  assert.ok(mark.classList.contains("logo"));
  const img = mark.children[0];
  assert.equal(img.tagName, "IMG");
  assert.equal(img.src, "/api/org/logo?id=org-2&v=1794500000000");
  assert.equal(mark.getAttribute("aria-label"), "Change your firm's logo");
  // With no door beside it the mark is the control: a keyboard stop, named.
  assert.equal(mark.tabIndex, 0);
  assert.equal(mark.getAttribute("aria-hidden"), null);
  // The button is named by its label, so the picture inside it says nothing.
  assert.equal(img.alt, "");
  // A logo that will not load falls back to the initials, and the mark stops
  // claiming to be a picture: it offers to add one, by name.
  img.fire("error");
  assert.ok(!mark.classList.contains("logo"));
  assert.equal(mark.textContent, "HP");
  assert.match(mark.getAttribute("aria-label"), /^Add your firm's logo\./);
  assert.equal(mark.getAttribute("aria-hidden"), null, "a failed logo has no door beside it: the mark must stay reachable");
  // A member who cannot manage sees the same logo as a picture, and the
  // picture's alt text is the only name it has.
  const member = loadFirmHead(joined(4));
  member.draw({ ...HARBOR, canManage: false });
  const seen = member.mark();
  assert.equal(seen.tagName, "SPAN");
  assert.ok(seen.classList.contains("logo"));
  assert.equal(seen.children[0].alt, "Harbor & Pine Development logo");
  assert.equal(seen.getAttribute("aria-hidden"), null, "a member's logo is hidden from a screen reader");
  assert.deepEqual(member.facts(), ["Development shop", "4 people"]);
});

test("a member who cannot manage: initials that are not a button, the whole of a long name one hover away, no door", () => {
  const ctx = loadFirmHead([...joined(12), { id: "p", pending: true }]);
  ctx.draw(KWCA);
  assert.deepEqual(ctx.facts(), ["Broker shop", "12 people"], "an invitation nobody has accepted is not a person yet");
  const mark = ctx.mark();
  assert.equal(mark.tagName, "SPAN");
  assert.equal(mark.textContent, "KW");
  assert.equal(mark.getAttribute("aria-hidden"), "true");
  assert.equal(byClass(ctx.el("hmFirmMeta"), "hm-fh-logo").length, 0);
  assert.ok(!ctx.el("hmFirmMeta").classList.contains("has-door"));
  // The bar cuts a long name with an ellipsis; the tooltip carries all of it.
  assert.equal(ctx.el("hmFirmName").title, "Kensington Whitfield Commercial Advisors");
});

test("every draw rebuilds the row: the door stands in for the head count, and a saved logo swaps them back", () => {
  const ctx = loadFirmHead([]);
  ctx.draw(JORDAN);
  assert.deepEqual(ctx.facts(), ["Development shop", "Add a logo"]);
  // The roster landing changes nothing while the door is offered, however
  // many have joined: three facts do not fit beside the button.
  ctx.setMembers(joined(12));
  ctx.draw(JORDAN);
  assert.deepEqual(ctx.facts(), ["Development shop", "Add a logo"]);
  // A logo is saved: the door goes and the count is back.
  ctx.draw({ ...JORDAN, logoAt: "1794500000001" });
  assert.deepEqual(ctx.facts(), ["Development shop", "12 people"], "the door outlived the logo it asked for");
  assert.equal(byClass(ctx.el("hmFirmMeta"), "hm-fh-logo").length, 0);
  assert.ok(!ctx.el("hmFirmMeta").classList.contains("has-door"));
  assert.equal(ctx.el("hmFirmMarkWrap").children.length, 1, "a redraw stacked a second mark");
  // One person is a person, and a roster that has not landed is no count at
  // all (never "0 people").
  ctx.setMembers(joined(1));
  ctx.draw({ ...JORDAN, logoAt: "1794500000001" });
  assert.deepEqual(ctx.facts(), ["Development shop", "1 person"]);
  ctx.setMembers([]);
  ctx.draw({ ...JORDAN, logoAt: "1794500000001" });
  assert.deepEqual(ctx.facts(), ["Development shop"]);
  // A member who cannot manage is never offered the door, so always the count.
  ctx.setMembers(joined(3));
  ctx.draw({ ...JORDAN, canManage: false });
  assert.deepEqual(ctx.facts(), ["Development shop", "3 people"]);
});

test("a redraw hands the keyboard's place back: the mark and the door are rebuilt on every draw", () => {
  // Home draws again as each of its reads lands, and every draw replaces the
  // mark and the door. The focused one used to be thrown away with the focus,
  // which then fell to the top of the page.
  const ctx = loadFirmHead(joined(1));
  ctx.draw(JORDAN);
  const door = byClass(ctx.el("hmFirmMeta"), "hm-fh-logo")[0];
  door.focus();
  assert.equal(ctx.document.activeElement, door);
  ctx.draw(JORDAN);
  const door2 = byClass(ctx.el("hmFirmMeta"), "hm-fh-logo")[0];
  assert.notEqual(door2, door, "the door is rebuilt on every draw");
  assert.equal(ctx.document.activeElement, door2, "the focus was not handed to the new door");
  // The logo is saved from the keyboard: the door is gone, and the focus goes
  // to the mark, which now changes that logo.
  ctx.draw({ ...JORDAN, logoAt: "1794500000001" });
  assert.equal(ctx.document.activeElement, ctx.mark(), "the focus was dropped when the door went");
  // Focus on the mark stays on the mark.
  ctx.draw({ ...JORDAN, logoAt: "1794500000002" });
  assert.equal(ctx.document.activeElement, ctx.mark());
  // A mouse click focuses the initials while the door is offered (they are
  // out of the tab order, not unclickable). A redraw hands that focus to the
  // door, never back to a mark a screen reader cannot see.
  const clicked = loadFirmHead(joined(1));
  clicked.draw(JORDAN);
  clicked.document.activeElement = clicked.mark();
  clicked.draw(JORDAN);
  assert.equal(clicked.document.activeElement, byClass(clicked.el("hmFirmMeta"), "hm-fh-logo")[0]);
  // Focus anywhere else is never taken: a draw must not pull the keyboard
  // into the firm row from the find box or the list.
  const elsewhere = ctx.el("hmFind");
  ctx.document.activeElement = elsewhere;
  ctx.draw(JORDAN);
  assert.equal(ctx.document.activeElement, elsewhere);
  // And a member's mark is a span: there is nothing to hand the focus to.
  const member = loadFirmHead(joined(3));
  member.draw(KWCA);
  member.draw(KWCA);
  assert.equal(member.document.activeElement, null);
});

// ---------------------------------------------------------------------------
// The stylesheet and the markup: the decisions a tidy-up would undo.
// ---------------------------------------------------------------------------
const style = (() => {
  // The stylesheet's own comment (the page's <head> has one that opens the
  // same way, over home-map.js's script tag).
  const at = html.indexOf("/* ---- Home as one map (2026-10-07");
  assert.notEqual(at, -1, "the Home stylesheet's opening comment moved");
  return html.slice(at, html.indexOf("</style>", at)).replace(/\/\*[\s\S]*?\*\//g, "");
})();
// Every @media block cut out of a stylesheet, by counting braces.
function outsideMedia(css) {
  let out = "", i = 0;
  for (;;) {
    const at = css.indexOf("@media", i);
    if (at === -1) return out + css.slice(i);
    out += css.slice(i, at);
    let depth = 0, j = css.indexOf("{", at);
    for (; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}" && --depth === 0) break; }
    i = j + 1;
  }
}
// The inside of the first @media block that opens with `media`.
function insideMedia(css, media) {
  const at = css.indexOf(media);
  assert.notEqual(at, -1, `no ${media} block`);
  let depth = 0, i = css.indexOf("{", at);
  const start = i + 1;
  for (; i < css.length; i++) { if (css[i] === "{") depth++; else if (css[i] === "}" && --depth === 0) break; }
  return css.slice(start, i);
}
// The body of the rule whose selector is exactly `sel`: OUTSIDE every @media
// block when `media` is omitted (so a base rule is never mistaken for its
// narrow-screen twin, wherever each sits in the file), else inside the first
// block that opens with `media`. A selector written twice is refused: the
// first copy would be read and the second would win on the page.
function rule(sel, media) {
  const css = media ? insideMedia(style, media) : outsideMedia(style);
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hits = [...css.matchAll(new RegExp("(?:^|[}\\n])\\s*" + esc + "\\s*\\{([^}]*)\\}", "g"))];
  assert.ok(hits.length, `no rule for ${sel}${media ? " in " + media : ""}`);
  assert.equal(hits.length, 1, `${sel}${media ? " in " + media : ""} is written ${hits.length} times`);
  return hits[0][1];
}
const decl = (body, prop) => { const m = body.match(new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)")); return m ? m[1].trim() : null; };
const px = (v) => String(v).trim().split(/\s+/).map((x) => parseFloat(x));
const RAIL = "@media (min-width: 900px)";
// A line of text's height in px: the rule's font size (a scale token, or a
// length the size test still allows) times its line-height, which must be a
// ratio. A length there does not grow with the text, so a reader who raises
// the browser's minimum font size gets letters cut by their own line.
function lineBox(sel) {
  const r = rule(sel), lh = decl(r, "line-height"), size = decl(r, "font-size");
  assert.match(String(lh), /^[0-9.]+$/, `${sel}'s line-height is a length (${lh}), not a ratio of its text`);
  const token = /^var\(--([a-z0-9-]+)\)$/.exec(size);
  const px = parseFloat(token ? SCALE_TOKENS[token[1]] : size);
  assert.ok(px > 0, `${sel} has no readable font size (${size})`);
  return Math.round(px * parseFloat(lh) * 100) / 100;
}

test("one line down the panel: the head starts where the cards and rows under the tabs start", () => {
  // The two-pixel drift this fixes happened because nothing tied the head's
  // inset to the list's: the list's content column is the body's side padding
  // plus the 10px every card and row carries, and the head stood at 28 and 16
  // against 26 and 18. Read each side off its own rule and add them up.
  const INNER = 10;
  for (const sel of [".hm-brief", ".hm-legal", ".hm-next"]) {
    assert.equal(px(decl(rule(sel), "margin"))[1], INNER, `${sel} no longer sits ${INNER}px inside the list`);
  }
  assert.equal(px(decl(rule(".hm-row"), "padding"))[1], INNER);
  // Away from the rail (a phone, the bar shell).
  const bodyPhone = px(decl(rule(".hm-body"), "padding"))[1];
  assert.equal(px(decl(rule(".hm-head"), "padding"))[1], bodyPhone + INNER, "the head and the list part company on a phone");
  assert.equal(px(decl(rule(".hm-fh"), "padding"))[1], bodyPhone + INNER, "the firm row is off the line on a phone");
  // Beside the rail.
  const bodyRail = px(decl(rule("html.nav-rail.hm-page .hm-body", RAIL), "padding"))[1];
  assert.equal(px(decl(rule("html.nav-rail.hm-page .hm-head", RAIL), "padding"))[1], bodyRail + INNER, "the head and the list part company beside the rail");
  assert.equal(px(decl(rule("html.nav-rail.hm-page .hm-fh", RAIL), "padding"))[1], bodyRail + INNER, "the firm row is off the line beside the rail");
  // The stand-in shown while Home loads sits on the same line, or the page jumps.
  assert.equal(px(decl(rule("html.hm-page #deskLoading"), "padding"))[1], bodyRail + INNER);
  // The saving message starts on the firm's text edge: the gutter, the mark, the gap.
  const row = rule(".hm-fh"), mark = rule(".hm-fh-mark");
  assert.equal(px(decl(rule("html.nav-rail.hm-page .hm-fh-msg", RAIL), "padding"))[3],
    bodyRail + INNER + parseFloat(decl(mark, "width")) + parseFloat(decl(row, "gap")));
});

test("beside the rail the firm row is the map switch's own band: one height, one top", () => {
  // The mark, the firm's two lines and "Firm settings" are one 34px row that
  // starts 14px down, the rows of the map's Properties / Permits switch, so
  // the rail's logo, the firm and the map's controls read as one band. The
  // button stood 29px below the switch before. A measured number, not a
  // shared one: if the switch moves, this moves with it.
  const layers = rule(".hm-layers");
  const top = parseFloat(decl(layers, "top"));
  assert.equal(px(decl(rule("html.nav-rail.hm-page .hm-fh", RAIL), "padding"))[0], top, "the firm row and the map's switch no longer share a top");
  // The switch's height is not written anywhere to read: it is its buttons'
  // 8px padding twice, a 16px icon and a 1px border twice. Typed here; if the
  // switch grows, this number and the row grow with it by hand.
  const H = 34;
  const sw = rule(".hm-layers button");
  assert.equal(px(decl(sw, "padding"))[0] * 2 + 16 + 2, H, "the map switch is no longer 34px tall: the firm row's band is built on that number");
  assert.equal(decl(rule(".hm-fh-mark"), "height"), H + "px");
  assert.equal(decl(rule(".hm-fh-mark"), "box-sizing"), "border-box", "the mark's border is added to its 34px");
  assert.equal(decl(rule(".hm-fh-set"), "height"), H + "px");
  assert.equal(decl(rule(".hm-fh-set"), "box-sizing"), "border-box");
  // The two lines of text are whole pixels and add up to the same 34px.
  assert.equal(lineBox(".hm-fh-txt b"), 18);
  assert.equal(lineBox(".hm-fh-txt small"), 16);
  assert.equal(lineBox(".hm-fh-txt b") + lineBox(".hm-fh-txt small"), H);
  // No rule under the row and no fill behind it: white space sets it apart.
  assert.equal(decl(rule(".hm-fh"), "border-bottom"), null);
  assert.equal(decl(rule(".hm-fh"), "background"), null);
});

test("the firm row is ink and grey: no red line, no indigo shop, and the door is told from the facts by more than colour", () => {
  const rows = style.split("\n").filter((l) => /^\s*(button)?\.hm-fh/.test(l) || /\.hm-fh-/.test(l.split("{")[0]));
  assert.ok(rows.length > 10, "the firm row's rules were not found");
  for (const l of rows) {
    // The focus ring is the product's red one; nothing else in the row is.
    if (/:focus-visible/.test(l.split("{")[0])) continue;
    assert.doesNotMatch(l, /var\(--red[a-z-]*\)/, "red is back in the firm row: " + l.trim().slice(0, 80));
    assert.doesNotMatch(l, /var\(--bv-/, "the indigo of a Firm pill is back in the firm row: " + l.trim().slice(0, 80));
  }
  const facts = rule(".hm-fh-txt small"), door = rule(".hm-fh-logo");
  assert.equal(decl(facts, "color"), "var(--ink-3)");
  // A step darker than the facts, a touch heavier, and underlined in its own
  // ink: a paler underline measured 1.5:1 and could not be seen.
  assert.equal(decl(door, "color"), "var(--ink-2)");
  assert.equal(decl(door, "text-decoration"), "underline");
  assert.equal(decl(door, "text-decoration-color"), null, "the door's underline is not the words' own colour");
  // Its press area reaches down and sideways, never up over the firm's name.
  assert.match(decl(rule(".hm-fh-logo::after"), "inset"), /^0 /);
  // A fact is never cut in half: each is one unbroken piece, and where a
  // reader's own text spacing makes the line too long a fact drops to the
  // next line whole (the old row wrapped too; an ellipsis here lost words).
  assert.equal(decl(rule(".hm-fh-txt small > *"), "white-space"), "nowrap");
  assert.equal(decl(facts, "flex-wrap"), "wrap");
  assert.equal(decl(rule(".hm-fh-txt small em"), "text-overflow"), null, "the shop is cut with an ellipsis again");
  // The dots are drawn, one after every fact but the last, so a fact that
  // wraps leaves its dot at the end of the line above.
  assert.match(rule(".hm-fh-txt small > *:not(:last-child)::after"), /content:\s*"\\00B7"/);
});

test("a mark that cannot be pressed does not look like one that can", () => {
  // A member's initials are a span; an owner's or admin's are the button that
  // adds or changes the logo. Drawn alike, the span looked pressable.
  const flat = rule(".hm-fh-mark"), button = rule("button.hm-fh-mark");
  assert.equal(decl(flat, "background"), "var(--wash-2)");
  assert.equal(decl(flat, "border"), "1px solid var(--line)");
  assert.equal(decl(button, "background"), "var(--card)");
  assert.equal(decl(button, "border-color"), "var(--edge)");
  assert.equal(decl(button, "cursor"), "pointer");
  assert.equal(decl(flat, "cursor"), null);
  // A border, not an inset shadow: a forced-colours mode keeps a border.
  assert.equal(decl(flat, "box-shadow"), null);
  // The logo stays on white in both themes (a logo is drawn for paper).
  assert.equal(decl(rule(".hm-fh-mark.logo"), "background"), "rgb(255 255 255)");
});

test("Firm settings is the shared compact button, hidden when the page says so, and named by the words on it", () => {
  const gear = html.slice(html.indexOf('<button id="hmFirmGear"'), html.indexOf("</button>", html.indexOf('<button id="hmFirmGear"')));
  const open = gear.slice(0, gear.indexOf(">") + 1);
  assert.match(open, /class="hidden hm-btn hm-fh-set"/, "the firm row's button is a one-off again");
  // It carried aria-label="Firm & branding" over a label that says "Firm
  // settings": a spoken name that did not contain the visible one.
  assert.doesNotMatch(open, /aria-label=|title=/);
  assert.match(gear, /<span>Firm settings<\/span>/);
  // The briefcase the owner picked (over a gear that "read as a sun") stays,
  // beside the words; it is decoration to a screen reader.
  assert.match(gear, /<svg [^>]*aria-hidden="true"/);
  // .hm-btn sets a display, which out-ranks the page's hide class: the row's
  // own rule restates it, or the button shows to a member in no firm.
  assert.equal(decl(rule(".hm-fh-set.hidden"), "display"), "none");
  assert.equal(decl(rule(".hm-fh.hidden"), "display"), "none");
  assert.equal(decl(rule(".hm-fh-msg.hidden"), "display"), "none");
  // The look is the component's: the row adds a place and a height, nothing else.
  for (const prop of ["padding", "border", "border-radius", "background", "color", "font-size", "font-weight"]) {
    assert.equal(decl(rule(".hm-fh-set"), prop), null, `.hm-fh-set restyles the shared button's ${prop}`);
  }
});

test("the firm row stands outside the head, so a member in no firm gets no row and no leftover of one", () => {
  // The row and its saving message are the panel's first two children, each
  // with its own gutters. Inside .hm-head the row needed a rule that knew
  // whether it was there (or a negative margin kept in step with a padding).
  const panel = html.indexOf('<div class="hm-panel">');
  const row = html.indexOf('<div id="hmFirmHead" class="hm-fh hidden">', panel);
  const msg = html.indexOf('<p id="hmFirmMsg" class="hidden hm-fh-msg" role="status">', panel);
  const head = html.indexOf('<div class="hm-head">', panel);
  assert.ok(panel > 0 && row > panel && msg > row && head > msg, "the firm row is not the panel's first block, before the head");
  assert.doesNotMatch(style, /\.hm-fh[^{]*~/, "a sibling rule that asks whether the firm row is there");
  assert.doesNotMatch(rule(".hm-fh"), /margin:\s*-/);
  // Narrow phones: a smaller mark and no briefcase, then one whole fact.
  const narrow = "@media (max-width: 449px)", tiny = "@media (max-width: 371px)";
  assert.equal(decl(rule(".hm-fh-mark", narrow), "width"), "28px");
  assert.equal(decl(rule(".hm-fh-set svg", narrow), "display"), "none");
  assert.equal(decl(rule(".hm-fh-txt small .hm-fh-n", tiny), "display"), "none");
  assert.equal(decl(rule(".hm-fh-txt small.has-door em", tiny), "display"), "none");
  // One fact is left there, so no dot: the hidden one would leave its own.
  // The SAME selector as the rule that draws the dot, or it loses to it.
  assert.equal(decl(rule(".hm-fh-txt small > *:not(:last-child)::after", tiny), "content"), "none");
  // The 28px mark keeps a 44px press area.
  assert.equal(decl(rule("button.hm-fh-mark::after", narrow), "inset"), "-9px");
});

test("the day, the greeting and the find box: whole-pixel lines, a placeholder that is a token, the tabs spaced from the head's side", () => {
  // The date's text is unchanged (test/org-desk.test.js reads it); it is
  // sentence case, never capitals.
  assert.equal(decl(rule(".hm-kick"), "text-transform"), null);
  assert.equal(lineBox(".hm-kick"), 18);
  // The greeting keeps Home's one heading size, on a whole-pixel line.
  assert.equal(decl(rule(".hm-title"), "font-size"), "30px");
  assert.equal(lineBox(".hm-title"), 34);
  assert.equal(decl(rule(".hm-title"), "font-family"), "var(--serif)");
  // The find box's placeholder was Tailwind's reset grey, the one text in the
  // head that was not a token (2.5:1 on the box in light).
  assert.equal(decl(rule("#hmFind::placeholder"), "color"), "var(--ink-3)");
  // The shared tabs' own rule is components.js's; the head tightens the gap
  // above them from its own side.
  assert.equal(decl(rule(".hm-head .hm-tabs"), "margin-top"), "12px");
  assert.doesNotMatch(style, /(^|[}\n])\s*\.hm-tabs\s*\{/, "the page restates the shared tabs' own selector");
});

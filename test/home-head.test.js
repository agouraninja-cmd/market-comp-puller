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
//
// A reviewer then broke the page 155 ways, one at a time, and 48 of them left
// every suite green. The checks that came out of that are marked "(broken to
// find)": each names the breakage it was written against. The same day's
// second round is here too: the list's scrollbar, the door's focus ring, the
// initials' tile and the saving message.
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
    // Only a button takes the focus, as in a browser (a span is not a stop),
    // and only one that is IN the document: focus() on a button that has not
    // been appended yet does nothing there. Without the second half, moving
    // the focus hand-back above the line that appends the mark passed here
    // and dropped the focus in every browser.
    focus() { if (doc && el.tagName === "BUTTON" && doc.holds(el)) doc.activeElement = el; },
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
    // Whether a node hangs under one of the page's own elements.
    holds: (node) => [...els.values()].some((root) => root.contains(node)),
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
  // A sign-out reaches both through that one writer (broken to find: with the
  // call gone, the last member's row and its message outlived the session).
  assert.match(slice(/  function resetHomeMap\(\) \{[\s\S]*?\n  \}/), /drawFirmHead\(null\)/);
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
  // (Each fact is its own element, so the stylesheet draws the dot between
  // them and one can drop out on a narrow phone without leaving a dot: the
  // tag names above are that check. A typed dot is a text node, and has none.)
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
  assert.ok(ctx.el("hmFirmMeta").children.every((c) => c.tagName), "a bare text node in the facts line: its dot would be typed, not drawn");
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

test("every mark is the tile the stylesheet draws, in every state (broken to find)", () => {
  // The line that gives the mark its class could be deleted with every suite
  // green: the stylesheet half held `.hm-fh-mark` to a dozen values over an
  // element that no longer had the class (26 x 24 bare letters on the page).
  for (const firm of [JORDAN, HARBOR, { ...HARBOR, canManage: false }, KWCA]) {
    const ctx = loadFirmHead(joined(2));
    ctx.draw(firm);
    assert.ok(ctx.mark().classList.contains("hm-fh-mark"), `${firm.name}: a mark with no tile`);
  }
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

// saveFirmLogo with everything it reads, the server and the file reader
// answered here. `answers` is what each fetch gets back, in order.
function loadSaveLogo({ firm, read, answers }) {
  const msg = makeEl("p");
  msg.className = MARKUP_CLASSES.get("hmFirmMsg") || "";
  const calls = { fetch: [], drawn: [] };
  const ctx = vm.createContext({
    document: { getElementById: (id) => (id === "hmFirmMsg" ? msg : null) },
    console, encodeURIComponent, JSON, Object, Date, String, Boolean, Promise,
    myFirm: () => firm,
    readLogoFile: read,
    fetch: async (url, opts) => { calls.fetch.push([url, opts && opts.method, opts && opts.body]); const a = answers.shift(); return { ok: a.ok, json: async () => a.body }; },
    drawFirmHead: (f) => calls.drawn.push({ ...f }),
  });
  new vm.Script([
    "let currentFirmBranding = null;",
    slice(/  async function saveFirmLogo\(file\) \{[\s\S]*?\n  \}/),
    "this.save = saveFirmLogo;",
  ].join("\n"), { filename: "index.html" }).runInContext(ctx);
  return { save: ctx.save, msg, calls };
}

test("a logo that is refused is told apart from one that is saved: the desk's own message, and its red for a refusal", async () => {
  // In the facts' small grey, "Please choose a PNG or JPEG image." read
  // exactly as "Saved." did: the one failure the head can report looked like
  // a success. The message is the desk's own now (.dk-msg: its size, its ink,
  // and `bad` for a refusal, as the add-a-building form and Contacts mark theirs).
  const firm = () => ({ ...JORDAN });
  const shown = (m) => ({ text: m.textContent, bad: m.classList.contains("bad"), hidden: m.classList.contains("hidden") });

  // A file that is not a picture: refused before anything is sent.
  const notPicture = loadSaveLogo({ firm: firm(), read: async () => { throw new Error("Please choose a PNG or JPEG image."); }, answers: [] });
  await notPicture.save({ name: "notes.txt" });
  assert.deepEqual(shown(notPicture.msg), { text: "Please choose a PNG or JPEG image.", bad: true, hidden: false });
  assert.equal(notPicture.calls.fetch.length, 0, "a refused file was sent anyway");

  // The server turns the read down, then the save: its own words, as a refusal.
  const noRead = loadSaveLogo({ firm: firm(), read: async () => "data:image/png;base64,AA==", answers: [{ ok: false, body: { error: "Only an owner or admin can change this." } }] });
  await noRead.save({ name: "logo.png" });
  assert.deepEqual(shown(noRead.msg), { text: "Only an owner or admin can change this.", bad: true, hidden: false });
  const noSave = loadSaveLogo({ firm: firm(), read: async () => "data:image/png;base64,AA==", answers: [{ ok: true, body: { branding: { name: "Avery" } } }, { ok: false, body: {} }] });
  await noSave.save({ name: "logo.png" });
  assert.deepEqual(shown(noSave.msg), { text: "Couldn't save the logo. Please try again.", bad: true, hidden: false });
  assert.equal(noSave.calls.drawn.length, 0, "a save that failed redrew the row as if it had a logo");

  // A save that works: "Saving" while it is in hand and "Saved" after, neither
  // one a refusal, and the row drawn again with the logo.
  let finish;
  const works = loadSaveLogo({ firm: firm(), read: () => new Promise((resolve) => { finish = resolve; }), answers: [{ ok: true, body: { branding: { name: "Avery" } } }, { ok: true, body: { branding: { name: "Avery", logo: "x" } } }] });
  const saving = works.save({ name: "logo.png" });
  assert.deepEqual(shown(works.msg), { text: "Saving your firm's logo\u2026", bad: false, hidden: false });
  finish("data:image/png;base64,AA==");
  await saving;
  assert.match(works.msg.textContent, /^Saved\. /);
  assert.ok(!works.msg.classList.contains("bad") && !works.msg.classList.contains("hidden"));
  assert.equal(works.calls.drawn.length, 1);
  assert.ok(works.calls.drawn[0].logoAt, "the row was drawn again without the logo it just saved");
  assert.deepEqual(works.calls.fetch.map((c) => c[1]), [undefined, "PUT"]);
  // The firm's branding is ONE profile and the save replaces it whole: it is
  // read for this firm, then sent back with the logo added. Sent without the
  // rest, a logo saved from Home blanked the firm's letterhead (a reviewer's
  // breakage: the test compared the two methods and nothing that was sent).
  assert.equal(works.calls.fetch[0][0], "/api/org/branding?id=org-1");
  assert.deepEqual(JSON.parse(works.calls.fetch[1][2]), { name: "Avery", logo: "data:image/png;base64,AA==", orgId: "org-1" });

  // A refusal, then a second try that works: the red does not outlive it.
  const again = loadSaveLogo({ firm: firm(), read: async (f) => { if (f.name === "notes.txt") throw new Error("Please choose a PNG or JPEG image."); return "data:image/png;base64,AA=="; }, answers: [{ ok: true, body: {} }, { ok: true, body: {} }] });
  await again.save({ name: "notes.txt" });
  assert.ok(again.msg.classList.contains("bad"));
  await again.save({ name: "logo.png" });
  assert.ok(!again.msg.classList.contains("bad"), "\"Saved.\" is still in a refusal's red");

  // A member who cannot manage is not answered at all (they have no door).
  const member = loadSaveLogo({ firm: { ...JORDAN, canManage: false }, read: async () => "x", answers: [] });
  await member.save({ name: "logo.png" });
  assert.deepEqual(shown(member.msg), { text: "", bad: false, hidden: true });

  // The markup carries the desk's class, and the row's own rule is only the
  // message's place and a whole-pixel line: no size or ink of its own, or a
  // refusal's red (a class on .dk-msg) loses to it.
  assert.equal(MARKUP_CLASSES.get("hmFirmMsg"), "hidden dk-msg hm-fh-msg");
  const own = rule(".hm-fh-msg");
  // .dk-msg.bad is two classes: the rail's rule (three and an element) is
  // the one that out-ranks it, and it is the layout the owner uses.
  for (const body of [own, rule("html.nav-rail.hm-page .hm-fh-msg", RAIL), rule(".hm-fh-msg", NARROW)]) {
    assert.equal(decl(body, "color"), null, "a rule for the message sets an ink of its own: a refusal's red can lose to it");
    assert.equal(decl(body, "font-size"), null);
  }
  assert.equal(decl(own, "margin"), "0", "the desk's 8px margin is back over the message: the date drops 8px");
  const desk = html.match(/\n    \.dk-msg \{([^}]*)\}/), bad = html.match(/\n    \.dk-msg\.bad \{([^}]*)\}/);
  assert.ok(desk && bad, "the desk's message rules moved");
  assert.equal(decl(desk[1], "font-size"), "var(--text-small)");
  assert.equal(decl(desk[1], "color"), "var(--ink-2)");
  assert.equal(decl(bad[1], "color"), "var(--red)");
  // 18px: the desk's 13px on the row's ratio, so the date under a message
  // still lands on a whole pixel.
  assert.match(String(decl(own, "line-height")), /^[0-9.]+$/, "the message's line-height is a length, not a ratio of its text");
  assert.equal(wholeLine(".hm-fh-msg", parseFloat(SCALE_TOKENS["text-small"]), decl(own, "line-height")), 18);
});

// ---------------------------------------------------------------------------
// The list's scrollbar: hmFitListBar, run against a stand-in list.
// ---------------------------------------------------------------------------
// `bar` is the width a scrollbar takes in this browser, in the page's own
// pixels (0 where bars float over the page: a phone, a Mac trackpad), and
// `thin` the width of the thin one. A browser keeps that room while the list
// scrolls, or whenever the list's gutter is told to stay. `rail: false` is
// the layout where the page scrolls and the list is no scroller at all.
function listBody({ bar, thin = 10, scrolls, pad = 16, width = 467, rail = true, inline }) {
  const style = { paddingRight: "", scrollbarGutter: "", scrollbarWidth: "", ...(inline || {}) };
  const body = {
    style, computed: { paddingLeft: pad + "px", overflowY: rail ? "auto" : "visible" }, offsetWidth: width, scrolls, reads: 0,
    // (An element with no box measures 0 both ways, as in a browser.)
    get clientWidth() {
      body.reads++;
      if (!width) return 0;
      const kept = rail && bar && (body.scrolls || style.scrollbarGutter === "stable");
      return width - (kept ? (style.scrollbarWidth === "thin" ? Math.min(bar, thin) : bar) : 0);
    },
    // What the cards and rows get: the list between its two paddings.
    get room() { return body.clientWidth - pad - (style.paddingRight === "" ? pad : parseFloat(style.paddingRight)); },
  };
  return body;
}
const FIT_SOURCE = slice(/  function hmFitListBar\(body\) \{[\s\S]*?\n  \}/);
const fitListBar = (() => {
  const ctx = vm.createContext({ getComputedStyle: (el) => el.computed, parseFloat, Math });
  new vm.Script(FIT_SOURCE + "\nthis.fit = hmFitListBar;", { filename: "index.html" }).runInContext(ctx);
  return ctx.fit;
})();
const NOTHING = { paddingRight: "", scrollbarGutter: "", scrollbarWidth: "" };

test("the list is as wide as the head with a scrollbar and without one: the bar stands in the list's own padding", () => {
  // Where a scrollbar takes room (Chrome and Edge on Windows, the owner's),
  // the list's bar took its 15px out of the list whenever the list was taller
  // than the panel: every card, row and "+ Add a property" ended 15px short of
  // the find box and "Firm settings", and a heading that just fit broke in
  // two. No picture showed it: a headless browser draws no scrollbars.
  const floating = listBody({ bar: 0, scrolls: true });
  fitListBar(floating);
  assert.deepEqual(floating.style, NOTHING, "where bars float over the page nothing is left written");
  const want = floating.room;

  // The owner's Today: a bar that takes room, a list that fits. The bar's room
  // is kept anyway, out of the padding, so the list is the width it was.
  const fits = listBody({ bar: 15, scrolls: false });
  fitListBar(fits);
  assert.deepEqual(fits.style, { paddingRight: "1px", scrollbarGutter: "stable", scrollbarWidth: "" });
  assert.equal(fits.room, want, "a list that fits is narrower than the head on Windows");
  // His Properties: nine rows, taller than the panel. The same width, so
  // nothing moves when a list starts or stops scrolling.
  fits.scrolls = true;
  assert.equal(fits.room, want, "the list narrows when it starts to scroll");
  const scrolling = listBody({ bar: 15, scrolls: true });
  fitListBar(scrolling);
  assert.deepEqual(scrolling.style, { paddingRight: "1px", scrollbarGutter: "stable", scrollbarWidth: "" });
  assert.equal(scrolling.room, want, "a scrolling list ends short of the find box and Firm settings");
  // Asked again, the answer is the same: it reads the list's LEFT padding,
  // which it never writes.
  fitListBar(scrolling);
  assert.deepEqual(scrolling.style, { paddingRight: "1px", scrollbarGutter: "stable", scrollbarWidth: "" });

  // A bar WIDER than the padding does not fit in it: 17px in older Windows
  // browsers, and any bar once the page is zoomed out (zoom does not shrink
  // the bar: 15px is 18.75 of the page's pixels at 80%, 22.4 at 67%). Kept at
  // that width the list ended short again, and a list that does not scroll
  // was short too, which it never was before. So the thin bar is asked for,
  // which fits, and the list is the head's width once more.
  for (const [bar, thin, why] of [[17, 10, "an older Windows browser"], [18.75, 12.5, "80% zoom"], [22.4, 14.9, "67% zoom"]]) {
    for (const scrolls of [false, true]) {
      const wide = listBody({ bar, thin, scrolls });
      fitListBar(wide);
      assert.equal(wide.style.scrollbarWidth, "thin", `${why}: a bar wider than the padding was kept at its width`);
      assert.equal(wide.style.scrollbarGutter, "stable");
      assert.ok(Math.abs(wide.room - want) < 0.001, `${why}, ${scrolls ? "a scrolling list" : "a list that fits"}: the list is ${want - wide.room}px short of the head`);
    }
  }
  // Even the thin one too wide (50% zoom): it takes all of the padding and
  // no more, never a negative one.
  const huge = listBody({ bar: 30, thin: 20, scrolls: true });
  fitListBar(huge);
  assert.deepEqual(huge.style, { paddingRight: "0px", scrollbarGutter: "stable", scrollbarWidth: "thin" });
  // Zoomed back in, the thin bar is given up: every fit starts from the
  // browser's own bar.
  const back = listBody({ bar: 15, scrolls: true, inline: { paddingRight: "6px", scrollbarGutter: "stable", scrollbarWidth: "thin" } });
  fitListBar(back);
  assert.deepEqual(back.style, { paddingRight: "1px", scrollbarGutter: "stable", scrollbarWidth: "" });

  // Away from the rail the page scrolls and not the list: nothing is measured
  // or written there (the observer fires on every tab change in that layout),
  // and what an earlier fit wrote beside the rail is taken back.
  const phone = listBody({ bar: 15, scrolls: false, pad: 8, rail: false });
  fitListBar(phone);
  assert.deepEqual(phone.style, NOTHING);
  assert.equal(phone.reads, 0, "the list is measured where it is not a scroller");
  const narrowed = listBody({ bar: 15, scrolls: false, pad: 8, rail: false, inline: { paddingRight: "0px", scrollbarGutter: "stable", scrollbarWidth: "thin" } });
  fitListBar(narrowed);
  assert.deepEqual(narrowed.style, NOTHING, "a fit made beside the rail outlived the rail layout");
  // Bars that float after a fit was made (a mouse unplugged from a Mac).
  const floated = listBody({ bar: 0, scrolls: true, inline: { paddingRight: "1px", scrollbarGutter: "stable", scrollbarWidth: "" } });
  fitListBar(floated);
  assert.deepEqual(floated.style, NOTHING);

  // Not laid out (Home is hidden): nothing to measure, so nothing is touched.
  // The observer asks again when the list gets a box.
  const hiddenList = listBody({ bar: 15, scrolls: false, width: 0, inline: { paddingRight: "1px", scrollbarGutter: "stable" } });
  fitListBar(hiddenList);
  assert.deepEqual(hiddenList.style, { paddingRight: "1px", scrollbarGutter: "stable", scrollbarWidth: "" });
  fitListBar(null);
  // It reads the list's left padding for the right's: the two sides are one
  // number in both rules (the insets test above holds them to three values).
  assert.equal(px(decl(rule("html.nav-rail.hm-page .hm-body", RAIL), "padding"))[1], 16);
});

// The block that installs the observer, RUN (it was only matched as text: a
// selector that found nothing, or the support check turned round, switched
// the whole fix off with every test green).
function runFitBlock({ list = true, css = true, supports = true, observer = true } = {}) {
  const body = listBody({ bar: 15, scrolls: true });
  const seen = { asked: [], observed: [], queries: [] };
  class RO { constructor(cb) { this.cb = cb; } observe(el, opts) { seen.observed.push({ el, opts, fire: this.cb }); } }
  const sandbox = {
    document: { querySelector: (q) => { seen.queries.push(q); return list ? body : null; } },
    getComputedStyle: (el) => el.computed, parseFloat, Math,
  };
  if (css) sandbox.CSS = { supports: (prop, value) => { seen.asked.push([prop, value]); return supports; } };
  if (observer) sandbox.ResizeObserver = RO;
  const block = slice(/  function hmFitListBar\(body\) \{[\s\S]*?\n  \}\n  \{[\s\S]*?\n  \}/);
  new vm.Script(block, { filename: "index.html" }).runInContext(vm.createContext(sandbox));
  return { body, seen };
}

test("one observer asks for the fit, on the list's border box, and only where the bar's room can be kept", () => {
  const on = runFitBlock();
  assert.deepEqual(on.seen.queries, ["#homeMap .hm-body"]);
  assert.deepEqual(on.seen.asked, [["scrollbar-gutter", "stable"]]);
  assert.equal(on.seen.observed.length, 1);
  assert.equal(on.seen.observed[0].el, on.body, "the observer was handed something other than the list");
  // The BORDER box: writing the padding does not change it, so the observer
  // cannot be woken by its own write (on the content box it is, every time).
  assert.deepEqual(on.seen.observed[0].opts, { box: "border-box" });
  assert.deepEqual(on.body.style, NOTHING, "the list was written before it had been observed");
  on.seen.observed[0].fire();
  assert.deepEqual(on.body.style, { paddingRight: "1px", scrollbarGutter: "stable", scrollbarWidth: "" }, "the observer's call does not fit the list");
  // No stable gutter: left as it was. Fitted once there, the padding is
  // wrong the next time a list starts or stops scrolling.
  for (const [why, opts] of [["no stable gutter", { supports: false }], ["no CSS.supports", { css: false }], ["no ResizeObserver", { observer: false }], ["no list on the page", { list: false }]]) {
    const off = runFitBlock(opts);
    assert.equal(off.seen.observed.length, 0, `${why}: an observer was installed anyway`);
    assert.deepEqual(off.body.style, NOTHING, `${why}: the list was written`);
  }
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
const NARROW = "@media (max-width: 449px)", TINY = "@media (max-width: 371px)";
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
  return wholeLine(sel, px, lh);
}
// Each ratio is rounded UP in its last place (18/14 is written 1.2858, not
// 1.2857). Rounded down it reads as the tidier number and is wrong: the line
// comes out a sixty-fourth of a pixel short (17.984px), and every edge under
// it lands between pixels. Rounding the product here would let that through.
function wholeLine(what, px, lh) {
  const exact = px * parseFloat(lh);
  assert.ok(exact >= Math.round(exact), `${what}'s ratio is rounded down (${lh}): its line is a sixty-fourth of a pixel short`);
  return Math.round(exact * 100) / 100;
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
  // The saving message starts on the firm's text edge: the gutter, the mark,
  // the gap. Beside the rail, away from it, and on a narrow phone, where the
  // mark and the gap are both smaller (broken to find: only the first was
  // added up).
  const row = rule(".hm-fh"), mark = rule(".hm-fh-mark");
  const markW = parseFloat(decl(mark, "min-width")), gap = parseFloat(decl(row, "gap"));
  assert.equal(px(decl(rule("html.nav-rail.hm-page .hm-fh-msg", RAIL), "padding"))[3], bodyRail + INNER + markW + gap);
  assert.equal(px(decl(rule(".hm-fh-msg"), "padding"))[3], bodyPhone + INNER + markW + gap, "away from the rail the saving message is off the firm's text edge");
  assert.equal(parseFloat(decl(rule(".hm-fh-msg", NARROW), "padding-left")),
    bodyPhone + INNER + parseFloat(decl(rule(".hm-fh-mark", NARROW), "min-width")) + parseFloat(decl(rule(".hm-fh", NARROW), "gap")),
    "on a narrow phone the saving message is off the firm's text edge");
});

test("the insets these tests add up are the whole cascade: one number a side, said once, in the rules read here (broken to find)", () => {
  // px(...)[1] of a four-value padding is the RIGHT side, and the line this
  // file is about is the left: `padding: 24px 26px 0 28px` passed. So did a
  // padding-left after the shorthand, and a second padding in the same rule
  // (decl reads the first, a browser the last). Three values, said once.
  for (const [what, body] of [
    [".hm-head", rule(".hm-head")], [".hm-fh", rule(".hm-fh")], [".hm-body", rule(".hm-body")],
    ["the rail's .hm-head", rule("html.nav-rail.hm-page .hm-head", RAIL)], ["the rail's .hm-fh", rule("html.nav-rail.hm-page .hm-fh", RAIL)],
    ["the rail's .hm-body", rule("html.nav-rail.hm-page .hm-body", RAIL)],
  ]) {
    assert.equal(px(decl(body, "padding")).length, 3, `${what}: a fourth value moves the left edge alone, and [1] reads the right`);
    assert.doesNotMatch(body, /padding-(left|right|inline)/, `${what}: a longhand moves one side after the shorthand this file reads`);
    assert.equal((body.match(/(?:^|;)\s*padding\s*:/g) || []).length, 1, `${what}: padding is said twice in one rule`);
  }
  // rule() reads one rule in one place. A browser also applies a rule in
  // another @media block (the Home sheet has two for 900px), in a comma list,
  // or under a longer selector: each of those moved the head, or put the date
  // in capitals, with every suite green. So each element these tests add up
  // is held to the NUMBER of rules that end in it, anywhere in the sheet.
  const styledBy = (sel) => (style.match(new RegExp("(?:^|[\\s,{}])" + sel.replace(/[.#]/g, "\\$&") + "\\s*[,{]", "g")) || []).length;
  for (const [sel, n, where] of [
    [".hm-head", 2, "base, beside the rail"], [".hm-body", 2, "base, beside the rail"],
    [".hm-fh", 3, "base, beside the rail, narrow phones"], [".hm-fh-mark", 2, "base, narrow phones"],
    [".hm-fh-msg", 3, "base, beside the rail, narrow phones"], [".hm-fh-set", 1, "base"], [".hm-fh-logo", 1, "base"],
    [".hm-kick", 1, "base"], [".hm-title", 1, "base"], [".hm-sub", 1, "base"], [".hm-find", 1, "base"],
  ]) {
    assert.equal(styledBy(sel), n, `${sel} is reached by ${styledBy(sel)} rules, not the ${n} read here (${where}): the cascade is no longer what this file adds up`);
  }
  // The row is styled by class. An id rule out-ranks every rule read here.
  assert.doesNotMatch(style, /#hmFirm[A-Za-z]*[^{};]*\{/, "an id rule on the firm row: it wins over the class rules these tests read");
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
  // Asked of both rules and by every route (broken to find: a background-color,
  // a box-shadow, and a border on the rail's rule each passed two exact names).
  for (const body of [rule(".hm-fh"), rule("html.nav-rail.hm-page .hm-fh", RAIL)]) {
    assert.doesNotMatch(body, /border|background|box-shadow/, "a rule under the firm row, or a fill behind it");
  }
  // A long name is cut with an ellipsis, never wrapped: wrapped, the row is
  // three lines and leaves the band (66px, the mark and the button at y=23).
  // And its column can shrink: without the min-width a 40-character name
  // pushed "Firm settings" 35px past the panel's edge (broken to find).
  const name = rule(".hm-fh-txt b");
  assert.equal(decl(name, "white-space"), "nowrap", "a long firm name wraps: the row is three lines and leaves the switch's band");
  assert.equal(decl(name, "overflow"), "hidden");
  assert.equal(decl(name, "text-overflow"), "ellipsis");
  assert.equal(decl(rule(".hm-fh-txt"), "min-width"), "0", "a long name pushes Firm settings past the panel's edge");
});

test("the firm row is ink and grey: no red line, no indigo shop, and the door is told from the facts by more than colour", () => {
  // Every rule that reaches the row, read whole (a rule, not a line of the
  // file). The focus ring is the product's red one and nothing else in the
  // row is: a rule is let off only when EVERY selector on it is a ring
  // (broken to find: `.hm-fh-logo:hover, .hm-fh-logo:focus-visible` in red
  // passed, the whole line let off for its second half).
  let seen = 0;
  for (const [, sels, body] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\.hm-fh/.test(sels)) continue;
    seen++;
    if (sels.split(",").every((x) => /:focus-visible/.test(x))) continue;
    assert.doesNotMatch(body, /var\(--red[a-z-]*\)/, "red is back in the firm row: " + sels.trim());
    assert.doesNotMatch(body, /var\(--bv-/, "the indigo of a Firm pill is back in the firm row: " + sels.trim());
  }
  assert.ok(seen > 10, "the firm row's rules were not found");
  const facts = rule(".hm-fh-txt small"), door = rule(".hm-fh-logo");
  assert.equal(decl(facts, "color"), "var(--ink-3)");
  // A step darker than the facts, a touch heavier, and underlined in its own
  // ink: a paler underline measured 1.5:1 and could not be seen.
  assert.equal(decl(door, "color"), "var(--ink-2)");
  assert.equal(decl(door, "text-decoration"), "underline");
  assert.equal(decl(door, "text-decoration-color"), null, "the door's underline is not the words' own colour");
  // Its press area reaches down and sideways, never up over the firm's name.
  assert.match(decl(rule(".hm-fh-logo::after"), "inset"), /^0 /);
  // A press area is an absolutely placed ::after, the size of its button only
  // while that button is what it is placed against. Without this one
  // declaration it is the whole window (1452 x 912 at 1440 x 900, measured):
  // a click on a tab or on the greeting opened the logo's file picker and the
  // tab did not change, with every suite green (broken to find).
  assert.equal(decl(door, "position"), "relative", "the door's press area fills the window: every click on the panel opens the file picker");
  assert.equal(decl(rule(".hm-fh-mark"), "position"), "relative", "the mark's press area fills the window: every click on the panel opens the file picker");
  // A fact is never cut off: where a reader's own text spacing makes the
  // line too long a fact drops to the next line whole (the old row wrapped
  // too; an ellipsis here lost words). A LONE fact wider than its column
  // (very large text on a phone) may shrink to the column and break between
  // its words: when it could do neither, it ran on under "Firm settings".
  const fact = rule(".hm-fh-txt small > *");
  assert.equal(decl(fact, "flex"), "0 1 auto", "a fact cannot shrink: one wider than its column runs under Firm settings");
  assert.equal(decl(fact, "min-width"), "0");
  assert.equal(decl(fact, "white-space"), null, "a fact that cannot break stays as wide as its words");
  assert.equal(decl(fact, "overflow"), null, "a fact is cut off instead of wrapped");
  assert.equal(decl(fact, "text-overflow"), null);
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

test("the initials' tile is a floor, not a size: it widens with its letters, and a logo's stays a square", () => {
  // The tile was a fixed 34px (28 on a narrow phone). A reader who raises the
  // browser's minimum font size got initials 9px wider than their tile.
  const mark = rule(".hm-fh-mark"), small = rule(".hm-fh-mark", NARROW);
  assert.equal(decl(mark, "min-width"), "34px");
  assert.equal(decl(mark, "width"), null, "the tile is a fixed width again: larger letters stand outside it");
  // The height stays fixed, so a line of larger letters is taller than the
  // tile: centred, never hung from its top (they sat on the bottom border).
  assert.equal(decl(mark, "align-content"), "center", "at a raised minimum font size the initials drop to the bottom of their tile");
  assert.equal(decl(small, "min-width"), "28px");
  assert.equal(decl(small, "width"), null);
  // A picture fills its tile and has no width of its own to give it: a
  // logo's tile is said, the same number, with no room given to letters.
  const logo = rule(".hm-fh-mark.logo");
  assert.equal(decl(logo, "width"), decl(mark, "min-width"));
  assert.equal(decl(logo, "padding"), "0");
  assert.equal(decl(rule(".hm-fh-mark.logo", NARROW), "width"), decl(small, "min-width"));
  // At the sizes the page ships the tile is still the square: the widest pair
  // of initials it writes, "WW", measured 27.34px at 13px and 23.14px at 11px
  // in Chromium, and with the tile's padding and its 1px border each side
  // that is inside the floor. More padding and "WW" alone widens the tile.
  const WW = { 13: 27.34, 11: 23.14 };
  for (const [body, token] of [[mark, "text-small"], [small, "text-tiny"]]) {
    assert.equal(decl(body, "font-size"), `var(--${token})`);
    const size = parseFloat(SCALE_TOKENS[token]);
    assert.ok(WW[size] + px(decl(body, "padding"))[1] * 2 + 2 <= parseFloat(decl(body, "min-width")),
      `"WW" no longer fits the ${decl(body, "min-width")} tile at ${size}px: the tile is not square for it`);
  }
});

test("the door's focus ring stays in the door's own line: outside it, its top stroke ran through the tails of the firm's name", () => {
  // A ring drawn outside the door's box put its top stroke in the last two
  // rows of the name's line, through the tail of every g, p and y. The box now
  // reaches sideways and down (never up), the same margins taken back so
  // nothing in the row moves, and the ring is drawn INSIDE it.
  const door = rule(".hm-fh-logo"), ring = rule(".hm-fh-logo:focus-visible");
  const pad = px(decl(door, "padding")), mar = px(decl(door, "margin"));
  assert.equal(pad.length, 3);
  assert.equal(pad[0], 0, "the door's box reaches up into the firm's name");
  assert.deepEqual(mar, [0, -pad[1], -pad[2]], "the door's padding is not taken back by its margins: the facts line moves");
  const width = parseFloat(decl(ring, "outline"));
  assert.equal(decl(ring, "outline"), "2px solid var(--red)");
  assert.equal(parseFloat(decl(ring, "outline-offset")), -width, "the ring is drawn outside the door's box again: its top stroke is in the name's line");
  // The ring stands where it did on its other three sides: a pixel clear of
  // the letters, and its foot two pixels under the line.
  assert.equal(pad[1] - width, 1);
  assert.equal(pad[2] - width, 2);
  // The press area, counted from the larger box: nothing up, 7px to the
  // right, 12px down, and 4px to the LEFT, which is the dot's own margin: at
  // 7px a click on the dot before the door opened the logo's file picker.
  const press = px(decl(rule(".hm-fh-logo::after"), "inset"));
  assert.equal(press.length, 4);
  assert.deepEqual([press[0], pad[1] - press[1], pad[2] - press[2], pad[1] - press[3]], [0, 7, 12, 4]);
  const dot = px(decl(rule(".hm-fh-txt small > *:not(:last-child)::after"), "margin"));
  assert.ok(pad[1] - press[3] <= dot[1], "the door's press area reaches the dot before it");
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
  const msg = html.indexOf('<p id="hmFirmMsg" class="hidden dk-msg hm-fh-msg" role="status">', panel);
  const head = html.indexOf('<div class="hm-head">', panel);
  assert.ok(panel > 0 && row > panel && msg > row && head > msg, "the firm row is not the panel's first block, before the head");
  assert.doesNotMatch(style, /\.hm-fh[^{]*~/, "a sibling rule that asks whether the firm row is there");
  assert.doesNotMatch(rule(".hm-fh"), /margin:\s*-/);
  // The stylesheet half of this file holds `.hm-fh-txt b`, `.hm-fh-txt small`
  // and `.hm-fh-mark` to a dozen values each, and nothing held the markup to
  // those selectors: the <small> turned into a <span> left every assertion
  // passing over rules that matched nothing (the facts in 16px ink italics,
  // no dot). One pin of the markup (broken to find).
  assert.match(html, /<span id="hmFirmMarkWrap" class="hm-fh-markw"><\/span>\s*<span class="hm-fh-txt"><b id="hmFirmName"><\/b><small id="hmFirmMeta"><\/small><\/span>/,
    "the name is styled as .hm-fh-txt b and the facts as .hm-fh-txt small");
  // Narrow phones: a smaller mark and no briefcase, then one whole fact.
  const narrow = NARROW, tiny = TINY;
  assert.equal(decl(rule(".hm-fh-mark", narrow), "min-width"), "28px");
  assert.equal(decl(rule(".hm-fh-mark", narrow), "height"), "28px", "a 28 x 34 mark on a phone");
  assert.equal(decl(rule(".hm-fh-set svg", narrow), "display"), "none");
  assert.equal(decl(rule(".hm-fh-txt small .hm-fh-n", tiny), "display"), "none");
  assert.equal(decl(rule(".hm-fh-txt small.has-door em", tiny), "display"), "none");
  // One fact is left there, so no dot: the hidden one would leave its own.
  // The SAME selector as the rule that draws the dot, or it loses to it.
  assert.equal(decl(rule(".hm-fh-txt small > *:not(:last-child)::after", tiny), "content"), "none");
  // The 28px mark keeps a 44px press area, as the 34px one has (the inset
  // counts from inside the 1px border: 34 - 2 + 12, 28 - 2 + 18).
  assert.equal(decl(rule("button.hm-fh-mark::after", narrow), "inset"), "-9px");
  assert.equal(decl(rule("button.hm-fh-mark::after"), "inset"), "-6px", "the 34px mark no longer has its 44px press area");
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
  // Firefox dims a placeholder unless told otherwise: the token, undimmed.
  assert.equal(decl(rule("#hmFind::placeholder"), "opacity"), "1");
  // The head's tiers stand one distance apart: the firm row to the date is
  // the head's top padding, the status to the find box is the find box's
  // margin. 24, 24, then the tabs' 12 (broken to find: only the 12 was read).
  const tier = parseFloat(decl(rule(".hm-find"), "margin-top"));
  assert.equal(tier, 24);
  assert.equal(px(decl(rule("html.nav-rail.hm-page .hm-head", RAIL), "padding"))[0], tier, "beside the rail the date and the find box no longer stand the same distance off");
  assert.equal(px(decl(rule(".hm-head"), "padding"))[0], tier, "away from the rail the date and the find box no longer stand the same distance off");
  // The shared tabs' own rule is components.js's; the head tightens the gap
  // above them from its own side.
  assert.equal(decl(rule(".hm-head .hm-tabs"), "margin-top"), "12px");
  assert.doesNotMatch(style, /(^|[}\n])\s*\.hm-tabs\s*\{/, "the page restates the shared tabs' own selector");
});

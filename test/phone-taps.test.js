// Touch targets on the member pages (2026-11-15).
//
// Run: npm test
//
// Cost: zero. It reads the pages' stylesheets as text and starts nothing.
//
// WHAT THIS PINS. A phone audit found forty controls under 32px tall on the
// working pages: the brand, the Comps section's tabs, "+ Add comps", "Hide
// map", the comp book's tick boxes and row names, "Compare cities", the
// rankings' city links and more. Under a finger (`@media (pointer:coarse)`)
// each now carries an invisible `::after` overlay that reaches past its box,
// so nothing moves and a mouse keeps the exact box. Three ways that breaks
// with every other suite green, because nothing else looks at a touch screen:
//
//   1. An overlay whose host is not positioned is the size of some ANCESTOR.
//      Home's firm row found this the hard way (workspace.md): without one
//      `position:relative`, a click anywhere on the panel opened the file
//      picker. So every overlay here must have a positioned host, in the same
//      block.
//   2. An overlay that reaches further than the space around its control
//      lies over the neighbour and takes its taps. The insets below were
//      measured against each control's neighbours; a larger one fails here
//      and must be measured again before the number is changed.
//   3. A tidy-up deletes a block that "does nothing" on the desktop it was
//      reviewed on.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

// Every `@media (pointer:coarse)` block in a file, comments removed, as the
// text between its braces. Written with or without spaces (index.html's
// stylesheet spaces its rules; the page modules do not).
function coarseBlocks(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\"/g, '"');
  const out = [];
  const re = /@media \(pointer: ?coarse\) ?\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1, i = re.lastIndex;
    for (; i < text.length && depth; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    out.push(text.slice(re.lastIndex, i - 1));
  }
  return out;
}

// A block's rules as [selectors[], declarations].
function rules(block) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(block))) out.push([m[1].split(",").map((s) => s.trim()).filter(Boolean), m[2].replace(/\s+/g, " ").trim()]);
  return out;
}

// What one selector ends up with inside a block, later rules winning.
function declsFor(block, selector) {
  const got = {};
  for (const [sels, body] of rules(block)) {
    if (!sels.includes(selector)) continue;
    for (const d of body.split(";")) {
      const at = d.indexOf(":");
      if (at > 0) got[d.slice(0, at).trim()] = d.slice(at + 1).trim();
    }
  }
  return got;
}

// How far an overlay reaches past its host, as [top, right, bottom, left] in
// px (positive = outward). Reads `inset` in its one to four value forms and
// the four longhands.
function reach(decls) {
  const px = (v) => { const m = /^(-?\d+(?:\.\d+)?)px$|^0$/.exec(v); assert.ok(m, "an overlay's inset must be in px: " + v); return -(parseFloat(v) || 0); };
  let t = 0, r = 0, b = 0, l = 0;
  if (decls.inset) {
    const v = decls.inset.split(/\s+/).map(px);
    t = v[0]; r = v.length > 1 ? v[1] : t; b = v.length > 2 ? v[2] : t; l = v.length > 3 ? v[3] : r;
  }
  if (decls.top) t = px(decls.top);
  if (decls.right) r = px(decls.right);
  if (decls.bottom) b = px(decls.bottom);
  if (decls.left) l = px(decls.left);
  return [t, r, b, l];
}

const FILES = {
  "vault-page.js": read("vault-page.js"),
  "bulk-page.js": read("bulk-page.js"),
  "permits-page.js": read("permits-page.js"),
  "permit-compare.js": read("permit-compare.js"),
  "market-rank-page.js": read("market-rank-page.js"),
  "messages-page.js": read("messages-page.js"),
  "server.js": read("server.js"),
  "index.html": read("index.html"),
};

// Every overlay this change added: the file, the control, and the furthest
// it may reach up/down and sideways. The numbers are what the page has room
// for, measured at 390px against each control's neighbours.
const OVERLAYS = [
  // file, host selector, max vertical reach, max sideways reach, why that much
  ["server.js", ".brand", 6, 0, "the header's own 12px padding on a phone"],
  ["server.js", ".cs-tabs a", 6, 0, "two tabs stand 2px apart: nothing sideways"],
  ["server.js", ".cta .alt", 10, 0, "two of them stand 30px apart on a market page"],
  ["index.html", ".rd-appbar > a", 6, 0, "the app bar's own 12px padding on a phone"],
  ["index.html", ".hm-first-key a", 10, 10, "the key it sits in is absolute over the map"],
  ["vault-page.js", ".dact", 7, 0, "16px under the tabs' row"],
  ["vault-page.js", ".pubbtn", 7, 0, "a line of the note it sits in"],
  ["vault-page.js", ".vd-mapx", 8, 8, "it stands 10px inside the map band, which clips"],
  ["vault-page.js", ".vd-all", 9, 8, "the ledger head's own 9px padding"],
  ["vault-page.js", ".vd-gn", 8, 10, "a group row's own 8px padding"],
  ["vault-page.js", ".vd-name", 8, 0, "a comp row's own 8px padding"],
  ["vault-page.js", ".dbox>summary", 12, 18, "the box's own 12px 18px padding"],
  ["vault-page.js", ".vd-dact .lnk", 9, 6, "10px under the opened row's figures"],
  ["bulk-page.js", ".bulk .links .lnk", 6, 0, "6px under the address box"],
  ["permits-page.js", ".pt-cmp", 10, 6, "the heading's own line"],
  ["permit-compare.js", ".pc-page .kicker a", 12, 8, "over the page's title, which is no control"],
  ["market-rank-page.js", ".rke-list a", 6, 0, "a row's own 5px padding and its hairline"],
  // An open chat's own buttons, and a row's More (2026-11-15).
  ["messages-page.js", ".msg-head .msg-btn", 8, 4, "the header's own 14px padding; its buttons stand 10px apart"],
  ["messages-page.js", "#msgBack", 8, 12, "the header's 16px side padding on its left, 10px to the title on its right"],
  ["messages-page.js", "#msgRBack", 8, 12, "the same header, on a report"],
  ["messages-page.js", ".msg-unsend", 8, 4, "its own message's line; it stands 8px from the edge"],
  ["messages-page.js", ".msg-more", 7, 7, "a 30px button in the 48px slot the row keeps clear for it"],
];

// Hosts that are positioned by their own rule elsewhere in the sheet, and so
// need no `position:relative` in the block.
const ALREADY_PLACED = {
  ".vd-mapx": /\.vd-mapx\{position:absolute;/,
  ".msg-unsend": /\.msg-unsend\{position:absolute;/,
  ".msg-more": /\.msg-more\{position:absolute;/,
};
// Hosts positioned by ANOTHER selector's rule in the same block: the id is a
// button of that family in the markup, so the family's position:relative is
// its own. Each entry names the rule and the markup that makes it true.
const PLACED_BY = {
  "#msgBack": [".msg-head .msg-btn", /<div class="msg-head">\s*<button class="msg-btn sm" id="msgBack"/],
  "#msgRBack": [".msg-head .msg-btn", /<div class="msg-head">\s*<button class="msg-btn sm" id="msgRBack"/],
};

test("every touch overlay stands on a positioned control, in the same block", () => {
  const seen = new Set();
  for (const [name, src] of Object.entries(FILES)) {
    for (const block of coarseBlocks(src)) {
      for (const [sels] of rules(block)) {
        for (const sel of sels) {
          if (!/::after$/.test(sel)) continue;
          const host = sel.replace(/::after$/, "");
          // A host positioned by its family also takes the family's overlay
          // and only moves its edges.
          const overlay = Object.assign({}, PLACED_BY[host] ? declsFor(block, PLACED_BY[host][0] + "::after") : {}, declsFor(block, sel));
          assert.equal(overlay.content, '""', name + ": " + sel + " draws nothing without content");
          assert.equal(overlay.position, "absolute", name + ": " + sel + " must be absolute, or it pushes its control's text");
          seen.add(name + " " + host);
          if (ALREADY_PLACED[host]) {
            assert.match(src, ALREADY_PLACED[host], name + ": " + host + " is no longer placed by its own rule");
            assert.equal(declsFor(block, host).position, undefined, name + ": " + host + " is absolute; position:relative here would drop it into the page's flow");
            continue;
          }
          if (PLACED_BY[host]) {
            const [family, markup] = PLACED_BY[host];
            assert.equal(declsFor(block, family).position, "relative", name + ": " + family + " no longer positions " + host);
            assert.match(src, markup, name + ": " + host + " is no longer a " + family + " in the markup, so nothing positions it");
            continue;
          }
          assert.equal(declsFor(block, host).position, "relative",
            name + ": " + host + " has an overlay and no position:relative beside it. The overlay is then the size of an ancestor, and a tap anywhere in that ancestor presses this control.");
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), OVERLAYS.map(([name, host]) => name + " " + host).sort(),
    "a touch overlay was added or removed: list it in OVERLAYS with the room it was measured to have");
});

test("no touch overlay reaches further than the room measured around its control", () => {
  for (const [name, host, maxV, maxH, why] of OVERLAYS) {
    const block = coarseBlocks(FILES[name]).find((b) => rules(b).some(([sels]) => sels.includes(host + "::after")));
    assert.ok(block, name + " lost the touch overlay on " + host);
    const [t, r, b, l] = reach(declsFor(block, host + "::after"));
    for (const [side, v, max] of [["top", t, maxV], ["bottom", b, maxV], ["right", r, maxH], ["left", l, maxH]]) {
      assert.ok(v >= 0, name + ": " + host + "'s overlay is smaller than the control on its " + side);
      assert.ok(v <= max, name + ": " + host + "'s overlay reaches " + v + "px on its " + side + "; it has room for " + max + " (" + why + "). Measure the neighbours again before raising this.");
    }
    // It must reach somewhere, or it is only a rule.
    assert.ok(t + b > 0, name + ": " + host + "'s overlay adds no height");
  }
});

test("the controls that take real room under a finger", () => {
  // The comp set's Clear: on a phone the set's buttons wrap 8px apart, so an
  // overlay tall enough to help would lie over the row above. Padding moves
  // it instead.
  const vault = coarseBlocks(FILES["vault-page.js"]).join("\n");
  assert.equal(declsFor(vault, ".vd-tact .lnk").padding, "8px 6px");
  assert.ok(!rules(vault).some(([sels]) => sels.includes(".vd-tact .lnk::after")), "the comp set's Clear has an overlay again: it lies over the button above it on a phone");
  // The comp book's tick cell is 36px wide on a phone under a finger (30
  // with a mouse), and the cell is the target: see vault-page.test.js.
  assert.equal(declsFor(vault, ".vd-lt td.vd-lc").width, "36px");
  // /bulk's settings: 7px of padding around one line is 36px; it was 2px.
  const bulk = coarseBlocks(FILES["bulk-page.js"]).join("\n");
  const fields = declsFor(bulk, ".bulk select");
  assert.equal(fields["padding-top"], "7px");
  assert.equal(fields["padding-bottom"], "7px");
  for (const sel of [".bulk input[type=text]", ".bulk input[type=number]"]) {
    assert.deepEqual(declsFor(bulk, sel), fields, "/bulk's " + sel + " and its selects share a row and must share a height");
  }
  // A chat's Send and Attach are 40px under a finger (27 before): Send is
  // the one button a chat cannot do without.
  const msgs = coarseBlocks(FILES["messages-page.js"]).join("\n");
  assert.equal(declsFor(msgs, ".msg-actions .msg-btn")["min-height"], "40px");
});

test("the overlays are under a finger only, and each control they name is still in its page", () => {
  // Not a width query: a tablet is wide and still a finger, and a narrow
  // desktop window is still a mouse, whose exact boxes must not grow.
  for (const [name, host] of OVERLAYS) {
    const src = FILES[name].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\"/g, '"');
    const outside = src.replace(/@media \(pointer: ?coarse\) ?\{[\s\S]*?\}\s*\}/g, "");
    const esc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s*>\s*/g, "\\s*>\\s*").replace(/ /g, "\\s+");
    assert.ok(!new RegExp("(^|[},\\s])" + esc + "::after\\s*[,{]").test(outside), name + ": " + host + "::after is styled outside the touch block, where it grows a mouse's target too");
  }
  const has = (name, needle) => assert.ok(FILES[name].includes(needle), name + " no longer has " + needle);
  has("server.js", '<nav class="cs-tabs"');
  has("server.js", 'class="alt" id="mktCsv"');
  has("index.html", 'class="hidden hm-first-key"');
  has("vault-page.js", 'class="btn ghost vd-mapx" id="mapHide"');
  has("vault-page.js", '<label class="vd-all">');
  has("vault-page.js", 'class="vd-gn" data-gk=');
  has("vault-page.js", '<p class="vd-dact">');
  has("bulk-page.js", 'class="lnk" id="pickFile"');
  has("permits-page.js", '<a class="pt-cmp" href="/permits/compare">');
  has("permit-compare.js", '<div class="kicker"><a href="/permits">');
  has("market-rank-page.js", '<ol class="rke-list">');
  has("messages-page.js", 'class="msg-btn sm msg-unsend"');
  has("messages-page.js", 'class="msg-btn primary sm" id="msgSend"');
});

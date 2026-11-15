// The report and the Firm settings dialog at phone width (2026-11-14).
//
// Run: npm test
//
// Cost: zero. It reads index.html's stylesheet and starts nothing.
//
// WHAT THIS PINS. A phone audit found two things on the app page: the Firm
// settings dialog slid sideways, and on a report the estimate began below the
// first screen. Both were cured in a handful of declarations inside one
// `@media (max-width: 639.98px)` block, which is exactly the kind of fix a
// later tidy-up removes with every other suite green, because nothing else
// looks at a phone.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const STYLE = INDEX.slice(0, INDEX.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");

// The phone block that holds the toolbar's rules: from its opening line to the
// closing brace on a line of its own.
const phoneBlock = () => {
  const at = STYLE.search(/@media \(max-width: 639\.98px\) \{\s*\.rd-tools \{ flex-wrap: nowrap;/);
  assert.ok(at > -1, "index.html lost the report's phone block");
  return STYLE.slice(at, STYLE.indexOf("\n    }", at));
};

test("on a phone the report's toolbar is one row that scrolls, not a grid four rows tall", () => {
  const block = phoneBlock();
  const tools = block.match(/\.rd-tools \{([^}]*)\}/)[1];
  assert.match(tools, /flex-wrap: nowrap/);
  assert.match(tools, /overflow-x: auto/);
  // Edge to edge: the page's 16px gutter is given back and put inside, so
  // the row scrolls under the screen's edge and nothing makes the PAGE wider.
  assert.match(tools, /margin-left: -16px; margin-right: -16px; padding: 0 36px 0 16px/);
  // The fade says there are more buttons; 36px of end padding lets the last
  // one scroll clear of the 32px fade.
  assert.match(tools, /mask-image: linear-gradient\(to right, black calc\(100% - 32px\), transparent\)/);
  assert.match(block, /\.rd-tools > button, \.rd-tools > #exportAllowance \{ flex: none; white-space: nowrap; \}/);
  // The grid is gone everywhere: it was ~200px of buttons above the value.
  assert.ok(!/\.rd-tools[^{]*\{[^}]*grid-template-columns/.test(STYLE), "the report's toolbar is a grid again");
  // The toolbar is still what the page's markup calls it, Share first.
  const at = INDEX.indexOf('<div class="rd-tools ');
  assert.ok(at > -1, "the report's toolbar lost its class");
  assert.ok(INDEX.indexOf('id="shareBtn"', at) < INDEX.indexOf('id="portfolioBtn"', at), "Share is no longer the toolbar's first button");
  assert.match(INDEX.slice(at, at + 200), /\bno-print\b/, "the toolbar prints");
});

test("on a phone the value starts sooner: the two cards over it are closed up", () => {
  const block = phoneBlock();
  assert.match(block, /#reportHeaderCard \{ padding: 16px 18px; \}/);
  assert.match(block, /#reportHeaderCard #reportAddress \{ font-size: var\(--text-heading\); \}/);
  assert.match(block, /#ownerHero \{ padding: 18px; \}/);
  assert.match(block, /#ownerHero \.rd-ledger \.rd-lcell \{ padding: 10px 16px; \}/);
  // Each id the block names is still in the page.
  for (const id of ["reportHeaderCard", "reportAddress", "ownerHero", "reportNav"]) {
    assert.ok(INDEX.includes('id="' + id + '"'), "index.html has no #" + id);
  }
  // The jump bar's links get the bar's height to be tapped in, by an overlay
  // that moves nothing (the underline of the current one stays under its word).
  assert.match(block, /\.rn-link \{ position: relative; \}/);
  assert.match(block, /\.rn-link::after \{ content: ""; position: absolute; inset: -11px -7px; \}/);
});

test("Firm settings' dropdowns never push the dialog wider than the phone", () => {
  // A <select> is as wide as its longest option. "Always share, even if the
  // firm turns it off" is 358px at a phone's 16px field size, 24px wider than
  // the dialog, and the whole dialog slid sideways.
  const block = phoneBlock();
  assert.match(block, /#firmAutoShareSelect, #firmShopSelect \{ max-width: 100%; min-width: 0; \}/);
  for (const id of ["firmAutoShareSelect", "firmShopSelect"]) {
    assert.ok(INDEX.includes('<select id="' + id + '"'), "index.html has no <select id=" + id + ">");
  }
});

test("a comp card's labels are the scale's smallest size, not smaller", () => {
  assert.match(STYLE, /\.cardgrid dt, label\[for="cardSort"\] \{ font-size: var\(--text-tiny\); \}/);
  // What the rule reaches: the cards' <dt>s inside a .cardgrid, and Sort by.
  assert.match(INDEX, /rows\.className = "cardgrid /);
  assert.match(INDEX, /for="cardSort"/);
});

// The vault's empty workspace.
//
// renderVaultHTML is pure, so the markup can be asserted with no database and
// no browser. What CANNOT be asserted here is which invitation ends up visible
// after leads/BOVs arrive: that is decided at runtime by applyFirstRun() and
// renderPipeline() against the boot payload. The runtime matrix lives in
// test/vault-page.test.js (jsdom-free harness in runPage).
//
// So these pin the things that are structural rather than behavioural, and
// that would break silently:
//
//   1. ONE file input. The empty book puts an upload button in #bookEmpty
//      while the ordinary "Add comps" panel keeps its own. If those ever
//      become two <input type=file> elements, they get two independent values
//      and two change handlers, and an upload started from one would be
//      invisible to the other's result message.
//   2. The empty vault IS the real vault. Both decks and the trust line ship
//      visible. Shipping them hidden would flash a blank workspace until JS
//      ran — the old first-run page, which this replaced.

const test = require("node:test");
const assert = require("node:assert");

const { renderVaultHTML } = require("../vault-page");

const CHROME = { CN_LOGO: "<svg></svg>", MARKET_CSS: "" };
const html = (comps, uploads) => renderVaultHTML({ s: 200, j: {
  comps: comps || [], uploads: uploads || [],
  counts: { returned: (comps || []).length, published: 0 },
  markets: [], types: [],
} }, CHROME);

test("there is exactly one file input, however many buttons open it", () => {
  const page = html();
  const inputs = page.match(/<input[^>]*type="file"/g) || [];
  assert.equal(inputs.length, 1,
    "two file inputs means two upload paths that cannot see each other's state");
});

test("both upload buttons drive that one input", () => {
  const page = html();
  for (const id of ["pick", "bookPick"]) {
    assert.match(page, new RegExp('\\$\\("' + id + '"\\)\\.addEventListener\\("click",function\\(\\)\\{ \\$\\("file"\\)\\.click\\(\\) \\}\\)'),
      id + " does not open the shared file input");
  }
});

test("the numbered first-run page is gone", () => {
  const page = html();
  assert.doesNotMatch(page, /id="firstRun"/);
  assert.doesNotMatch(page, /id="frPick"/);
});

test("the trust line and both decks ship visible", () => {
  const page = html();
  assert.match(page, /<div class="trust" id="trustLine">/);
  assert.doesNotMatch(page, /class="trust hide" id="trustLine"/);
  assert.match(page, /<div class="deck" id="deckBook">/);
  assert.match(page, /<div class="deck" id="deckPipe">/);
});

test("empty invitations ship visible; tables and the uploader stay hidden", () => {
  const page = html();
  assert.match(page, /id="bookEmpty"/);
  assert.doesNotMatch(page, /id="bookEmpty"[^>]*hide/);
  assert.match(page, /id="pipeEmpty"/);
  assert.doesNotMatch(page, /id="pipeEmpty"[^>]*\bhide\b/);
  assert.match(page, /<div id="addSec" class="addpanel hide">/);
  assert.match(page, /id="addToggle"[^>]*aria-expanded="false"/);
  assert.match(page, /<div class="tw hide" id="pipeTableWrap">/);
});

test("the coverage form is one relocating node that parks in the pipeline invitation", () => {
  const page = html();
  assert.equal((page.match(/id="covForm"/g) || []).length, 1,
    "a second coverage form would drift from the coverage rules");
  assert.match(page, /id="covBox"/);
  assert.match(page, /id="pipeEmpty"/);
  assert.doesNotMatch(page, /id="covFormHome"/);
  assert.doesNotMatch(page, /id="covFormSlot"/);
});

test("applyFirstRun keys on comps AND uploads", () => {
  // An import that landed but produced no comps still means the broker has
  // been through the door; showing the book invitation again would read as
  // their work having been thrown away.
  assert.match(html(), /applyFirstRun\(comps\.length,\(o\.j\.uploads\|\|\[\]\)\.length\)/);
  assert.match(html(), /var first=compCount===0&&uploadCount===0/);
});

test("applyFirstRun no longer hides the decks, the trust line, or the pipeline", () => {
  const page = html();
  assert.doesNotMatch(page, /\$\("pipeSec"\)\.className=first/);
  assert.doesNotMatch(page, /\$\("deckBook"\)\.className=first/);
  assert.doesNotMatch(page, /\$\("trustLine"\)\.className=first/);
  assert.match(page, /\$\("bookEmpty"\)\.className=first/);
});

test("the emitted page script still parses", () => {
  const m = html().match(/<script>\n\(function\(\)\{[\s\S]*?\}\)\(\);\n<\/script>/);
  assert.ok(m, "could not find the page's inline script");
  assert.doesNotThrow(() => new Function(m[0].replace(/^<script>/, "").replace(/<\/script>$/, "")));
});

test("the file input accepts csv and pdf", () => {
  assert.match(html(), /id="file"[^>]*accept="[^"]*\.pdf/);
});

test("the book invitation disclosure names the extract vendor", () => {
  const page = html();
  const start = page.indexOf('id="bookEmpty"');
  assert.ok(start >= 0, "#bookEmpty is missing");
  const end = page.indexOf('id="addSec"', start);
  const block = page.slice(start, end > start ? end : undefined);
  assert.match(block, /extract vendor/);
  assert.match(block, /Upload closed deals/);
});

test("picker copy mentions PDF", () => {
  assert.match(html(), /Choose a spreadsheet or PDF/);
});

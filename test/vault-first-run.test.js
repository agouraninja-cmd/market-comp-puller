// The vault's first-run state.
//
// renderVaultHTML is pure, so the markup can be asserted with no database and
// no browser. What CANNOT be asserted here is which sections end up visible:
// that is decided at runtime by applyFirstRun() against the boot payload, and
// this repo has no DOM and no dependencies to give it one. That matrix (empty
// / populated / imported-but-empty) was verified by rendering the real page in
// a browser; see the PR.
//
// So these pin the two things that are structural rather than behavioural, and
// that would break silently:
//
//   1. ONE file input. The first run puts an upload button in step 1 while the
//      ordinary "Add comps" section keeps its own. If those ever become two
//      <input type=file> elements, they get two independent values and two
//      change handlers, and an upload started from one would be invisible to
//      the other's result message.
//   2. Everything the first run controls ships HIDDEN and is revealed only by
//      applyFirstRun. Ship one of them visible and a broker with a full vault
//      gets "Start here" flashing above their book on every page load.

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
  // #pick is the original; #frPick is step 1 of the first run. Both must call
  // the same $("file").click(), not open a picker of their own.
  for (const id of ["pick", "frPick"]) {
    assert.match(page, new RegExp('\\$\\("' + id + '"\\)\\.addEventListener\\("click",function\\(\\)\\{ \\$\\("file"\\)\\.click\\(\\) \\}\\)'),
      id + " does not open the shared file input");
  }
});

test("the first-run panel ships hidden", () => {
  // Revealed only by applyFirstRun. If it shipped visible, a broker with a
  // full vault would see "Start here" above their own book until the JS ran.
  assert.match(html(), /<section id="firstRun" class="hide">/);
});

test("every element the first run hides ships hidden or is toggled by id", () => {
  const page = html();
  // The trust line ships hidden: on day one it is a 0-0 scoreboard.
  assert.match(page, /<div class="trust hide" id="trustLine">/);
  // Both deck rules ship hidden with it, and for the same reason: a rule
  // reading "Your book" over an empty one is that scoreboard again.
  assert.match(page, /<div class="deck hide" id="deckBook">/);
  assert.match(page, /<div class="deck hide" id="deckPipe">/);
  // The rest are toggled by id, so they must HAVE ids to toggle. Since
  // Direction U neither addSec nor importsSec is a <section> — one is a panel
  // under the book deck, the other a disclosure under the comps table — so
  // this pins the id, which is what the toggling actually needs.
  for (const id of ["addSec", "compsSec", "importsSec", "pipeSec"]) {
    assert.match(page, new RegExp('id="' + id + '"'), id + " has no id to toggle");
  }
});

test("the uploader ships closed, so the book is what a returning broker sees", () => {
  // "Add comps" was a section above the comps table until 2026-08-10. It is
  // the book deck's action now and opens on click; shipping it open would put
  // the uploader back in front of the data it was moved out of.
  assert.match(html(), /<div id="addSec" class="addpanel hide">/);
  assert.match(html(), /id="addToggle"[^>]*aria-expanded="false"/);
});

test("the pipeline table ships hidden, so a header row never stands alone", () => {
  assert.match(html(), /<div class="tw hide" id="pipeTableWrap">/);
});

test("the pipeline section ships hidden, so an empty vault does not flash the inbox", () => {
  assert.match(html(), /<section id="pipeSec"/);
  assert.match(html(), /\$\("pipeSec"\)\.className=first\?"hide":""/);
});

test("the coverage form is one relocating node that parks in Markets you watch", () => {
  const page = html();
  assert.equal((page.match(/id="covForm"/g) || []).length, 1,
    "a second coverage form would drift from the coverage rules");
  assert.match(page, /id="covBox"/);
  assert.match(page, /id="covFormHome"/);
  assert.doesNotMatch(page, /id="covFormSlot"/);
});

test("applyFirstRun keys on comps AND uploads", () => {
  // An import that landed but produced no comps still means the broker has
  // been through the door; showing "Start here" again would read as their
  // work having been thrown away.
  assert.match(html(), /applyFirstRun\(comps\.length,\(o\.j\.uploads\|\|\[\]\)\.length\)/);
  assert.match(html(), /var first=compCount===0&&uploadCount===0/);
});

test("the emitted page script still parses", () => {
  // Same guard as test/vault-page.test.js: the whole page is one template
  // literal, so a stray ${ or a single-backslash escape ships a blank
  // workspace rather than failing at require time.
  const m = html().match(/<script>\n\(function\(\)\{[\s\S]*?\}\)\(\);\n<\/script>/);
  assert.ok(m, "could not find the page's inline script");
  assert.doesNotThrow(() => new Function(m[0].replace(/^<script>/, "").replace(/<\/script>$/, "")));
});

test("the file input accepts csv and pdf", () => {
  assert.match(html(), /id="file"[^>]*accept="[^"]*\.pdf/);
});

test("the first-run disclosure names the extract vendor", () => {
  const page = html();
  const start = page.indexOf('id="firstRun"');
  assert.ok(start >= 0, "#firstRun is missing");
  const end = page.indexOf('id="deckBook"', start);
  const firstRun = page.slice(start, end > start ? end : undefined);
  assert.match(firstRun, /extract vendor/);
});

test("picker copy mentions PDF", () => {
  assert.match(html(), /Choose a spreadsheet or PDF/);
});

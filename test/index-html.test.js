// index.html has no build step and no bundler, so its one big inline
// <script> block IS the entire front end: search, modals, results
// rendering, exports. Nothing in `npm test` ever parses it, and
// `node --check` cannot read an HTML file -- so today this script has zero
// syntax coverage of any kind.
//
// The failure mode is severe and silent. Per CLAUDE.md's Restart rule, that
// script's very first statement destructures the global VALUATION, so a
// syntax error anywhere in the block throws immediately and aborts the
// whole front end -- no search form, no modals, no report rendering --
// while the page still serves its HTML and CSS untouched. It LOOKS fine and
// does nothing. Upcoming work rewrites large parts of this script, so it
// needs a net.
//
// This follows the precedent in test/vault-page.test.js, which compiles the
// browser JS vault-page.js emits, for the same class of reason: a template
// that builds JavaScript as a string has no compiler watching it until
// something actually parses the output.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HTML_PATH = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf8");

// A `type` attribute value that is still executable JavaScript. Absence of
// a type attribute ALSO means JavaScript (the HTML default), which is
// handled separately below -- an omitted attribute is not the same as an
// empty string.
const JS_TYPE = /^\s*(text\/javascript|application\/javascript|module)\s*$/i;

// Pulls every <script>...</script> block out of index.html, keeping the raw
// attribute string (so callers can filter on src/type) and an approximate
// starting line number, good enough to find the block by eye in a failure
// message without pretending to be exact.
function extractScriptBlocks(source) {
  const blocks = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(source)) !== null) {
    blocks.push({
      attrs: m[1],
      body: m[2],
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return blocks;
}

// Real, executable inline JS only. A <script src=...> tag (valuation.js,
// html2canvas, leaflet) has no body here to parse -- it is a reference to a
// separate file. A non-JS `type` (application/ld+json and the like) is data
// a JS parser is SUPPOSED to reject; feeding it to vm.Script would either
// fail this test for the wrong reason or, worse, get "fixed" by someone
// rewriting JSON as JavaScript to make a red test go green.
function isRealJsBlock(block) {
  if (/\bsrc\s*=/i.test(block.attrs)) return false;
  const typeMatch = block.attrs.match(/\btype\s*=\s*["']([^"']*)["']/i);
  if (typeMatch && !JS_TYPE.test(typeMatch[1])) return false;
  if (!block.body.trim()) return false;
  return true;
}

test("index.html has at least one real inline script block to check", () => {
  // A future edit to index.html's <script> tags (a new src, a stray type
  // attribute) could accidentally filter every block out, and a loop over
  // zero blocks below would pass having checked nothing -- a green test
  // that verifies nothing is worse than no test, so that has its own guard.
  const real = extractScriptBlocks(html).filter(isRealJsBlock);
  assert.ok(
    real.length > 0,
    "found zero real inline <script> blocks in index.html; the extraction filter is probably wrong"
  );
});

test("index.html's inline script blocks parse as valid JavaScript", () => {
  const real = extractScriptBlocks(html).filter(isRealJsBlock);
  for (const block of real) {
    try {
      // Parsing only, never running: new vm.Script compiles without
      // executing, so this needs none of document/window/localStorage,
      // which this Node process does not have.
      new vm.Script(block.body, { filename: "index.html" });
    } catch (err) {
      assert.fail(
        "index.html's inline <script> starting near line " + block.line +
        " failed to parse: " + err.message
      );
    }
  }
});

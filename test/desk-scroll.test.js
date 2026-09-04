// A workspace load starts at the top (2026-09-04).
//
// Chrome restores the scroll position across a reload once the document is
// tall enough, and since the desk arrives inside the page (DESK_BOOT) it is.
// Measured on the live site: a refresh from 1407px down came back at 1407px,
// the run-a-report chamber at the foot of the workspace. The boot block that
// opens the workspace now switches scroll restoration to manual before the
// load event and scrolls to the top once — and only on that branch, so a
// shared report keeps the browser's own behaviour.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// The boot block: from the shared-path test to the close of its `if`.
function bootBlock() {
  const at = html.indexOf("const _sharedPath = /^\\/r\\/");
  assert.ok(at > 0, "the workspace boot block must still test /r/<id> by name");
  return html.slice(at, html.indexOf("\n  }\n", at) + 4);
}

test("the workspace boot turns scroll restoration off before load and scrolls to the top", () => {
  const block = bootBlock();
  assert.ok(block.includes('history.scrollRestoration = "manual"'),
    "manual restoration, or Chrome puts a refresh back at the chamber");
  assert.ok(block.indexOf('history.scrollRestoration = "manual"') < block.indexOf("showDeskView();"),
    "set before the desk shows, which is before the load event");
  assert.ok(block.includes("window.scrollTo(0, 0)"), "and one explicit scroll to the top");
  assert.ok(block.indexOf("showDeskView();") < block.indexOf("window.scrollTo(0, 0)"),
    "after the desk is on screen, so nothing later in the block scrolls it back");
});

test("only the workspace branch does it — a shared report keeps the browser's behaviour", () => {
  const block = bootBlock();
  assert.ok(block.includes("!_sharedPath"), "the branch still excludes /r/<id>");
  // Exactly one writer of the flag in the whole file: the boot block.
  assert.equal((html.match(/history\.scrollRestoration\s*=/g) || []).length, 1,
    "scrollRestoration must be written in exactly one place");
});

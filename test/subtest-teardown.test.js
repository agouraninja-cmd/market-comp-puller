// A subtest that registers a teardown must own the context it registers on.
//
// `t.after()` inside a subtest declared `async () => {}` closes over the
// PARENT's context, so the teardown runs when the parent finishes rather than
// when the subtest does. Nothing goes red — every assertion still passes — the
// suite just holds every server it booted open until the last subtest in the
// block ends, then shuts them all down at once. Measured on
// test/org-run.test.js: eleven live server.js children and eleven stand-in
// databases at peak, against the one that block uses at a time.
//
// This is a check rather than a convention written down somewhere because it
// has now been fixed twice. PR #239 found it in test/hub-note-email-run.test.js
// on 2026-08-31 ("twelve live server.js children at peak ... that burst is the
// state a hung `node --test` was observed in") and fixed the three files it was
// looking at; four more carried the identical defect and were found the next
// day, by which time org-run had gone intermittently red under load. The
// difference between right and wrong is the single character `t`, the suite
// stays green either way, and a person is the wrong detector for that.
//
// The rule is deliberately wider than `t.after`: a subtest with no context of
// its own has no business touching the parent's AT ALL, including by handing it
// to a fixture helper — `await firmWithMike(t)` was org-run's shape, and it
// leaked exactly as an inline `t.after` would have. Declare `async (t) => {}`
// and the shadowed `t` is the right one everywhere inside.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DIR = __dirname;
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith(".test.js")).sort();

// `t.test("name", async () => {` — the declaration, and whether it named a
// context of its own. The name is matched as any EXPRESSION rather than a
// string literal: one subtest here is generated in a loop and takes a
// variable, and a pattern that only read literals would skip it in silence,
// which is the failure the count assertion below exists to catch. Scoped by
// the indentation of the declaring line, which is what this suite's
// formatting supports; a declaration split across lines is not matched, which
// is a blind spot rather than a false alarm.
const DECL = /^(\s*)(?:await\s+)?t\.test\(\s*(.*?),\s*(?:async\s*)?\(\s*([^)]*?)\s*\)\s*=>\s*\{\s*$/;
// Either `t.something` or `t` handed to a call — the two ways the parent's
// context gets used from inside a subtest that never declared one.
const USES_T = /\bt\.\w+|\(\s*t\s*[,)]/;
const CLOSER = /^\s*\}\)\s*;?\s*$/;

function scan(src) {
  const lines = src.split("\n");
  const found = [];
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DECL);
    if (!m) continue;
    seen++;
    const indent = m[1].length;
    const name = m[2].replace(/^["'`]|["'`]$/g, "");
    if (m[3].trim()) continue;            // declared its own context: fine
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      // End of this subtest: a closer at or left of the declaration's indent.
      if (CLOSER.test(line) && line.match(/^\s*/)[0].length <= indent) break;
      if (USES_T.test(line)) found.push({ line: j + 1, name, code: line.trim() });
    }
  }
  return { found, seen };
}

test("a subtest that uses the test context declares its own", () => {
  const bad = [];
  let subtests = 0;
  for (const f of FILES) {
    if (f === path.basename(__filename)) continue;
    const { found, seen } = scan(fs.readFileSync(path.join(DIR, f), "utf8"));
    subtests += seen;
    for (const o of found) bad.push(`${f}:${o.line}  [${o.name}]  ${o.code}`);
  }

  // A scanner that matches nothing reports every file as clean. This suite has
  // hundreds of subtests, so if the declaration shape ever drifts, fail here
  // rather than pass forever on a verdict that means nothing.
  assert.ok(subtests > 200,
    `the subtest scanner matched only ${subtests} declarations — its pattern has gone stale, so its verdict means nothing`);

  assert.deepEqual(bad, [], "\n\n" + [
    "These subtests reach for the parent's test context, so their teardowns run",
    "when the PARENT ends and every server they boot stays alive until the last",
    "subtest in the block finishes. Declare the subtest `async (t) => {}` and the",
    "shadowed `t` is the right one:",
    "",
    ...bad.map((b) => "  " + b),
    "",
  ].join("\n"));
});

// No copy names a page called Data.
//
// Run: npm test
//
// Cost: zero. A source scan; nothing boots.
//
// The member's private comp book was the "/vault" page, called "Data" in copy
// from 2026-10-04 until 2026-10-13, when the vault was taken apart: the comps
// are "Your comps" at /comps now, and /vault redirects there. The copy kept
// saying "your Data" in more than eighty strings across thirteen files (the
// report's source badge, the share warning, Messages, the client hub, the
// marketing pages, the trial and renewal emails, the server's error strings)
// for a page nobody could find any more. This pins the shapes those took, so
// the name cannot creep back one string at a time.
//
// Code comments may still say "Data" for the history ("the Home and Data
// drafts"); none of them uses these shapes, and none should need to.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// Everything that renders copy: the app, the server-rendered pages, the
// emails and the server's error strings. iOS, docs and tests are not served.
const FILES = fs.readdirSync(ROOT)
  .filter((f) => /\.(js|html)$/.test(f))
  .sort();

const SHAPES = [
  /\b(?:your|Your|my|private|Private|anyone[’']s|CompNinja) Data\b/,
  /\b(?:in|to|from|From) Data\b/,
  /\bData (?:for your own|access|puts|is (?:most|unavailable|closed)|stays|details)\b/,
];

test("no copy calls the comp book Data", () => {
  assert.ok(FILES.includes("index.html") && FILES.includes("server.js"), "the scan lost the files it exists for");
  const hits = [];
  for (const f of FILES) {
    const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (SHAPES.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, [], "say \"your comps\" (or nothing): there is no Data page since 2026-10-13");
});

test("the report's badge for a member's own comp says so, and is not Verified", () => {
  // Rule 8: "Verified" is the badge the server awards when a named broker
  // vouches for a deal. A member's private comp has not earned it, so its
  // badge says whose it is, never how sure we are of it.
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const row = html.match(/broker_vault:\s*\{ label: "([^"]+)",\s+cls: "bv", legend: "([^"]+)" \}/);
  assert.ok(row, "the broker_vault source tier moved or lost its bv class");
  assert.equal(row[1], "Your comp");
  assert.ok(!/verified/i.test(row[1] + row[2]), "a private comp's badge claims verification");
});

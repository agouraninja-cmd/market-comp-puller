"use strict";

// Two small pure readers that live inside server.js, lifted out of its source
// and run: the report cache key and the corpus's number reader. server.js
// cannot be required (it boots), and neither function touches anything but
// its arguments, so the text itself is evaluated. If either is renamed or
// stops being a plain top-level function, lift() fails loudly.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");

// A top-level `function name(` up to its closing brace at column 0 (or the
// end of the line, for a one-liner).
function lift(name) {
  const at = src.indexOf(`\nfunction ${name}(`);
  assert.ok(at >= 0, `server.js no longer has a top-level function ${name}`);
  const lineEnd = src.indexOf("\n", at + 1);
  const firstLine = src.slice(at + 1, lineEnd);
  if (/\}\s*$/.test(firstLine)) return firstLine;
  const end = src.indexOf("\n}\n", at);
  assert.ok(end > at, `${name} has no closing brace at column 0`);
  return src.slice(at + 1, end + 2);
}

const { cacheKeyFor, corpusNum, firstNumber } = new Function("crypto",
  `${lift("firstNumber")}\n${lift("corpusNum")}\n${lift("cacheKeyFor")}\nreturn { cacheKeyFor, corpusNum, firstNumber };`)(crypto);

const key = (over) => cacheKeyFor({
  address: "500 Warehouse Way, Boise, ID", type: "Industrial", note: "", months: 24, maxComps: 8,
  txFocus: "both", subjectSizeSqft: "", verifiedComps: [], subjectDetails: {}, ...over,
});

test("the cache key tells a decimal figure from the figure without its point", () => {
  // Until 2026-11-10 every period was stripped as punctuation, so these pairs
  // shared one cache entry and a corrected search was served the report built
  // for the figure it replaced.
  assert.notEqual(key({ note: "within 2.5 miles" }), key({ note: "within 25 miles" }));
  assert.notEqual(key({ note: "1.5 mi" }), key({ note: "15 mi" }));
  assert.notEqual(key({ type: "Land", subjectDetails: { lot_acres: "2.4" } }),
    key({ type: "Land", subjectDetails: { lot_acres: "24" } }));
  assert.notEqual(key({ note: ".5 miles" }), key({ note: "5 miles" }));
});

test("the cache key still ignores decorative punctuation and spacing", () => {
  assert.equal(key({ address: "500 Warehouse Way, Boise, ID" }), key({ address: "500 Warehouse Way,Boise,  ID." }));
  assert.equal(key({ address: "12 N. Main St., Boise, ID" }), key({ address: "12 N Main St, Boise, ID" }));
  assert.equal(key({ note: "Near the airport." }), key({ note: "near the airport" }));
  assert.equal(key({ note: "Dock-high, rail spur." }), key({ note: "dock-high,rail spur" }));
  // And a search with no decimals in it keeps the key it always had.
  const before = crypto.createHash("sha256")
    .update(["500 warehouse way, boise, id", "Industrial", "near the airport", 24, 8, "both", "", ""].join("::")).digest("hex");
  assert.equal(key({ note: "Near the airport." }), before);
});

test("corpusNum reads the first number written, not every digit in the text", () => {
  assert.equal(corpusNum("$7,750,000"), 7750000);
  assert.equal(corpusNum("$209"), 209);
  assert.equal(corpusNum(88), 88);
  assert.equal(corpusNum("$14.50/SF/yr NNN"), 14.5);
  // The shapes that used to come out wrong (see firstNumber's header).
  assert.equal(corpusNum("$7.00-$12.00/SF/yr NNN"), 7, "a range was unpriced (NaN)");
  assert.equal(corpusNum("$1.08/SF/month NNN ($12.96/SF/yr NNN)"), 1.08);
  assert.equal(corpusNum("$32.50 - $36.00/SF/yr"), 32.5);
  assert.equal(corpusNum("$115-$130"), 115, "not 115130");
  assert.equal(corpusNum("$28.00/SF/yr FSG, 3% bumps"), 28, "not 28.003");
  for (const blank of ["", null, undefined, "n/a", "Undisclosed", "$0", 0]) {
    assert.equal(corpusNum(blank), null, String(blank));
  }
});

test("firstNumber reads a size written with its unit", () => {
  assert.equal(firstNumber("25,000 sq. ft."), 25000);
  assert.equal(firstNumber("25,000 s.f."), 25000);
  assert.equal(firstNumber("12500"), 12500);
  assert.equal(firstNumber(".75 acres"), 0.75);
  assert.ok(Number.isNaN(firstNumber("unknown")));
});

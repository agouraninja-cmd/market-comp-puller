// scripts/truth-test.js: the pure half. Requiring the script runs nothing
// (main is behind require.main), and nothing here makes a request.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const TT = require("../scripts/truth-test");

const NOW = Date.parse("2026-11-27");
const comp = (address, psf, over) => ({ address, transaction: "Sale", date: "2026-06", size_sqft: "10000",
  price_per_sqft: String(psf), source_type: "public_record", ...over });
const target = { address: "100 Main St, Boise, ID", type: "Industrial", sold: 1000000 };

test("a report is scored against the sale price, with the building's own sale taken out", () => {
  const report = {
    subject_size_sqft: "10000",
    comps: [comp("1 A St, Boise, ID", 90), comp("2 B St, Boise, ID", 110), comp("3 C St, Boise, ID", 100),
            comp("4 D St, Boise, ID", 100),
            // The subject's own sale, respelled: a report must not be graded
            // on a price it was shown.
            comp("100 Main Street, Boise, ID 83702", 500)],
    _call: { billed_calls: 2, cost_usd: 0.02 },
  };
  const r = TT.scoreReport(target, report, NOW);
  assert.equal(r.ownSaleRemoved, 1);
  assert.equal(r.comps, 4);
  assert.equal(r.saleComps, 4);
  assert.equal(r.likely, 1000000);
  assert.equal(r.miss, 0);
  assert.equal(r.inRange, true);
  assert.equal(r.calls, 2);
  // For any other building, that fifth comp is just a comp and stays.
  const other = TT.scoreReport({ ...target, address: "999 Elsewhere Rd, Boise, ID" }, report, NOW);
  assert.equal(other.ownSaleRemoved, 0);
  assert.equal(other.comps, 5);
});

test("a report with no size or no priced sale is counted as not valued, never as a zero miss", () => {
  const noSize = TT.scoreReport(target, { comps: [comp("1 A St, Boise, ID", 90), comp("2 B St, Boise, ID", 110), comp("3 C St, Boise, ID", 100)] }, NOW);
  assert.equal(noSize.miss, null);
  const empty = TT.scoreReport(target, { subject_size_sqft: "10000", comps: [] }, NOW);
  assert.equal(empty.miss, null);
  const s = TT.summarize([noSize, empty, { address: "x", error: "503" }]);
  assert.equal(s.valued, 0);
  assert.equal(s.failed, 1);
  assert.equal(s.medianMiss, null);
});

test("the summary is the median of absolute misses, with the mean capped at 100%", () => {
  const rows = [0.05, -0.10, 0.30, -0.60, 4.0].map((miss, i) => ({ address: String(i), miss, inRange: i < 2, saleComps: 4, seconds: 30 + i * 10, cost: 0.01, calls: 1 }));
  const s = TT.summarize(rows);
  assert.equal(s.medianMiss, 0.30);
  assert.ok(Math.abs(s.meanMiss - (0.05 + 0.10 + 0.30 + 0.60 + 1) / 5) < 1e-12);
  assert.equal(s.within10, 2 / 5);
  assert.equal(s.within20, 2 / 5);
  assert.equal(s.over50, 2 / 5);
  assert.equal(s.inRange, 2 / 5);
  assert.equal(s.overMinute, 1);
  assert.equal(s.slowest, 70);
});

test("two runs are compared only on buildings valued in both, and report the swing between them", () => {
  const a = { rows: [{ address: "1 A St, Boise, ID", type: "Office", miss: 0.10, saleComps: 4 },
                     { address: "2 B St, Boise, ID", type: "Office", miss: -0.40, saleComps: 3 },
                     { address: "3 C St, Boise, ID", type: "Office", miss: null, saleComps: 0 }] };
  const b = { rows: [{ address: "1 A Street, Boise, ID", type: "Office", miss: -0.20, saleComps: 8 },
                     { address: "2 B St, Boise, ID", type: "Office", miss: -0.10, saleComps: 7 },
                     { address: "3 C St, Boise, ID", type: "Office", miss: 0.05, saleComps: 6 }] };
  const c = TT.compare(a, b);
  assert.equal(c.pairs, 2, "the building one run could not value is not an improvement in the other");
  assert.equal(c.better, 1);
  assert.equal(c.worse, 1);
  assert.equal(c.medianA, 0.25);
  assert.ok(Math.abs(c.medianB - 0.15) < 1e-12);
  assert.ok(Math.abs(c.medianSwing - 0.30) < 1e-12);
  assert.equal(c.compsB, 7.5);
});

test("the committed truth set is usable: an address, a type and a sale price on every row, no repeats", () => {
  const set = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "scripts", "truth-set.json"), "utf8"));
  assert.ok(set.targets.length >= 40);
  const seen = new Set();
  for (const t of set.targets) {
    assert.match(t.address, /^\d.*, [A-Z]{2}( \d{5})?$/, t.address);
    assert.ok(["Industrial", "Office", "Retail"].includes(t.type), t.address);
    assert.ok(t.sold >= 500000, t.address);
    const k = t.address.toLowerCase();
    assert.ok(!seen.has(k), "listed twice: " + t.address);
    seen.add(k);
  }
});

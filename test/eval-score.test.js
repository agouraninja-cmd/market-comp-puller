"use strict";

const test = require("node:test");
const assert = require("node:assert");
const S = require("../eval-score");

const NOW = Date.parse("2026-08-09T00:00:00Z");
const TARGET = { address: "100 Main St, Boise, ID", type: "Industrial", months: 24 };

function report(comps, extra) {
  return Object.assign({ comps: comps, summary: "s".repeat(500) }, extra || {});
}

test("scoreReport counts priced sale comps and whether a valuation is possible", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", size_sqft: "10,000", price_or_rate: "$1,000,000", price_per_sqft: "$100", source_type: "listing" },
    { address: "2 B St, Boise, ID", transaction: "Sale", date: "2026-04-01", size_sqft: "5,000", price_or_rate: "$750,000", price_per_sqft: "$150", source_type: "public_record" },
    { address: "3 C St, Boise, ID", transaction: "Lease", date: "2026-03-01", size_sqft: "8,000", price_or_rate: "$9.50/SF/yr", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.comps, 3);
  assert.equal(m.pricedSales, 2);
  assert.equal(m.valuationPossible, true);
});

test("scoreReport: one priced sale is not enough for a valuation", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", size_sqft: "10,000", price_or_rate: "$1,000,000", price_per_sqft: "$100", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.pricedSales, 1);
  assert.equal(m.valuationPossible, false);
});

test("scoreReport scores provenance with valuation.js tier weights", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$100", source_type: "public_record" },
    { address: "2 B St, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$110", source_type: "estimate" },
  ]), TARGET, NOW);
  // public_record 1 + estimate 0.5, averaged.
  assert.equal(m.provenanceScore, 0.75);
  assert.equal(m.tierCounts.public_record, 1);
  assert.equal(m.tierCounts.estimate, 1);
  assert.equal(m.estimateRate, 0.5);
});

test("scoreReport flags aggregate addresses and out-of-window dates", () => {
  const m = S.scoreReport(report([
    { address: "Market Median, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$100", source_type: "estimate" },
    { address: "2 B St, Boise, ID", transaction: "Sale", date: "2019-01-01", price_per_sqft: "$110", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.aggregateRate, 0.5);
  assert.equal(m.inWindowRate, 0.5);
});

test("scoreReport matches the subject's city and state", () => {
  const m = S.scoreReport(report([
    { address: "1 A St, Boise, ID", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$100", source_type: "listing" },
    { address: "9 Z Ave, Dallas, TX", transaction: "Sale", date: "2026-05-01", price_per_sqft: "$110", source_type: "listing" },
  ]), TARGET, NOW);
  assert.equal(m.marketMatchRate, 0.5);
});

test("scoreReport records narrative lengths and subject size lookup", () => {
  const m = S.scoreReport(report([], {
    summary: "abc", value_drivers: ["one", "two"], market_trend: "flat",
    price_discovery: { note: "xyz" }, subject_size_sqft: "42,000",
  }), TARGET, NOW);
  assert.equal(m.summaryChars, 3);
  assert.equal(m.valueDriversChars, 6);
  assert.equal(m.marketTrendChars, 4);
  assert.equal(m.priceDiscoveryChars, 3);
  assert.equal(m.subjectSizeFound, true);
});

test("scoreReport does not throw on empty or malformed reports", () => {
  for (const bad of [null, {}, { comps: null }, { comps: [null, {}] }]) {
    const m = S.scoreReport(bad, TARGET, NOW);
    assert.equal(typeof m.comps, "number");
    assert.equal(m.valuationPossible, false);
  }
});

test("summarize averages successes and reports failures separately", () => {
  const sum = S.summarize([
    { target: "a", ok: true, metrics: { comps: 4, pricedSales: 4, valuationPossible: true, provenanceScore: 1, durationMs: 60000 } },
    { target: "b", ok: true, metrics: { comps: 2, pricedSales: 0, valuationPossible: false, provenanceScore: 0.5, durationMs: 40000 } },
    { target: "c", ok: false, error: "timeout" },
  ]);
  assert.equal(sum.targets, 3);
  assert.equal(sum.failures, 1);
  assert.deepEqual(sum.failedTargets, [{ target: "c", error: "timeout" }]);
  assert.equal(sum.metrics.comps, 3);              // (4+2)/2, failure excluded
  assert.equal(sum.metrics.provenanceScore, 0.75);
  assert.equal(sum.valuationPossibleRate, 0.5);
});

test("compare reports per-metric deltas and tolerates a missing metric", () => {
  const a = { metrics: { comps: 4, provenanceScore: 0.8 }, valuationPossibleRate: 1, failures: 0 };
  const b = { metrics: { comps: 6, provenanceScore: 0.6 }, valuationPossibleRate: 0.5, failures: 2 };
  const d = S.compare(a, b);
  assert.equal(d.metrics.comps.baseline, 4);
  assert.equal(d.metrics.comps.candidate, 6);
  assert.equal(d.metrics.comps.delta, 2);
  assert.equal(d.metrics.provenanceScore.delta, -0.2);
  assert.equal(d.valuationPossibleRate.delta, -0.5);
  assert.equal(d.failures.delta, 2);
  const d2 = S.compare({ metrics: { comps: 4 } }, { metrics: { other: 1 } });
  assert.equal(d2.metrics.comps.candidate, null);
  assert.equal(d2.metrics.other.baseline, null);
});

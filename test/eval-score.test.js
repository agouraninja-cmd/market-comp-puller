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

// --- cost and token accounting ----------------------------------------------
// The scorecard could measure quality and wall clock but not spend, so "is
// thinking less cheaper AND still accurate?" was only half answerable. These
// ride on `_call`, which /api/comps attaches for an internal caller on a billed
// leg only.

test("scoreReport reads spend off _call, splitting thinking from the report", () => {
  const m = S.scoreReport({
    comps: [], summary: "",
    _call: {
      billed_calls: 1, cost_usd: 0.0311,
      usage: { input_tokens: 4207, output_tokens: 7401, thought_tokens: 6473 },
    },
  }, { type: "Industrial", months: 12 }, Date.now());
  assert.equal(m.costUsd, 0.0311);
  assert.equal(m.billedCalls, 1);
  assert.equal(m.outputTokens, 7401);
  assert.equal(m.thoughtTokens, 6473);
  // thought is a SUBSET of output, so the report is the remainder — the figure
  // every prompt trim in this project has been aiming at.
  assert.equal(m.reportTokens, 928);
  assert.ok(Math.abs(m.thoughtShare - 0.8746) < 0.001, `got ${m.thoughtShare}`);
});

test("a run with no spend data reports none of it, rather than zeros", () => {
  // A cache hit, or a run predating this, must not average in as a free search
  // — that would halve the reported cost of any run that hit the cache.
  const m = S.scoreReport({ comps: [], summary: "" },
    { type: "Industrial", months: 12 }, Date.now());
  for (const k of ["costUsd", "outputTokens", "thoughtTokens", "reportTokens", "thoughtShare"]) {
    assert.ok(!(k in m), `${k} must be absent, not zero`);
  }
  const s = S.summarize([{ target: "t", ok: true, metrics: m }]);
  assert.ok(!("costUsd" in s.metrics), "summarize must not invent a $0.00 average");
});

test("summarize averages spend only over the targets that reported it", () => {
  const withCost = (c) => ({ target: "t", ok: true, metrics: { costUsd: c, comps: 5 } });
  const s = S.summarize([withCost(0.02), withCost(0.04), { target: "u", ok: true, metrics: { comps: 5 } }]);
  assert.equal(s.metrics.costUsd, 0.03, "the target with no cost data is skipped, not counted as free");
});

test("a provider with no thinking reports a zero share, which reads as 'no lever here'", () => {
  const m = S.scoreReport({
    comps: [], summary: "",
    _call: { billed_calls: 1, cost_usd: 0.3, usage: { output_tokens: 4100, thought_tokens: 0 } },
  }, { type: "Industrial", months: 12 }, Date.now());
  assert.equal(m.thoughtShare, 0);
  assert.equal(m.reportTokens, 4100, "with no thinking, every output token is report");
});

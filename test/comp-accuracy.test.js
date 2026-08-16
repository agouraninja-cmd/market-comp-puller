"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const A = require("../comp-accuracy");

const NOW = Date.parse("2026-08-16T00:00:00Z");
const TARGET = { address: "100 Main St, Boise, ID", type: "Industrial", months: 24 };

// A comp whose numbers all agree, used as the base for every negative test:
// if a check fires on THIS, it fires on honest data.
function clean(over) {
  return Object.assign({
    address: "1 A St, Boise, ID",
    transaction: "Sale",
    date: "2026-05-01",
    size_sqft: "10,000",
    price_or_rate: "$1,000,000",
    price_per_sqft: "$100",
    source_type: "public_record",
  }, over || {});
}

const keysOf = (comps) => A.checkComps(comps, { now: NOW }).flagged.map((f) => f.key);

// --- Family 1: self-consistency -------------------------------------------

test("a self-consistent comp raises nothing", () => {
  const r = A.checkComps([clean()], { now: NOW });
  assert.deepEqual(r.flagged, []);
  assert.equal(r.clean, 1);
  assert.equal(r.score, 1);
});

test("psf_mismatch fires when the stated $/SF does not match price / size", () => {
  // $1,000,000 / 10,000 SF is $100/SF, not $250.
  assert.deepEqual(keysOf([clean({ price_per_sqft: "$250" })]), ["psf_mismatch"]);
});

test("psf_mismatch tolerates ordinary rounding", () => {
  // $1,043,700 / 10,000 = $104.37/SF, written as $104. Honest data.
  assert.deepEqual(keysOf([clean({ price_or_rate: "$1,043,700", price_per_sqft: "$104" })]), []);
});

test("rate_as_sale_price catches the $1.2M shorthand numericValue reads as 1.2", () => {
  // The exact hazard valuation.js's salePsfOf already guards against, which
  // is how we know the model writes it. It must surface as the parse failure
  // it is, not as a tiny $/SF nobody can interpret.
  const r = A.checkComps([clean({ price_or_rate: "$1.2M", price_per_sqft: "" })], { now: NOW });
  assert.deepEqual(r.flagged.map((f) => f.key), ["rate_as_sale_price"]);
});

test("rate_as_sale_price catches a lease rate written into a sale's price", () => {
  assert.deepEqual(keysOf([clean({ price_or_rate: "$9.50", price_per_sqft: "" })]), ["rate_as_sale_price"]);
});

test("a lease is not judged as a sale", () => {
  // Every sale-shaped check must stay quiet here: a lease rate of $9.50 on
  // 10,000 SF is a perfectly ordinary lease.
  assert.deepEqual(keysOf([clean({
    transaction: "Lease", price_or_rate: "$9.50/SF/yr", price_per_sqft: "",
  })]), []);
});

test("implausible_psf fires on a per-SF figure outside the sane band", () => {
  assert.deepEqual(keysOf([clean({ size_sqft: "", price_or_rate: "", price_per_sqft: "$95,000" })]),
    ["implausible_psf"]);
});

test("alt_basis_mismatch checks the per-unit denominator multifamily is priced on", () => {
  // $6,000,000 across 40 units is $150,000/unit, not $95,000.
  assert.deepEqual(keysOf([clean({
    price_or_rate: "$6,000,000", size_sqft: "40,000", price_per_sqft: "$150",
    units: "40", price_per_unit: "$95,000",
  })]), ["alt_basis_mismatch"]);
});

test("alt_basis_mismatch checks the per-acre denominator land is priced on", () => {
  assert.deepEqual(keysOf([clean({
    price_or_rate: "$2,000,000", size_sqft: "", price_per_sqft: "",
    lot_acres: "10", price_per_acre: "$50,000",
  })]), ["alt_basis_mismatch"]);
});

test("a correct per-unit figure raises nothing", () => {
  assert.deepEqual(keysOf([clean({
    price_or_rate: "$6,000,000", size_sqft: "40,000", price_per_sqft: "$150",
    units: "40", price_per_unit: "$150,000",
  })]), []);
});

test("future_date fires on a deal that has not happened", () => {
  assert.deepEqual(keysOf([clean({ date: "2027-01-01" })]), ["future_date"]);
});

test("today's deal is not a future deal", () => {
  assert.deepEqual(keysOf([clean({ date: "2026-08-16" })]), []);
});

test("duplicate_comp fires on a spelling variant of the same building", () => {
  const r = A.checkComps([
    clean({ address: "19127 Red Label Lane, Caldwell, ID 83607" }),
    clean({ address: "19127 Red Label Ln, Caldwell, ID 83605" }),
  ], { now: NOW });
  assert.deepEqual(r.flagged.map((f) => f.key), ["duplicate_comp"]);
  // One building voting twice: only the second copy is the defect.
  assert.equal(r.clean, 1);
});

test("duplicate_comp fires on an exact size-and-price coincidence", () => {
  // backtest.js's belt-and-braces rule: distinct buildings essentially never
  // share both figures exactly.
  assert.deepEqual(keysOf([
    clean({ address: "1 A St, Boise, ID" }),
    clean({ address: "999 Nowhere Blvd, Boise, ID" }),
  ]), ["duplicate_comp"]);
});

test("two genuinely different buildings are not duplicates", () => {
  assert.deepEqual(keysOf([
    clean({ address: "1 A St, Boise, ID" }),
    clean({ address: "2 B St, Boise, ID", price_or_rate: "$750,000", size_sqft: "5,000", price_per_sqft: "$150" }),
  ]), []);
});

test("an empty comp list scores 1 rather than NaN", () => {
  const r = A.checkComps([], { now: NOW });
  assert.equal(r.score, 1);
  assert.equal(r.total, 0);
});

test("a malformed comp list does not throw", () => {
  assert.doesNotThrow(() => A.checkComps([null, {}, { address: 5 }], { now: NOW }));
});

// --- Family 2: ground-truth agreement -------------------------------------

const DEAL = {
  address: "1 A St, Boise, ID",
  city_state: "Boise, ID",
  type: "Industrial",
  transaction: "Sale",
  date: "2026-05-01",
  price: 1000000,
  size_sqft: 10000,
  basis: "public_record",
  source_url: "https://county.example.gov/rec/1",
};

test("a found deal with matching numbers scores full recall and agreement", () => {
  const t = A.scoreTruth({ comps: [clean()] }, [DEAL], TARGET, NOW);
  assert.equal(t.expected, 1);
  assert.equal(t.found, 1);
  assert.equal(t.recall, 1);
  assert.equal(t.priceAgreeRate, 1);
  assert.equal(t.sizeAgreeRate, 1);
  assert.equal(t.dateAgreeRate, 1);
  assert.equal(t.contradictions, 0);
});

test("a known deal the search never returned is a miss, not an unverified comp", () => {
  const t = A.scoreTruth({ comps: [] }, [DEAL], TARGET, NOW);
  assert.equal(t.recall, 0);
  assert.deepEqual(t.missed, [DEAL.address]);
  assert.equal(t.unverified, 0);
});

test("a matched deal reported at the wrong price is a contradiction", () => {
  const t = A.scoreTruth({ comps: [clean({ price_or_rate: "$1,400,000" })] }, [DEAL], TARGET, NOW);
  assert.equal(t.found, 1);
  assert.equal(t.contradictions, 1);
  assert.equal(t.priceAgreeRate, 0);
});

test("size tolerance is looser than price tolerance", () => {
  // Gross vs rentable square footage genuinely differs between sources for
  // one building; a recorded sale price does not.
  const t = A.scoreTruth({ comps: [clean({ size_sqft: "10,400" })] }, [DEAL], TARGET, NOW);
  assert.equal(t.sizeAgreeRate, 1);
  assert.equal(t.contradictions, 0);
});

test("a recording date weeks off the closing date still agrees", () => {
  const t = A.scoreTruth({ comps: [clean({ date: "2026-05-20" })] }, [DEAL], TARGET, NOW);
  assert.equal(t.dateAgreeRate, 1);
});

test("unverified comps are counted but are NEVER errors", () => {
  // The load-bearing honesty rule: the answer key holds the deals we happen
  // to know, not every deal in the market, so a comp missing from it is
  // unproven rather than false. If this ever becomes a false-positive rate,
  // the harness reports a confident accuracy number that mostly measures how
  // small the truth set is.
  const t = A.scoreTruth({
    comps: [clean(), clean({ address: "77 Unknown Rd, Boise, ID", price_or_rate: "$2,000,000", size_sqft: "20,000" })],
  }, [DEAL], TARGET, NOW);
  assert.equal(t.unverified, 1);
  assert.equal(t.recall, 1, "an extra comp must not reduce recall");
  assert.equal(t.contradictions, 0, "an unmatched comp is not a contradiction");
  assert.equal(t.priceAgreeRate, 1, "an unmatched comp must not enter the agreement rates");
});

test("a deal outside the requested window is not expected", () => {
  const old = Object.assign({}, DEAL, { date: "2019-01-01" });
  assert.equal(A.scoreTruth({ comps: [] }, [old], TARGET, NOW).expected, 0);
});

test("a deal in another market or another type is not expected", () => {
  const elsewhere = Object.assign({}, DEAL, { address: "1 A St, Dallas, TX", city_state: "Dallas, TX" });
  const otherType = Object.assign({}, DEAL, { type: "Office" });
  assert.equal(A.scoreTruth({ comps: [] }, [elsewhere, otherType], TARGET, NOW).expected, 0);
});

test("recall is null, not zero, when the key covers nothing here", () => {
  // "Not measured" and "found none of them" are different facts, and a zero
  // would drag any average that pooled it.
  assert.equal(A.scoreTruth({ comps: [clean()] }, [], TARGET, NOW).recall, null);
});

// --- Roll-up ---------------------------------------------------------------

test("summarizeAccuracy pools recall rather than averaging per-report rates", () => {
  // 1 of 1 in one report and 1 of 9 in another is 2/10, not the 55% an
  // average of the two rates would report.
  const s = A.summarizeAccuracy([
    { consistency: { total: 1, clean: 1, findings: {} }, truth: { expected: 1, found: 1, matched: [] } },
    { consistency: { total: 1, clean: 1, findings: {} }, truth: { expected: 9, found: 1, matched: [] } },
  ]);
  assert.equal(s.recall, 0.2);
});

test("summarizeAccuracy skips failed targets", () => {
  const s = A.summarizeAccuracy([
    { consistency: { total: 2, clean: 1, findings: { psf_mismatch: 1 } }, truth: {} },
    { target: "x", ok: false, error: "HTTP 500" },
  ]);
  assert.equal(s.reports, 1);
  assert.equal(s.comps, 2);
  assert.equal(s.consistencyScore, 0.5);
  assert.equal(s.findings.psf_mismatch, 1);
});

test("compareAccuracy reports deltas for metrics and findings", () => {
  const a = A.summarizeAccuracy([{ consistency: { total: 2, clean: 1, findings: { psf_mismatch: 1 } }, truth: {} }]);
  const b = A.summarizeAccuracy([{ consistency: { total: 2, clean: 2, findings: {} }, truth: {} }]);
  const d = A.compareAccuracy(a, b);
  assert.equal(d.metrics.consistencyScore.delta, 0.5);
  assert.equal(d.findings.psf_mismatch.delta, -1);
});

// --- The answer key's own rules -------------------------------------------

test("validateDeal accepts a well-formed deal", () => {
  assert.deepEqual(A.validateDeal(DEAL, 0), []);
});

test("validateDeal refuses a deal a past search produced", () => {
  // The rule that keeps this an answer key rather than a mirror: scoring a
  // new search against an old search's output measures agreement between two
  // model runs and flatters a shared mistake.
  const errs = A.validateDeal(Object.assign({}, DEAL, { basis: "model_corpus" }), 0);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /not independent/);
});

test("validateDeal refuses an unknown basis", () => {
  assert.match(A.validateDeal(Object.assign({}, DEAL, { basis: "vibes" }), 0)[0], /basis must be one of/);
});

test("validateDeal requires a URL for a basis that cites a document", () => {
  assert.match(A.validateDeal(Object.assign({}, DEAL, { source_url: "" }), 0)[0], /source_url/);
});

test("validateDeal does not require a URL for a broker-verified deal", () => {
  // Its citation is a named broker in comp_submissions, not a document.
  assert.deepEqual(A.validateDeal(Object.assign({}, DEAL, { basis: "broker_verified", source_url: "" }), 0), []);
});

test("validateDeal refuses an aggregate address as an answer", () => {
  const errs = A.validateDeal(Object.assign({}, DEAL, { address: "Downtown submarket average, Boise, ID" }), 0);
  assert.ok(errs.some((e) => /names a statistic|street number/.test(e)));
});

test("validateDeal refuses an unparseable date or price", () => {
  assert.ok(A.validateDeal(Object.assign({}, DEAL, { date: "last spring" }), 0).some((e) => /date must parse/.test(e)));
  assert.ok(A.validateDeal(Object.assign({}, DEAL, { price: "undisclosed" }), 0).some((e) => /price must parse/.test(e)));
});

test("the committed truth-set.json validates", () => {
  // A malformed answer key must fail the build, not silently score nothing.
  const set = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "truth-set.json"), "utf8"));
  const v = A.validateTruthSet(set);
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});

test("the truth set's illustrative example is not scored as a real deal", () => {
  // It lives beside `deals`, never inside it. An example row inside the
  // answer key is a fake transaction being scored as a real one, the same
  // trap the vault template's `#` comment rows exist to avoid.
  const set = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "truth-set.json"), "utf8"));
  assert.ok(set.example, "the example should exist as documentation");
  assert.ok(!set.deals.some((d) => d.address === set.example.address),
    "the example must never appear in deals");
});

// --- Targets derived from the key -----------------------------------------

test("targetsFromTruthSet makes one search per market and type, wide enough to reach the oldest deal", () => {
  const set = {
    deals: [
      DEAL,
      Object.assign({}, DEAL, { address: "2 B St, Boise, ID", date: "2024-11-01" }),
      Object.assign({}, DEAL, { address: "9 Z Ave, Dallas, TX", city_state: "Dallas, TX" }),
      Object.assign({}, DEAL, { address: "3 C St, Boise, ID", type: "Office" }),
    ],
  };
  const targets = A.targetsFromTruthSet(set, { now: NOW });
  assert.equal(targets.length, 3);
  const boiseIndustrial = targets.find((t) => t.type === "Industrial" && /Boise/.test(t.address));
  assert.equal(boiseIndustrial.knownDeals, 2);
  // The 2024-11-01 deal is ~21 months back, so a 12-month window would ask
  // for a report that could not contain it.
  assert.equal(boiseIndustrial.months, 24);
});

test("targetsFromTruthSet returns nothing for an empty key", () => {
  assert.deepEqual(A.targetsFromTruthSet({ deals: [] }, { now: NOW }), []);
});

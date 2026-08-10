// The valuation core, extracted from index.html so the browser and the
// accuracy harness run one copy of the math.
//
// Run: npm test
//
// These are CHARACTERIZATION tests: every expected value is what the inline
// code in index.html produced before the extraction. They exist to prove the
// move changed nothing, so do not "fix" one by adjusting the expectation.

const test = require("node:test");
const assert = require("node:assert");

const V = require("../valuation");

const AS_OF = Date.parse("2026-07-01");

// A comp shaped the way the report's comps array is shaped.
function comp(over) {
  return Object.assign({
    address: "100 Main St, Boise, ID",
    transaction: "Sale",
    date: "2026-07-01",
    size_sqft: "10000",
    price_per_sqft: "100",
    source_type: "public_record",
  }, over || {});
}

test("numericValue strips commas and currency", () => {
  assert.equal(V.numericValue("$1,500,000"), 1500000);
  assert.equal(V.numericValue("150.5"), 150.5);
  assert.ok(Number.isNaN(V.numericValue(null)));
  assert.ok(Number.isNaN(V.numericValue("no digits here")));
});

test("salePsfOf prefers the reported figure, then derives price / size", () => {
  assert.equal(V.salePsfOf(comp({ price_per_sqft: "$150" })), 150);
  assert.equal(
    V.salePsfOf(comp({ price_per_sqft: "", price_or_rate: "$1,500,000", size_sqft: "10,000" })),
    150);
});

test("salePsfOf refuses a shorthand price that would derive a nonsense rate", () => {
  // numericValue("$1.2M") is 1.2, so the derived rate is 0.00012/SF. The
  // 1..100000 guard is what stops that reaching the valuation.
  assert.ok(Number.isNaN(
    V.salePsfOf(comp({ price_per_sqft: "", price_or_rate: "$1.2M", size_sqft: "10000" }))));
});

test("heroRound steps by magnitude", () => {
  assert.equal(V.heroRound(45678), 46000);         // < 100k  -> 1,000
  assert.equal(V.heroRound(926987), 925000);       // < 1M    -> 5,000
  assert.equal(V.heroRound(1234567), 1225000);     // < 10M   -> 25,000
  assert.equal(V.heroRound(12345678), 12300000);   // >= 10M  -> 100,000
});

test("heroRound is idempotent, so a rounded value can pass through it again", () => {
  [45678, 926987, 1234567, 12345678].forEach((v) => {
    assert.equal(V.heroRound(V.heroRound(v)), V.heroRound(v));
  });
});

test("robustPpsfRange with two comps shows the raw spread, untrimmed", () => {
  const rr = V.robustPpsfRange([{ v: 100, w: 1 }, { v: 200, w: 1 }]);
  assert.equal(rr.low, 100);
  assert.equal(rr.mid, 150);
  assert.equal(rr.high, 200);
  assert.equal(rr.trimmed, false);
});

test("robustPpsfRange with four comps trims to weighted quartiles", () => {
  const rr = V.robustPpsfRange([100, 200, 300, 400].map((v) => ({ v, w: 1 })));
  assert.equal(rr.low, 150);
  assert.equal(rr.mid, 250);
  assert.equal(rr.high, 350);
  assert.equal(rr.trimmed, true);
});

test("robustPpsfRange accepts bare numbers as weight-1 items", () => {
  const rr = V.robustPpsfRange([100, 200, 300, 400]);
  assert.equal(rr.low, 150);
  assert.equal(rr.high, 350);
});

test("compAgeYears is zero for a same-day comp and capped at five years", () => {
  assert.equal(V.compAgeYears(comp({ date: "2026-07-01" }), AS_OF), 0);
  assert.equal(V.compAgeYears(comp({ date: "2010-01-01" }), AS_OF), 5);
  assert.equal(V.compAgeYears(comp({ date: "not a date" }), AS_OF), null);
});

test("compWeight is 1 for a same-day, same-size, public-record comp", () => {
  assert.equal(V.compWeight(comp(), AS_OF, 10000), 1);
});

test("compWeight halves once per octave beyond 2x the subject size", () => {
  // 40,000 SF against a 10,000 SF subject is two octaves, so one halving.
  assert.equal(V.compWeight(comp({ size_sqft: "40000" }), AS_OF, 10000), 0.5);
});

test("compWeight gives a free pass inside 0.5x-2x", () => {
  assert.equal(V.compWeight(comp({ size_sqft: "20000" }), AS_OF, 10000), 1);
  assert.equal(V.compWeight(comp({ size_sqft: "5000" }), AS_OF, 10000), 1);
});

test("compWeight applies the source tier", () => {
  assert.equal(V.compWeight(comp({ source_type: "listing" }), AS_OF, 10000), 0.85);
  assert.equal(V.compWeight(comp({ source_type: "news" }), AS_OF, 10000), 0.7);
  assert.equal(V.compWeight(comp({ source_type: "estimate" }), AS_OF, 10000), 0.5);
});

test("compWeight floors at 0.15 so no comp silently vanishes", () => {
  // Seven years old (capped to five), three octaves off size, estimate tier:
  // 0.176776 * 0.25 * 0.5 = 0.0221, well under the floor.
  const w = V.compWeight(
    comp({ date: "2019-07-01", size_sqft: "80000", source_type: "estimate" }), AS_OF, 10000);
  assert.equal(w, 0.15);
});

test("compWeight treats missing data as neutral, never as a penalty", () => {
  assert.equal(V.compWeight(comp({ date: "", size_sqft: "", source_type: "" }), AS_OF, 10000), 1);
});

test("trendFactor compounds the market trend over the comp's age", () => {
  const f = V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, 10);
  assert.ok(Math.abs(f - 1.21) < 0.005, "expected ~1.21, got " + f);
});

test("trendFactor caps extrapolation at three years", () => {
  const five = V.trendFactor(comp({ date: "2021-07-01" }), AS_OF, 10);
  assert.ok(Math.abs(five - 1.331) < 0.005, "expected ~1.331, got " + five);
});

test("trendFactor is identity without a usable trend", () => {
  assert.equal(V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, null), 1);
  assert.equal(V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, 0), 1);
  assert.equal(V.trendFactor(comp({ date: "2024-07-01" }), AS_OF, 45), 1);  // server bounds at 30
  assert.equal(V.trendFactor(comp({ date: "2026-07-01" }), AS_OF, 10), 1);  // age 0
});

test("tierOf reads the verified flag first, then the source type", () => {
  assert.equal(V.tierOf(comp({ verified: true })), "verified");
  assert.equal(V.tierOf(comp({ verified: "true" })), "verified");
  assert.equal(V.tierOf(comp({ source_type: "listing" })), "listing");
  assert.equal(V.tierOf(comp({ source_type: "who knows" })), null);
});

test("valueFromComps composes the weighted, trimmed range and the totals", () => {
  // Four same-day, same-size, public-record comps: equal weights, so the
  // quartiles are exact and independent of the weighting.
  const comps = [100, 200, 300, 400].map((psf) =>
    comp({ price_per_sqft: String(psf), address: psf + " Main St" }));
  const v = V.valueFromComps(comps, { subjectSF: 10000, asOf: AS_OF, trendPct: null });
  assert.equal(v.psfLow, 150);
  assert.equal(v.psfMid, 250);
  assert.equal(v.psfHigh, 350);
  assert.equal(v.low, 1500000);
  assert.equal(v.mid, 2500000);
  assert.equal(v.high, 3500000);
  assert.equal(v.n, 4);
  assert.equal(v.trimmed, true);
});

test("valueFromComps spans a size RANGE the way the hero does", () => {
  const comps = [100, 200, 300, 400].map((psf) =>
    comp({ price_per_sqft: String(psf), address: psf + " Main St" }));
  const v = V.valueFromComps(comps, {
    subjectSF: { min: 8000, max: 12000 }, asOf: AS_OF, trendPct: null,
  });
  assert.equal(v.low, 150 * 8000);    // low $/SF x the SMALLEST size
  assert.equal(v.mid, 250 * 10000);   // mid $/SF x the MIDPOINT size
  assert.equal(v.high, 350 * 12000);  // high $/SF x the LARGEST size
});

test("valueFromComps drops leases, which are a different unit", () => {
  const comps = [
    comp({ price_per_sqft: "100", address: "1 Main St" }),
    comp({ price_per_sqft: "200", address: "2 Main St" }),
    comp({ price_per_sqft: "9", address: "3 Main St", transaction: "Lease" }),
  ];
  const v = V.valueFromComps(comps, { subjectSF: 10000, asOf: AS_OF, trendPct: null });
  assert.equal(v.n, 2);
  assert.equal(v.psfLow, 100);
  assert.equal(v.psfHigh, 200);
});

test("valueFromComps takes an alternate value extractor for $/unit bases", () => {
  const comps = [100000, 200000, 300000, 400000].map((ppu) =>
    comp({ price_per_unit: String(ppu), address: ppu + " Main St" }));
  const v = V.valueFromComps(comps, {
    subjectSF: 0, asOf: AS_OF, trendPct: null,
    readValue: (c) => V.numericValue(c.price_per_unit),
  });
  assert.equal(v.psfLow, 150000);
  assert.equal(v.psfMid, 250000);
  assert.equal(v.psfHigh, 350000);
});

test("valueFromComps returns null when nothing carries a usable value", () => {
  assert.equal(V.valueFromComps([], { subjectSF: 10000, asOf: AS_OF }), null);
  assert.equal(
    V.valueFromComps([comp({ price_per_sqft: "", price_or_rate: "", size_sqft: "" })],
      { subjectSF: 10000, asOf: AS_OF }),
    null);
});

test("valueFromComps falls back to salePsfOf when readValue is not a function", () => {
  // Guards against `{ ...opts, readValue: cond ? extractor : undefined }`,
  // which sets the key without supplying a function. Should behave exactly
  // as if `readValue` had been omitted entirely.
  const comps = [100, 200, 300, 400].map((psf) =>
    comp({ price_per_sqft: String(psf), address: psf + " Main St" }));
  const withUndefined = V.valueFromComps(comps,
    { subjectSF: 10000, asOf: AS_OF, trendPct: null, readValue: undefined });
  const omitted = V.valueFromComps(comps, { subjectSF: 10000, asOf: AS_OF, trendPct: null });
  assert.deepEqual(withUndefined, omitted);
  assert.equal(withUndefined.psfLow, 150);
  assert.equal(withUndefined.psfMid, 250);
  assert.equal(withUndefined.psfHigh, 350);
});

test("outlierOf: inside the band and at the edges is null", () => {
  const band = { low: 100, high: 200 };
  assert.equal(V.outlierOf(150, band), null);
  assert.equal(V.outlierOf(100, band), null);
  assert.equal(V.outlierOf(200, band), null);
  // Outside the band but within 25% of the edge: still null.
  assert.equal(V.outlierOf(249, band), null);   // 24.5% above 200
  assert.equal(V.outlierOf(76, band), null);    // 24% below 100
});

test("outlierOf: beyond 25% of the nearest edge flags with direction and pct", () => {
  const band = { low: 100, high: 200 };
  assert.deepEqual(V.outlierOf(276, band), { dir: "above", pct: 38 });  // (276-200)/200
  assert.deepEqual(V.outlierOf(70, band), { dir: "below", pct: 30 });   // (100-70)/100
});

test("outlierOf: exactly 25% past an edge is null (strict inequality)", () => {
  const band = { low: 100, high: 200 };
  assert.equal(V.outlierOf(250, band), null);
  assert.equal(V.outlierOf(75, band), null);
});

test("outlierOf: degenerate and junk inputs are null", () => {
  assert.equal(V.outlierOf(NaN, { low: 100, high: 200 }), null);
  assert.equal(V.outlierOf(0, { low: 100, high: 200 }), null);
  assert.equal(V.outlierOf(-5, { low: 100, high: 200 }), null);
  assert.equal(V.outlierOf(150, null), null);
  assert.equal(V.outlierOf(150, { low: 0, high: 0 }), null);
  assert.equal(V.outlierOf(150, { low: 200, high: 100 }), null);  // inverted band
  // Single-point band: 25% rule still applies around the point.
  assert.deepEqual(V.outlierOf(130, { low: 100, high: 100 }), { dir: "above", pct: 30 });
  assert.equal(V.outlierOf(120, { low: 100, high: 100 }), null);
});

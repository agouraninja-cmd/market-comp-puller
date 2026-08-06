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

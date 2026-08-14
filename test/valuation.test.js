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

test("yearOf accepts a 4-digit year and refuses everything else", () => {
  assert.equal(V.yearOf(1994), 1994);
  assert.equal(V.yearOf("1994"), 1994);
  assert.equal(V.yearOf(" 2019 "), 2019);
  assert.equal(V.yearOf(""), null);
  assert.equal(V.yearOf(null), null);
  assert.equal(V.yearOf("c. 1994"), null);
  assert.equal(V.yearOf("built 1994"), null);
  assert.equal(V.yearOf(2752), null);       // a size that leaked into the year field
  assert.equal(V.yearOf("1250000"), null);  // a price that leaked into the year field
});

test("compWeight downweights a 30-year vintage mismatch", () => {
  // 1994 subject vs 2024 new construction: 30 years, 15 past the free pass,
  // so one halving. The Austin Rosedale failure mode: a 1994 resale priced
  // by teardown-rebuild sales on the next block.
  assert.equal(V.compWeight(comp({ year_built: "2024" }), AS_OF, 10000, 1994), 0.5);
});

test("compWeight gives a free pass within 15 years of vintage", () => {
  assert.equal(V.compWeight(comp({ year_built: "2009" }), AS_OF, 10000, 1994), 1);
  assert.equal(V.compWeight(comp({ year_built: "1994" }), AS_OF, 10000, 1994), 1);
  assert.equal(V.compWeight(comp({ year_built: "1979" }), AS_OF, 10000, 1994), 1);
});

test("compWeight treats missing year as neutral, never as a penalty", () => {
  assert.equal(V.compWeight(comp({ year_built: "" }), AS_OF, 10000, 1994), 1);
  assert.equal(V.compWeight(comp({ year_built: "2024" }), AS_OF, 10000, 0), 1);
  assert.equal(V.compWeight(comp({ year_built: "2024" }), AS_OF, 10000), 1);
});

test("compWeight gives a free pass within a mile of the subject", () => {
  assert.equal(V.compWeight(comp({ distance_mi: 0.4 }), AS_OF, 10000), 1);
  assert.equal(V.compWeight(comp({ distance_mi: 1 }), AS_OF, 10000), 1);
  assert.equal(V.compWeight(comp({ distance_mi: "< 0.1 mi" }), AS_OF, 10000), 1);
});

test("compWeight halves at five miles (4-mile half-life after the 1-mile pass)", () => {
  assert.equal(V.compWeight(comp({ distance_mi: 5 }), AS_OF, 10000), 0.5);
  assert.equal(V.compWeight(comp({ distance_mi: "5.0 mi" }), AS_OF, 10000), 0.5);
});

test("compWeight treats missing distance as neutral, never as a penalty", () => {
  assert.equal(V.compWeight(comp({ distance_mi: "" }), AS_OF, 10000), 1);
  assert.equal(V.compWeight(comp(), AS_OF, 10000), 1);
});

test("distanceMiles reads the column the table already shows", () => {
  assert.equal(V.distanceMiles(comp({ distance_mi: 2.3 })), 2.3);
  assert.equal(V.distanceMiles(comp({ distance_mi: "2.3 mi" })), 2.3);
  assert.equal(V.distanceMiles(comp()), null);
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

// --- subjectSizeFit ---------------------------------------------------------
//
// The rule that would have caught the 2026-08-13 report: a $52,000 mobile home
// valued at $795,000 because the size box held 10,100 SF measured off a bike
// shop 81 m away. The comps were right; the subject size was not.

test("subjectSizeFit counts the comps outside compWeight's 0.5x-2x window", () => {
  // The count the hero's trust line reports. 10,000 SF subject: 30,000 is more
  // than 2x (off), 20,000 is exactly 2x (inside, matching compWeight's own
  // free pass), 5,000 is exactly 0.5x (inside).
  const fit = V.subjectSizeFit(10000, [
    comp({ size_sqft: "30000" }), comp({ size_sqft: "20000" }), comp({ size_sqft: "5000" }),
  ]);
  assert.equal(fit.sized, 3);
  assert.equal(fit.offSize, 1);
  assert.equal(fit.unsupported, false);
});

test("subjectSizeFit flags a subject size the comps cannot support", () => {
  // The real report, with its real numbers.
  const trailerComps = [460, 720, 924, 672, 980, 938, 1152, 1492]
    .map((sf) => comp({ size_sqft: String(sf) }));
  const fit = V.subjectSizeFit(10100, trailerComps);
  assert.equal(fit.unsupported, true);
  assert.equal(fit.dir, "larger");
  assert.equal(fit.nearest, 1492);
  assert.equal(fit.factor, 6.8);
  // Every comp is off-size, which is what makes the SUBJECT the outlier.
  assert.equal(fit.offSize, 8);
  assert.equal(fit.sized, 8);
});

test("subjectSizeFit flags an implausibly SMALL subject too", () => {
  // The same failure with the numbers reversed — a size typed in thousands, or
  // a unit's floor area against whole-building comps.
  const fit = V.subjectSizeFit(900, [
    comp({ size_sqft: "40000" }), comp({ size_sqft: "52000" }), comp({ size_sqft: "61000" }),
  ]);
  assert.equal(fit.unsupported, true);
  assert.equal(fit.dir, "smaller");
  assert.equal(fit.nearest, 40000);
  assert.equal(fit.factor, 44.4);
});

test("subjectSizeFit stays quiet when the comps straddle the subject", () => {
  // One comp far smaller and another far larger is a scattered comp set, which
  // the per-comp weighting already handles and offSize already reports. It is
  // NOT a size box holding a number from a different building, so it must not
  // raise the warning that tells the reader to go doubt their own input.
  const fit = V.subjectSizeFit(10000, [
    comp({ size_sqft: "500" }), comp({ size_sqft: "800" }), comp({ size_sqft: "90000" }),
  ]);
  assert.equal(fit.offSize, 3);
  assert.equal(fit.unsupported, false);
});

test("subjectSizeFit needs three sized comps before it accuses the subject", () => {
  // Two comps agreeing is not evidence about a third figure.
  const two = V.subjectSizeFit(10100, [comp({ size_sqft: "460" }), comp({ size_sqft: "720" })]);
  assert.equal(two.offSize, 2);
  assert.equal(two.unsupported, false);
});

test("subjectSizeFit ignores leases and unsized comps, and returns null with nothing to compare", () => {
  // Leases are a different unit ($/SF/yr) and never inform the sale band, so
  // they cannot make the subject look out of place either.
  const withLease = V.subjectSizeFit(10100, [
    comp({ size_sqft: "460" }), comp({ size_sqft: "720" }), comp({ size_sqft: "924" }),
    comp({ transaction: "Lease", size_sqft: "40000" }),
  ]);
  assert.equal(withLease.sized, 3);
  assert.equal(withLease.unsupported, true);
  // No size on the subject, or no sized comp, means there is no comparison to
  // report — distinct from a comparison that found nothing wrong.
  assert.equal(V.subjectSizeFit(0, [comp()]), null);
  assert.equal(V.subjectSizeFit(10000, [comp({ size_sqft: "" })]), null);
  assert.equal(V.subjectSizeFit(10000, []), null);
});

// --- askFit -----------------------------------------------------------------
//
// The rule that would have caught the 2026-08-13 Austin Rosedale report: a
// 1994 house listed at $1,250,000 ($454/SF, neighborhood median) valued at
// $1,650,000 because the comps were the expensive tail. Size was right; the
// listing never entered the report.

test("askFit flags the Austin listing-vs-comps gap", () => {
  const fit = V.askFit(1250000, 1650000);
  assert.equal(fit.skewed, true);
  assert.equal(fit.dir, "above");
  assert.equal(fit.pct, 32);
  assert.equal(fit.ask, 1250000);
  assert.equal(fit.mid, 1650000);
});

test("askFit stays quiet at or inside 25%", () => {
  // Same 25% product rule as outlierOf: exactly 25% is not skewed.
  const inside = V.askFit(1250000, 1500000);   // 20%
  assert.equal(inside.skewed, false);
  assert.equal(inside.dir, "above");
  const edge = V.askFit(1000000, 1250000);     // exactly 25%
  assert.equal(edge.skewed, false);
  const agree = V.askFit(1250000, 1250000);
  assert.equal(agree.skewed, false);
  assert.equal(agree.dir, "even");
});

test("askFit flags a listing well ABOVE the comps too", () => {
  const fit = V.askFit(2000000, 1250000);      // comps 37.5% below the ask
  assert.equal(fit.skewed, true);
  assert.equal(fit.dir, "below");
  assert.equal(fit.pct, 38);
});

test("askFit returns null without both figures", () => {
  assert.equal(V.askFit(0, 1650000), null);
  assert.equal(V.askFit(1250000, 0), null);
  assert.equal(V.askFit(null, 1650000), null);
  assert.equal(V.askFit(1250000, NaN), null);
});

test("a blended vault comp has a tier, at full weight", () => {
  // The key exists so the tier does: without broker_vault in TIER_WEIGHT,
  // tierOf returned null and index.html's sourceBadge() rendered no
  // "From your vault" badge (found on the first real blended report,
  // 2026-08-10). Weight 1 must equal the old implicit behavior, where a
  // null tier skipped the multiplier.
  assert.equal(V.tierOf(comp({ source_type: "broker_vault" })), "broker_vault");
  assert.equal(V.TIER_WEIGHT.broker_vault, 1);
  const vault = comp({ source_type: "broker_vault" });
  const unknown = comp({ source_type: "who knows" });
  assert.equal(V.compWeight(vault, AS_OF), V.compWeight(unknown, AS_OF));
});

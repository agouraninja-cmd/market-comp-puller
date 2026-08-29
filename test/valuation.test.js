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

test("CRE's free pass runs out to 10 miles, matching blend-corpus's radius", () => {
  // The free pass and the corpus blend radius must name the same circle, or a
  // comp the blend auto-includes as in-market is graded Weak by the hero.
  assert.equal(V.defaultFreePassMiles("Industrial"), 10);
  assert.equal(V.defaultFreePassMiles("Office"), 10);
  assert.equal(V.defaultFreePassMiles("Residential"), 1);
  assert.equal(V.compWeight(comp({ distance_mi: 9 }), AS_OF, 10000), 1);
  assert.equal(V.compWeight(comp({ distance_mi: 10 }), AS_OF, 10000), 1);
});

test("compWeight halves at fourteen miles (4-mile half-life after the 10-mile pass)", () => {
  assert.equal(V.compWeight(comp({ distance_mi: 14 }), AS_OF, 10000), 0.5);
  assert.equal(V.compWeight(comp({ distance_mi: "14.0 mi" }), AS_OF, 10000), 0.5);
});

test("an explicit radius still overrides the type default in both directions", () => {
  // A "2.5 miles" market note tightens the circle; the fallback only applies
  // when the caller names nothing.
  assert.equal(V.compWeight(comp({ distance_mi: 6.5 }), AS_OF, 10000, null, { radiusMiles: 2.5 }), 0.5);
  assert.equal(V.compWeight(comp({ distance_mi: 6.5 }), AS_OF, 10000, null, {}), 1);
});

test("Residential distance half-life is 2 miles, so a 5-mile house counts half as much as CRE", () => {
  // CRE: 0.5^((5-1)/4) = 0.5. Residential: 0.5^((5-1)/2) = 0.25.
  assert.equal(V.distanceHalfLifeMiles("Residential"), 2);
  assert.equal(V.distanceHalfLifeMiles("Industrial"), 4);
  assert.equal(V.compWeight(comp({ distance_mi: 5 }), AS_OF, 10000, null, "Residential"), 0.25);
  assert.equal(V.compWeight(comp({ distance_mi: 3 }), AS_OF, 10000, null, { propertyType: "Residential" }), 0.5);
});

test("a $2M house is not valued off a majority of cheaper houses a few miles over", () => {
  // 4 nearby sales at $500/SF (the subject's own streets) plus 15 sales at
  // $250/SF six miles away — the 19-comp flood from a 10-mile residential
  // blend. CRE's 4-mile half-life still lets the cheap majority win the
  // weighted median; the house curve does not.
  const nearby = Array.from({ length: 4 }, (_, i) =>
    comp({ address: i + " Near St", price_per_sqft: "500", size_sqft: "4000", distance_mi: 0.3 }));
  const far = Array.from({ length: 15 }, (_, i) =>
    comp({ address: i + " Far Rd", price_per_sqft: "250", size_sqft: "4000", distance_mi: 6 }));
  const house = V.valueFromComps(nearby.concat(far), {
    subjectSF: 4000, asOf: AS_OF, trendPct: null, propertyType: "Residential",
  });
  const cre = V.valueFromComps(nearby.concat(far), {
    subjectSF: 4000, asOf: AS_OF, trendPct: null,
  });
  assert.ok(house.psfMid > 400, "house likely should sit with the nearby $500/SF comps, got " + house.psfMid);
  assert.ok(cre.psfMid < house.psfMid, "CRE curve should sit closer to the cheap majority");
  assert.equal(house.n, 19);
});

test("parseRadiusMiles reads a market note and refuses junk", () => {
  assert.equal(V.parseRadiusMiles("2.5 miles"), 2.5);
  assert.equal(V.parseRadiusMiles("within 2.5 mi"), 2.5);
  assert.equal(V.parseRadiusMiles("2.5 mile radius"), 2.5);
  assert.equal(V.parseRadiusMiles(""), null);
  assert.equal(V.parseRadiusMiles("North Dallas submarket"), null);
  assert.equal(V.parseRadiusMiles("1000 miles"), null);
});

test("radiusClaimContradicted keeps an approximate claim and drops a false one", () => {
  // The live sample's own numbers: a claimed ~5 miles against comps 13 to 20
  // out. That is the contradiction a reader was being handed.
  assert.equal(V.radiusClaimContradicted("Immediate submarket, ~5 miles", 20), true);
  assert.equal(V.radiusClaimContradicted("Immediate submarket, ~5 miles", 13), true);
  // A radius is approximate by nature, so slack before we call it wrong.
  assert.equal(V.radiusClaimContradicted("about 5 miles", 5), false);
  assert.equal(V.radiusClaimContradicted("about 5 miles", 6.25), false);
  assert.equal(V.radiusClaimContradicted("about 5 miles", 6.3), true);
});

test("radiusClaimContradicted never invents a contradiction out of missing data", () => {
  // Free-form prose with no mileage in it: nothing to compare, so the line
  // stays. This is the common case, and treating it as a contradiction would
  // blank a useful sentence on most reports.
  assert.equal(V.radiusClaimContradicted("North Dallas submarket", 40), false);
  assert.equal(V.radiusClaimContradicted("", 40), false);
  assert.equal(V.radiusClaimContradicted(null, 40), false);
  // No measurement (nothing geocoded) leaves the model's claim alone.
  assert.equal(V.radiusClaimContradicted("about 5 miles", null), false);
  assert.equal(V.radiusClaimContradicted("about 5 miles", 0), false);
  assert.equal(V.radiusClaimContradicted("about 5 miles", NaN), false);
});

test("priceTierFactor floors a 2x $/SF miss and leaves a 1.2x peer full weight", () => {
  assert.equal(V.priceTierFactor(500, 500), 1);
  assert.equal(V.priceTierFactor(600, 500), 1);
  assert.equal(V.priceTierFactor(250, 500), 0.15);
  assert.equal(V.priceTierFactor(250, 0), 1);
});

test("a $2M house among cheaper sales inside a 2.5-mile market note recovers via price tier", () => {
  // Owner typed "2.5 miles" as the market note. All 19 comps sit inside that
  // circle, so distance cannot separate them. 4 true comps at $500/SF and
  // 15 cheaper houses at $250/SF — without the asking $/SF the IQR sits at
  // $1M; with it the cheap majority floors and the headline follows the $2M
  // product.
  const peers = Array.from({ length: 4 }, (_, i) =>
    comp({ address: i + " Peer St", price_per_sqft: "500", size_sqft: "4000", distance_mi: 2.3 }));
  const cheap = Array.from({ length: 15 }, (_, i) =>
    comp({ address: i + " Cheap Rd", price_per_sqft: "250", size_sqft: "4000", distance_mi: 2.4 }));
  const mixed = peers.concat(cheap);
  const withAsk = V.valueFromComps(mixed, {
    subjectSF: 4000, asOf: AS_OF, trendPct: null,
    propertyType: "Residential", radiusMiles: 2.5, subjectPsf: 500,
  });
  const noAsk = V.valueFromComps(mixed, {
    subjectSF: 4000, asOf: AS_OF, trendPct: null,
    propertyType: "Residential", radiusMiles: 2.5,
  });
  assert.ok(withAsk.psfMid > 400, "asking $/SF should recover the $2M tier, got " + withAsk.psfMid);
  assert.ok(noAsk.psfMid < 350, "without an ask, 2.5-mile cheaper comps still win, got " + noAsk.psfMid);
  assert.equal(V.compWeight(cheap[0], AS_OF, 4000, null, {
    propertyType: "Residential", radiusMiles: 2.5, subjectPsf: 500,
  }), 0.15);
  assert.equal(V.compWeight(peers[0], AS_OF, 4000, null, {
    propertyType: "Residential", radiusMiles: 2.5, subjectPsf: 500,
  }), 1);
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

// ---------------------------------------------------------------------------
// conditionSpread — the spread the six weighting factors can't explain away,
// which on a house is condition and finish. Derived from the report's own
// band on purpose, so these tests pin the derivation, never a constant.
// ---------------------------------------------------------------------------

test("conditionSpread reports the band in $/SF and as a dollar swing", () => {
  const band = { low: 412, mid: 450, high: 487, trimmed: true };
  const c = V.conditionSpread(band, 2450);
  assert.equal(c.psfLow, 412);
  assert.equal(c.psfHigh, 487);
  // (487 - 412) / 450 — the same ratio index.html's spreadPhrase reads.
  assert.equal(c.pct, 17);
  // (487 - 412) * 2450 = 183,750, heroRound'd to the nearest 5,000.
  assert.equal(c.swing, 185000);
});

test("conditionSpread stays quiet below the outlier trim", () => {
  // trimmed:false means fewer than 4 sale comps, so low/high are the literal
  // min and max of a tiny sample: that measures scatter, not what the market
  // pays for condition. smallNNote already speaks for this case.
  assert.equal(V.conditionSpread({ low: 412, mid: 450, high: 487, trimmed: false }, 2450), null);
  assert.equal(V.conditionSpread(null, 2450), null);
});

test("conditionSpread still answers in $/SF with no subject size", () => {
  const c = V.conditionSpread({ low: 400, mid: 500, high: 600, trimmed: true }, 0);
  assert.equal(c.psfLow, 400);
  assert.equal(c.psfHigh, 600);
  assert.equal(c.pct, 40);
  // No size, no swing — never a swing computed off a guessed size.
  assert.equal(c.swing, undefined);
});

test("conditionSpread refuses an inverted or zero band", () => {
  assert.equal(V.conditionSpread({ low: 600, mid: 500, high: 400, trimmed: true }, 2450), null);
  assert.equal(V.conditionSpread({ low: 0, mid: 500, high: 600, trimmed: true }, 2450), null);
});

// ---------------------------------------------------------------------------
// unexplainedGain — the part of a subject's gain since its own last sale that
// the market's drift does not account for. The closest honest answer to "how
// much was spent on the renovation" without permit data.
// ---------------------------------------------------------------------------

const GAIN_AS_OF = Date.parse("2026-08-16");

test("unexplainedGain separates market drift from the rest of the gain", () => {
  // $400k in June 2021, +6%/yr, asking $700k today. 5.21 years of drift
  // explains roughly $542k of it; the remainder is what the market did not
  // hand over.
  const g = V.unexplainedGain({
    lastPrice: 400000, lastDate: "2021-06-01",
    askPrice: 700000, trendPct: 6, asOf: GAIN_AS_OF,
  });
  assert.equal(g.expected, 540000);
  // Derived from the ROUNDED expected, so the two figures reconcile against
  // the ask exactly on screen rather than drifting a rounding step apart.
  assert.equal(g.expected + g.unexplained, 700000);
  assert.equal(g.unexplained, 160000);
  assert.equal(g.pct, 30);
  assert.equal(g.years, 5.2);
});

test("unexplainedGain stays silent without a market trend", () => {
  // report-parse.js normalizes annual_price_trend_pct to null unless it is a
  // nonzero number within +/-30. With no drift model, reading it as flat would
  // report every appreciating market as a renovation.
  const args = { lastPrice: 400000, lastDate: "2021-06-01", askPrice: 700000, asOf: GAIN_AS_OF };
  assert.equal(V.unexplainedGain({ ...args, trendPct: null }), null);
  assert.equal(V.unexplainedGain({ ...args, trendPct: 0 }), null);
  assert.equal(V.unexplainedGain({ ...args, trendPct: 45 }), null);
});

test("unexplainedGain only speaks in the ABOVE direction", () => {
  // Asking LESS than drift explains has unknowable causes — distress, a
  // divorce, deferred maintenance, an overpriced original purchase — and this
  // report cannot defend naming any of them about a specific home.
  assert.equal(V.unexplainedGain({
    lastPrice: 600000, lastDate: "2023-06-01",
    askPrice: 560000, trendPct: 6, asOf: GAIN_AS_OF,
  }), null);
});

test("unexplainedGain holds to the same 25% bar as askFit and outlierOf", () => {
  // Drift alone takes $400k to ~$540k. An ask inside 25% of that is not a
  // gap worth naming, and must not disagree with the report's other two
  // users of OUTLIER_PCT.
  assert.equal(V.unexplainedGain({
    lastPrice: 400000, lastDate: "2021-06-01",
    askPrice: 620000, trendPct: 6, asOf: GAIN_AS_OF,
  }), null);
  assert.ok(V.unexplainedGain({
    lastPrice: 400000, lastDate: "2021-06-01",
    askPrice: 700000, trendPct: 6, asOf: GAIN_AS_OF,
  }));
});

test("unexplainedGain is bounded to a decade back and a quarter forward", () => {
  const args = { lastPrice: 200000, askPrice: 900000, trendPct: 6, asOf: GAIN_AS_OF };
  // 30 years of one current annual rate is fiction, not a renovation signal.
  assert.equal(V.unexplainedGain({ ...args, lastDate: "1996-06-01" }), null);
  // A same-month relist divides by noise.
  assert.equal(V.unexplainedGain({ ...args, lastDate: "2026-08-01" }), null);
  // A classic buy-renovate-list flip is inside the window and must speak.
  assert.ok(V.unexplainedGain({ ...args, lastDate: "2025-02-01" }));
});

test("unexplainedGain refuses missing or unparseable inputs", () => {
  const args = { lastPrice: 400000, lastDate: "2021-06-01", askPrice: 700000, trendPct: 6, asOf: GAIN_AS_OF };
  assert.equal(V.unexplainedGain({ ...args, lastPrice: NaN }), null);
  assert.equal(V.unexplainedGain({ ...args, lastPrice: 0 }), null);
  assert.equal(V.unexplainedGain({ ...args, askPrice: 0 }), null);
  assert.equal(V.unexplainedGain({ ...args, lastDate: "last spring" }), null);
  assert.equal(V.unexplainedGain({ ...args, lastDate: "" }), null);
  assert.equal(V.unexplainedGain({ ...args, lastDate: null }), null);
  assert.equal(V.unexplainedGain(), null);
});

test("unexplainedGain refuses prose Date.parse would coerce to January", () => {
  // V8 answers Date.parse("sometime in 2021") with 2021-01-01, not NaN, so
  // without the year-shape guard free text becomes a January anchor under a
  // dollar figure nobody could check.
  const args = { lastPrice: 400000, askPrice: 700000, trendPct: 6, asOf: GAIN_AS_OF };
  ["sometime in 2021", "Sometime 2021", "Q2 2021", "2021", "last spring", "6/2021"]
    .forEach((d) => assert.equal(V.unexplainedGain({ ...args, lastDate: d }), null, d));
  // The forms the model actually writes all still work, and all land on the
  // same June 2021 anchor.
  ["2021-06-01", "2021-06", "2021/06/01", "June 2021", "june 2021", "Jun 1, 2021", "6/1/2021", "1 June 2021"]
    .forEach((d) => assert.ok(V.unexplainedGain({ ...args, lastDate: d }), d));
});

// ---------------------------------------------------------------------------
// conditionFit — where the subject sits in the condition spread its comps
// show, once the owner has stated their own. Guidance about which half of the
// existing band to read, never a change to the band.
// ---------------------------------------------------------------------------

function condComp(condition, over) {
  return Object.assign(comp({ condition }), over || {});
}

test("conditionFit points at the upper half when the comps are less updated", () => {
  const fit = V.conditionFit("Renovated", [
    condComp("Original"), condComp("Original"), condComp("Needs work"), condComp("Updated"),
  ]);
  assert.equal(fit.dir, "above");
  assert.equal(fit.rated, 4);
  assert.equal(fit.below, 4);
  assert.equal(fit.subject, "Renovated");
});

test("conditionFit points at the lower half when the comps are more updated", () => {
  const fit = V.conditionFit("Needs work", [
    condComp("Renovated"), condComp("Updated"), condComp("Renovated"),
  ]);
  assert.equal(fit.dir, "below");
  assert.equal(fit.above, 3);
});

test("conditionFit says inline when the subject sits among its comps", () => {
  // The caller prints nothing for this. A sentence reporting no difference is
  // exactly what took the trust line to 1,034 characters.
  const fit = V.conditionFit("Updated", [
    condComp("Renovated"), condComp("Original"), condComp("Updated"), condComp("Needs work"),
  ]);
  assert.equal(fit.dir, "inline");
});

test("conditionFit needs three rated comps before it claims a direction", () => {
  assert.equal(V.conditionFit("Renovated", [condComp("Original"), condComp("Original")]), null);
  // Unrated comps don't count toward the floor — three comps, one rated.
  assert.equal(V.conditionFit("Renovated", [
    condComp("Original"), condComp(""), condComp("not a condition"),
  ]), null);
  assert.ok(V.conditionFit("Renovated", [
    condComp("Original"), condComp("Original"), condComp("Original"),
  ]));
});

test("conditionFit ignores leases and an unstated subject", () => {
  // The band it is annotating is sales-only, so its evidence must be too.
  assert.equal(V.conditionFit("Renovated", [
    condComp("Original", { transaction: "Lease" }),
    condComp("Original", { transaction: "Lease" }),
    condComp("Original", { transaction: "Lease" }),
  ]), null);
  const comps = [condComp("Original"), condComp("Original"), condComp("Original")];
  assert.equal(V.conditionFit("", comps), null);
  assert.equal(V.conditionFit(undefined, comps), null);
  // A word outside the vocabulary is not a rank — never a silent "Original".
  assert.equal(V.conditionFit("Fully renovated", comps), null);
});

test("conditionFit's vocabulary matches report-parse's, in rank order", () => {
  // A word here the parser drops to "" would be a rank nothing can reach.
  const RP = require("../report-parse");
  assert.deepEqual(Object.keys(V.CONDITION_RANK), RP.CONDITION_VALUES);
  RP.CONDITION_VALUES.forEach((v) => assert.equal(RP.normalizeConditionValue(v), v));
});

test("conditionFit is not fooled by inherited Object properties", () => {
  // CONDITION_RANK["toString"] is a FUNCTION on a plain object literal, and a
  // function passes an `== null` guard. Before rankOf, this returned
  // dir "below" and the trust line would have stated confidently that three
  // comps were more updated than a house whose condition was "constructor".
  const junk = ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"];
  const comps = junk.map((c) => comp({ condition: c }));
  junk.forEach((v) => assert.equal(V.conditionFit(v, comps), null, v));
  // Real subject, junk comps: the comps must not count as rated.
  assert.equal(V.conditionFit("Renovated", comps), null);
});

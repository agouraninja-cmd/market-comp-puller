// Comp size band — the rule that a comp has to be roughly the subject's size.
//
// Run: npm test
//
// The promises under test: the default really is ±30%, the setting can widen
// it or turn it off, a comp with no stated size is never thrown away for it,
// and every removal is counted so the report can disclose it.

const test = require("node:test");
const assert = require("node:assert");

const SB = require("../size-band");

function comp(sqft, over = {}) {
  return {
    address: "100 Main St, Dallas, TX",
    date: "Jan 2026",
    transaction: "Sale",
    size_sqft: sqft,
    price_or_rate: "$7,000,000",
    source_type: "public_record",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// normalizeTolerancePct — absent, off, and a number are three different things
// ---------------------------------------------------------------------------

test("an absent tolerance takes the 30% default", () => {
  assert.equal(SB.DEFAULT_TOLERANCE_PCT, 30);
  for (const v of [undefined, null, ""]) {
    assert.equal(SB.normalizeTolerancePct(v), 30);
  }
});

test("off is a real setting, not a missing one", () => {
  for (const v of ["off", "Off", " any ", "none", "all", 0, "0", false]) {
    assert.equal(SB.normalizeTolerancePct(v), null, `expected ${JSON.stringify(v)} to mean no band`);
  }
});

test("a number is taken, clamped at both ends", () => {
  assert.equal(SB.normalizeTolerancePct(15), 15);
  assert.equal(SB.normalizeTolerancePct("50"), 50);
  assert.equal(SB.normalizeTolerancePct(12.55), 12.6);
  assert.equal(SB.normalizeTolerancePct(9000), SB.MAX_TOLERANCE_PCT);
  assert.equal(SB.normalizeTolerancePct(0.2), SB.MIN_TOLERANCE_PCT);
});

test("an unreadable tolerance falls back rather than refusing a report", () => {
  assert.equal(SB.normalizeTolerancePct("wide-ish"), 30);
  assert.equal(SB.normalizeTolerancePct({}), 30);
  assert.equal(SB.normalizeTolerancePct(NaN), 30);
});

test("the fallback is a parameter, so a caller can default to off", () => {
  assert.equal(SB.normalizeTolerancePct(undefined, null), null);
});

// ---------------------------------------------------------------------------
// sizeBandFor
// ---------------------------------------------------------------------------

test("±30% of 25,000 SF is 17,500 to 32,500", () => {
  assert.deepEqual(SB.sizeBandFor(25000, 30), { pct: 30, min: 17500, max: 32500 });
});

test("no subject size means no band — it falls open", () => {
  assert.equal(SB.sizeBandFor(0, 30), null);
  assert.equal(SB.sizeBandFor(null, 30), null);
  assert.equal(SB.sizeBandFor("", 30), null);
});

test("no tolerance means no band", () => {
  assert.equal(SB.sizeBandFor(25000, null), null);
  assert.equal(SB.sizeBandFor(25000, 0), null);
});

test("a tolerance at or past 100% still leaves a positive floor", () => {
  const band = SB.sizeBandFor(10000, 200);
  assert.ok(band.min > 0, "a 200% band must not put the floor at or below zero");
  assert.equal(band.max, 30000);
});

// ---------------------------------------------------------------------------
// fitsSizeBand
// ---------------------------------------------------------------------------

test("the band's own edges are inside it", () => {
  const band = SB.sizeBandFor(25000, 30);
  assert.equal(SB.fitsSizeBand(comp("17,500"), band), true);
  assert.equal(SB.fitsSizeBand(comp("32,500"), band), true);
  assert.equal(SB.fitsSizeBand(comp("17,499"), band), false);
  assert.equal(SB.fitsSizeBand(comp("32,501"), band), false);
});

test("a comp with no stated size is kept, never judged out", () => {
  const band = SB.sizeBandFor(25000, 30);
  for (const v of [undefined, null, "", "n/a", 0, "0"]) {
    assert.equal(SB.fitsSizeBand(comp(v), band), true, `expected size ${JSON.stringify(v)} to be kept`);
  }
});

test("sizes are read the way the rest of the app reads them", () => {
  const band = SB.sizeBandFor(25000, 30);
  assert.equal(SB.fitsSizeBand(comp("28,400 SF"), band), true);
  assert.equal(SB.fitsSizeBand(comp("120,000 SF"), band), false);
});

test("no band keeps everything", () => {
  assert.equal(SB.fitsSizeBand(comp("500,000"), null), true);
});

// ---------------------------------------------------------------------------
// applySizeBand
// ---------------------------------------------------------------------------

const report = (comps) => ({ summary: "A market.", avg_price_per_sqft: "$140", comps });

test("out-of-band comps are removed and counted", () => {
  const band = SB.sizeBandFor(25000, 30);
  const out = SB.applySizeBand(report([
    comp("24,000"), comp("120,000"), comp("30,000"), comp("4,000"),
  ]), band);
  assert.deepEqual(out.comps.map((c) => c.size_sqft), ["24,000", "30,000"]);
  assert.equal(out.size_filtered_count, 2);
  assert.deepEqual(out.size_band, { pct: 30, min: 17500, max: 32500 });
});

test("a band that removes nothing still discloses itself", () => {
  const band = SB.sizeBandFor(25000, 30);
  const out = SB.applySizeBand(report([comp("24,000")]), band);
  assert.equal(out.size_filtered_count, 0);
  assert.deepEqual(out.size_band, { pct: 30, min: 17500, max: 32500 });
});

test("the source report is never mutated — it may be the cached object", () => {
  const band = SB.sizeBandFor(25000, 30);
  const src = report([comp("24,000"), comp("120,000")]);
  const out = SB.applySizeBand(src, band);
  assert.equal(src.comps.length, 2, "the cached report kept every comp");
  assert.equal(out.comps.length, 1);
  assert.equal(src.size_band, undefined);
});

test("with the band off the report comes back untouched", () => {
  const src = report([comp("500,000")]);
  assert.equal(SB.applySizeBand(src, null), src);
});

test("a report with no comps array survives", () => {
  const band = SB.sizeBandFor(25000, 30);
  assert.deepEqual(SB.applySizeBand({ summary: "x" }, band).comps, []);
  assert.equal(SB.applySizeBand(null, band), null);
});

// ---------------------------------------------------------------------------
// splitBySizeBand / describeSizeBand
// ---------------------------------------------------------------------------

test("splitting keeps both halves, so a caller can count what it lost", () => {
  const band = SB.sizeBandFor(10000, 30);
  const { kept, dropped } = SB.splitBySizeBand([comp("9,000"), comp("50,000")], band);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 1);
});

test("splitting with no band keeps the list as it was", () => {
  const rows = [comp("50,000")];
  assert.equal(SB.splitBySizeBand(rows, null).kept, rows);
});

test("the band describes itself in the units a person reads", () => {
  assert.equal(SB.describeSizeBand(SB.sizeBandFor(25000, 30)), "17,500-32,500 SF");
  assert.equal(SB.describeSizeBand(null), "");
});

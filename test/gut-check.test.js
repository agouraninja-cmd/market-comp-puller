// The gut check's decision table — every rule the /vault panel renders.
// Pure like valuation.js: no DB, no DOM, no clock. The dual export is what
// lets the browser and this suite run ONE copy of the rules.

const test = require("node:test");
const assert = require("node:assert");

const GC = require("../gut-check");

// A minimal parseDealDate for tests: "YYYY-MM(-DD)" -> fractional year.
function parseDealDate(s) {
  const m = String(s || "").match(/^((?:19|20)\d{2})-(\d{2})/);
  return m ? Number(m[1]) + (Number(m[2]) - 0.5) / 12 : null;
}

function corpusRow(o) {
  return Object.assign({
    address: "100 Elm St, Boise, ID", transaction: "sale",
    deal_date: "2026-03-14", price_per_sqft: "150", cap_rate: "",
    source_type: "public_record",
  }, o);
}
function vaultComp(o) {
  return Object.assign({
    id: "c1", market: "Boise, ID", property_type: "Industrial",
    transaction: "sale", price_per_sqft: 150, cap_rate: null,
  }, o);
}
function bench(o) {
  return Object.assign({ market: "Boise, ID", type: "Industrial",
    corpus: null, snapshot: null }, o);
}
const CORPUS_OK = { count: 6, median_ppsf: 150, q1_ppsf: 120, q3_ppsf: 180,
  newest_deal_date: "2026-03-14", cap_rate_median: null, cap_rate_count: 0 };
const SNAP_OK = { ppsf: { median: 145, low: 125, high: 170, count: 8 },
  cap_rate_low: "5.5%", cap_rate_high: "6.5%", market_trend: "", generatedAt: "2026-08-01" };

// --- corpusStats -----------------------------------------------------------

test("corpusStats: quartiles over usable sale rows only", () => {
  // Distinct addresses: same-building dedupe (below) must not collapse four
  // genuinely different comps into one.
  const rows = [
    corpusRow({ address: "100 Elm St, Boise, ID", price_per_sqft: "100" }),
    corpusRow({ address: "200 Oak St, Boise, ID", price_per_sqft: "120" }),
    corpusRow({ address: "300 Pine St, Boise, ID", price_per_sqft: "140" }),
    corpusRow({ address: "400 Cedar St, Boise, ID", price_per_sqft: "160" }),
    corpusRow({ address: "500 Birch St, Boise, ID", price_per_sqft: "200", transaction: "lease" }),   // lease: out
    corpusRow({ address: "600 Fir St, Boise, ID", price_per_sqft: "999", source_type: "estimate" }),// provenance: out
    corpusRow({ address: "700 Ash St, Boise, ID", price_per_sqft: "998", source_type: "news" }),    // provenance: out
    corpusRow({ address: "800 Maple St, Boise, ID", price_per_sqft: "" }),                            // unpriced: out
  ];
  const s = GC.corpusStats(rows, { parseDealDate });
  assert.equal(s.count, 4);
  assert.equal(s.median_ppsf, 130);
  assert.ok(s.q1_ppsf >= 100 && s.q1_ppsf <= 120);
  assert.ok(s.q3_ppsf >= 140 && s.q3_ppsf <= 160);
});

test("corpusStats: same building harvested under four address spellings dedupes to one, below the band floor", () => {
  const rows = [
    corpusRow({ address: "19127 Red Label Lane, Caldwell, ID 83607", price_per_sqft: "150", deal_date: "2026-01-01" }),
    corpusRow({ address: "19127 Red Label Ln, Caldwell, ID 83605", price_per_sqft: "152", deal_date: "2026-02-01" }),
    corpusRow({ address: "19127 RED LABEL LANE, Caldwell, ID 83607", price_per_sqft: "148", deal_date: "2026-03-01" }),
    corpusRow({ address: "19127 red label ln., Caldwell, ID", price_per_sqft: "151", deal_date: "2025-12-01" }),
  ];
  const s = GC.corpusStats(rows, { parseDealDate });
  assert.equal(s.count, 1, "four spellings of one building fold to one row");
  assert.equal(s.median_ppsf, 148, "the surviving row is the newest-dated copy (2026-03-01)");
  // count 1 is below MIN_CORPUS_PPSF (4), so it cannot contribute to the band
  // even though a naive q1-q3 over four near-identical prices would look
  // confidently tight.
  const r = GC.gutCheck([vaultComp({ price_per_sqft: 150 })], [bench({ corpus: s })]);
  assert.equal(r.buckets[0].verdict, "no_data");
  assert.equal(r.buckets[0].band, null);
});

test("corpusStats: rows with no address are kept separately, never merged into one bucket", () => {
  const rows = [
    corpusRow({ address: "", price_per_sqft: "100" }),
    corpusRow({ address: "", price_per_sqft: "120" }),
    corpusRow({ address: "", price_per_sqft: "140" }),
    corpusRow({ address: "", price_per_sqft: "160" }),
  ];
  const s = GC.corpusStats(rows, { parseDealDate });
  assert.equal(s.count, 4, "empty-address rows must not be folded together");
});

test("corpusStats: newest_deal_date is the raw string of the newest parseable date", () => {
  const s = GC.corpusStats([
    corpusRow({ deal_date: "2025-11-01", price_per_sqft: "100" }),
    corpusRow({ deal_date: "2026-03-14", price_per_sqft: "120" }),
    corpusRow({ deal_date: "garbage", price_per_sqft: "140" }),
  ], { parseDealDate });
  assert.equal(s.newest_deal_date, "2026-03-14");
});

test("corpusStats: cap-rate median needs 3 parseable values, skips junk", () => {
  // Distinct addresses: same-building dedupe must not collapse these three
  // otherwise-identical rows (same default address/date) into one.
  const two = GC.corpusStats([
    corpusRow({ address: "1 First St, Boise, ID", cap_rate: "5.5%" }),
    corpusRow({ address: "2 Second St, Boise, ID", cap_rate: "6.5%" }),
    corpusRow({ address: "3 Third St, Boise, ID", cap_rate: "n/a" }),
  ], { parseDealDate });
  assert.equal(two.cap_rate_median, null);
  assert.equal(two.cap_rate_count, 2);
  const three = GC.corpusStats([
    corpusRow({ address: "1 First St, Boise, ID", cap_rate: "5.5%" }),
    corpusRow({ address: "2 Second St, Boise, ID", cap_rate: "6.0%" }),
    corpusRow({ address: "3 Third St, Boise, ID", cap_rate: "6.5%" }),
  ], { parseDealDate });
  assert.equal(three.cap_rate_median, 6);
  assert.equal(three.cap_rate_count, 3);
});

test("corpusStats: null when nothing is usable at all", () => {
  assert.equal(GC.corpusStats([], { parseDealDate }), null);
  assert.equal(GC.corpusStats([corpusRow({ price_per_sqft: "", cap_rate: "" })],
    { parseDealDate }), null);
  assert.equal(GC.corpusStats(null, { parseDealDate }), null);
});

// --- gutCheck: verdicts ----------------------------------------------------

test("in line: broker median inside the union band", () => {
  const r = GC.gutCheck(
    [vaultComp({ price_per_sqft: 150 })],
    [bench({ corpus: CORPUS_OK, snapshot: SNAP_OK })]);
  assert.equal(r.buckets.length, 1);
  assert.equal(r.buckets[0].verdict, "in_line");
  assert.equal(r.buckets[0].delta_pct, null);
  // union of corpus 120-180 and snapshot 125-170
  assert.equal(r.buckets[0].band.low, 120);
  assert.equal(r.buckets[0].band.high, 180);
});

test("above market: outside the band, delta from the nearest edge", () => {
  const r = GC.gutCheck(
    [vaultComp({ price_per_sqft: 225 })],
    [bench({ corpus: CORPUS_OK })]);           // band 120-180
  assert.equal(r.buckets[0].verdict, "above");
  assert.equal(r.buckets[0].delta_pct, 25);    // (225-180)/180
});

test("below market: negative delta", () => {
  const r = GC.gutCheck(
    [vaultComp({ price_per_sqft: 90 })],
    [bench({ corpus: CORPUS_OK })]);           // band 120-180
  assert.equal(r.buckets[0].verdict, "below");
  assert.equal(r.buckets[0].delta_pct, -25);   // (120-90)/120
});

test("a delta that rounds to 0% never renders as above/below", () => {
  const tightBand = { count: 6, median_ppsf: 100, q1_ppsf: 100, q3_ppsf: 100,
    newest_deal_date: "2026-03-14", cap_rate_median: null, cap_rate_count: 0 };
  // 100.4 is technically over a band topping out at 100, but (0.4/100)*100
  // rounds to 0 -- the contradiction "above * 0%" must collapse to in_line.
  const r = GC.gutCheck(
    [vaultComp({ price_per_sqft: 100.4 })],
    [bench({ corpus: tightBand })]);
  assert.equal(r.buckets[0].verdict, "in_line");
  assert.equal(r.buckets[0].delta_pct, null);
});

test("thin corpus (count < 4) does not count toward the band", () => {
  const thin = Object.assign({}, CORPUS_OK, { count: 3 });
  const r = GC.gutCheck([vaultComp({})], [bench({ corpus: thin })]);
  assert.equal(r.buckets[0].verdict, "no_data");
  assert.equal(r.buckets[0].band, null);
  // ...but the same thin corpus WITH a snapshot still gets the snapshot band.
  const r2 = GC.gutCheck([vaultComp({ price_per_sqft: 150 })],
    [bench({ corpus: thin, snapshot: SNAP_OK })]);
  assert.equal(r2.buckets[0].verdict, "in_line");
  assert.equal(r2.buckets[0].band.low, 125);
  assert.equal(r2.buckets[0].band.high, 170);
});

test("no benchmark at all -> no_data, and no outliers can fire", () => {
  const r = GC.gutCheck([vaultComp({ price_per_sqft: 9999 })], []);
  assert.equal(r.buckets[0].verdict, "no_data");
  assert.deepEqual(r.buckets[0].outlierIds, []);
  assert.deepEqual(r.outliers, {});
});

test("a bucket with no priced sales gets no card at all", () => {
  const r = GC.gutCheck(
    [vaultComp({ transaction: "lease", price_per_sqft: null }),
     vaultComp({ id: "c2", price_per_sqft: null })],
    [bench({ corpus: CORPUS_OK })]);
  assert.equal(r.buckets.length, 0);
});

test("buckets sort by priced-sale count, descending", () => {
  const r = GC.gutCheck([
    vaultComp({ id: "a1", market: "Meridian, ID" }),
    vaultComp({ id: "b1", market: "Boise, ID" }),
    vaultComp({ id: "b2", market: "Boise, ID" }),
  ], []);
  assert.equal(r.buckets[0].market, "Boise, ID");
  assert.equal(r.buckets[1].market, "Meridian, ID");
});

// --- gutCheck: outliers ----------------------------------------------------

test("outlier: a sale more than 25% outside the band is flagged; leases never", () => {
  const r = GC.gutCheck([
    vaultComp({ id: "hot", price_per_sqft: 230 }),   // 180*1.25=225 -> flagged
    vaultComp({ id: "warm", price_per_sqft: 220 }),  // above band, inside 25% -> not
    vaultComp({ id: "cold", price_per_sqft: 80 }),   // 120*0.75=90 -> flagged
    vaultComp({ id: "lease", transaction: "lease", price_per_sqft: null }),
  ], [bench({ corpus: CORPUS_OK })]);
  assert.deepEqual(Object.keys(r.outliers).sort(), ["cold", "hot"]);
  assert.equal(r.outliers.hot.dir, "above");
  assert.ok(r.outliers.hot.pct >= 27 && r.outliers.hot.pct <= 28);
  assert.equal(r.outliers.cold.dir, "below");
  assert.deepEqual(r.buckets[0].outlierIds.sort(), ["cold", "hot"]);
});

// --- gutCheck: cap rates ---------------------------------------------------

test("cap verdict: needs 2 broker cap comps and a snapshot range", () => {
  const one = GC.gutCheck([vaultComp({ cap_rate: 6.0 })],
    [bench({ snapshot: SNAP_OK })]);
  assert.equal(one.buckets[0].cap, null);
  const two = GC.gutCheck([
    vaultComp({ cap_rate: 5.8 }), vaultComp({ id: "c2", cap_rate: 6.2 }),
  ], [bench({ snapshot: SNAP_OK, corpus: Object.assign({}, CORPUS_OK, { cap_rate_median: 6.1, cap_rate_count: 4 }) })]);
  assert.ok(two.buckets[0].cap);
  assert.equal(two.buckets[0].cap.verdict, "in_line");     // 6.0 in 5.5-6.5
  assert.equal(two.buckets[0].cap.median, 6);
  assert.equal(two.buckets[0].cap.corpus_median, 6.1);
});

test("cap verdict: no snapshot range means no cap verdict, corpus median alone is not a band", () => {
  const r = GC.gutCheck([
    vaultComp({ cap_rate: 5.8 }), vaultComp({ id: "c2", cap_rate: 6.2 }),
  ], [bench({ corpus: Object.assign({}, CORPUS_OK, { cap_rate_median: 6.1, cap_rate_count: 4 }) })]);
  assert.equal(r.buckets[0].cap, null);
});

test("cap verdict: an UNPRICED sale's cap rate still counts", () => {
  // Brokers track undisclosed-price deals, and a sale with no entered price
  // can still carry a real cap rate. Only the $/SF median needs a price; the
  // cap aggregate needs a sale — same filter corpusStats' cap side uses.
  const r = GC.gutCheck([
    vaultComp({ cap_rate: 5.8 }),                                        // priced sale
    vaultComp({ id: "c2", price_per_sqft: null, cap_rate: 6.2 }),        // unpriced sale
  ], [bench({ snapshot: SNAP_OK })]);
  assert.ok(r.buckets[0].cap, "two sale cap rates must clear the broker floor");
  assert.equal(r.buckets[0].cap.count, 2, "the unpriced sale's cap rate must count");
  assert.equal(r.buckets[0].cap.median, 6);
  assert.equal(r.buckets[0].broker.pricedSales, 1, "the $/SF side still counts priced sales only");
});

test("the exported floors and threshold hold their specced values", () => {
  assert.equal(GC.MIN_CORPUS_PPSF, 4);
  assert.equal(GC.MIN_CORPUS_CAP, 3);
  assert.equal(GC.MIN_BROKER_CAP, 2);
  assert.equal(GC.OUTLIER_PCT, 0.25);
});

test("cap verdict: a lease's cap rate is ignored, sale-only like the corpus side", () => {
  const r = GC.gutCheck([
    vaultComp({ cap_rate: 5.8 }),
    vaultComp({ id: "c2", cap_rate: 6.2 }),
    // priced, so it would otherwise widen the bucket -- excluded purely for
    // being a lease, matching corpusStats' sale-only cap aggregate.
    vaultComp({ id: "c3", transaction: "lease", price_per_sqft: 500, cap_rate: 9.9 }),
  ], [bench({ snapshot: SNAP_OK })]);
  assert.ok(r.buckets[0].cap);
  assert.equal(r.buckets[0].cap.count, 2, "the lease's cap rate must not count toward the median");
  assert.equal(r.buckets[0].cap.median, 6);
});

// --- malformed input never throws ------------------------------------------

test("malformed input degrades, never throws", () => {
  assert.doesNotThrow(() => GC.gutCheck(null, null));
  assert.doesNotThrow(() => GC.gutCheck([{}], [{}]));
  assert.doesNotThrow(() => GC.gutCheck(
    [vaultComp({ price_per_sqft: "not a number" })],
    [bench({ corpus: { count: "x" }, snapshot: { ppsf: {} } })]));
  const r = GC.gutCheck([vaultComp({ price_per_sqft: "x" })], []);
  assert.equal(r.buckets.length, 0);   // unparseable price = not a priced sale
});

// --- the dual export -------------------------------------------------------

test("the module also installs a browser global", () => {
  // Simulate a browser: no module/exports in scope, a bare root object.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "gut-check.js"), "utf8");
  const root = {};
  new Function("self", src)(root);
  assert.ok(root.GUTCHECK, "browser load must define GUTCHECK on the root");
  assert.equal(typeof root.GUTCHECK.gutCheck, "function");
  assert.equal(typeof root.GUTCHECK.corpusStats, "function");
});

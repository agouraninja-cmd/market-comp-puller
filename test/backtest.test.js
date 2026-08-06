// Hold-one-out accuracy scoring over the comp corpus.
//
// Run: npm test
//
// Nothing here touches a database. Fixtures are built so the arithmetic is
// exact: peers share a deal date and a size, which makes their weights equal
// and the quartiles independent of the weighting.

const test = require("node:test");
const assert = require("node:assert");

const BT = require("../backtest");

// The real parseDealDate from server.js, in the two forms these fixtures use.
// Returns a decimal year, or null. Kept deliberately small: the point is to
// inject the same CONTRACT the server injects, not to re-test that parser.
function parseDealDate(s) {
  const m = String(s || "").trim().match(/^((19|20)\d{2})-(\d{2})$/);
  if (!m) return null;
  const mo = Number(m[3]);
  return mo >= 1 && mo <= 12 ? Number(m[1]) + (mo - 0.5) / 12 : null;
}

function row(over) {
  return Object.assign({
    market: "Boise, ID",
    property_type: "Industrial",
    address: "100 Main St, Boise, ID",
    transaction: "Sale",
    deal_date: "2026-01",
    size_sqft: "10000",
    price_or_rate: "$1,000,000",
    price_per_sqft: "100",
    source_type: "public_record",
  }, over || {});
}

// Four peers at 100/200/300/400 dated 2026-01, and one subject at 250 dated
// 2026-06. With minPeers 4 the peers cannot score each other (each sees only
// three), so exactly one subject scores and its numbers are hand-checkable:
// equal weights -> quartiles 150 / 250 / 350 against an actual of 250.
function fixture() {
  return [
    row({ address: "1 A St", price_per_sqft: "100" }),
    row({ address: "2 A St", price_per_sqft: "200" }),
    row({ address: "3 A St", price_per_sqft: "300" }),
    row({ address: "4 A St", price_per_sqft: "400" }),
    row({ address: "9 Subject Way", deal_date: "2026-06", price_per_sqft: "250" }),
  ];
}

const OPTS = { now: Date.parse("2026-07-01"), parseDealDate, minPeers: 4, minSubjects: 1 };

test("score holds a subject out and grades it against its peers", () => {
  const r = BT.score(fixture(), OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.belowFloor, false);
  // Predicted mid 250 against an actual of 250.
  assert.equal(r.medianAbsError, 0);
  // 250 sits inside 150..350.
  assert.equal(r.bandCoverage, 1);
  // (350 - 150) / 250
  assert.ok(Math.abs(r.medianBandWidth - 0.8) < 1e-9, "got " + r.medianBandWidth);
});

test("score skips a subject without enough peers, and says how many", () => {
  const r = BT.score(fixture(), OPTS);
  // The four 2026-01 rows each see only three peers under minPeers 4.
  assert.equal(r.skipped.thinPeers, 4);
});

test("score never uses a peer that sold after the subject", () => {
  const rows = fixture().concat([
    // A wildly-priced later sale. If as-of filtering broke, the prediction
    // would move and medianAbsError would stop being 0.
    row({ address: "99 Later Ave", deal_date: "2026-12", price_per_sqft: "9999",
          source_type: "estimate" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.medianAbsError, 0);
});

test("score DOES use an estimate-tier peer, because production does", () => {
  const rows = fixture().concat([
    row({ address: "98 Earlier Ave", deal_date: "2025-12", price_per_sqft: "9999",
          source_type: "estimate" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  // The outlier is down-weighted, not ignored, so the prediction moves.
  assert.ok(r.medianAbsError > 0, "estimate-tier peer should have moved the prediction");
});

test("score refuses an estimate-tier row as ground truth", () => {
  const rows = fixture().map((r) =>
    r.address === "9 Subject Way" ? Object.assign({}, r, { source_type: "estimate" }) : r);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 0);
  assert.equal(r.skipped.notGroundTruth, 1);
});

test("score excludes a same-address duplicate from its own peer set", () => {
  const rows = fixture().concat([
    // Same building, harvested twice at a different price: must not help
    // value itself.
    row({ address: "9 SUBJECT WAY  ", deal_date: "2026-05", price_per_sqft: "250" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.medianAbsError, 0);
});

test("score never mixes markets or property types", () => {
  const rows = fixture().concat([
    row({ address: "5 A St", market: "Ontario, CA", price_per_sqft: "9999" }),
    row({ address: "6 A St", property_type: "Office", price_per_sqft: "9999" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1);
  assert.equal(r.medianAbsError, 0);
});

test("score drops rows it cannot use at all, and counts them", () => {
  const rows = fixture().concat([
    row({ address: "7 A St", deal_date: "sometime in 2026" }),   // undateable
    row({ address: "8 A St", price_per_sqft: "", price_or_rate: "" }),  // unpriced
    row({ address: "10 A St", transaction: "Lease" }),           // a lease
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.skipped.unusable, 3);
  assert.equal(r.scored, 1);
});

test("score withholds every figure below the subject floor", () => {
  const r = BT.score(fixture(), Object.assign({}, OPTS, { minSubjects: 20 }));
  assert.equal(r.scored, 1);
  assert.equal(r.belowFloor, true);
  assert.equal(r.medianAbsError, null);
  assert.equal(r.bandCoverage, null);
  assert.equal(r.medianBandWidth, null);
  assert.deepEqual(r.byType, []);
});

test("score breaks results out by property type", () => {
  const r = BT.score(fixture(), OPTS);
  assert.equal(r.byType.length, 1);
  assert.equal(r.byType[0].type, "Industrial");
  assert.equal(r.byType[0].scored, 1);
  assert.equal(r.byType[0].medianAbsError, 0);
});

test("score survives an empty corpus without inventing a number", () => {
  const r = BT.score([], OPTS);
  assert.equal(r.scored, 0);
  assert.equal(r.belowFloor, true);
  assert.equal(r.medianAbsError, null);
});

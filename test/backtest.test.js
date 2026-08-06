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
  const merged = Object.assign({
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
  // Keep price_or_rate internally consistent (size x $/SF) whenever the
  // caller varies size_sqft or price_per_sqft without saying otherwise.
  // isSameProperty's belt-and-brace check (backtest.js) compares size_sqft
  // AND price_or_rate; every fixture below used to share the SAME default
  // total price regardless of $/SF, which meant otherwise-unrelated fixture
  // rows collided as "the same property" the moment that check existed. A
  // caller that wants a genuine collision (or an explicitly unpriced row)
  // still overrides price_or_rate directly, which this leaves alone.
  if (!over || !("price_or_rate" in over)) {
    const sz = Number(merged.size_sqft), psf = Number(merged.price_per_sqft);
    if (sz > 0 && psf > 0) merged.price_or_rate = "$" + String(Math.round(sz * psf));
  }
  return merged;
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
  // A differential, not a count: adding a sixth, earlier-dated row can
  // legitimately change WHICH rows clear minPeers (the four Jan peers can
  // now see each other through it too), so asserting r.scored is fixture-
  // specific. What this test actually claims -- that an estimate-tier row
  // is USED as a peer, just down-weighted, rather than excluded outright --
  // is proven by the aggregate prediction moving at all. If the tier bar
  // were wrongly applied to peers, the estimate row would never enter any
  // peer set and this number would be identical to the base run.
  const base = BT.score(fixture(), OPTS);
  const withEstimatePeer = BT.score(fixture().concat([
    row({ address: "98 Earlier Ave", deal_date: "2025-12", price_per_sqft: "9999",
          source_type: "estimate" }),
  ]), OPTS);
  assert.notEqual(withEstimatePeer.medianAbsError, base.medianAbsError);
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

test("a disqualified first copy of a building does not block a scoreable second copy", () => {
  // Same building harvested twice. The FIRST copy in array order is
  // estimate-tier, so it can never be ground truth; the SECOND is
  // public_record with a full peer set. The second copy must still get its
  // turn: claiming the address key on the first ATTEMPT (rather than on a
  // first SUCCESS) would silently and permanently block it, and since
  // corpusRowsForMarket returns newest-harvest-first, that bias would hit
  // whichever harvest happens to be older every time.
  const rows = fixture().slice(0, 4).concat([
    row({ address: "9 Subject Way", deal_date: "2026-06", price_per_sqft: "250",
          source_type: "estimate" }),
    row({ address: "9 SUBJECT WAY  ", deal_date: "2026-06", price_per_sqft: "250" }),
  ]);
  const r = BT.score(rows, OPTS);
  assert.equal(r.skipped.notGroundTruth, 1);
  assert.equal(r.scored, 1);
  assert.equal(r.medianAbsError, 0);
});

// Regression for the 2026-08-06 whole-branch review finding: normAddress
// used to just lowercase and collapse whitespace over the FULL address, so
// a building the model wrote down two different ways across two searches
// keyed as two different properties. The real corpus held exactly this --
// "19127 Red Label Lane, Caldwell, ID 83605" and "19127 Red Label Ln,
// Caldwell, ID 83607" (abbreviated suffix, wrong zip), same size, same
// price -- and the old key let each score as an independent subject valued
// in part from the OTHER's own price, at 0.0% error apiece. This fixture
// fails against that old normAddress; it must pass against the fixed one.
test("a spelling-variant duplicate of the subject cannot peer with or duplicate-score itself", () => {
  const peers = [
    row({ market: "Caldwell, ID", address: "1 Warehouse Row", deal_date: "2026-01", price_per_sqft: "100" }),
    row({ market: "Caldwell, ID", address: "2 Warehouse Row", deal_date: "2026-01", price_per_sqft: "200" }),
    row({ market: "Caldwell, ID", address: "3 Warehouse Row", deal_date: "2026-01", price_per_sqft: "300" }),
    row({ market: "Caldwell, ID", address: "4 Warehouse Row", deal_date: "2026-01", price_per_sqft: "400" }),
  ];
  const variants = [
    row({
      market: "Caldwell, ID", address: "19127 Red Label Lane, Caldwell, ID 83605",
      deal_date: "2026-06", size_sqft: "56000", price_or_rate: "$14,000,000", price_per_sqft: "250",
    }),
    row({
      market: "Caldwell, ID", address: "19127 Red Label Ln, Caldwell, ID 83607",
      deal_date: "2026-06", size_sqft: "56000", price_or_rate: "$14,000,000", price_per_sqft: "250",
    }),
  ];
  const r = BT.score(peers.concat(variants), OPTS);
  // Exactly one spelling variant of the same building may score -- never
  // both, and the one that does must be valued from the four genuine peers
  // only, never in part from its own other spelling.
  assert.equal(r.scored, 1, "only one spelling variant of the same building may score");
  assert.equal(r.medianAbsError, 0, "the scored variant must be valued from the four genuine peers only");
  assert.equal(r.skipped.duplicateAddress, 1, "the second variant must be skipped as a duplicate, not scored independently");
});

test("normAddress keys on the street line and folds common suffixes/directionals", () => {
  assert.equal(
    BT.normAddress("19127 Red Label Lane, Caldwell, ID 83605"),
    BT.normAddress("19127 Red Label Ln, Caldwell, ID 83607"),
    "suffix folding plus dropping everything after the first comma must equate these"
  );
  assert.equal(BT.normAddress("100 North Main Street, Boise, ID"), "100 n main st");
});

test("isSameProperty treats an exact size+price match as the same building even when the key differs", () => {
  const a = { key: "a", row: { size_sqft: "56,000", price_or_rate: "$11,088,000" } };
  const b = { key: "b", row: { size_sqft: "56000", price_or_rate: "$11,088,000" } };
  const c = { key: "c", row: { size_sqft: "56000", price_or_rate: "$11,999,999" } };
  assert.equal(BT.isSameProperty(a, b), true, "same size and price, different key, must still count as the same property");
  assert.equal(BT.isSameProperty(a, c), false, "a different price must not be treated as a coincidence");
});

// Regression for Finding 2 of the same review: `claimed` deduped SUBJECTS,
// but nothing deduped a subject's PEER SET. A building harvested twice (same
// key, two different harvests) entered the weighted band as two separate
// comps and pulled it twice. Built so the fix reproduces an EXACT clean
// prediction: the kept (nearer-date) copy of the duplicated peer completes
// the same 100/200/300/400 quartile the other equal-weight fixtures use, so
// any leftover influence from the un-deduped, wrongly-priced farther copy
// would show up as a nonzero medianAbsError.
test("a peer harvested twice counts once, as its date-nearest copy", () => {
  const rows = [
    row({ market: "Nampa, ID", address: "1 Anchor Row", deal_date: "2026-01", price_per_sqft: "100" }),
    row({ market: "Nampa, ID", address: "2 Anchor Row", deal_date: "2026-01", price_per_sqft: "200" }),
    row({ market: "Nampa, ID", address: "3 Anchor Row", deal_date: "2026-01", price_per_sqft: "400" }),
    // Same building ("5 Dup Row"), harvested twice. The Jan copy is nearer to
    // the subject's June deal date and carries the price that completes the
    // clean quartile; the 2025 copy is farther and wildly mispriced. Only the
    // nearer copy must survive dedup.
    row({ market: "Nampa, ID", address: "5 Dup Row", deal_date: "2026-01", price_per_sqft: "300" }),
    row({ market: "Nampa, ID", address: "5 Dup Row", deal_date: "2025-06", price_per_sqft: "9999" }),
    row({ market: "Nampa, ID", address: "9 Subject Way", deal_date: "2026-06", price_per_sqft: "250" }),
  ];
  const r = BT.score(rows, OPTS);
  assert.equal(r.scored, 1, "only the June subject has enough peers once the duplicate collapses to one row");
  // 100/200/300/400 median 250 against an actual of 250 -- any leftover
  // influence from the un-deduped 9999 copy would move this off zero.
  assert.equal(r.medianAbsError, 0, "the duplicated peer's farther, mispriced copy must not also enter the band");
  assert.equal(r.bandCoverage, 1);
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

// The truth test's scoring rules (truth-score.js): how a real report is held
// against a real closed price. Pure, so every judgment runs here with no
// server and no search. The runner's wiring is test/truth-test-run.test.js.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const TRUTH = require("../truth-score.js");
const BULK = require("../bulk.js");

const RAN_AT = Date.parse("2026-11-17T12:00:00Z");

function truthOf(over) {
  const r = TRUTH.normalizeTruth(Object.assign({
    id: "chi-off-01", address: "500 W Madison St, Chicago, IL 60661", type: "Office",
    sale_price: 2000000, sale_date: "2026-06", size_sqft: 10000,
  }, over || {}));
  assert.equal(r.error, undefined, r.error);
  return r.entry;
}

// A sale comp at `psf` over 10,000 SF. Prices are deliberately never the
// truth's own $2,000,000: the same price beside the same size IS the subject
// (see isSubjectComp), and a fixture that tripped that would test nothing.
function sale(n, psf, over) {
  return Object.assign({
    address: n + " Web Way, Chicago, IL 60601", date: "Mar 2026", transaction: "Sale",
    size_sqft: "10000", price_or_rate: "$" + (psf * 10000).toLocaleString("en-US"),
    source_type: "public_record",
  }, over || {});
}
const FIVE = () => [sale(1, 183), sale(2, 193), sale(3, 203), sale(4, 213), sale(5, 223)];
const report = (over) => Object.assign({ subject_size_sqft: "10000", comps: FIVE() }, over || {});

// ---- the answer key --------------------------------------------------------

test("an entry is put in one shape, with that type's own lookback", () => {
  const e = truthOf();
  assert.equal(e.market, "Chicago, IL");
  assert.equal(e.sale_price, 2000000);
  assert.equal(e.months, 24);
  assert.equal(e.checked, false);
  assert.equal(truthOf({ type: "Residential" }).months, 6);
  assert.equal(truthOf({ months: 36 }).months, 36);
  assert.equal(truthOf({ sale_price: "$5.25M" }).sale_price, 5250000);
});

test("a bad entry is refused with its id and the reason", () => {
  const bad = (over, want) => {
    const r = TRUTH.normalizeTruth(Object.assign({
      id: "x-1", address: "1 A St, Boise, ID", type: "Office", sale_price: 1, sale_date: "2026-01",
    }, over));
    assert.match(r.error || "", want);
  };
  bad({ id: "Has Spaces" }, /id must be/);
  bad({ address: "Main St, Boise, ID" }, /street number/);
  bad({ address: "1 A St Boise" }, /City, ST/);
  bad({ type: "Warehouse" }, /type must be/);
  bad({ sale_price: "a lot" }, /not an amount/);
  bad({ sale_date: "June 2026" }, /YYYY-MM/);
  bad({ sale_date: null }, /needs its sale_date/);
  bad({ sale_price: null }, /needs its sale_price/);
  bad({ size_sqft: -5 }, /size_sqft/);
});

test("an entry with no price yet is open, not an error", () => {
  const e = truthOf({ sale_price: null, sale_date: null });
  assert.equal(e.sale_price, null);
  assert.equal(e.sale_date, null);
});

test("a land parcel's acres and lot size fill each other", () => {
  assert.equal(truthOf({ type: "Land", size_sqft: null, lot_acres: 2 }).size_sqft, 87120);
  assert.equal(truthOf({ type: "Land", size_sqft: 87120 }).lot_acres, 2);
});

test("a set refuses a reused id and the same building entered twice", () => {
  const a = { id: "a-1", address: "500 W Madison St, Chicago, IL", type: "Office", sale_price: 1e6, sale_date: "2026-01" };
  const r = TRUTH.normalizeSet([
    a,
    Object.assign({}, a, { address: "9 Other Rd, Chicago, IL" }),
    Object.assign({}, a, { id: "a-2", address: "500 West Madison Street, Chicago, IL 60661" }),
    Object.assign({}, a, { id: "a-3", address: "500 W Madison St, Springfield, IL" }),
  ]);
  assert.deepEqual(r.entries.map((e) => e.id), ["a-1", "a-3"]);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems[0], /used twice/);
  assert.match(r.problems[1], /same building as a-1/);
});

test("the committed answer key reads clean", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "truth-set.json"), "utf8"));
  assert.ok(Array.isArray(raw.sales), "truth-set.json keeps its sales under \"sales\"");
  const r = TRUTH.normalizeSet(raw.sales);
  assert.deepEqual(r.problems, []);
  // A committed price must have somewhere a reader can check it.
  r.entries.filter((e) => e.sale_price).forEach((e) => assert.ok(e.source, e.id + " has a price and no source"));
});

test("money is read whole, and shorthand is not read as 1.2 dollars", () => {
  assert.equal(TRUTH.moneyOf("$12,450,000"), 12450000);
  assert.equal(TRUTH.moneyOf("1.2M"), 1200000);
  assert.equal(TRUTH.moneyOf("$1.2 million"), 1200000);
  assert.equal(TRUTH.moneyOf(950000), 950000);
  assert.equal(TRUTH.moneyOf("about 5 million"), null);
  assert.equal(TRUTH.moneyOf(""), null);
  assert.equal(TRUTH.moneyOf(0), null);
});

// ---- the building must not price itself ------------------------------------

test("the subject is recognized across the ways its address gets written", () => {
  const t = truthOf();
  const is = (address) => TRUTH.isSubjectComp({ address, transaction: "Sale" }, t);
  assert.equal(is("500 W Madison St, Chicago, IL 60661"), true);
  assert.equal(is("500 West Madison Street, Chicago, IL"), true);
  assert.equal(is("500 W. Madison St., Suite 200, Chicago, IL 60606"), true);
  assert.equal(is("500 W Madison St Suite 200, Chicago, IL"), true);
  assert.equal(is("5000 W Madison St, Chicago, IL"), false);
  assert.equal(is("500 W Monroe St, Chicago, IL"), false);
  assert.equal(is("50 W Madison St, Chicago, IL"), false);
});

test("a comp under another name is still the subject when the deal matches", () => {
  const t = truthOf();
  const named = { address: "Madison Plaza, Chicago, IL", transaction: "Sale", price_or_rate: "$2,000,000" };
  // The same price alone is not enough: two buildings do sell for $2,000,000.
  assert.equal(TRUTH.isSubjectComp(named, t), false);
  assert.equal(TRUTH.isSubjectComp(Object.assign({ size_sqft: "10,100" }, named), t), true);
  assert.equal(TRUTH.isSubjectComp(Object.assign({ size_sqft: "30000" }, named), t), false);
  assert.equal(TRUTH.isSubjectComp(Object.assign({ date: "Jun 2026" }, named), t), true);
  assert.equal(TRUTH.isSubjectComp(Object.assign({ date: "Jan 2025" }, named), t), false);
  // A lease at that figure is a different kind of number.
  assert.equal(TRUTH.isSubjectComp(Object.assign({}, named, { transaction: "Lease", size_sqft: "10000" }), t), false);
});

test("the subject's own sale is removed before valuing, and counted", () => {
  const t = truthOf();
  const clean = TRUTH.scoreTarget(report(), t, { ranAt: RAN_AT });
  // The building's own sale, at a price that would drag the range if used.
  const own = { address: "500 West Madison Street, Chicago, IL", date: "Jun 2026", transaction: "Sale",
    size_sqft: "10000", price_or_rate: "$9,000,000", source_type: "news" };
  const leaky = TRUTH.scoreTarget(report({ comps: FIVE().concat([own]) }), t, { ranAt: RAN_AT });
  assert.equal(leaky.leakedComps, 1);
  assert.equal(leaky.knewPrice, true);
  assert.deepEqual(leaky.served, clean.served);
  assert.equal(clean.leakedComps, 0);
  assert.equal(clean.knewPrice, false);
});

// ---- the number is the customer's number -----------------------------------

test("the value scored is bulk.js's reading of the hero, not a second opinion", () => {
  const t = truthOf();
  const rep = report({ annual_price_trend_pct: 4, subject_year_built: "1998" });
  const row = TRUTH.scoreTarget(rep, t, { ranAt: RAN_AT });
  const hero = BULK.valueFromReport(rep, { asOf: RAN_AT, propertyType: "Office", note: "" });
  assert.equal(row.status, "scored");
  assert.equal(row.served.low, hero.value_low);
  assert.equal(row.served.likely, hero.value_likely);
  assert.equal(row.served.high, hero.value_high);
  assert.equal(row.miss.error, (hero.value_likely - 2000000) / 2000000);
  assert.equal(row.miss.inRange, 2000000 >= hero.value_low && 2000000 <= hero.value_high);
});

test("a report the page could not put dollars on says which kind", () => {
  const t = truthOf();
  const unsized = TRUTH.scoreTarget(report({ subject_size_sqft: "" }), t, { ranAt: RAN_AT });
  assert.equal(unsized.status, "unsized");
  assert.equal(unsized.miss, null);
  // The true size is known, so the comps and the math can still be graded.
  assert.ok(unsized.trueSize && unsized.trueSize.absError < 0.2);

  const oneSale = TRUTH.scoreTarget(report({ comps: [sale(1, 203)] }), t, { ranAt: RAN_AT });
  assert.equal(oneSale.status, "no_value", "one priced sale is not a range (the hero's two-comp bar)");
  const leases = TRUTH.scoreTarget(report({ comps: FIVE().map((c) => Object.assign(c, { transaction: "Lease" })) }), t, { ranAt: RAN_AT });
  assert.equal(leases.status, "no_value");
});

test("an open entry keeps its prediction and scores nothing", () => {
  const row = TRUTH.scoreTarget(report(), truthOf({ sale_price: null, sale_date: null }), { ranAt: RAN_AT });
  assert.equal(row.status, "open");
  assert.ok(row.served.likely > 0);
  assert.equal(row.miss, null);
  assert.equal(row.prospective, false);
});

// ---- where the miss comes from ---------------------------------------------

test("a wrong size lookup is the whole miss, and the true-size reading shows it", () => {
  const t = truthOf();
  const row = TRUTH.scoreTarget(report({ subject_size_sqft: "20000" }), t, { ranAt: RAN_AT });
  assert.equal(row.size.error, 1);
  assert.ok(row.miss.error > 0.6, "twice the building is far too much money: " + row.miss.error);
  assert.ok(row.trueSize.absError < 0.1, "with the true size the comps were right: " + row.trueSize.error);
});

test("a run that typed the true size is scored on that size", () => {
  const t = truthOf();
  const row = TRUTH.scoreTarget(report({ subject_size_sqft: "" }), t, { ranAt: RAN_AT, typedSize: true });
  assert.equal(row.status, "scored");
  assert.equal(row.served.size_sqft, 10000);
  assert.equal(row.served.size_source, "typed");
  // Nothing was looked up, so the lookup is not graded.
  const s = TRUTH.summarize([row]);
  assert.equal(s.sizeLookup.n, 0);
  assert.equal(s.sizeLookup.wanted, 0);
});

test("the as-of-the-sale reading uses no comp from after the closing", () => {
  const t = truthOf(); // closed 2026-06
  const later = [sale(6, 900, { date: "Sep 2026" }), sale(7, 950, { date: "Oct 2026" })];
  const row = TRUTH.scoreTarget(report({ comps: FIVE().concat(later) }), t, { ranAt: RAN_AT });
  assert.equal(row.asOfComps, 5);
  assert.ok(row.asOfSale.absError < 0.1, "the later sales did not move it: " + row.asOfSale.error);
  assert.ok(row.miss.absError > row.asOfSale.absError, "today's reading did see them");
  // A comp in the sale's own month is known history (backtest.js's rule).
  const same = TRUTH.scoreTarget(report({ comps: FIVE().concat([sale(8, 205, { date: "Jun 2026" })]) }), t, { ranAt: RAN_AT });
  assert.equal(same.asOfComps, 6);
});

test("the as-of reading is withheld under three earlier sales", () => {
  const t = truthOf();
  const comps = [sale(1, 193), sale(2, 203), sale(3, 213, { date: "Sep 2026" }), sale(4, 223, { date: "Oct 2026" })];
  const row = TRUTH.scoreTarget(report({ comps }), t, { ranAt: RAN_AT });
  assert.equal(row.asOfComps, 2);
  assert.equal(row.asOfSale, null);
  assert.equal(row.status, "scored");
});

test("land is valued per acre, the way its report page leads", () => {
  const t = truthOf({ id: "land-01", address: "12500 S Pflumm Rd, Olathe, KS", type: "Land",
    sale_price: 400000, sale_date: "2026-05", size_sqft: null, lot_acres: 4 });
  const acre = (n, per) => ({ address: n + " Field Rd, Olathe, KS", date: "Feb 2026", transaction: "Sale",
    lot_acres: "5", price_per_acre: "$" + per.toLocaleString("en-US"), price_or_rate: "$" + (per * 5).toLocaleString("en-US"),
    source_type: "public_record" });
  // Under $1/SF, which the $/SF reader refuses: per acre is the only reading.
  const rep = { subject_size_sqft: String(4 * 43560), comps: [acre(1, 90000), acre(2, 100000), acre(3, 110000)] };
  const row = TRUTH.scoreTarget(rep, t, { ranAt: RAN_AT });
  assert.equal(row.status, "scored");
  assert.equal(row.served.basis, "acre");
  assert.equal(row.served.likely, 400000);
  assert.equal(row.miss.error, 0);
  // Two per-acre comps are not a range for that basis (the hero's floor of three).
  const thin = TRUTH.scoreTarget({ subject_size_sqft: rep.subject_size_sqft, comps: rep.comps.slice(0, 2) }, t, { ranAt: RAN_AT });
  assert.notEqual(thin.served && thin.served.basis, "acre");
});

// ---- did it already know ---------------------------------------------------

test("finding the building's own sale counts as knowing only at the true price", () => {
  const t = truthOf();
  const at = (ls) => TRUTH.scoreTarget(report({ subject_last_sale: ls }), t, { ranAt: RAN_AT });
  const hit = at({ date: "Jun 2026", price: "$2,010,000", source_url: "https://example.com" });
  assert.deepEqual([hit.ownSale.found, hit.ownSale.matches, hit.knewPrice], [true, true, true]);
  // An earlier trade of the same building is not the answer.
  const old = at({ date: "Aug 2019", price: "$1,200,000", source_url: "" });
  assert.deepEqual([old.ownSale.found, old.ownSale.matches, old.knewPrice], [true, false, false]);
  const noPrice = at({ date: "Jun 2026", price: "", source_url: "" });
  assert.deepEqual([noPrice.ownSale.found, noPrice.ownSale.matches, noPrice.knewPrice], [true, null, false]);
  const none = TRUTH.scoreTarget(report(), t, { ranAt: RAN_AT });
  assert.deepEqual([none.ownSale.found, none.knewPrice], [false, false]);
});

test("a prediction made before the closing is marked as one", () => {
  const t = truthOf({ sale_date: "2026-12-10" });
  assert.equal(TRUTH.scoreTarget(report(), t, { ranAt: RAN_AT }).prospective, true);
  assert.equal(TRUTH.scoreTarget(report(), truthOf(), { ranAt: RAN_AT }).prospective, false);
});

// ---- a set of buildings ----------------------------------------------------

// A scored row with a chosen signed miss, built through the real scorer so
// the summary is fed the shape it will be fed: the price is set from what the
// fixture report is actually valued at.
const LIKELY = TRUTH.scoreTarget(report(), truthOf(), { ranAt: RAN_AT }).served.likely;
function rowWithMiss(id, error, over) {
  const t = truthOf(Object.assign({
    id, address: id.length + "0" + id.replace(/\D/g, "") + " Test St, Chicago, IL",
    sale_price: Math.round(LIKELY / (1 + error)),
  }, over || {}));
  return TRUTH.scoreTarget(report(), t, { ranAt: RAN_AT });
}

test("the summary is the standard reading: median miss, shares, lean, coverage, hit rate", () => {
  const rows = [
    rowWithMiss("a-1", 0.04), rowWithMiss("a-2", -0.08), rowWithMiss("a-3", 0.15), rowWithMiss("a-4", 0.30),
    TRUTH.scoreTarget(report({ subject_size_sqft: "" }), truthOf({ id: "a-5", address: "77 Fifth St, Chicago, IL", size_sqft: null }), { ranAt: RAN_AT }),
    TRUTH.scoreTarget(report({ comps: [] }), truthOf({ id: "a-6", address: "88 Sixth St, Chicago, IL" }), { ranAt: RAN_AT }),
    { id: "a-7", type: "Office", status: "failed", error: "HTTP 502" },
  ];
  const s = TRUTH.summarize(rows);
  assert.equal(s.targets, 7);
  assert.equal(s.failed, 1);
  assert.equal(s.scored, 4);
  assert.equal(s.unsized, 1);
  assert.equal(s.noValue, 1);
  // Four of the six searches that finished got a dollar range; the failed
  // search says nothing about its building and is left out.
  assert.equal(s.hitRate, 4 / 6);
  assert.equal(s.belowFloor, true);
  const h = s.headline;
  assert.equal(h.n, 4);
  const abs = rows.slice(0, 4).map((r) => r.miss.absError).sort((x, y) => x - y);
  assert.equal(h.medianAbsError, (abs[1] + abs[2]) / 2);
  assert.equal(h.within10, 0.5);
  assert.equal(h.within20, 0.75);
  assert.ok(h.bias > 0, "three of four ran high");
  assert.ok(h.interval.lo <= h.medianAbsError && h.interval.hi >= h.medianAbsError);
  assert.equal(s.worst[0].id, "a-4");
  assert.equal(s.byType.length, 1);
  assert.equal(s.unchecked, 6);
});

test("the miss is split on whether the report already knew the price", () => {
  const knew = TRUTH.scoreTarget(report({ subject_last_sale: { date: "Jun 2026", price: "$2,000,000" } }), truthOf({ id: "k-1" }), { ranAt: RAN_AT });
  const blind = rowWithMiss("b-1", 0.2);
  const s = TRUTH.summarize([knew, blind]);
  assert.equal(s.peek.ownSaleFound, 1);
  assert.equal(s.peek.ownSaleMatched, 1);
  assert.equal(s.peek.knewPrice.n, 1);
  assert.equal(s.peek.didNotKnow.n, 1);
  assert.equal(s.peek.didNotKnow.medianAbsError, blind.miss.absError);
});

test("an empty or all-open run summarizes without a number, not with a zero", () => {
  const s = TRUTH.summarize([TRUTH.scoreTarget(report(), truthOf({ sale_price: null, sale_date: null }), { ranAt: RAN_AT })]);
  assert.equal(s.scored, 0);
  assert.equal(s.open, 1);
  assert.equal(s.hitRate, 1);
  assert.equal(s.headline.medianAbsError, null);
  assert.equal(TRUTH.summarize([]).hitRate, null);
});

test("the interval is the same on every reading of one run", () => {
  const xs = [0.02, 0.05, 0.09, 0.14, 0.22, 0.31, 0.4];
  assert.deepEqual(TRUTH.bootstrap(xs, TRUTH.median), TRUTH.bootstrap(xs, TRUTH.median));
  assert.equal(TRUTH.bootstrap([0.1], TRUTH.median), null);
});

test("two runs are compared only on the buildings both scored", () => {
  const base = [rowWithMiss("c-1", 0.30), rowWithMiss("c-2", 0.20), rowWithMiss("c-3", 0.25), rowWithMiss("c-9", 0.01)];
  const cand = [rowWithMiss("c-1", 0.10), rowWithMiss("c-2", 0.05), rowWithMiss("c-3", 0.08),
    { id: "c-9", type: "Office", status: "failed", error: "x" }, rowWithMiss("c-4", 0.9)];
  const c = TRUTH.compare(base, cand);
  assert.equal(c.pairs, 3);
  assert.equal(c.onlyInBase, 1);
  assert.equal(c.onlyInCand, 1);
  assert.equal(c.better, 3);
  assert.equal(c.worse, 0);
  assert.ok(c.change < 0, "the candidate is closer");
  assert.ok(c.interval.hi < 0, "on every resample");
  // The candidate cannot win by failing on a building: c-9 simply drops out.
  assert.equal(TRUTH.compare(base, base).change, 0);
});

// ---- what may be committed -------------------------------------------------

test("a private row's committed form holds no address, no price and no dollars", () => {
  const t = TRUTH.normalizeTruth({
    id: "deal-07", address: "4321 Secret Ranch Rd, Eagle, ID 83616", type: "Industrial",
    sale_price: 3456789, sale_date: "2026-04", size_sqft: 23456,
  }, { private: true }).entry;
  const rep = { subject_size_sqft: "23456", comps: FIVE(), subject_last_sale: { date: "Apr 2026", price: "$3,456,789" } };
  const row = TRUTH.scoreTarget(rep, t, { ranAt: RAN_AT });
  assert.equal(row.status, "scored");
  const pub = TRUTH.publicRow(row);
  const text = JSON.stringify(pub);
  ["4321", "Secret", "Eagle", "3456789", "23456", String(row.served.likely), String(row.served.low), String(row.served.high)]
    .forEach((needle) => assert.ok(!text.includes(needle), "the committed row still holds " + needle + ": " + text));
  // What it keeps is what the scorecard needs.
  assert.equal(pub.id, "deal-07");
  assert.equal(pub.miss.error, row.miss.error);
  assert.equal(pub.knewPrice, true);
  assert.deepEqual(pub.ownSale, { found: true, matches: true });
  // And it still pairs in a comparison.
  assert.equal(TRUTH.compare([pub], [pub]).pairs, 1);
  // A public row goes out whole.
  const open = TRUTH.scoreTarget(report(), truthOf(), { ranAt: RAN_AT });
  assert.equal(TRUTH.publicRow(open), open);
});

// ---- the two copies the browser could not share ----------------------------

test("the lookback each type is searched with is index.html's own", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/const RECOMMENDED_LOOKBACK = (\{[^}]*\});/);
  assert.ok(m, "index.html still declares RECOMMENDED_LOOKBACK on one line");
  const theirs = Function("return (" + m[1] + ");")();
  assert.deepEqual(TRUTH.LOOKBACK_MONTHS, theirs);
  assert.deepEqual(Object.keys(TRUTH.LOOKBACK_MONTHS).sort(), TRUTH.TYPES.slice().sort());
});

test("both mirrored pieces are marked on both sides", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const mine = fs.readFileSync(path.join(__dirname, "..", "truth-score.js"), "utf8");
  assert.match(html, /⚠ MIRRORED in truth-score\.js LOOKBACK_MONTHS/);
  assert.match(html, /⚠ MIRRORED, for Land only, in truth-score\.js landPerAcre/);
  assert.match(mine, /⚠ MIRRORS index\.html RECOMMENDED_LOOKBACK/);
  assert.match(mine, /⚠ MIRRORS index\.html altBasisRange/);
});

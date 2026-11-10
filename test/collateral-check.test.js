// Collateral check — a loan against the report's value range.
//
// These are the figures a lender would decide whether to order an appraisal
// on, so each rule in collateral-check.js's header has a test that fails if
// it is quietly reversed: a missing number that becomes a zero, a purchase
// under value that borrows against the difference, a price that already
// breaks the limit being reported as "the appraisal decides".
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../collateral-check.js");

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

const RANGE = { low: 1800000, likely: 2000000, high: 2300000 };

// --- parsing: refuse rather than guess -------------------------------------

test("money accepts what a person types, and refuses shorthand outright", () => {
  assert.equal(C.money(1600000), 1600000);
  assert.equal(C.money("1,600,000"), 1600000);
  assert.equal(C.money("$1,600,000"), 1600000);
  // "1.6M" read as 1.6 would report a 0.0% LTV on a $1.6M loan.
  assert.equal(C.money("1.6M"), null);
  assert.equal(C.money("1.6m"), null);
  assert.equal(C.money("about 1600000"), null);
  assert.equal(C.money(""), null);
  assert.equal(C.money(null), null);
  assert.equal(C.money(-5), null);
  assert.equal(C.money(Infinity), null);
  // A loan of nothing is not a loan: zero is "not entered", never an LTV of 0%.
  assert.equal(C.money(0), null);
  assert.equal(C.money("0"), null);
});

test("the limit is the lender's own, and falls back to the default rather than to nothing", () => {
  assert.equal(C.limitPct(75), 75);
  assert.equal(C.limitPct("75"), 75);
  assert.equal(C.limitPct("75%"), 75);
  assert.equal(C.limitPct(100), 100);
  assert.equal(C.limitPct(""), C.DEFAULT_LIMIT_PCT);
  assert.equal(C.limitPct(null), C.DEFAULT_LIMIT_PCT);
  assert.equal(C.limitPct(0), C.DEFAULT_LIMIT_PCT);
  assert.equal(C.limitPct(140), C.DEFAULT_LIMIT_PCT, "a limit past the whole value is not a limit");
  assert.equal(C.limitPct("eighty"), C.DEFAULT_LIMIT_PCT);
  assert.equal(C.DEFAULT_LIMIT_PCT, 80);
});

// --- nothing entered -------------------------------------------------------

test("no loan is null everywhere, never a 0% LTV", () => {
  const r = C.summarize({ value: RANGE });
  assert.equal(r.loan, null);
  assert.equal(r.verdict, null);
  assert.equal(r.requiredValue, null);
  assert.equal(r.cushionPct, null);
  assert.equal(r.likely.ltvPct, null);
  assert.equal(r.likely.within, null);
  assert.deepEqual(r.missing, ["a loan amount"]);
  // What the building supports does not need a loan to be known.
  near(r.likely.maxLoan, 1600000);
  near(r.low.maxLoan, 1440000);
});

test("no value estimate is null, and says what is missing", () => {
  const r = C.summarize({ loan: 1500000 });
  assert.equal(r.value, null);
  assert.equal(r.verdict, null);
  assert.deepEqual(r.scenarios, []);
  assert.equal(r.cushionPct, null);
  near(r.requiredValue, 1875000);       // still knowable: 1.5M / 80%
  assert.deepEqual(r.missing, ["a value estimate"]);
  assert.deepEqual(C.summarize().missing, ["a value estimate", "a loan amount"]);
  assert.deepEqual(C.summarize(null).scenarios, []);
});

// --- the three figures -----------------------------------------------------

test("LTV is read at the low, likely and high values", () => {
  const r = C.summarize({ loan: 1500000, value: RANGE });
  near(r.low.ltvPct, (1500000 / 1800000) * 100);
  near(r.likely.ltvPct, 75);
  near(r.high.ltvPct, (1500000 / 2300000) * 100);
  assert.deepEqual(r.scenarios.map((s) => s.key), ["low", "likely", "high"]);
  assert.equal(r.likely.basisIs, "value");
});

test("the required value is the loan over the limit, and the cushion is how far likely can fall", () => {
  const r = C.summarize({ loan: 1500000, value: RANGE, limitPct: 80 });
  near(r.requiredValue, 1875000);
  near(r.cushionPct, 6.25);                 // 1 - 1.875M / 2.0M
  near(r.likely.room, 100000);              // 1.6M supported, 1.5M asked
  near(r.low.room, -60000);                 // 1.44M supported at the low end
  // Past the limit at likely is a NEGATIVE cushion, not a zero.
  const over = C.summarize({ loan: 1800000, value: RANGE, limitPct: 80 });
  near(over.cushionPct, -12.5);
});

test("a loan exactly at the limit is inside it", () => {
  const r = C.summarize({ loan: 1600000, value: RANGE, limitPct: 80 });
  near(r.likely.ltvPct, 80);
  assert.equal(r.likely.within, true, "1.6M on 2.0M is AT an 80% limit, not over it");
  near(r.cushionPct, 0);
});

// --- the verdict -----------------------------------------------------------

test("covered: inside the limit even at the low end", () => {
  assert.equal(C.summarize({ loan: 1400000, value: RANGE }).verdict, "covered");
});

test("depends: inside at likely, over at the low end", () => {
  const r = C.summarize({ loan: 1500000, value: RANGE });
  assert.equal(r.verdict, "depends");
  assert.equal(r.low.within, false);
  assert.equal(r.likely.within, true);
});

test("stretch: over at likely, inside only toward the high end", () => {
  const r = C.summarize({ loan: 1700000, value: RANGE });
  assert.equal(r.verdict, "stretch");
  assert.equal(r.likely.within, false);
  assert.equal(r.high.within, true);
});

test("short: over the limit across the whole range", () => {
  assert.equal(C.summarize({ loan: 1900000, value: RANGE }).verdict, "short");
});

test("the limit moves the verdict", () => {
  const args = { loan: 1500000, value: RANGE };
  assert.equal(C.summarize({ ...args, limitPct: 90 }).verdict, "covered");
  assert.equal(C.summarize({ ...args, limitPct: 80 }).verdict, "depends");
  assert.equal(C.summarize({ ...args, limitPct: 70 }).verdict, "stretch");
  assert.equal(C.summarize({ ...args, limitPct: 60 }).verdict, "short");
});

// --- a range that is not all there ----------------------------------------

test("a single figure still gets a verdict, never an invented spread", () => {
  const r = C.summarize({ loan: 1500000, value: { likely: 2000000 } });
  assert.equal(r.low, null);
  assert.equal(r.high, null);
  assert.deepEqual(r.scenarios.map((s) => s.key), ["likely"]);
  assert.equal(r.verdict, "covered");
  assert.equal(C.summarize({ loan: 1700000, value: { likely: 2000000 } }).verdict, "short");
});

test("an inverted range is ignored, not stress-tested against", () => {
  const r = C.summarize({ loan: 1500000, value: { low: 2500000, likely: 2000000, high: 1500000 } });
  assert.equal(r.low, null, "a low above likely is not a low");
  assert.equal(r.high, null, "a high below likely is not a high");
  assert.equal(r.verdict, "covered");
});

// --- the purchase price: lesser of price and value -------------------------

test("a purchase under value is financed on the price, not on the value", () => {
  const r = C.summarize({ loan: 1500000, price: 1900000, value: RANGE });
  // Likely and high are worth more than the price, so the price is the basis.
  assert.equal(r.likely.basisIs, "price");
  assert.equal(r.high.basisIs, "price");
  near(r.likely.ltvPct, (1500000 / 1900000) * 100);
  near(r.high.ltvPct, (1500000 / 1900000) * 100, 1e-6);
  // The low end is under the price, so the value is the basis there.
  assert.equal(r.low.basisIs, "value");
  near(r.low.ltvPct, (1500000 / 1800000) * 100);
  near(r.likely.maxLoan, 1520000);          // 80% of the price
});

test("a purchase over value is financed on the value", () => {
  const r = C.summarize({ loan: 1500000, price: 2600000, value: RANGE });
  assert.equal(r.high.basisIs, "value");
  near(r.likely.ltvPct, 75);
  assert.equal(r.pricePosition, "above");
  near(r.priceGapPct, (2600000 / 2300000 - 1) * 100);
});

test("the price is placed against the range", () => {
  assert.equal(C.summarize({ price: 2100000, value: RANGE }).pricePosition, "inside");
  assert.equal(C.summarize({ price: 1800000, value: RANGE }).pricePosition, "inside", "an end of the range is inside it");
  const below = C.summarize({ price: 1620000, value: RANGE });
  assert.equal(below.pricePosition, "below");
  near(below.priceGapPct, 10);
  assert.equal(C.summarize({ value: RANGE }).pricePosition, null);
});

test("equity is the share of the price the loan does not cover", () => {
  const r = C.summarize({ loan: 1500000, price: 2000000, value: RANGE });
  near(r.priceLtvPct, 75);
  near(r.equityPct, 25);
  assert.equal(r.priceBinds, false);
  assert.equal(C.summarize({ loan: 1500000, value: RANGE }).equityPct, null);
});

test("a price that already breaks the limit binds, whatever the appraisal says", () => {
  // 1.7M on a 1.9M purchase is 89% of the price. Likely is 2.0M and high is
  // 2.3M, but the lesser-of basis never rises past the price.
  const r = C.summarize({ loan: 1700000, price: 1900000, value: RANGE, limitPct: 80 });
  assert.equal(r.priceBinds, true);
  assert.equal(r.verdict, "short");
  assert.equal(r.high.within, false, "a high appraisal cannot cover a loan the price does not");
  near(r.high.ltvPct, (1700000 / 1900000) * 100);
  // Without the price the same loan is merely a stretch, which is the
  // difference this flag exists to report.
  assert.equal(C.summarize({ loan: 1700000, value: RANGE, limitPct: 80 }).verdict, "stretch");
});

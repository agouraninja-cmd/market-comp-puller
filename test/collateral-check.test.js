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

// --- the words -------------------------------------------------------------
// describe() is the one copy of what a person reads, shared by the report's
// card and the public lender page. These pin the sentences themselves: the
// lender page shows them to somebody deciding whether to trust the product,
// and the report shows the same ones afterwards.

test("describe says nothing without a value to read against", () => {
  assert.equal(C.describe(C.summarize({ loan: 1500000 })), null);
  assert.equal(C.describe(null), null);
});

test("with no loan the tiles say what each value supports, and there is no read", () => {
  const d = C.describe(C.summarize({ value: RANGE }));
  assert.equal(d.basis, "Value $1,800,000 to $2,300,000 · 80% limit");
  assert.deepEqual(d.low, { figure: null, tone: null, sub: "up to $1,440,000 on $1,800,000" });
  assert.equal(d.likely.sub, "up to $1,600,000 on $2,000,000");
  assert.equal(d.need, null);
  assert.deepEqual(d.read, []);
  assert.equal(d.ranged, true);
});

test("each tile carries its figure, its tone and what it was measured on", () => {
  const d = C.describe(C.summarize({ loan: 1500000, value: RANGE }));
  assert.deepEqual(d.low, { figure: "83.3%", tone: "over", sub: "on $1,800,000 · $60,000 over your limit" });
  assert.deepEqual(d.likely, { figure: "75.0%", tone: "ok", sub: "on $2,000,000 · $100,000 of room" });
  assert.deepEqual(d.high, { figure: "65.2%", tone: "ok", sub: "on $2,300,000 · $340,000 of room" });
  assert.deepEqual(d.need, { figure: "$1,875,000", sub: "for $1,500,000 at your 80% limit · 6.3% under the likely value" });
  // Exactly at the limit is said, not shown as "$0 of room".
  const at = C.describe(C.summarize({ loan: 1600000, value: RANGE }));
  assert.equal(at.likely.sub, "on $2,000,000 · at your limit");
  assert.equal(at.need.sub, "for $1,600,000 at your 80% limit · right at the likely value");
});

test("the read has one sentence per verdict", () => {
  const read = (loan, extra) => C.describe(C.summarize({ loan, value: RANGE, ...extra })).read;
  assert.deepEqual(read(1400000),
    ["Covered across the range. Even at the low value this loan sits inside your 80% limit."]);
  assert.deepEqual(read(1500000),
    ["The appraisal decides. This loan fits at the likely value and not at the low one, so it needs the building to come in at $1,875,000 or more."]);
  assert.deepEqual(read(1700000),
    ["A stretch. This loan is over your 80% limit at the likely value and fits only toward the top of the range."]);
  assert.deepEqual(read(1900000),
    ["Over your 80% limit across the whole range. At the likely value the limit allows $1,600,000, $300,000 less than this loan."]);
  // The limit in the sentence is the lender's own.
  assert.match(read(1500000, { limitPct: 72.5 })[0], /over your 72\.5% limit/);
});

test("a purchase price adds where it sits and what the borrower put in", () => {
  const d = C.describe(C.summarize({ loan: 1500000, price: 1900000, value: RANGE }));
  // Likely and high are worth more than the price, so they say so.
  assert.equal(d.likely.sub, "on the $1,900,000 price · $20,000 of room");
  assert.equal(d.low.sub, "on $1,800,000 · $60,000 over your limit");
  assert.deepEqual(d.read.slice(1), [
    "The $1,900,000 price sits inside this report's range.",
    "The borrower's equity is 21.1% of the price.",
  ]);
  const above = C.describe(C.summarize({ loan: 1500000, price: 2600000, value: RANGE }));
  assert.equal(above.read[1], "The $2,600,000 price is 13.0% above the top of this report's range.");
  const below = C.describe(C.summarize({ loan: 1000000, price: 1620000, value: RANGE }));
  assert.equal(below.read[1], "The $1,620,000 price is 10.0% below the bottom of this report's range.");
  assert.equal(C.describe(C.summarize({ loan: 2000000, price: 2000000, value: RANGE })).read.pop(), "The loan is the whole price.");
  assert.equal(C.describe(C.summarize({ loan: 2100000, price: 2000000, value: RANGE })).read.pop(), "The loan is more than the price.");
});

test("when the price binds, the figure and the read tell the same story", () => {
  // 1.7M on a 1.9M purchase: the value this loan needs is above the price,
  // so no appraisal gets there. Both lines must say so. They disagreed once
  // ("3.6% above the likely value" over "whatever the appraisal says").
  const d = C.describe(C.summarize({ loan: 1700000, price: 1900000, value: RANGE }));
  assert.equal(d.need.figure, "$2,125,000");
  assert.equal(d.need.sub, "for $1,700,000 at your 80% limit · more than the $1,900,000 price, which caps what a lender counts");
  assert.equal(d.read[0], "The price is what binds here, not the value. A lender counts the lesser of the two, and at " +
    "$1,900,000 your 80% limit allows $1,520,000: $180,000 less than this loan, whatever the appraisal says.");
  assert.ok(!d.read.some((s) => /appraisal decides/.test(s)));
});

test("one figure is worded as one figure, and each page names whose it is", () => {
  const one = { likely: 2000000 };
  const d = C.describe(C.summarize({ loan: 1500000, price: 2100000, value: one }));
  assert.equal(d.ranged, false);
  assert.equal(d.basis, "Value $2,000,000 · 80% limit");
  assert.equal(d.low, null);
  assert.equal(d.high, null);
  assert.equal(d.read[0], "Covered. At this report's value the loan sits inside your 80% limit.");
  assert.equal(d.read[1], "The $2,100,000 price is 5.0% above this report's value.");
  assert.equal(C.describe(C.summarize({ loan: 1700000, value: one })).read[0],
    "Over your 80% limit at this report's value. At the likely value the limit allows $1,600,000, $100,000 less than this loan.");
  // The lender page's check runs on a sample, and says so.
  const sample = C.describe(C.summarize({ loan: 1500000, price: 1900000, value: RANGE }), { whose: "this sample's" });
  assert.equal(sample.read[1], "The $1,900,000 price sits inside this sample's range.");
});

test("the report passes its own way of writing money", () => {
  const eur = (v) => "€" + Math.round(v).toLocaleString("en-US");
  const d = C.describe(C.summarize({ loan: 1500000, value: RANGE }), { money: eur });
  assert.equal(d.basis, "Value €1,800,000 to €2,300,000 · 80% limit");
  assert.equal(d.need.figure, "€1,875,000");
  assert.equal(d.low.sub, "on €1,800,000 · €60,000 over your limit");
  assert.ok(!JSON.stringify(d).includes("$"), "a dollar sign survived the report's own formatter");
});

test("text that is not a figure is unreadable, an empty box is only empty, and both pages say it one way", () => {
  for (const raw of ["1.6M", "7M", "about two million", "$1.2m", "0", "-5"]) {
    assert.equal(C.unreadable(raw), true, `"${raw}" should be refused out loud`);
  }
  for (const raw of ["", "   ", null, undefined, "1,600,000", "$1,600,000", 1600000]) {
    assert.equal(C.unreadable(raw), false, `"${raw}" is not something to complain about`);
  }
  // The report card and the public lender page both say these, word for
  // word, so a figure refused on one is refused the same way on the other.
  assert.equal(C.UNREAD.loan, "That loan amount could not be read. Type it in full, like 1,600,000.");
  assert.equal(C.UNREAD.price, "That purchase price could not be read. Type it in full, like 2,000,000.");
});

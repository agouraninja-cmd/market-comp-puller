// bulk.js valueFromReport when the report holds a sale of the subject itself.
// The rule is valuation.js's ("The building's own sale (2026-11-27)": that
// section's header comment is the specification) and is tested against that
// module. This file holds the ROW: what bulk.js hands the rule, and what it
// prints back.
//
// A bulk row is three dollar figures for an address, with a portfolio total
// under fifty of them, and a vetted recent sale of the building can now carry
// nine tenths of each. Every way that goes wrong is money: a sale leaned on
// that should not be (a report nobody vetted, the building next door, a caller
// that never said which address it was valuing), a good sale carrying a whole
// headline with nothing said, a member's own asking price moving the answer it
// was a question about, and a row that stops agreeing with the report it
// links to.
//
// The expected figures are worked out by hand from the specification, with
// the arithmetic beside each. None is pasted from a run.
//
// Run: node --test test/bulk-own-sale.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const BULK = require("../bulk.js");

// ---------------------------------------------------------------------------
// One building, one sale, five comps, chosen so every figure can be done on
// paper:
//   - the report is dated EXACTLY one year after the sale (valuation.js counts
//     a year as 365.25 days), so the sale's age is 1.0: a weight of 0.9, an
//     allowance of 10%, and one whole year of the market's trend;
//   - the comps are the subject's own size, so none is restated for size, and
//     they closed the day it did, so each is one year old: equal weights, and
//     each $/SF moved by the same year of trend;
//   - Florida, where a deed shows its price, with a news page behind the sale,
//     so no half-weight condition applies;
//   - ISO dates, which are read as UTC, so the answers are the same in any
//     time zone.
// ---------------------------------------------------------------------------
const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const SOLD = "2023-11-27";
const ASOF = Date.parse(SOLD) + YEAR_MS;
const SIZE = 20000;
const ADDRESS = "500 Commerce Way, Tampa, FL 33602";
const ARTICLE = "https://www.bizjournals.com/tampabay/news/2023/11/28/500-commerce-way-sells.html";

const comp = (psf, i) => ({
  address: `${i + 1}0 Dock Rd, Tampa, FL`, transaction: "Sale", date: SOLD,
  size_sqft: String(SIZE), price_or_rate: "$" + psf * SIZE, source_type: "public_record",
});
const REPORT = {
  currency: "USD", subject_size_sqft: String(SIZE), subject_size_source: "county records",
  annual_price_trend_pct: 5,
  comps: [64, 72, 80, 88, 96].map(comp),          // $/SF as sold
  // A sale as the server leaves it once vetted (settleOwnSale stamps `settled: 1`).
  subject_last_sale: {
    date: SOLD, price: "$2,000,000", source_url: ARTICLE, source_type: "news",
    address: ADDRESS, size_sqft: String(SIZE), basis: "arms_length", settled: 1,
  },
};
// What every caller passes: the bulk worker, the re-value route, a firm's building sheet.
const OPTS = { asOf: ASOF, propertyType: "Industrial", address: ADDRESS, txFocus: "both" };

// The report with one thing changed, valued with one option changed.
function value(change, opts) {
  const report = structuredClone(REPORT);
  if (change) change(report);
  return BULK.valueFromReport(report, { ...OPTS, ...opts });
}
// The same row with the sale taken out of its report: the comps' own answer.
const compsAlone = (change, opts) => value((r) => { if (change) change(r); delete r.subject_last_sale; }, opts);
// Every figure of a row but `own_sale`, for "this is exactly the comps' answer".
function figures(row) { const rest = { ...row }; delete rest.own_sale; return rest; }
const dollars = (row) => [row.value_low, row.value_likely, row.value_high];
const compDollars = (row) => [row.comps_low, row.comps_likely, row.comps_high];
const perSf = (row) => [row.psf_low, row.psf_mid, row.psf_high];
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, `${what}: wanted ${want}, got ${got}`);

// WHAT THE COMPS ALONE SAY (valuation.js valueFromComps), by hand:
//   $/SF as sold            64     72     80     88     96
//   one year at +5%         67.2   75.6   84     92.4   100.8
// Five equal weights sit at the 10th, 30th, 50th, 70th and 90th percentiles,
// and the band is the 15th to the 85th:
//   Low     a quarter of the way from 67.2 to 75.6           69.3
//   Likely  the middle one                                   84
//   High    three quarters of the way from 92.4 to 100.8     98.7
// Times 20,000 SF that is $1,386,000 / $1,680,000 / $1,974,000, and a total
// from $1M to $10M is shown to the nearest $25,000 (heroRound):
const COMPS = [1375000, 1675000, 1975000];

// The whole rule in one row. If the blend here drifts from the formula, or the
// row is handed a different date, trend or size from the page, a portfolio's
// rows stop matching the reports they link to and neither screen can show it.
//
//   A, the sale at today's prices: $2,000,000 x 1.05 = $2,100,000
//   w = 0.9 and the allowance is 10% (first year). The comps' Likely is within
//   1.5x of A ($1,400,000 to $3,150,000), so the comps are blended as they are.
//   Likely  0.9 x 2,100,000 + 0.1 x 1,675,000 = 1,890,000 + 167,500 = 2,057,500
//   Low     0.9 x 1,890,000 (A less 10%) + 0.1 x 1,375,000 = 1,701,000 + 137,500 = 1,838,500
//   High    0.9 x 2,310,000 (A plus 10%) + 0.1 x 1,975,000 = 2,079,000 + 197,500 = 2,276,500
// Likely is inside A's allowance (1,890,000 to 2,310,000) and Low to High
// already holds both the price paid and A, so nothing is clamped or widened.
// To the nearest $25,000: $1,850,000 / $2,050,000 / $2,275,000.
test("a vetted first-year sale leads the row: nine tenths the sale at today's prices, one tenth the comps", () => {
  const got = value();
  assert.deepEqual(dollars(got), [1850000, 2050000, 2275000]);
  assert.deepEqual(compDollars(got), COMPS, "what the comps alone said rides beside the blend, untouched");
  assert.deepEqual(dollars(compsAlone()), COMPS, "and it is the figure the same report gives with no sale in it");

  const own = got.own_sale;
  assert.equal(own.anchored, true);
  assert.equal(own.weight, 0.9, "with comps beside it the sale is nine tenths of the figure, never all of it");
  assert.equal(own.half, null);
  assert.equal(own.price, 2000000, "the price as paid");
  assert.equal(own.date, SOLD);
  assert.equal(own.indexed, 2100000, "the price moved to the report date by the report's own trend");
  assert.equal(own.refused, null);

  // The row's $/SF is its dollars over its size, so it still multiplies out:
  // 1,850,000 / 20,000 = 92.5, 2,050,000 / 20,000 = 102.5, 2,275,000 / 20,000 = 113.75.
  assert.deepEqual(perSf(got), [92.5, 102.5, 113.75]);
  assert.deepEqual(perSf(got).map((psf) => psf * got.size_sqft), dollars(got));
  // The counts still describe the comps the sale was checked against.
  assert.deepEqual([got.sized, got.sale_comps, got.comp_count, got.trimmed], [true, 5, 5, true]);
});

// THE LEGACY GUARANTEE. Every report cached, saved or shared before this rule
// holds a sale nobody vetted: never asked for a basis, never matched to an
// address, its source never read. The server's stamp is the one thing that
// tells such a sale from a vetted one, so without it the row has to be the row
// it always was, to the dollar. Otherwise every run already on somebody's
// screen moves the next time a size is typed into it.
test("a report whose sale was never stamped is valued exactly as it was before the rule", () => {
  const before = compsAlone();
  assert.deepEqual(dollars(before), COMPS);
  assert.equal(before.own_sale, null);
  // The strongest sale there could be, short only of the stamp.
  for (const stamp of ["no key at all", null, 0, false]) {
    const got = value((r) => {
      if (stamp === "no key at all") delete r.subject_last_sale.settled;
      else r.subject_last_sale.settled = stamp;
    });
    const how = `settled: ${stamp}`;
    assert.deepEqual(figures(got), figures(before), how);
    assert.equal(got.own_sale.refused, "unsettled", how);
    assert.equal(got.own_sale.anchored, false, how);
    assert.equal(got.own_sale.weight, 0, how);
  }
  // The rows that had no dollar figure still have none: with no size it is the
  // $/SF band alone, and with no priced sale comps it is nothing at all.
  const legacy = (r) => { delete r.subject_last_sale.settled; };
  const unsized = value((r) => { legacy(r); r.subject_size_sqft = ""; });
  assert.deepEqual(figures(unsized), figures(compsAlone((r) => { r.subject_size_sqft = ""; })));
  assert.deepEqual(dollars(unsized), [null, null, null]);
  assert.equal(value((r) => { legacy(r); r.comps = []; }), null);
});

// The sale has to be recorded for THIS building, and the address the row was
// run on is what says which building that is. A caller that forgot it would
// otherwise lean on whatever sale the report happened to hold.
test("a caller that passes no address gets the comps alone, and the row says no address was given", () => {
  for (const address of [undefined, null, "", "   "]) {
    const got = value(null, { address });
    const how = `address: ${JSON.stringify(address)}`;
    assert.equal(got.own_sale.refused, "no_address", how);
    assert.equal(got.own_sale.anchored, false, how);
    assert.deepEqual(figures(got), figures(compsAlone(null, { address })), how);
    assert.deepEqual(dollars(got), COMPS, how);
  }
});

// Three ways a caller says "do not lean", each the page's own (ownSaleBlend).
// A leases-only search headlines a rent and net lease mode a cap rate, so no
// sale is weighed and the row says nothing of one (null, the page's "no sale
// was weighed"). The member's switch on a saved report, and the server's
// OWN_SALE=off, which the callers pass the same way, are a refusal with a name.
// A caller that dropped one of the three would print a row that leans beside a
// report that does not.
test("a leases-only run, net lease mode and the off switch each leave the row on the comps", () => {
  for (const opts of [{ txFocus: "leases" }, { netLease: true }]) {
    const got = value(null, opts);
    assert.equal(got.own_sale, null, JSON.stringify(opts));
    assert.deepEqual(figures(got), figures(compsAlone(null, opts)), JSON.stringify(opts));
    assert.deepEqual(dollars(got), COMPS, JSON.stringify(opts));
  }
  const off = value(null, { ownSaleOff: true });
  assert.equal(off.own_sale.refused, "off");
  assert.equal(off.own_sale.anchored, false);
  assert.equal(off.own_sale.weight, 0);
  assert.deepEqual(figures(off), figures(compsAlone(null, { ownSaleOff: true })));
  assert.deepEqual(dollars(off), COMPS);
  // And the other values of each do not switch it off by being present.
  for (const opts of [{ txFocus: "sales" }, { netLease: false }, { ownSaleOff: false }]) {
    assert.equal(value(null, opts).own_sale.weight, 0.9, JSON.stringify(opts));
  }
});

// A price the member typed on the row (their Asking column) is their question
// ("is $2M right?"), and a question must not move the answer. Read as the
// building's listing, a typed price equal to the sale price would switch the
// sale off, and one far from it would halve it: the row would drop toward the
// comps because of what the member typed. It may still weight the comps
// (subjectPsfOf), which is why only the sale's own fields are compared.
test("the row's own asking price never decides whether the sale is used or how much it weighs", () => {
  const plain = value();
  // The sale price (two spellings), the sale at today's prices, and far either side.
  for (const askingPrice of [2000000, "$2,000,000", 2100000, 5000000, 900000]) {
    const got = value(null, { askingPrice });
    const how = `a typed asking price of ${askingPrice}`;
    assert.deepEqual(got.own_sale, plain.own_sale, how);
    assert.equal(got.own_sale.anchored, true, how);
    assert.equal(got.own_sale.weight, 0.9, how);
  }
});

// The listing the SEARCH found is evidence about the building, and it touches
// the sale two ways. A "sale" at exactly today's asking price is the listing
// read as a closing, and leaning on it would hand an owner their own ask back
// as a value. And a building listed more than a quarter away from what it
// sold for at today's prices has two prices that disagree (work done since,
// income changed, a hopeful ask), so the sale counts for half:
//   w = 0.9 / 2 = 0.45, under a half, so the comps lead and nothing is clamped
//   Likely  0.45 x 2,100,000 + 0.55 x 1,675,000 = 945,000 + 921,250 = 1,866,250, shown as $1,875,000
test("the listing the search found refuses a sale at its own price, and halves one it is more than a quarter away from", () => {
  const listedAt = (price) => (r) => { r.subject_asking = { price }; };
  // "$2M" is how a listing page writes it: read as a plain number it is 2, and no ask at all.
  for (const price of ["$2,000,000", "$2M", 2000000]) {
    const got = value(listedAt(price));
    assert.equal(got.own_sale.refused, "matches_asking", `listed at ${price}`);
    assert.equal(got.own_sale.anchored, false, `listed at ${price}`);
    assert.deepEqual(figures(got), figures(compsAlone(listedAt(price))), `listed at ${price}`);
    assert.deepEqual(dollars(got), COMPS, `listed at ${price}`);
  }
  // 29% over $2,100,000, and 33% under it (35% over and 30% under the price paid).
  for (const price of ["$2,700,000", "$2.7M", "$1,400,000"]) {
    const got = value(listedAt(price));
    assert.equal(got.own_sale.anchored, true, `listed at ${price}`);
    assert.equal(got.own_sale.half, "ask_far", `listed at ${price}`);
    assert.equal(got.own_sale.weight, 0.45, `listed at ${price}`);
    assert.equal(got.value_likely, 1875000, `listed at ${price}`);
  }
  // 10% over $2,100,000 (15% over the price paid): the two prices agree, and nothing changes.
  const close = value(listedAt("$2,300,000"));
  assert.deepEqual([close.own_sale.half, close.own_sale.weight, close.value_likely], [null, 0.9, 2050000]);
});

// Six and eighteen months before the report, in a market where the search saw
// no clear trend (null), so the sale at today's prices IS the price paid.
const SIX_MONTHS = "2024-05-27", EIGHTEEN_MONTHS = "2023-05-27";
const flat = (date, more) => (r) => {
  r.annual_price_trend_pct = null;
  r.subject_last_sale.date = date;
  if (more) more(r);
};
const oneComp = (r) => { r.comps = [r.comps[2]]; };          // the $80/SF sale
const leasesOnly = (r) => {
  r.comps = [{ address: "90 Dock Rd, Tampa, FL", transaction: "Lease", date: SOLD, size_sqft: String(SIZE), price_or_rate: "$9.00/SF/yr" }];
};
const noSize = (r) => { r.subject_size_sqft = ""; };
// Alone, the weight is 1: Likely is A, and Low and High are A less and plus 10%.
const SALE_ALONE = [1800000, 2000000, 2200000];

// With fewer than two priced sales the comps are not a range the sale can be
// held against (the page's floor for a comps figure), so the sale would be the
// whole headline. Only the strongest kind may be: a clean sale inside its
// first year. Anything weaker is refused, or a row would rest 100% on a price
// that carries 45% (a leaseback) or 67.5% (eighteen months old) when there are
// comps beside it, only because the comps were thin.
test("with fewer than two priced sale comps, only a clean first-year sale stands alone", () => {
  // One comp is a point, not a range: 80 x 20,000 = $1,600,000. It is shown, not blended in.
  const alone = value(flat(SIX_MONTHS, oneComp));
  assert.deepEqual(dollars(alone), SALE_ALONE);
  assert.equal(alone.own_sale.anchored, true);
  assert.equal(alone.own_sale.weight, 1, "the row says the sale is the whole figure");
  assert.deepEqual(compDollars(alone), [1600000, 1600000, 1600000]);
  assert.deepEqual(perSf(alone), [90, 100, 110], "the sale's dollars over 20,000 SF");
  assert.equal(alone.sale_comps, 1);

  // No priced sale at all (a report of leases): the same figures, and no comps' figure to show.
  const noSales = value(flat(SIX_MONTHS, leasesOnly));
  assert.deepEqual(dollars(noSales), SALE_ALONE);
  assert.deepEqual(compDollars(noSales), [null, null, null]);
  assert.deepEqual([noSales.sale_comps, noSales.lease_comps, noSales.own_sale.weight], [0, 1, 1]);

  // An eighteen-month-old sale (0.9 x (3 - 1.5) / 2 = 0.675 beside comps) and a
  // sale-leaseback (half weight) are real evidence, and not enough alone.
  for (const [what, weaker, half] of [
    ["an eighteen-month-old sale", flat(EIGHTEEN_MONTHS), null],
    ["a sale-leaseback", flat(SIX_MONTHS, (r) => { r.subject_last_sale.basis = "sale_leaseback"; }), "sale_leaseback"],
  ]) {
    const thin = (r) => { weaker(r); oneComp(r); };
    const got = value(thin);
    assert.equal(got.own_sale.refused, "alone_weak", what);
    assert.equal(got.own_sale.anchored, false, what);
    assert.equal(got.own_sale.half, half, what);
    assert.deepEqual(figures(got), figures(compsAlone(thin)), `${what}: the row is the one comp's figure, as it was before the rule`);
    assert.deepEqual(dollars(got), [1600000, 1600000, 1600000], what);
    assert.equal(value((r) => { weaker(r); leasesOnly(r); }), null, `${what} and no priced sale comps: nothing to value`);
  }
});

// "We found the market but not your building's size" used to mean a $/SF band
// and no dollars. A building that just sold has a dollar figure whatever its
// size, so the row carries it. But with no size the comps have no dollar
// figure to check the sale against, so the alone rule applies here too.
test("a row with no size carries the dollar figures of a clean first-year sale, and of nothing weaker", () => {
  const unsized = value(flat(SIX_MONTHS, noSize));
  assert.deepEqual([unsized.sized, unsized.size_sqft], [false, null]);
  assert.deepEqual(dollars(unsized), SALE_ALONE);
  assert.equal(unsized.own_sale.weight, 1);
  assert.deepEqual(compDollars(unsized), [null, null, null], "with no size the comps have no dollar figure");
  // The $/SF band is still the comps' own, with no trend to move it: a quarter
  // of the way from 64 to 72, the middle one, three quarters of the way from 88 to 96.
  [66, 80, 94].forEach((want, i) => near(perSf(unsized)[i], want, "the comps' $/SF band"));
  assert.equal(unsized.sale_comps, 5);

  // A weaker sale leaves the row what it always was: the band, and no dollars.
  const weak = value(flat(EIGHTEEN_MONTHS, noSize));
  assert.equal(weak.own_sale.refused, "alone_weak");
  assert.deepEqual(dollars(weak), [null, null, null]);
  assert.deepEqual(figures(weak), figures(compsAlone(flat(EIGHTEEN_MONTHS, noSize))));

  // Neither a size nor a priced comp: the sale is all there is, and it is enough.
  const bare = value(flat(SIX_MONTHS, (r) => { noSize(r); leasesOnly(r); }));
  assert.deepEqual(dollars(bare), SALE_ALONE);
  assert.deepEqual([bare.sized, ...perSf(bare)], [false, null, null, null]);

  // Null only when there is nothing to value: no priced comp, and no sale the rule will use.
  for (const [what, unusable] of [
    ["no sale", (r) => { delete r.subject_last_sale; }],
    ["a sale the server never stamped", (r) => { delete r.subject_last_sale.settled; }],
    ["a sale of the building next door", (r) => { r.subject_last_sale.address = "502 Commerce Way, Tampa, FL 33602"; }],
  ]) {
    assert.equal(value(flat(SIX_MONTHS, (r) => { noSize(r); leasesOnly(r); unusable(r); })), null, what);
  }
});

// More than 3x apart, the sale and the comps are describing different things
// (a portfolio's price on one building, a wrong size, comps of another kind)
// and nothing here can say which. Leaning 90% on the sale then is a coin toss
// with the whole headline, so the comps stand and the row carries both figures.
//   $6,000,000 x 1.05 = $6,300,000, and 6,300,000 / 1,675,000 = 3.76
//   $500,000 x 1.05 = $525,000, and 525,000 / 1,675,000 = 0.31, under a third
// Both are prices a 20,000 SF building can fetch ($300 and $25 a square foot),
// so it is the comps that refuse them and not the price alone.
test("a sale more than three times the comps, or under a third of them, is refused and the row keeps the comps' figures", () => {
  for (const [price, indexed] of [["$6,000,000", 6300000], ["$500,000", 525000]]) {
    const got = value((r) => { r.subject_last_sale.price = price; });
    assert.equal(got.own_sale.refused, "disagree", price);
    assert.equal(got.own_sale.anchored, false, price);
    assert.equal(got.own_sale.weight, 0, price);
    assert.equal(got.own_sale.indexed, indexed, `${price} at today's prices, so a caller can say how far apart the two are`);
    assert.deepEqual(figures(got), figures(compsAlone()), price);
    assert.deepEqual(dollars(got), COMPS, price);
  }
});

// The rule was measured on Industrial, Office and Retail and on nothing else.
// A house is bought, redone and resold inside a year, an apartment building is
// bought to be renovated, land to be entitled: a recent price says less about
// today, and nobody has measured how much less. Bulk runs every type, and a
// caller that passed no type at all must not lean either.
test("only an Industrial, Office or Retail row leans on the sale", () => {
  for (const propertyType of ["Office", "Retail"]) {
    const got = value(null, { propertyType });
    assert.deepEqual([got.own_sale.anchored, got.own_sale.weight, got.value_likely], [true, 0.9, 2050000], propertyType);
  }
  for (const propertyType of ["Residential", "Multifamily", "Land", undefined]) {
    const got = value(null, { propertyType });
    assert.equal(got.own_sale.refused, "type", String(propertyType));
    assert.equal(got.own_sale.anchored, false, String(propertyType));
    assert.deepEqual(figures(got), figures(compsAlone(null, { propertyType })), String(propertyType));
  }
});

// The costliest mistake: a price leaned on that is not this building's own.
// The search is asked which address each sale is recorded for and what area it
// covered, and the row hands the rule its own address, size, currency and year
// built to hold that against. Each of these is a real sale, and none is what
// this building is worth, so each leaves the row on the comps and says why.
const portfolio = (r) => { r.subject_last_sale.basis = "portfolio"; };
const NOT_THIS_BUILDINGS_PRICE = [
  ["the building next door", (r) => { r.subject_last_sale.address = "502 Commerce Way, Tampa, FL 33602"; }, "other_address"],
  ["the same street address in another city", (r) => { r.subject_last_sale.address = "500 Commerce Way, Orlando, FL"; }, "other_address"],
  ["one unit of the building", (r) => { r.subject_last_sale.address = "500 Commerce Way Unit 4, Tampa, FL 33602"; }, "unit"],
  ["a sale the search put no address to", (r) => { delete r.subject_last_sale.address; }, "no_address"],
  ["a sale that covered 45,000 SF, on a row valuing 20,000", (r) => { r.subject_last_sale.size_sqft = "45000"; }, "scope"],
  ["a portfolio's price", portfolio, "basis"],
  ["a sale from the year before the building was built", (r) => { r.subject_year_built = "2024"; }, "predates_building"],
  ["a report in another currency", (r) => { r.currency = "CAD"; }, "currency"],
];
test("a sale that is not this building's own price leaves the row on the comps, and says why", () => {
  for (const [what, change, reason] of NOT_THIS_BUILDINGS_PRICE) {
    const got = value(change);
    assert.equal(got.own_sale.refused, reason, what);
    assert.equal(got.own_sale.anchored, false, what);
    assert.deepEqual(figures(got), figures(compsAlone(change)), `${what}: the comps' own figures`);
    assert.deepEqual(dollars(got), COMPS, what);
  }
  assert.equal(value(portfolio).own_sale.why, "portfolio", "the kind of sale rides out with the refusal");
  // The size the sale's area is held against is the size the row is valued at,
  // and a size the member typed wins there as it does everywhere else: at
  // 40,000 SF this 20,000 SF sale is half the building.
  const retyped = value(null, { subjectSizeSqft: 40000 });
  assert.equal(retyped.own_sale.refused, "scope");
  assert.deepEqual(figures(retyped), figures(compsAlone(null, { subjectSizeSqft: 40000 })));
});

// The search can hand back the building's real address when the typed one was
// wrong (subject_address_corrected: the next town over, a misspelled city),
// and the sale is recorded under the real one. The page matches the sale
// against every name the report has for the subject, so the row has to as
// well, or a member who mistyped a city gets a row valued on comps beside a
// report that leans on the sale.
test("a sale recorded under the address the search corrected to is still the building's own", () => {
  const typed = "500 Commerce Way, Temple Terrace, FL";
  const corrected = value((r) => { r.subject_address_corrected = ADDRESS; }, { address: typed });
  assert.deepEqual([corrected.own_sale.anchored, corrected.own_sale.weight], [true, 0.9]);
  assert.deepEqual(dollars(corrected), [1850000, 2050000, 2275000]);
  // With no correction, a sale in Tampa is another place's as far as the row can tell.
  assert.equal(value(null, { address: typed }).own_sale.refused, "other_address");
});

// The worker files the report it just valued under the member's recent
// searches, and the re-value route writes a saved payload back. A valuation
// that edited the report it was handed (dropped the stamp, rounded the price,
// sorted the comps) would change what is stored, and what the next reader sees.
test("valuing a report does not change it", () => {
  const deepFreeze = (o) => {
    Object.values(o).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); });
    return Object.freeze(o);
  };
  for (const change of [
    null,                                                                  // leaned on
    (r) => { delete r.subject_last_sale.settled; },                        // refused
    (r) => { r.subject_asking = { price: "$2.7M" }; },                     // halved
    flat(SIX_MONTHS, (r) => { noSize(r); leasesOnly(r); }),                // alone
  ]) {
    const report = structuredClone(REPORT);
    if (change) change(report);
    const before = structuredClone(report);
    // Frozen all the way down, and both modules run in strict mode: a write throws.
    const got = BULK.valueFromReport(deepFreeze(report), Object.freeze({ ...OPTS, askingPrice: 2000000 }));
    assert.ok(got && got.own_sale, "the case was valued, and its sale considered");
    assert.deepEqual(report, before);
  }
});

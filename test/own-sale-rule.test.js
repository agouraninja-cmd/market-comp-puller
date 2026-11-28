// The building's own sale: THE RULE (valuation.js, "The building's own sale
// (2026-11-27)"). A vetted sale of the subject itself from the last three
// years leads Low / Likely / High, and the comps become the check on it:
//   Likely = w x A + (1 - w) x the comps' Likely
// A is the price moved to the report date by the market's trend; w is 0.9
// through the first year, then a straight line to nothing at three. One price
// can carry nine tenths of a headline, so this file holds the three ways that
// costs money: a WRONG sale leaned on, a good sale silently carrying the whole
// figure, and an older report changing value. That section's header comment
// is the specification, and every expected figure here is worked out from it
// by hand, with the arithmetic beside it. None is pasted from a run.
//
// Run: node --test test/own-sale-rule.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../valuation.js");

// The sale's date is ISO (read in UTC on any machine) and each report date is
// built FROM it, so a case is exactly as old as it says.
const YEAR_MS = 365.25 * 24 * 3600 * 1000, DAY_MS = 24 * 3600 * 1000;
const SOLD = "2025-06-16", SOLD_MS = Date.parse(SOLD);
const reportAt = (years) => SOLD_MS + years * YEAR_MS;
const ADDRESS = "100 Main St, Columbus, OH 43215";      // Ohio, where a deed shows the price

// A sale the rule leans on in full, and the options of a report that lets it:
// $2,000,000 for 20,000 SF ($100 a square foot), closed half a year before the
// report, an ordinary sale cited to a news page, recorded for this address and
// stamped by the server. No trend, so A is the price itself.
// Every case below breaks ONE thing about this pair.
function good(saleOver, optsOver) {
  return {
    sale: { date: SOLD, price: "$2,000,000", source_url: "https://news.example.com/deals/100-main-st-sells",
      source_type: "news", address: ADDRESS, basis: "arms_length", settled: 1, ...saleOver },
    opts: { asOf: reportAt(0.5), trendPct: null, propertyType: "Industrial", currency: "USD", yearBuilt: 1998,
      asking: null, subjectAddresses: [ADDRESS], subjectSize: 20000, off: false, ...optsOver },
  };
}
const anchor = (saleOver, optsOver) => { const g = good(saleOver, optsOver); return V.ownSaleAnchor(g.sale, g.opts); };
const refused = (saleOver, optsOver) => anchor(saleOver, optsOver).reason;      // undefined when it is leaned on
const because = (saleOver, optsOver) => { const a = anchor(saleOver, optsOver); return [a.reason, a.why]; };
const blend = (comps, saleOver, optsOver) => { const g = good(saleOver, optsOver); return V.valueWithOwnSale(comps, g.sale, g.opts); };
const figures = (r) => ({ low: r.low, mid: r.mid, high: r.high });
const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, `${what}: wanted ${want}, got ${got}`);

// --- The curves: weight, allowance, index ------------------------------------

// 0.9 is arithmetic on two outside figures (comps miss by about 28%, one
// arm's-length price is good to about 10%: 28^2 / (28^2 + 10^2) = 0.89), and
// three years is the look-back the appraisal standard names. A curve that ran
// longer, or gave an unreadable age anything but nothing, would lean on a price
// that no longer describes the building. One sale is also one buyer's price,
// hence the allowance, and an older one says less about today.
test("the sale's weight is 0.9 through its first year and falls in a straight line to nothing at three, and its allowance widens from 10%", () => {
  for (const age of [0, 0.5, 1]) near(V.ownSaleWeight(age), 0.9, `${age} years`);
  // Past the first year: 0.9 x (3 - age) / (3 - 1).
  for (const [age, want] of [[1.5, 0.675], [2, 0.45], [2.5, 0.225]]) near(V.ownSaleWeight(age), want, `0.9 x ${3 - age} / 2`);
  for (const age of [3, 3.01, 5, 30]) assert.equal(V.ownSaleWeight(age), 0, `${age} years: nothing is left at three and after`);
  // A sale dated after the report, or an age that is not a number, weighs nothing.
  for (const age of [-0.01, -2, NaN, undefined, "soon"]) assert.equal(V.ownSaleWeight(age), 0, `an age of ${String(age)}`);
  // Either side of the sale: 10% in the first year, five more points for each year after.
  for (const [age, want] of [[0, 0.10], [0.5, 0.10], [1, 0.10], [1.5, 0.125], [2, 0.15]]) near(V.ownSaleSpread(age), want, `the allowance at ${age} years`);
});

// The trend is the search's own estimate (-2.5, +1.5 and +0.5 for one office
// across three runs). On a comp it moves one vote among several; here it
// multiplies most of the headline, so it is held to 10% a year and 15% in all.
test("the price is moved to the report date by the market's trend, held to 10% a year and 15% in all", () => {
  for (const none of [null, undefined, NaN, 0]) assert.equal(V.ownSaleIndex(SOLD, reportAt(1), none), 1, `a trend of ${String(none)}`);
  for (const [years, trendPct, want, why] of [
    [1, 5, 1.05, "5% a year for one year"],
    [2, 6, 1.1236, "6% a year for two years is 1.06 x 1.06, under both caps"],
    [1, 25, 1.10, "the yearly cap: a 25% trend is read as 10%"],
    [1, -25, 0.90, "the yearly cap, falling"],
    [2, 10, 1.15, "the cap in all: 10% a year for two years would be 1.21"],
    [2, -10, 0.85, "the cap in all, falling: it would be 0.81"],
  ]) near(V.ownSaleIndex(SOLD, reportAt(years), trendPct), want, why);
});

// --- ownSaleAnchor: when the sale is leaned on, and every reason it is not ---

test("the known-good sale is leaned on in full, and a report that carries no sale gets no answer at all", () => {
  const a = anchor();
  assert.deepEqual([a.ok, a.half], [true, null]);
  // No trend, so the sale at today's prices (`value`) is the price paid.
  for (const [key, want] of [["price", 2000000], ["value", 2000000], ["ageYears", 0.5], ["weight", 0.9], ["spread", 0.10]]) near(a[key], want, key);
  // null is "the report carries none", which every reader takes as nothing to say.
  for (const none of [null, undefined, "sold in 2025", {}, { source_url: "https://news.example.com/deals/x" }, { price: "", date: "  " }]) {
    assert.equal(V.ownSaleAnchor(none, good().opts), null, JSON.stringify(none));
  }
});

// A recorded "sale" for $10 is a deed for nominal consideration, a bare year
// cannot be aged, a date ahead of the report is a deal announced and not
// closed, and under a tenth of the answer a sale is history, not evidence.
test("a sale with no usable price, no readable date, a date ahead of the report, or too many years on it, is refused", () => {
  for (const price of ["", "Undisclosed", "$1", "$10", "about $2M", "$1.9M to $2.1M"]) assert.equal(refused({ price }), "no_price", JSON.stringify(price));
  for (const date of ["", "2025", "sometime in 2025", "2025-02-30"]) assert.equal(refused({ date }), "no_date", JSON.stringify(date));
  // Two days of slack, for clocks and time zones: it counts as closed today.
  for (const hours of [24, 47]) near(anchor({}, { asOf: SOLD_MS - hours * 3600 * 1000 }).weight, 0.9, `dated ${hours} hours after the report`);
  for (const days of [3, 30, 400]) assert.equal(refused({}, { asOf: SOLD_MS - days * DAY_MS }), "future", `dated ${days} days after the report`);
  // 0.9 x (3 - age) / 2 falls under a tenth once the age passes 3 - 0.2222 = 2.78 years.
  near(anchor({}, { asOf: reportAt(2.7) }).weight, 0.135, "at 2.7 years 0.9 x 0.3 / 2 still counts");
  for (const years of [2.8, 3, 4, 12]) assert.equal(refused({}, { asOf: reportAt(years) }), "old", `${years} years`);
});

// Measured on Industrial, Office and Retail and on no other type (a house is
// bought, redone and resold inside a year, land is bought to be entitled), in
// dollars. The stamp is the server saying it vetted THIS sale: asked for its
// basis, matched it to the address, checked its link. The switch is the member's
// one guard for what no public record shows (a renovation, a fire).
test("only a stamped sale on an Industrial, Office or Retail report in US dollars is leaned on, and the member or the server can turn it off", () => {
  for (const propertyType of ["Industrial", "Office", "Retail"]) assert.equal(anchor({}, { propertyType }).ok, true, propertyType);
  for (const propertyType of ["Residential", "Multifamily", "Land", undefined, "constructor"]) assert.equal(refused({}, { propertyType }), "type", String(propertyType));
  for (const currency of ["CAD", "EUR", "MXN"]) assert.equal(refused({}, { currency }), "currency", currency);
  for (const settled of [undefined, null, 0, false, "1", "yes"]) assert.equal(refused({ settled }), "unsettled", `settled: ${JSON.stringify(settled)}`);
  assert.equal(refused({}, { off: true }), "off");
  // The server's two findings ride out as `why`, because the page says which.
  for (const why of ["dead_source", "page_lacks_price"]) assert.deepEqual(because({ unusable: why }), ["unusable", why]);
});

// The first draft leaned on 9 sales it should not have. A portfolio's price is
// several buildings' money, a related-party or distressed price was not set by
// a market, a "land" price bought something that is not this building. And a
// blank is not a clean bill, nor is "unknown", the search's own word for not
// being able to tell: a caveat may cost a good sale, never pass for a clean one.
test("a sale that is not an ordinary sale of the whole property is refused, and says what kind it was", () => {
  const words = ["portfolio", "leasehold", "redevelopment", "partial_interest", "related_party", "distressed", "land", "not_closed"];
  const blanks = [["", "unstated"], [undefined, "unstated"], ["   ", "unstated"], ["unknown", "other"], ["a very good deal", "other"]];
  // The second word is the kind, which the page words its sentence from.
  for (const [basis, why] of words.map((w) => [w, w]).concat(blanks)) assert.deepEqual(because({ basis }), ["basis", why], JSON.stringify(basis));
});

// The prompt asks for "the page that states it". Of the own sales the audit
// found cited to a bare home page, one was an asking price and one a portfolio
// allocation; another was cited to a flyer image uploaded before the sale.
test("a sale with no link to a page that could state its price is refused", () => {
  const flyer = "https://news.example.com/flyers/100-main-st.jpg";
  for (const source_url of ["", undefined, "see county records", "https://news.example.com", "https://news.example.com/", flyer]) {
    assert.equal(refused({ source_url }), "no_source", JSON.stringify(source_url));
  }
  assert.deepEqual(because({ source_type: "estimate" }), ["no_source", "estimate_source"], "the search called its own source an estimate");
});

// Without a stated address nothing can tell this building's sale from the one
// next door's, and one unit's price is not the building's.
test("the sale has to be recorded for this address, and for the whole building", () => {
  for (const address of ["", undefined]) assert.equal(refused({ address }), "no_address", "the sale gives no address");
  for (const subjectAddresses of [[], undefined, [undefined, ""]]) assert.equal(refused({}, { subjectAddresses }), "no_address", "the report names no subject");
  for (const address of ["102 Main St, Columbus, OH 43215", "100 High St, Columbus, OH 43215", "100 Main St, Dayton, OH 45402"]) {
    const a = anchor({ address });
    assert.deepEqual([a.reason, a.saleAddress], ["other_address", address], "the page names the address it was recorded for");
  }
  // A city can hold a 100 N Main St and a 100 S Main St that differ only by ZIP, so for LEANING another ZIP is another place.
  assert.equal(refused({ address: "100 Main St, Columbus, OH 43004" }), "other_address", "this city, another ZIP");
  assert.equal(anchor({ address: "100 Main Street, Columbus, OH" }).ok, true, "another spelling of this address is this building");
  assert.equal(anchor({}, { subjectAddresses: ["100 Main St, Worthington, OH", ADDRESS] }).ok, true, "any of the report's names for the subject will do");
  assert.equal(refused({ address: "100 Main St Unit 5, Columbus, OH 43215" }), "unit", "the sale is of one unit");
  assert.equal(refused({}, { subjectAddresses: ["100 Main St Suite 200, Columbus, OH 43215"] }), "unit", "the subject is one unit");
});

// What the same report says about the subject can show the "sale" is something
// else. In the audit the harmless differences in area (rentable against gross)
// were under 10% and the harmful ones (two buildings, a whole park) 1.9x and up.
// No whole building sells under $15 or over $2,500 a square foot. Built after it
// "sold", the price bought the land. At the listing's price, it is the listing.
test("a sale of a different area, at an impossible price a square foot, from before the building stood, or at the listing's own price, is refused", () => {
  for (const [size_sqft, saleSize] of [["23,200", 23200], ["16,800", 16800], ["40,000", 40000]]) {     // 16% over, 16% under, double
    const a = anchor({ size_sqft });
    assert.deepEqual([a.reason, a.saleSize, a.subjectSize], ["scope", saleSize, 20000], "the page prints both sizes");
  }
  for (const size_sqft of ["22,800", "17,200", "20,000"]) assert.equal(anchor({ size_sqft }).ok, true, `${size_sqft} SF is inside 15%`);
  for (const [price, psf] of [["$12,450", "62 cents: a record printed in thousands"], ["$280,000", "$14"], ["$60,000,000", "$3,000"]]) {
    assert.equal(refused({ price }), "implausible", `${psf} a square foot`);
  }
  assert.equal(refused({}, { subjectSize: 500 }), "implausible", "a whole building's price on a 500 SF suite: $4,000 a square foot");
  for (const price of ["$400,000", "$40,000,000"]) assert.equal(anchor({ price }).ok, true, `${price} is $20 or $2,000 a square foot`);
  for (const yearBuilt of [2026, "2026", 2031]) assert.equal(refused({}, { yearBuilt }), "predates_building", `built ${yearBuilt}`);
  assert.equal(anchor({}, { yearBuilt: 2025 }).ok, true, "built and sold in one year is a sale of the building");
  assert.equal(refused({}, { asking: 2000000 }), "matches_asking");
  assert.equal(refused({}, { asking: 2000000, asOf: reportAt(1), trendPct: 5 }), "matches_asking", "it is the price as recorded that is compared");
});

// The page has a sentence for most refusals and deliberately none for an old
// sale or an unstamped one. Judged in another order, every report saved before
// the rule (no basis, no address on its sale) would grow a sentence saying the
// search "did not confirm it was an ordinary sale", and stop being the page it was.
test("an old sale is old whatever else is wrong with it, and an unstamped sale is unsettled before its basis or address is judged", () => {
  assert.equal(refused({ basis: "" }, { asOf: reportAt(3.5) }), "old");
  assert.equal(refused({ basis: "portfolio", address: "9 Elm St, Akron, OH 44301" }, { asOf: reportAt(4) }), "old");
  assert.equal(refused({ settled: undefined, basis: "" }), "unsettled");
  assert.equal(refused({ settled: undefined, basis: undefined, address: "9 Elm St, Akron, OH 44301", source_url: "" }), "unsettled");
});

// HALF: real evidence with a condition attached. A sale-leaseback's price was
// set together with a lease, an allocated price is a share of a larger deal, a
// listing page may show the last asking price, a Texas deed shows no price, and
// a building listed today far from what it sold for has two prices that disagree.
test("a sale with a condition attached counts for half as much, and says which condition", () => {
  const TEXAS = "100 Main St, Dallas, TX 75201";
  for (const [half, saleOver, optsOver] of [
    ["sale_leaseback", { basis: "sale_leaseback" }, {}],
    ["allocated", { basis: "allocated" }, {}],
    ["listing_page", { source_type: "listing" }, {}],
    ["listing_page", { source_url: "https://www.loopnet.com/Listing/100-Main-St-Columbus-OH/1234567/" }, {}],
    ["non_disclosure", { source_type: "public_record", address: TEXAS }, { subjectAddresses: [TEXAS] }],
    ["ask_far", {}, { asking: 2600000 }],      // listed 30% above what it sold for
    ["ask_far", {}, { asking: 1400000 }],      // and 30% below
  ]) {
    const a = anchor(saleOver, optsOver);
    assert.deepEqual([a.ok, a.half], [true, half]);
    near(a.weight, 0.45, `${half}: half of 0.9`);
    near(anchor(saleOver, { ...optsOver, asOf: reportAt(2) }).weight, 0.225, `${half} at two years: half of 0.45`);
  }
  assert.deepEqual([anchor({}, { asking: 2600000 }).askPct, anchor({}, { asking: 1400000 }).askPct], [30, -30], "the page says how far, and which way");
  // The same facts without the condition count in full.
  near(anchor({ address: TEXAS }, { subjectAddresses: [TEXAS] }).weight, 0.9, "a Texas price that a news page reports");
  near(anchor({}, { asking: 2400000 }).weight, 0.9, "listed 20% above the sale is inside a quarter");
  // The listing is measured against A: 2,600,000 is 30% over the price paid and 18% over 2,000,000 x 1.10.
  near(anchor({}, { asking: 2600000, asOf: reportAt(1), trendPct: 10 }).weight, 0.9, "listed 18% above the sale at today's prices");
  // Halved, it is history sooner: at 2.6 years 0.9 x 0.4 / 2 = 0.18 counts whole, and half of it, 0.09, does not.
  near(anchor({}, { asOf: reportAt(2.6) }).weight, 0.18, "whole at 2.6 years");
  assert.equal(refused({ basis: "sale_leaseback" }, { asOf: reportAt(2.6) }), "old", "halved at 2.6 years");
});

// The asking price here is the LISTING THE SEARCH FOUND, never the one a
// member typed. A typed price is the member's question ("is $9M right?"):
// read here, typing the sale's own price into the form would switch the sale
// off and drop the estimate by the whole gap to the comps under the cursor.
test("a typed asking price is not an input, and a listing price misread as a few dollars is ignored", () => {
  // Typed, under the names it travels by elsewhere (bulk.js, the page's subject range). Then "$1.05M" read as 1.05.
  for (const optsOver of [{ askingPrice: 2000000, priceMin: 2000000, priceMax: 2000000 }, { askingPrice: 2600000, priceMin: 2600000 },
    { asking: 1.05 }, { asking: 2600 }, { asking: 9999 }]) {
    const a = anchor({}, optsOver);
    assert.equal(a.half, null, JSON.stringify(optsOver));
    near(a.weight, 0.9, JSON.stringify(optsOver));
  }
});

// --- valueWithOwnSale: the estimate once the sale is weighed in --------------
// Dollar totals are rounded by heroRound: to the nearest $25,000 between $1M
// and $10M, which is every blended figure below ("shown as").

test("a clean first-year sale carries 90% of each figure and the comps carry the rest", () => {
  const comps = { low: 1500000, mid: 1800000, high: 2200000 };
  // No trend: A = 2,000,000, w = 0.9, allowance 10%.
  //   Likely  0.9 x 2,000,000 + 0.1 x 1,800,000 = 1,980,000, shown as 1,975,000
  //   Low     0.9 x 1,800,000 + 0.1 x 1,500,000 = 1,770,000, shown as 1,775,000
  //   High    0.9 x 2,200,000 + 0.1 x 2,200,000 = 2,200,000
  const flat = blend(comps);
  assert.deepEqual(figures(flat), { low: 1775000, mid: 1975000, high: 2200000 });
  assert.deepEqual([flat.anchored, flat.held, flat.refused], [true, false, null], "comps 10% under the sale are not held");
  near(flat.weight, 0.9, "the sale's share");
  assert.deepEqual(flat.comp, comps, "what the comps say on their own rides beside the blend");
  // A market rising 5% a year, exactly one year on: A = 2,000,000 x 1.05 = 2,100,000.
  //   Likely  0.9 x 2,100,000 + 0.1 x 1,800,000 = 2,070,000, shown as 2,075,000
  //   Low     0.9 x 1,890,000 + 0.1 x 1,500,000 = 1,851,000, shown as 1,850,000
  //   High    0.9 x 2,310,000 + 0.1 x 2,200,000 = 2,299,000, shown as 2,300,000
  const rising = blend(comps, {}, { asOf: reportAt(1), trendPct: 5 });
  near(rising.ownSale.value, 2100000, "the sale at today's prices");
  assert.deepEqual(figures(rising), { low: 1850000, mid: 2075000, high: 2300000 });
  // The page's lastValuation spells the middle figure "likely". Read as "no
  // comps", that spelling would hand the sale the whole headline without a word.
  const spelled = blend({ low: 1500000, likely: 1800000, high: 2200000 });
  assert.deepEqual([figures(spelled), spelled.anchored, spelled.comp], [figures(flat), true, comps]);
});

// Past 1.5x the comps are describing a different kind of building (valuation.js
// already calls 1.5x a different price tier), and unheld, the worst comp sets
// pulled hardest on the one figure that was right.
test("comps more than 1.5x from the sale are held at 1.5x before they are blended", () => {
  // A $3,000,000 sale against comps at half of it. Their Likely is lifted to
  // 3,000,000 / 1.5 = 2,000,000, and their Low and High by the same 4/3.
  //   Likely  0.9 x 3,000,000 + 0.1 x 2,000,000 = 2,900,000 (unheld: 2,850,000)
  //   Low     0.9 x 2,700,000 + 0.1 x 1,600,000 = 2,590,000, shown as 2,600,000
  //   High    0.9 x 3,300,000 + 0.1 x 2,400,000 = 3,210,000, shown as 3,200,000
  const cheap = { low: 1200000, mid: 1500000, high: 1800000 };
  const lifted = blend(cheap, { price: "$3,000,000" });
  assert.deepEqual(figures(lifted), { low: 2600000, mid: 2900000, high: 3200000 });
  assert.deepEqual([lifted.held, lifted.ratio], [true, 2], "the sale is twice the comps");
  assert.deepEqual(lifted.comp, cheap, "the comps' own figures are reported as they were, not as held");
  // Comps at twice a $2,000,000 sale come down to 2,000,000 x 1.5 = 3,000,000, a factor of 0.75.
  //   Likely  0.9 x 2,000,000 + 0.1 x 3,000,000 = 2,100,000
  //   Low     0.9 x 1,800,000 + 0.1 x 2,700,000 = 1,890,000, shown as 1,900,000
  //   High    0.9 x 2,200,000 + 0.1 x 3,600,000 = 2,340,000, shown as 2,350,000
  const lowered = blend({ low: 3600000, mid: 4000000, high: 4800000 });
  assert.deepEqual([figures(lowered), lowered.held], [{ low: 1900000, mid: 2100000, high: 2350000 }, true]);
});

// The comps are the check on the sale, and a check does not move the answer
// past its own margin. And a range that leaves out what the building actually
// sold for, while saying it leans on that sale, contradicts itself.
test("while the sale leads, Likely stays inside its allowance and the range holds both the price paid and the price at today's prices", () => {
  // A year and a half on: w = 0.9 x 1.5 / 2 = 0.675, allowance 12.5%. Comps 45% above
  // the sale would put Likely at 0.675 x 2,000,000 + 0.325 x 2,900,000 = 2,292,500,
  // 14.6% over the sale, so it is kept at 2,000,000 x 1.125 = 2,250,000.
  //   Low     0.675 x 1,750,000 + 0.325 x 2,500,000 = 1,993,750, shown as 2,000,000
  //   High    0.675 x 2,250,000 + 0.325 x 3,400,000 = 2,623,750, shown as 2,625,000
  const dear = { low: 2500000, mid: 2900000, high: 3400000 };
  const kept = blend(dear, {}, { asOf: reportAt(1.5) });
  near(kept.weight, 0.675, "the sale's share");
  assert.deepEqual(figures(kept), { low: 2000000, mid: 2250000, high: 2625000 });
  // Rising 10% for exactly a year: paid 2,000,000, A = 2,200,000, comps well above.
  //   Low     0.9 x 1,980,000 + 0.1 x 3,000,000 = 2,082,000, ABOVE the price paid, so Low is the price paid
  //   Likely  0.9 x 2,200,000 + 0.1 x 3,200,000 = 2,300,000
  //   High    0.9 x 2,420,000 + 0.1 x 3,400,000 = 2,518,000, shown as 2,525,000
  const rising = blend({ low: 3000000, mid: 3200000, high: 3400000 }, {}, { asOf: reportAt(1), trendPct: 10 });
  assert.deepEqual(figures(rising), { low: 2000000, mid: 2300000, high: 2525000 });
  // Falling 10% for a year: paid 2,000,000, A = 1,800,000, comps well below.
  //   High    0.9 x 1,980,000 + 0.1 x 1,300,000 = 1,912,000, BELOW the price paid, so High is the price paid
  //   Likely  0.9 x 1,800,000 + 0.1 x 1,250,000 = 1,745,000, shown as 1,750,000
  //   Low     0.9 x 1,620,000 + 0.1 x 1,150,000 = 1,573,000, shown as 1,575,000
  const falling = blend({ low: 1150000, mid: 1250000, high: 1300000 }, {}, { asOf: reportAt(1), trendPct: -10 });
  assert.deepEqual(figures(falling), { low: 1575000, mid: 1750000, high: 2000000 });
  // Under a half share the comps lead and the plain blend stands. Two years on,
  // w = 0.45 and the allowance is 15%, against the first case's comps:
  //   Likely  0.45 x 2,000,000 + 0.55 x 2,900,000 = 2,495,000, shown as 2,500,000 (25% over the sale)
  //   Low     0.45 x 1,700,000 + 0.55 x 2,500,000 = 2,140,000, shown as 2,150,000 (above the price paid)
  //   High    0.45 x 2,300,000 + 0.55 x 3,400,000 = 2,905,000, shown as 2,900,000
  assert.deepEqual(figures(blend(dear, {}, { asOf: reportAt(2) })), { low: 2150000, mid: 2500000, high: 2900000 });
});

// A refusal must cost the report nothing: the figures a caller prints are the
// comps' own, as they came. That includes the one refusal only the comps can
// cause: more than three times them, or under a third, one of the two describes
// a different thing (another building's size, a sale of more than this one).
test("a refused sale, and one more than three times the comps or under a third of them, leaves the comps' figures exactly as they were", () => {
  const comps = { low: 1512345, mid: 1803210, high: 2204567 };
  for (const [reason, saleOver, optsOver] of [["basis", { basis: "portfolio" }, {}], ["off", {}, { off: true }],
    ["other_address", { address: "102 Main St, Columbus, OH 43215" }, {}], ["old", {}, { asOf: reportAt(5) }], ["type", {}, { propertyType: "Land" }]]) {
    const r = blend(comps, saleOver, optsOver);
    assert.deepEqual([r.refused, r.ownSale.reason, r.anchored, r.weight, r.held], [reason, reason, false, 0, false]);
    assert.deepEqual(figures(r), comps, `${reason}: the comps' own figures, unrounded`);
  }
  for (const far of [{ low: 512345, mid: 650000, high: 801234 },            // the sale is 3.08x the comps
    { low: 6012345, mid: 6500000, high: 7001234 }]) {                       // the sale is 0.31x the comps
    const r = blend(far);
    assert.deepEqual([r.refused, r.anchored, r.weight], ["disagree", false, 0]);
    assert.deepEqual(figures(r), far, "not blended, not held, not rounded");
  }
  // Just inside (2.86x and 0.34x) the sale still leads, with the comps held.
  for (const mid of [700000, 5800000]) {
    const r = blend({ low: mid * 0.9, mid, high: mid * 1.1 });
    assert.deepEqual([r.anchored, r.held], [true, true], `comps at ${mid}`);
  }
  // No sale reported at all: the comps, and no refusal to explain.
  const none = V.valueWithOwnSale(comps, null, good().opts);
  assert.deepEqual([figures(none), none.refused, none.ownSale], [comps, null, null]);
});

// With nothing beside it to check it, only the strongest sale may be the whole headline.
test("with no comps, only a clean sale within its first year stands alone", () => {
  // w = 1: Likely is A, and Low and High are A less and plus 10%.
  const alone = blend(null);
  assert.deepEqual([figures(alone), alone.anchored, alone.weight, alone.comp], [{ low: 1800000, mid: 2000000, high: 2200000 }, true, 1, null]);
  assert.equal(blend(null, {}, { asOf: reportAt(1) }).anchored, true, "exactly one year on is still its first year");
  for (const [what, saleOver, optsOver] of [
    ["a sale-leaseback", { basis: "sale_leaseback" }, {}],
    ["a price from a listing page", { source_type: "listing" }, {}],
    ["a building listed today 30% above it", {}, { asking: 2600000 }],
    ["a sale thirteen months old", {}, { asOf: reportAt(13 / 12) }],
    ["a sale two years old", {}, { asOf: reportAt(2) }],
  ]) {
    const r = blend(null, saleOver, optsOver);
    assert.deepEqual([r.refused, r.anchored], ["alone_weak", false], what);
    assert.deepEqual(figures(r), { low: null, mid: null, high: null }, `${what}: no figure at all, not the sale's`);
  }
});

// A caller prints three figures in a row and nothing downstream re-sorts them,
// so a blend comes out in order even off comps that are not (the second shape).
test("Low never passes Likely and Likely never passes High, whatever the age, trend, comps or condition", () => {
  const STEP = 25000;          // figures are shown to the nearest $25,000 at these sizes
  let leaned = 0;
  for (const years of [0, 0.5, 1, 1.4, 1.8, 2, 2.5, 2.7]) for (const trendPct of [null, -10, -3, 4, 10]) for (const basis of ["arms_length", "sale_leaseback"]) {
    for (const scale of [0.4, 0.7, 1, 1.4, 2.5]) for (const [lo, hi] of [[0.85, 1.3], [1.2, 0.8]]) {      // comps at 40% to 250% of the price paid
      const comps = { low: 2000000 * scale * lo, mid: 2000000 * scale, high: 2000000 * scale * hi };
      const r = blend(comps, { basis }, { asOf: reportAt(years), trendPct });
      const at = `${years} years, trend ${trendPct}, ${basis}, comps x${scale} (${lo} to ${hi}): ${r.low} / ${r.mid} / ${r.high}`;
      if (!r.anchored) { assert.deepEqual(figures(r), comps, at); continue; }
      leaned++;
      assert.ok(r.low <= r.mid && r.mid <= r.high, at);
      if (r.weight < 0.5) continue;
      // While it leads, both promises of the "while the sale leads" test hold everywhere, to the rounding.
      const a = r.ownSale;
      assert.ok(Math.abs(r.mid - a.value) <= a.value * a.spread + STEP, `Likely left the sale's allowance: ${at}`);
      assert.ok(r.low <= Math.min(a.price, a.value) + STEP && r.high >= Math.max(a.price, a.value) - STEP, `the range lost the sale: ${at}`);
    }
  }
  assert.ok(leaned > 600, `only ${leaned} of 800 cases leaned on the sale, so the loop proves little`);
});

// --- ownSaleFrom: which sale is the building's own, and which rows are comps --

const comp = (address, over) => ({ address, transaction: "Sale", date: "2025-03-10", size_sqft: "20000", price_or_rate: "$1,900,000",
  source_type: "public_record", source_url: "https://records.example.gov/deeds/2025-0417", notes: "", ...over });
const REPORTED = { date: SOLD, price: "$2,000,000", source_url: "https://news.example.com/deals/100-main-st-sells" };
// The subject's own closing as it comes back among the comps: its address
// respelled, dated four days after the reported line, cited to a news page.
const OWN_ROW = comp("100 Main Street, Columbus, OH 43215", { date: "2025-06-20", price_or_rate: "$2,050,000", source_type: "news",
  source_url: "https://news.example.com/deals/100-main-st-trades", notes: "Sold to an owner-user." });

// The prompt forbids the subject's own sale among its comps and it turns up
// there anyway (11 of 47 audited reports). Left in, it is weighed once as a comp
// and again as the anchor. Its own asking price, entered as a comp, is worse:
// read as a closing it would be an ask carrying 90% of the value.
test("a sale of the subject among its comps comes out, its own listing comes back as a listing, and a lease at its address stays", () => {
  const lease = comp("100 Main St, Columbus, OH", { transaction: "Lease", price_or_rate: "$9.50/SF/yr" });
  const elm = comp("1 Elm St, Columbus, OH"), oak = comp("2 Oak Ave, Columbus, OH");
  const report = { subject_last_sale: { ...REPORTED }, comps: [elm, OWN_ROW, lease, oak] };
  const before = structuredClone(report);
  const out = V.ownSaleFrom(report, [ADDRESS]);
  assert.deepEqual([out.own, out.comps], [[OWN_ROW], [elm, lease, oak]], "a suite let in the building is a real lease comp for it");
  assert.deepEqual([out.sale, out.row, out.listing], [REPORTED, null, null], "the reported sale stands: the row is the same closing, four days on");
  assert.deepEqual(report, before, "the caller's report is not edited");
  // The address the search corrected the subject to is one of its names too:
  // typed by its locality, the building is recorded under its postal city.
  const typed = ["100 Main St, Worthington, OH"];
  assert.deepEqual(V.ownSaleFrom({ ...report, subject_address_corrected: ADDRESS }, typed).own, [OWN_ROW]);
  assert.deepEqual(V.ownSaleFrom(report, typed).own, [], "without the correction the typed city names another place");
  // One building saved under two ZIPs is still not a comp of itself, though nothing leans on that row (the anchor's rule).
  const otherZip = { ...OWN_ROW, address: "100 Main St, Columbus, OH 43004" };
  assert.deepEqual(V.ownSaleFrom({ comps: [otherZip, elm] }, [ADDRESS]).own, [otherZip]);
  for (const date of ["Active", "Listed Mar 2025"]) {
    const row = { ...OWN_ROW, date, price_or_rate: "$2,400,000" };      // priced and news-sourced: only its date says it is an ask
    const onMarket = V.ownSaleFrom({ comps: [row, elm] }, [ADDRESS]);
    assert.deepEqual([onMarket.listing, onMarket.sale, onMarket.row, onMarket.comps], [row, null, null, [elm]], date);
  }
});

// A report whose subject_last_sale came back without a price ("terms
// undisclosed") can hold that price one row down. But a listing-sourced row is
// how an ask becomes "what it sold for", and the corpus holds 135 sale rows
// whose notes say the price is a list price under a closed-sale date.
test("a same-building row becomes the sale only when it is a closed, well-sourced sale and the reported one is missing or older", () => {
  const from = (reported, rowOver) => V.ownSaleFrom({ subject_last_sale: reported, comps: [{ ...OWN_ROW, ...rowOver }] }, [ADDRESS]);
  const PROMOTED = { date: "2025-06-20", price: "$2,050,000", source_url: OWN_ROW.source_url, source_type: "news",
    address: OWN_ROW.address, size_sqft: "20000", from_comp: true };
  for (const [what, reported] of [
    ["no sale was reported", null],
    ["the reported sale has no price", { ...REPORTED, price: "" }],
    ["the reported price is a deed's nominal $10", { ...REPORTED, price: "$10" }],
    ["the reported date cannot be read", { ...REPORTED, date: "2025" }],
    ["the reported sale is 41 days older", { ...REPORTED, date: "2025-05-10" }],
    ["the building sold twice and the reported sale is the earlier one", { ...REPORTED, date: "2022-09-01", price: "$1,200,000" }],
  ]) assert.deepEqual([from(reported, {}).sale, from(reported, {}).row], [PROMOTED, OWN_ROW], what);
  // Two closings of the building among the comps: the later one is its last sale.
  const earlier = { ...OWN_ROW, date: "2022-09-01", price_or_rate: "$1,200,000" };
  for (const comps of [[OWN_ROW, earlier], [earlier, OWN_ROW]]) assert.deepEqual(V.ownSaleFrom({ comps }, [ADDRESS]).sale, PROMOTED);
  // A month of slack: "Mar 2026" on one line and "2026-03-27" on the other are
  // one closing, and the reported line is the one the search was asked for.
  for (const date of [SOLD, "2025-06-01", "2025-07-30"]) {
    const out = from({ ...REPORTED, date }, {});
    assert.deepEqual([out.sale, out.row], [{ ...REPORTED, date }, null], `reported ${date}`);
  }
  // Never promoted, whatever the reported sale lacks. And still not a comp of itself.
  for (const [what, rowOver] of [
    ["a listing-sourced row", { source_type: "listing" }],
    ["a row the search called an estimate", { source_type: "estimate" }],
    ["a row with no source type", { source_type: "" }],
    ["notes that say the price is an ask", { notes: "List price used as proxy for closed price." }],
    ["a row with no price", { price_or_rate: "Undisclosed" }],
    ["a row dated only by its year", { date: "2025" }],
  ]) {
    const out = from({ ...REPORTED, price: "" }, rowOver);
    assert.deepEqual([out.sale, out.row], [{ ...REPORTED, price: "" }, null], what);
    assert.deepEqual([out.own.length, out.comps.length], [1, 0], `${what}: it still leaves the comps`);
  }
});

// THE LEGACY GUARANTEE. Every report cached, saved or shared before 2026-11-27
// carries its subject's last sale without a stamp: never asked for a basis, never
// matched to an address, its source never read. Such a report must show the
// figures it always showed, to the dollar, however good its sale looks.
test("a report whose own sale was never stamped is valued on its comps alone, exactly as before", () => {
  const comps = { low: 1512345, mid: 1803210, high: 2204567 };
  // The shape a report had before the rule: three keys and nothing else.
  const legacy = { date: "Jun 2025", price: "$2,000,000", source_url: "https://news.example.com/deals/100-main-st-sells" };
  // And the strongest sale there could be, short only of the stamp.
  const unstamped = good().sale;
  delete unstamped.settled;
  for (const sale of [legacy, unstamped]) {
    const r = V.valueWithOwnSale(comps, sale, good().opts);
    assert.deepEqual(figures(r), comps);
    assert.deepEqual([r.anchored, r.weight, r.refused], [false, 0, "unsettled"]);
    // And with no comps it has no value either: the sale never stands in for them.
    assert.deepEqual(figures(V.valueWithOwnSale(null, sale, good().opts)), { low: null, mid: null, high: null });
  }
});

// --- Found by review on the day it was written -------------------------------
// Each of these was a reproduction before it was a test.

// The page lists the subject's names corrected address first, a bulk row
// typed address first. Read off "the first name", the state (and so the
// non-disclosure half) and the unit depended on that order, and one report
// was worth $1,950,000 on one screen and $1,725,000 on the other.
test("the answer does not depend on the order the subject's names are listed in", () => {
  const texas = { ...good().sale, source_url: "https://records.example.gov/deed/123", source_type: "public_record",
    address: "100 Main St, Dallas, TX 75201" };
  const withNames = (names) => ({ ...good().opts, subjectAddresses: names });
  for (const names of [["100 Main St, Dallas", "100 Main St, Dallas, TX 75201"], ["100 Main St, Dallas, TX 75201", "100 Main St, Dallas"]]) {
    const a = V.ownSaleAnchor(texas, withNames(names));
    assert.deepEqual([a.ok, a.half], [true, "non_disclosure"], names.join(" | "));
    near(a.weight, 0.45, "0.9 halved, whichever name came first");
  }
  // The sale's own address says where the property is when no name does.
  assert.equal(V.ownSaleAnchor(texas, withNames(["100 Main St, Dallas"])).half, "non_disclosure");
  // A subject typed as one suite is one suite, however the search rewrote
  // its address and whichever of the two is listed first.
  for (const names of [["100 Main St Suite 200, Columbus, OH", ADDRESS], [ADDRESS, "100 Main St Suite 200, Columbus, OH"]]) {
    assert.equal(V.ownSaleAnchor(good().sale, withNames(names)).reason, "unit", names.join(" | "));
  }
});

// The loose match (another ZIP allowed) is for taking a building out of its
// own comps. Used for more than that, another ZIP's row displaced the sale
// recorded for this exact address and was then refused as "another address",
// and another ZIP's asking price halved the real sale's weight.
test("a row that matches only loosely leaves the comps but is never read as the sale or the listing", () => {
  const reported = { date: SOLD, price: "$2,000,000", source_url: "https://news.example.com/deals/100-main-st-sells",
    source_type: "news", address: ADDRESS, basis: "arms_length" };
  const otherZip = { address: "100 Main St, Columbus, OH 43004", transaction: "Sale", date: "2026-03-10", size_sqft: "20000",
    price_or_rate: "$5,000,000", source_type: "public_record", source_url: "https://records.example.gov/deeds/2026-0310", notes: "" };
  const loose = V.ownSaleFrom({ subject_last_sale: reported, comps: [otherZip] }, [ADDRESS]);
  assert.equal(loose.comps.length, 0, "it is still not a comp of this building");
  assert.deepEqual(loose.own, [otherZip]);
  assert.equal(loose.sale, reported, "the sale recorded for this address stands");
  assert.equal(loose.row, null);
  const listed = V.ownSaleFrom({ subject_last_sale: reported, comps: [{ ...otherZip, date: "Active", price_or_rate: "$3,000,000", source_type: "listing" }] }, [ADDRESS]);
  assert.equal(listed.listing, null, "another ZIP's asking price is not this building's");
  // The same row AT this address is read: it is newer than the reported sale.
  const here = { ...otherZip, address: "100 Main Street, Columbus, OH 43215" };
  const strict = V.ownSaleFrom({ subject_last_sale: reported, comps: [here] }, [ADDRESS]);
  assert.equal(strict.row, here);
  assert.equal(strict.sale.from_comp, true);
});

// A comp is never asked what kind of sale it was. So a comp row the server
// reads as the building's sale (`from_comp`, the server's own mark) is judged
// by what its notes said, and when they said nothing it is neither a clean
// bill nor a refusal: half. It used to be stamped arms_length whatever the
// notes said, and a sale-leaseback leaned at 0.9.
test("a sale read off a comp row counts for half when its notes named no kind of sale", () => {
  const silent = anchor({ basis: undefined, from_comp: true });
  assert.deepEqual([silent.ok, silent.half], [true, "from_comp"]);
  near(silent.weight, 0.45, "0.9 halved");
  // The mark is the server's: without it, or with anything but true, a blank
  // basis is the refusal it always was.
  assert.deepEqual(because({ basis: undefined }), ["basis", "unstated"]);
  assert.deepEqual(because({ basis: "", from_comp: 1 }), ["basis", "unstated"]);
  // And where the notes did name a kind, that kind is judged as usual.
  assert.deepEqual(because({ basis: "portfolio", from_comp: true }), ["basis", "portfolio"]);
  assert.equal(anchor({ basis: "sale_leaseback", from_comp: true }).half, "sale_leaseback");
  assert.equal(anchor({ basis: "arms_length", from_comp: true }).half, null);
});

test("ownSaleNoteBasis reads what a comp row's notes say about its sale, and nothing into silence", () => {
  for (const [notes, want] of [
    ["Sale-leaseback: the seller leased the building back for 15 years.", "sale_leaseback"],
    ["Leasehold interest only; the land is ground leased.", "leasehold"],
    ["Bought for redevelopment; the building will be demolished.", "redevelopment"],
    ["Price is this building's allocated share of a larger deal.", "allocated"],
    ["Sold as land before the building was finished.", "land"],
    // The price itself is not a stated closing price: not a kind of sale, a refusal.
    ["Price estimated from the transfer tax.", "other"],
    ["Terms were not disclosed.", "other"],
    // Silence, and words that merely turn up in commercial notes.
    ["Sold to an investor.", ""],
    ["Owner-user sale; tilt-up warehouse built 1998.", ""],
    ["Next to a redevelopment district.", ""],
    ["Not a sale-leaseback; the seller vacated.", ""],
    ["", ""],
  ]) assert.equal(V.ownSaleNoteBasis(notes), want, notes);
  for (const none of [null, undefined, 42]) assert.equal(V.ownSaleNoteBasis(none), "", String(none));
});

// Widening the range to hold the price paid happened BEFORE rounding to the
// display step, which could carry Low up past the price, or High down below
// it, by half a step.
test("while the sale leads, the range holds the price paid after display rounding too", () => {
  // $2,015,000 a year before the report, +10% a year: A = 2,216,500. The
  // range's floor is the price paid, and the step at this size is $25,000:
  // 2,015,000 rounds to 2,025,000 (above the price) and DOWN to 2,000,000.
  const up = good({ price: "$2,015,000" }, { asOf: reportAt(1), trendPct: 10 });
  const rising = V.valueWithOwnSale({ low: 3000000, mid: 3200000, high: 3400000 }, up.sale, up.opts);
  assert.equal(rising.low, 2000000);
  assert.ok(rising.low <= 2015000 && rising.low <= rising.mid && rising.mid <= rising.high);
  // The mirror: $2,010,000, falling 10% a year, comps below. The range's
  // ceiling is the price paid: 2,010,000 rounds to 2,000,000 and UP to 2,025,000.
  const down = good({ price: "$2,010,000" }, { asOf: reportAt(1), trendPct: -10 });
  const falling = V.valueWithOwnSale({ low: 1150000, mid: 1250000, high: 1300000 }, down.sale, down.opts);
  assert.equal(falling.high, 2025000);
  assert.ok(falling.high >= 2010000 && falling.low <= falling.mid && falling.mid <= falling.high);
});

test("a sale within half a percent of the found listing's price is the listing, and one past that is a sale", () => {
  assert.equal(refused({}, { asking: 2000000 }), "matches_asking");
  // 2,000,000 against 2,008,000 is 0.4% under: one page rounds what another prints in full.
  assert.equal(refused({}, { asking: 2008000 }), "matches_asking");
  // 2,000,000 against 2,012,100 is 0.6% under: a sale a little under its asking price.
  assert.equal(refused({}, { asking: 2012100 }), undefined);
  near(V.OWN_SALE_ASK_MATCH, 0.005, "the tolerance the header states");
});

test("three small readings: a disbelieved trend, an age that is not a number, and a year read off a clock", () => {
  // The comps' own index disbelieves a trend past 30% a year and applies
  // none. Capped to 10 first, the sale was moved by a trend nobody believed.
  for (const wild of [40, -40, 31]) assert.equal(V.ownSaleIndex(SOLD, reportAt(1), wild), 1, `${wild}% a year`);
  near(V.ownSaleIndex(SOLD, reportAt(1), 30), 1.10, "30% is believed, and held to 10");
  // Number(null) is 0, "a sale that closed today".
  for (const age of [null, "", [], {}, true]) assert.equal(V.ownSaleWeight(age), 0, JSON.stringify(age));
  // The sale's year comes off the date as written. Read with a local clock,
  // an ISO January date is the year before anywhere west of Greenwich, and a
  // January 2026 sale of a 2026 building was refused on one machine and
  // leaned on by another.
  assert.equal(refused({ date: "2026-01" }, { asOf: Date.parse("2026-06-01"), yearBuilt: 2026 }), undefined);
  assert.equal(refused({ date: "2026-01-01" }, { asOf: Date.parse("2026-06-01"), yearBuilt: 2026 }), undefined);
  assert.equal(refused({ date: "2025-12-31" }, { asOf: Date.parse("2026-06-01"), yearBuilt: 2026 }), "predates_building");
});

test("one building of a campus is not its sibling: a building, tower, pad, phase, lot or floor named as its own comma part", () => {
  // A comma part between the street and the city used to count as a unit
  // only for fifteen words with a digit or a letter behind them, and with
  // one ZIP on both sides the part simply vanished: "Building Two" at the
  // subject's street number was the subject, and its sale carried 90% of
  // the value. Each of these is another building (or one floor of one).
  for (const sibling of ["Building Two", "Bldg III", "Tower 2", "Pad C", "Phase II", "Lot 5", "2nd Floor", "Units A-C"]) {
    const at = `100 Main St, ${sibling}, Columbus, OH 43215`;
    assert.equal(V.sameBuilding(at, ADDRESS), false, sibling);
    assert.ok(refused({ address: at }), `${sibling}: not leaned on`);
  }
  // One spelling per name: "Building One" is "Bldg 1", "Phase II" is "Phase 2".
  assert.equal(V.sameBuilding("100 Main St, Building One, Columbus, OH", "100 Main St, Bldg 1, Columbus, OH"), true);
  assert.equal(V.sameBuilding("100 Main St, Phase II, Columbus, OH", "100 Main St, Phase 2, Columbus, OH"), true);
  // A street NAMED with one of the words is still a street.
  assert.equal(V.sameBuilding("5600 Building C Way, Columbus, OH", "5600 Building C Way, Columbus, OH 43215"), true);
});

test("the same building typed without a comma before the city, or with Third for 3rd, is still the same building", () => {
  // The address box is free text. Read with the city inside the street's
  // name, the building's own sale was refused as "another address" and the
  // page printed it as a fact about a different building.
  assert.equal(V.sameBuilding("1200 W Industrial Blvd Dallas, TX 75207", "1200 W Industrial Blvd, Dallas, TX 75207"), true);
  assert.equal(V.sameBuilding("1200 W Industrial Blvd Dallas, TX", "1200 W Industrial Blvd, Austin, TX"), false, "the city still has to agree");
  assert.equal(V.sameBuilding("100 Third Street, Boise, ID", "100 3rd St, Boise, ID"), true);
  assert.equal(V.sameBuilding("100 Saint Charles Avenue New Orleans, LA", "100 St Charles Ave, New Orleans, LA"), true);
  assert.equal(V.sameBuilding("200 Space Center Blvd, Houston, TX", "200 Space Ctr Blvd, Houston TX"), true);
  assert.equal(refused({ address: "100 Main Street Columbus, OH 43215" }), undefined);
});

test("a comp row promoted to the sale keeps the basis the search gave the same closing", () => {
  // The reported line said the deal was a sale-leaseback and gave no price;
  // the price sat one row down among the comps. Promoted with no basis, the
  // leaseback came back clean and leaned in full.
  const row = { address: ADDRESS, transaction: "Sale", date: "Jun 2025", price_or_rate: "$2,000,000",
    source_type: "news", source_url: "https://news.example.com/deals/100-main", notes: "" };
  const sameClosing = V.ownSaleFrom({ comps: [row], subject_last_sale: { date: "2025-06-16", price: "", basis: "sale_leaseback" } }, [ADDRESS]);
  assert.equal(sameClosing.sale.from_comp, true);
  assert.equal(sameClosing.sale.basis, "sale_leaseback");
  // Nothing stated, nothing carried (the server then reads the row's notes).
  const silent = V.ownSaleFrom({ comps: [row], subject_last_sale: { date: "2025-06-16", price: "" } }, [ADDRESS]);
  assert.equal(silent.sale.basis, undefined);
  // A row more than a month newer than the reported sale is another closing:
  // the older deal's basis says nothing about it.
  const later = V.ownSaleFrom({ comps: [{ ...row, date: "Mar 2026" }],
    subject_last_sale: { date: "2025-06-16", price: "$1,800,000", basis: "portfolio" } }, [ADDRESS]);
  assert.equal(later.sale.from_comp, true);
  assert.equal(later.sale.basis, undefined);
});

test("the 1.5 times hold fades with the sale's weight, so a sale carrying a tenth does not pin the value to itself", () => {
  // A = $2,000,000 (no trend). Comps say $5,000,000: 2.5 times, inside the
  // 3 times refusal. At 2.75 years w = 0.9 x (3 - 2.75) / 2 = 0.1125.
  //   held comps  = 2,000,000 x 1.5 = 3,000,000 (k in full = 0.6)
  //   fade        = 0.1125 / 0.5 = 0.225, so k = 1 + (0.6 - 1) x 0.225 = 0.91
  //   comps used  = 5,000,000 x 0.91 = 4,550,000
  //   Likely      = 0.1125 x 2,000,000 + 0.8875 x 4,550,000 = 4,263,125
  // Held in full it was 0.1125 x 2,000,000 + 0.8875 x 3,000,000 = 2,887,500,
  // and at the next birthday the sale dropped out and it jumped to 5,000,000.
  const g = good({}, { asOf: reportAt(2.75) });
  const out = V.valueWithOwnSale({ low: 4500000, mid: 5000000, high: 5500000 }, g.sale, g.opts);
  assert.equal(out.anchored, true);
  near(out.weight, 0.1125, "the weight at 2.75 years");
  assert.equal(out.held, true);
  assert.ok(Math.abs(out.mid - 4263125) / 4263125 < 0.02, `Likely ${out.mid} is about 4,263,125`);
  // While the sale leads the hold is in full: half a year, w = 0.9.
  //   Likely = 0.9 x 2,000,000 + 0.1 x 3,000,000 = 2,100,000, kept inside A +/- 10%.
  const leading = V.valueWithOwnSale({ low: 4500000, mid: 5000000, high: 5500000 }, good().sale, good().opts);
  assert.ok(Math.abs(leading.mid - 2100000) / 2100000 < 0.02, `Likely ${leading.mid} is about 2,100,000`);
});

test("priced comps with no dollar figure still check the sale: by $/SF, or the sale does not stand alone", () => {
  // No size (or one priced comp) leaves the comps without a range in
  // dollars. Read as "no comps", a $90,000,000 sale stood alone at full
  // weight beside five comps at $64 to $96 a foot, and adding comps was what
  // switched the check on.
  const g = good({ size_sqft: "" }, { subjectSize: 0, compPsf: 80 });
  assert.equal(V.valueWithOwnSale(null, g.sale, g.opts).refused, "unchecked", "neither side has a size");
  // The sale states its size: $2,000,000 over 20,000 SF is $100/SF against
  // the comps' $80, a ratio of 1.25, so it stands alone.
  const sized = good({ size_sqft: "20000" }, { subjectSize: 0, compPsf: 80 });
  const ok = V.valueWithOwnSale(null, sized.sale, sized.opts);
  assert.equal(ok.anchored, true);
  near(ok.ratio, 1.25, "sale $/SF over the comps' $/SF");
  // One comp at $20/SF against the subject's 20,000 SF: $100 / $20 = 5, past 3.
  const one = good({}, { compPsf: 20 });
  assert.equal(V.valueWithOwnSale(null, one.sale, one.opts).refused, "disagree");
  // No priced comps at all: alone, as before.
  const none = good({}, { compPsf: 0 });
  assert.equal(V.valueWithOwnSale(null, none.sale, none.opts).anchored, true);
});

// valuation.js, "The building's own sale (2026-11-27)": the helpers that READ
// a sale and decide whose it is. A sale of the subject itself can carry 90%
// of a report's Likely value, so every mistake here is a headline: a price
// misread ("$9.75M" as 9.75), a date guessed, a caveat passing for a clean
// sale, a listing page counted as a record, and above all a neighbour's or a
// unit's sale taken for this building's. The expected values are worked out
// from that section's header comment, not copied from a run.
//
// Run: node --test test/own-sale-match.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../valuation");

// Both directions: "the same building" cannot depend on which address is the
// subject's and which is the sale's.
function same(a, b, expected, why) {
  const label = JSON.stringify(a) + " and " + JSON.stringify(b) + (why ? ": " + why : "");
  assert.equal(V.sameBuilding(a, b), expected, label);
  assert.equal(V.sameBuilding(b, a), expected, label + " (the other way round)");
}

// --- moneyOf ---------------------------------------------------------------

// numericValue, the parser every comp goes through, reads "$9.75M" as 9.75.
// On a comp that is one vote among several. This figure is multiplied into
// most of the headline, so a price is read whole or not at all.
test("moneyOf reads a sale price the ways one is written, to the dollar", () => {
  assert.equal(V.moneyOf("$12,450,000"), 12450000);
  assert.equal(V.moneyOf("12450000"), 12450000);
  assert.equal(V.moneyOf(12450000), 12450000);
  assert.equal(V.moneyOf("$9.75M"), 9750000);            // 9.75 x 1,000,000
  assert.equal(V.moneyOf("$12.45 million"), 12450000);   // 12.45 x 1,000,000
  assert.equal(V.moneyOf("US$ 2.1M"), 2100000);          // 2.1 x 1,000,000
  assert.equal(V.moneyOf("$950K"), 950000);              // 950 x 1,000
  assert.equal(V.moneyOf("12,450,000 USD"), 12450000);
  // What the shorthand costs when a plain number parse is handed it.
  assert.equal(V.numericValue("$9.75M"), 9.75);
});

// A figure that is not ONE dollar price has no honest reading: the middle of
// a range is nobody's price, "about" is not a record, and a euro figure read
// as dollars is wrong by the exchange rate. NaN is "no_price" to the rule,
// and nothing leans on it.
test("moneyOf refuses anything that is not one US-dollar figure", () => {
  const refused = [
    "$9M-$10M", "$9,000,000 - $10,000,000",                // a range
    "$9,750,000 ($128/SF)", "$9M $10M",                    // two numbers
    "about $9M", "~$9M", "$9M+",                           // an approximation
    "€9M", "£9,000,000", "C$9M", "9,000,000 EUR",          // another currency
    "12,45,000",                                           // not how thousands are grouped
    "-$5,000,000", "0", "$0", "undisclosed", "", "   ",
  ];
  for (const text of refused) {
    assert.ok(Number.isNaN(V.moneyOf(text)), JSON.stringify(text) + " was read as " + V.moneyOf(text));
  }
  for (const value of [null, undefined, 0, -5, NaN, Infinity]) {
    assert.ok(Number.isNaN(V.moneyOf(value)), String(value) + " was read as " + V.moneyOf(value));
  }
});

// --- saleDateMs ------------------------------------------------------------

// The sale's weight IS its age (0.9 through the first year, nothing at
// three), so a date is read only in a shape that names one. A month and year
// is the first of that month in local time and an ISO date is UTC: the
// instants compDateMs gives a comp dated the same way, so a sale and a comp
// written alike are aged alike.
test("saleDateMs reads the shapes a closing date is written in", () => {
  const march = new Date(2026, 2, 1).getTime();
  for (const text of ["Mar 2026", "March 2026", "03/2026", "3/2026"]) {
    assert.equal(V.saleDateMs(text), march, text);
  }
  assert.equal(V.saleDateMs("2026-03-27"), Date.UTC(2026, 2, 27));
  assert.equal(V.saleDateMs("2026-03"), Date.UTC(2026, 2, 1));
  // A quarter is its middle month. Q2 is April, May, June: May.
  assert.equal(V.saleDateMs("Q2 2025"), new Date(2025, 4, 1).getTime());
  // Q4 is October, November, December: November.
  assert.equal(V.saleDateMs("Q4 2024"), new Date(2024, 10, 1).getTime());
  // A full date, the three ways a record or an article prints one.
  const day = new Date(2026, 2, 27).getTime();
  for (const text of ["Mar 27, 2026", "27 March 2026", "3/27/2026"]) {
    assert.equal(V.saleDateMs(text), day, text);
  }
  // 2024 had a 29 February, so the impossible-day refusal below is a real
  // calendar check and not a ceiling on the day number.
  assert.equal(V.saleDateMs("2024-02-29"), Date.UTC(2024, 1, 29));
  assert.equal(V.saleDateMs("Feb 29, 2024"), new Date(2024, 1, 29).getTime());
  // Every spelling of a month the refusal of look-alike words must still let
  // through, the four-letter "Sept" and a trailing period included.
  assert.equal(V.saleDateMs("Sept 2025"), new Date(2025, 8, 1).getTime());
  assert.equal(V.saleDateMs("Sep. 2025"), new Date(2025, 8, 1).getTime());
  assert.equal(V.saleDateMs("September 2025"), new Date(2025, 8, 1).getTime());
});

// Date.parse alone answers "sometime in 2021" with a January nothing claimed
// and rolls 30 February into March. A bare year cannot be aged at all: on a
// report dated November 2026, "2025" is anything from 11 to 23 months old,
// which is a weight of 0.9 at one end and about half at the other (the line
// runs from 0.9 at 12 months to nothing at 36: 0.9 x (36 - 23) / 24 = 0.49).
// And a LISTING's date ("Active", "Listed Mar 2025", the search's own
// convention for a property on the market) is not a closing.
test("saleDateMs refuses a date it would have to guess", () => {
  const refused = [
    "2026", "2021",                                        // a bare year
    "sometime in 2021", "early 2021", "Spring 2021",       // words around a year
    "2025-02-30", "2025/02/30", "2025-02-29",              // days that do not exist (2025 is no leap year)
    "2025-13-01", "13/2025", "Q5 2025",                    // nor does a 13th month or a 5th quarter
    // Date.parse rolls these into the next month too, in every shape that
    // names a day, not only the year-first one.
    "2/30/2025", "Feb 30, 2025", "30 Feb 2025", "June 31, 2025",
    // A word that STARTS like a month is not one. Date.parse reads its first
    // three letters, so a sale "Marketed 2024" was a March 2024 closing and
    // leaned on at whatever weight that age gave it.
    "Marketed 2024", "Decided 2020", "Mayor 2021", "Junk 2022",
    "Active", "Listed Mar 2025",                           // on the market, not sold
    "", "   ",
  ];
  for (const text of refused) {
    assert.ok(Number.isNaN(V.saleDateMs(text)), JSON.stringify(text) + " was read as " + new Date(V.saleDateMs(text)));
  }
  for (const value of [null, undefined, 2026]) {
    assert.ok(Number.isNaN(V.saleDateMs(value)), String(value) + " was read as a date");
  }
});

// --- ownSaleBasis ----------------------------------------------------------

// What KIND of sale it was, in a closed vocabulary. Only three of its words
// can be leaned on (arms_length in full, sale_leaseback and allocated for
// half) and the other eight are refused, so each has to land on its own key
// in the spellings a model writes. The first spelling of each is the key
// itself.
const BASIS_SPELLINGS = {
  arms_length: ["arms_length", "Arms Length", "arm's length", "Arm's-length sale", "open market sale"],
  sale_leaseback: ["sale_leaseback", "Sale-Leaseback", "leaseback"],
  allocated: ["allocated", "Allocated share", "allocation"],
  portfolio: ["portfolio", "Portfolio sale", "multi-property sale"],
  leasehold: ["leasehold", "Leasehold interest", "ground lease"],
  redevelopment: ["redevelopment", "Redevelopment site", "tear-down"],
  partial_interest: ["partial_interest", "Partial interest", "recapitalization", "joint venture"],
  related_party: ["related_party", "Related party", "affiliate", "family transfer"],
  distressed: ["distressed", "Foreclosure", "auction", "REO", "bank-owned", "short sale", "deed in lieu"],
  land: ["land", "Land sale", "land only"],
  not_closed: ["not_closed", "Not closed", "asking price", "list price", "pending", "under contract"],
};

test("ownSaleBasis reads every word of the closed vocabulary in the spellings it arrives in", () => {
  for (const [key, spellings] of Object.entries(BASIS_SPELLINGS)) {
    for (const text of spellings) assert.equal(V.ownSaleBasis(text), key, JSON.stringify(text));
  }
  // The table is the whole vocabulary: a word added to the module without a
  // row here fails, instead of going out untested.
  assert.deepEqual(Object.keys(BASIS_SPELLINGS).sort(), Object.keys(V.OWN_SALE_BASIS_WORDS).sort());
});

// "An unknown caveat may cost a good sale, it must never pass for a clean
// one", and a blank is not a clean bill. The dangerous inputs are the ones
// that CONTAIN the clean word: a denial of it, or a caveat riding behind it.
test("ownSaleBasis never lets a blank, an unknown phrase or a qualified one pass for an ordinary sale", () => {
  for (const blank of ["", "   ", null, undefined]) {
    assert.equal(V.ownSaleBasis(blank), "unstated", JSON.stringify(blank));
  }
  for (const text of ["1031 exchange", "investment sale", "unknown", "N/A"]) {
    assert.equal(V.ownSaleBasis(text), "other", text);
  }
  for (const text of ["arms length sale, part of a portfolio", "arms_length; sale_leaseback", "arms length (allocated)"]) {
    assert.equal(V.ownSaleBasis(text), "other", text);
  }
  for (const text of ["not arm's length", "Non-arms-length", "not arms length"]) {
    assert.equal(V.ownSaleBasis(text), "related_party", text);
  }
});

// --- specificPage, isListingHost, stateOf ----------------------------------

// The prompt asks for "the page that states it". Of the own sales the audit
// found cited to a bare home page, one was an asking price and one a
// portfolio allocation, and another was cited to a flyer image uploaded
// three months before the sale it was cited for. A link like that cannot be
// checked against the price, so a sale cited to one is refused ("no_source").
test("specificPage passes a page that could state the sale and nothing else", () => {
  const pages = [
    "https://www.bizjournals.com/orlando/news/2025/03/14/14-e-washington-st-sells.html",
    "http://county.example.gov/parcel?id=9",               // a record addressed by its query
    "https://example.com/properties/100-main-st",          // one property's page under an index
    "https://example.com/flyers/100-main-st.pdf",
  ];
  for (const url of pages) assert.equal(V.specificPage(url), true, url);
  const notPages = [
    "https://example.com", "https://example.com/", "https://www.example.com/#top",     // the front door
    "https://example.com/flyer.jpg", "https://example.com/photos/100-main.PNG", "https://example.com/a.webp?w=800",
    "https://example.com/search", "https://example.com/recent-transactions", "https://example.com/listings/",
    "https://example.com/sold", "https://example.com/properties",                      // a search or index page
    "www.example.com/news/deal", "example.com/news/deal", "ftp://example.com/deal.pdf",
    "javascript:alert(1)", "see the county record",                                    // not an http link
    "", "   ",
  ];
  for (const url of notPages) assert.equal(V.specificPage(url), false, JSON.stringify(url));
  for (const value of [null, undefined, 42]) assert.equal(V.specificPage(value), false, String(value));
});

// A sale cited to a search engine's results was leaned on at full weight,
// because any query string made the link "specific". A search is still a
// search and an index still an index whatever rides behind the "?", and with
// no path at all only a query that names a record is a page.
test("specificPage is not fooled by a query string", () => {
  const notPages = [
    "https://www.google.com/search?q=14+e+washington+st+orlando+sold",
    "https://example.com/listings?page=2",
    "https://example.com/properties?sort=price",
    "https://example.com/?utm_source=newsletter",           // the front door, tracked
    "https://duckduckgo.com/?q=100+main+st+sold",           // a search box with no path
    "https://example.com/?utm_source=x&gclid=abc",
  ];
  for (const url of notPages) assert.equal(V.specificPage(url), false, url);
  const pages = [
    "https://county.example.gov/?parcel=R123",              // how some county sites address a record
    "https://county.example.gov/?utm_source=x&parcel=R123", // a tracker beside it changes nothing
    "https://example.com/news/100-main-st-sells?utm_source=newsletter",
    "https://example.com/properties/100-main-st?ref=home",
  ];
  for (const url of pages) assert.equal(V.specificPage(url), true, url);
});

// A marketplace page shows an ASKING price, and its "sold" figure is often
// the last ask, so a sale cited to one counts for half. The match is on the
// host and is label-bounded: loosened to a substring it would halve a real
// article on a host that merely ends the same way, or one that names the
// marketplace in its path.
test("isListingHost knows a marketplace by its host, subdomains included", () => {
  const listings = [
    "https://www.loopnet.com/Listing/100-Main-St-Boise-ID/1234567/",
    "https://loopnet.com/Listing/1",
    "https://images.crexi.com/assets/1.html",
    "https://WWW.CREXI.COM/properties/123/idaho-100-main",
    "https://www.zillow.com/homedetails/1_zpid/",
  ];
  for (const url of listings) assert.equal(V.isListingHost(url), true, url);
  const others = [
    "https://www.bizjournals.com/boise/news/2025/03/14/100-main-st-sells.html",
    "https://adacounty.id.gov/assessor/parcel/R1234567",
    "https://notloopnet.com/Listing/1",
    "https://loopnet.com.example.net/Listing/1",
    "https://example.com/loopnet.com/Listing/1",
    "",
  ];
  for (const url of others) assert.equal(V.isListingHost(url), false, JSON.stringify(url));
  for (const value of [null, undefined]) assert.equal(V.isListingHost(value), false, String(value));
});

// The state decides which rule the source is held to: where a deed does not
// show the price, a "sale price" on the web is a news report or it is the
// last asking price. A street's own suffix is not a state: "Ct" is a court,
// not Connecticut.
test("stateOf reads the state off the end of an address, with or without a ZIP", () => {
  assert.equal(V.stateOf("100 Main St, Boise, ID 83702"), "ID");
  assert.equal(V.stateOf("100 Main St, Boise, ID"), "ID");
  assert.equal(V.stateOf("500 Commerce St, Dallas, TX 75202-1234"), "TX");
  assert.equal(V.stateOf("8000 S Federal Way, Boise ID 83716"), "ID");
  assert.equal(V.stateOf("14 e washington st, orlando, fl 32801"), "FL");
  assert.equal(V.stateOf("100 main st, boise, id"), "ID");
  for (const text of ["100 Main St", "100 Maple Ct", "100 Main St, Boise", "", null, undefined]) {
    assert.equal(V.stateOf(text), "", JSON.stringify(text));
  }
});

// The subject's address is what a member typed, and the sale's is what a page
// printed. Read only as ", ST" at the very end, the state was missed in every
// other shape, and then two things went wrong at once: the same street line
// in two states was one building, and a non-disclosure state's price was
// never halved.
test("stateOf and zipOf read the shapes people and pages write", () => {
  const idaho = [
    "100 Main St, Boise ID",                 // no comma before the state
    "100 Main St, Boise, ID, 83702",         // a comma before the ZIP
    "100 Main St, Boise, ID 83702, USA",     // a country behind it
    "100 Main St, Boise, ID 83702, United States",
    "100 Main St, Boise, Idaho 83702",       // spelled out
    "100 Main St, Boise, Id.",
    "100 Main St, Suite 200, Boise, ID",
  ];
  for (const text of idaho) assert.equal(V.stateOf(text), "ID", text);
  assert.equal(V.zipOf("100 Main St, Boise, ID 83702, USA"), "83702");
  assert.equal(V.zipOf("100 Main St, Boise, ID, 83702-1234"), "83702");
  assert.equal(V.zipOf("83702 Main St, Boise, ID"), "", "a street number is not a ZIP");
  // The longer name wins: Arkansas is not Kansas, West Virginia not Virginia.
  assert.equal(V.stateOf("100 Main St, Little Rock, Arkansas"), "AR");
  assert.equal(V.stateOf("100 Main St, Charleston, West Virginia"), "WV");
  assert.equal(V.stateOf("100 Main St, Kansas City, Kansas"), "KS");
  // A city that shares its state's name, written with no state, is still the
  // city: read as the state it would leave the address with no city at all,
  // and an address with no city matches any.
  assert.equal(V.stateOf("100 Main St, New York"), "");
  assert.equal(V.cityKey("100 Main St, New York"), "new york");
  assert.equal(V.cityKey("100 Main St, New York, New York"), "new york");
  // The city is read past a unit's own comma part, and without its state.
  assert.equal(V.cityKey("100 Main St, Building B, Boise, ID 83702"), "boise");
  assert.equal(V.cityKey("100 Main St, Kansas City MO"), "kansas city");
  assert.equal(V.cityKey("100 Main St"), "");
  // And the half weight follows: this is the same sale and the same state.
  const record = { source_url: "https://www.bizjournals.com/boise/news/2026/06/14/100-main-st-sells.html", source_type: "public_record" };
  assert.deepEqual(V.ownSaleSource(record, "100 Main St, Boise ID"), { ok: true, half: "non_disclosure" });
  assert.deepEqual(V.ownSaleSource(record, "100 Main St, Boise, Idaho 83702, USA"), { ok: true, half: "non_disclosure" });
});

// --- the street line -------------------------------------------------------

// Two searches wrote one Caldwell warehouse two ways, "Lane" and "Ln" (and
// gave it two ZIPs). Folded, the street line is one key.
test("streetKey folds the spellings of one street line to one key", () => {
  assert.equal(V.streetKey("19127 Red Label Lane, Caldwell, ID 83607"), "19127 red label ln");
  assert.equal(V.streetKey("19127 Red Label Ln, Caldwell, ID 83605"), "19127 red label ln");
  assert.equal(V.streetKey("5705 W. 98th St., Los Angeles, CA 90045"), "5705 w 98th st");
  assert.equal(V.streetKey("100 North Main Street"), "100 n main st");
  assert.equal(V.streetKey(null), "");
});

// "The same address" is four questions about the street (its number, name,
// directional and suffix) and one about the unit. Kept apart, a suite is not
// mistaken for the building and "Main St" is not mistaken for "Main Ave".
test("streetParts takes a street line apart: number or range, name, directional, suffix and unit", () => {
  const main = { lo: 100, hi: 100, name: "main", dir: "n", suffix: "st", unit: "" };
  assert.deepEqual(V.streetParts("100 North Main Street, Boise, ID 83702"), main);
  assert.deepEqual(V.streetParts("100 N. MAIN ST."), main);
  assert.deepEqual(V.streetParts("23126-23170 Valencia Blvd, Valencia, CA"),
    { lo: 23126, hi: 23170, name: "valencia", dir: "", suffix: "blvd", unit: "" });
  const units = [
    ["100 Main St Suite 101, Boise, ID", "101"],
    ["100 Main St #5, Boise, ID", "5"],
    ["100 Main St, Suite 101, Boise, ID", "101"],
    ["100 Main St, #5, Boise, ID", "5"],
    ["100 Main St Apt 4B", "4b"],
  ];
  for (const [text, unit] of units) {
    const parts = V.streetParts(text);
    assert.equal(parts.unit, unit, text);
    assert.equal(parts.name + " " + parts.suffix, "main st", text + ": the unit is kept out of the street's name");
  }
  // No street number, no building: a place or a district names none.
  for (const text of ["Main St, Boise, ID", "Financial District (general submarket estimate)", "", null, undefined]) {
    assert.equal(V.streetParts(text), null, JSON.stringify(text));
  }
});

// Each of these was one unit's address read as the whole building's, so a
// suite's sale was leaned on at full weight for the building: the unit was
// only seen on the street line, or in its own comma part in two spellings.
test("a unit is kept apart however it is written", () => {
  const whole = "100 Main St, Boise, ID 83702";
  const units = [
    ["100 Main St, Suite #200, Boise, ID 83702", "200"],   // a "#" behind the word
    ["100 Main St, Unit #5, Boise, ID 83702", "5"],
    ["100 Main St Suite #200, Boise, ID 83702", "200"],
    ["100 Main St, Building B, Boise, ID 83702", "b"],     // words the comma part did not know
    ["100 Main St, Bldg 2, Boise, ID 83702", "2"],
    ["100 Main St, Floor 2, Boise, ID 83702", "2"],
    ["100 Main St, Rm 5, Boise, ID 83702", "5"],
    ["100 Main St, Suites 200-210, Boise, ID 83702", "200-210"],
    ["100 Main St, Units 1-3, Boise, ID 83702", "1-3"],
  ];
  for (const [text, unit] of units) {
    assert.equal(V.streetParts(text).unit, unit, text);
    same(text, whole, false, "one unit is not the building");
  }
  same("100 Main St, Suite #200, Boise, ID", "100 Main St Ste 200, Boise, ID", true, "one suite, written two ways");
  // A letter on the number is its own address: 2020B is neither 2020A nor 2020.
  assert.deepEqual(V.streetParts("2020B Airport Way"), { lo: 2020, hi: 2020, name: "airport", dir: "", suffix: "way", unit: "b" });
  same("2020B Airport Way, Boise, ID 83705", "2020A Airport Way, Boise, ID 83705", false);
  same("100A Main St, Boise, ID", "100 Main St, Boise, ID", false);
  same("100A Main St, Boise, ID", "100A Main Street, Boise, ID 83702", true);
});

// The other direction: a street NAMED with a unit's word lost its name to
// the unit scan and matched nothing, not even itself. A unit needs a name
// ahead of it and an identifier behind it (a digit, or one or two letters).
test("a street named Space, Building or Suite is still a street", () => {
  assert.deepEqual(V.streetParts("2101 Space Park Dr, Houston, TX"),
    { lo: 2101, hi: 2101, name: "space park", dir: "", suffix: "dr", unit: "" });
  same("2101 Space Park Dr, Houston, TX", "2101 Space Park Drive, Houston, TX 77058", true);
  same("5600 Building C Way, Denver, CO 80239", "5600 Building C Way, Denver, CO", true);
  // And a real unit on such a street is still seen.
  same("2101 Space Park Dr Suite 100, Houston, TX", "2101 Space Park Dr, Houston, TX", false);
});

// Pages set a range with an en dash, and the prompt asks for the sale's
// address exactly as the page gives it. Unread, the range matched nothing.
test("a range set with an en dash is the same range", () => {
  same("23126\u201323170 Valencia Blvd, Valencia, CA", "23126 Valencia Blvd, Valencia, CA", true);
  same("23126\u201323170 Valencia Blvd, Valencia, CA", "23126-23170 Valencia Blvd, Valencia, CA", true);
});

// "Dr E" and "Ave NW": with the suffix looked for only as the last word, the
// suffix became part of the street's name and a good sale was refused as
// another address. One side leaving the directional out is not a
// contradiction; two different ones still are.
test("a directional written after the suffix is still a directional", () => {
  assert.deepEqual(V.streetParts("76 Inverness Dr E"), { lo: 76, hi: 76, name: "inverness", dir: "e", suffix: "dr", unit: "" });
  same("76 Inverness Dr E, Englewood, CO", "76 Inverness Dr, Englewood, CO", true);
  same("76 E Inverness Dr, Englewood, CO", "76 Inverness Dr E, Englewood, CO", true);
  same("1600 Pennsylvania Ave NW, Washington, DC", "1600 Pennsylvania Avenue, Washington, DC", true);
  same("76 Inverness Dr E, Englewood, CO", "76 Inverness Dr W, Englewood, CO", false, "east is not west");
});

// Queens, New York writes ONE house number with a hyphen: "37-18 Northern
// Blvd" is the 18th lot past 37th Street. Read as the range 18 to 37 it
// would name every building on the block, and a neighbour's sale would be
// its own.
test("a New York hyphenated house number is one number, never a block-long range", () => {
  const lic = (number) => number + " Northern Blvd, Long Island City, NY";
  // The pair runs DOWN, so it is the one number sites that drop the hyphen
  // write: "37" and "18" set together, 3718.
  assert.deepEqual(V.streetParts(lic("37-18")), { lo: 3718, hi: 3718, name: "northern", dir: "", suffix: "blvd", unit: "" });
  same(lic("37-18"), lic("37-20"), false, "next door");
  same(lic("37-18"), lic("3718"), true, "the same number without its hyphen");
  for (const swallowed of ["18", "25", "37"]) same(lic("37-18"), lic(swallowed), false, "inside the misread range 18 to 37");
  // A pair that runs UP reads as a range, so two ranges must be the SAME
  // range: these are two house numbers, and as overlapping ranges they would
  // be one building.
  same("37-52 82nd St, Jackson Heights, NY", "37-60 82nd St, Jackson Heights, NY", false);
  same("37-52 82nd St, Jackson Heights, NY", "37-52 82nd St, Jackson Heights, NY 11372", true);
});

// --- sameBuilding ----------------------------------------------------------

// One building is written many ways, by the member who typed it and by the
// page that reports its sale. If these did not fold, the best evidence a
// report has would be refused as "another address" over a spelling.
test("sameBuilding folds the spellings of one address", () => {
  same("100 Main Street, Boise, ID 83702", "100 Main St, Boise, ID 83702", true);
  same("100 North Main Street, Boise, ID", "100 N Main St, Boise, ID", true);
  same("14 E Washington St, Orlando, FL", "14 East Washington Street, Orlando, FL 32801", true);
  same("5705 W. 98th St., Los Angeles, CA 90045", "5705 West 98th Street, Los Angeles, CA", true);
  same("100 MAIN ST, BOISE, ID", "100 Main St, Boise, ID", true);
  // One side leaving the directional or the suffix out is not a contradiction.
  same("100 N Main St, Boise, ID", "100 Main St, Boise, ID", true);
  same("100 Main St, Boise, ID", "100 Main, Boise, ID", true);
});

// The costliest mistake in this file: another building's sale leaned on.
test("a different number, name, directional or suffix is a different building", () => {
  const subject = "100 N Main St, Boise, ID 83702";
  same(subject, "102 N Main St, Boise, ID 83702", false, "next door");
  same(subject, "1000 N Main St, Boise, ID 83702", false, "a number that only starts the same");
  same(subject, "100 S Main St, Boise, ID 83702", false, "the other end of the street");
  same(subject, "100 N Main Ave, Boise, ID 83702", false, "another street of the same name");
  same(subject, "100 N Maine St, Boise, ID 83702", false, "a name one letter off");
});

// A sale is often recorded for the whole range a building occupies
// ("23126-23170 Valencia Blvd") while the member types one of its numbers.
test("a number inside the other address's range is the same building, and one outside it is not", () => {
  const range = "23126-23170 Valencia Blvd, Valencia, CA 91355";
  const at = (number) => number + " Valencia Blvd, Valencia, CA 91355";
  for (const inside of [23126, 23150, 23170]) same(range, at(inside), true);
  for (const outside of [23124, 23172]) same(range, at(outside), false);
  same(range, "23126 - 23170 Valencia Boulevard, Valencia, CA 91355", true, "the same range, respelled");
  same(range, at("23126-23150"), false, "two ranges must be the same range");
  // On a US street the odd numbers are across the road. A range that runs
  // even to even holds only its own side's numbers, so 23151 is the building
  // opposite, not this one.
  for (const opposite of [23127, 23151, 23169]) same(range, at(opposite), false, "the other side of the street");
  // A range that runs across both parities says nothing about sides.
  same("100-125 Main St, Boise, ID", "111 Main St, Boise, ID", true);
  same("100-125 Main St, Boise, ID", "112 Main St, Boise, ID", true);
});

// "100 Main St Unit 5" is not "100 Main St": one condo's price over the
// whole building's size is not this building's sale. The unit may be a word
// and a number on the street line, a "#", or a comma part of its own.
test("a unit on one side only is not the same building, and the same unit is", () => {
  const whole = "100 Main St, Boise, ID 83702";
  const oneUnit = [
    "100 Main St Unit 5, Boise, ID 83702",
    "100 Main St #5, Boise, ID 83702",
    "100 Main St Ste. 200, Boise, ID 83702",
    "100 Main St, Suite 200, Boise, ID 83702",
    "100 Main St, #5, Boise, ID 83702",
  ];
  for (const unit of oneUnit) same(unit, whole, false);
  same("100 Main St Unit 5, Boise, ID", "100 Main St #5, Boise, ID", true, "one unit, written two ways");
  same("100 Main St, Suite 200, Boise, ID", "100 Main St Ste 200, Boise, ID", true, "one unit, written two ways");
  same("100 Main St Suite 200, Boise, ID", "100 Main St Suite 300, Boise, ID", false, "two units of one building");
});

// Every town has a Main Street. Without the place, a sale of 100 Main St in
// one Springfield would carry the value of 100 Main St in another.
test("the same street line in another city or state is not the same building", () => {
  same("100 Main St, Boise, ID", "100 Main St, Meridian, ID", false);
  same("100 Main St, Springfield, IL", "100 Main St, Springfield, MO", false);
  same("100 Main St, Portland, OR 97204", "100 Main St, Portland, ME", false);
  same("100 Main St, Kansas City, MO 64105", "100 Main St, Kansas City, KS 66101", false);
});

// The same five addresses as above, with the state written the ways a member
// types it. Each pair was "one building" while the state went unread.
test("another state is another building however the state is written", () => {
  same("100 Main St, Springfield IL", "100 Main St, Springfield, MO 65806", false);
  same("100 Main St, Kansas City MO", "100 Main St, Kansas City, KS 66101", false);
  same("100 Main St, Springfield, IL 62701, USA", "100 Main St, Springfield, MO 65806, USA", false);
  same("100 Main St, Springfield, Illinois", "100 Main St, Springfield, Missouri", false);
  same("100 MAIN ST, SPRINGFIELD, IL, 62701", "100 Main St, Springfield, MO", false);
  // And one state written two ways is one state.
  same("100 Main St, Springfield IL", "100 Main St, Springfield, Illinois 62701", true);
  same("100 Main St, Charleston, West Virginia", "100 Main St, Charleston, WV", true);
  same("100 Main St, Charleston, West Virginia", "100 Main St, Charleston, VA", false);
});

// Two different ZIPs under one city's name. For LEANING on a sale that is
// two places: a city can hold a "100 N Main St" and a "100 S Main St", and
// written without the directional they differ only by ZIP. For taking a
// building's own sale OUT of its comps (the third argument) it is one place:
// two searches wrote one Caldwell warehouse with two ZIPs, and leaving a
// building among its own comps is the worse mistake there.
test("one city, two ZIPs: two places to lean on, one building to take out of its own comps", () => {
  const a = "19127 Red Label Lane, Caldwell, ID 83607", b = "19127 Red Label Ln, Caldwell, ID 83605";
  same(a, b, false);
  assert.equal(V.sameBuilding(a, b, true), true);
  assert.equal(V.sameBuilding(b, a, true), true);
  // Loose is only loose about the ZIP: another city, state, number or unit
  // is still another building.
  assert.equal(V.sameBuilding(a, "19127 Red Label Ln, Nampa, ID 83605", true), false);
  assert.equal(V.sameBuilding(a, "19127 Red Label Ln, Caldwell, OR 97000", true), false);
  assert.equal(V.sameBuilding(a, "19129 Red Label Ln, Caldwell, ID 83605", true), false);
  assert.equal(V.sameBuilding(a, "19127 Red Label Ln Unit 2, Caldwell, ID 83605", true), false);
});

// A postal city and a locality are two names for one building ("Fleming
// Island" and "Orange Park"), so when both addresses carry a ZIP the ZIP
// settles it, either way.
test("a ZIP on both addresses settles the place, either way", () => {
  same("100 Main St, Fleming Island, FL 32003", "100 Main St, Orange Park, FL 32003", true);
  same("100 Main St, Fleming Island, FL", "100 Main St, Orange Park, FL", false, "with no ZIP these are two towns");
  same("100 Main St, Fleming Island, FL 32003-1234", "100 Main St, Orange Park, FL 32003", true, "ZIP+4 is the same ZIP");
  same("100 Main St, Boise, ID 83702", "100 Main St, Boise, ID 83706", false, "one city, two ZIPs");
});

// A deal page often prints the street line and nothing else. One side naming
// no city is accepted, and one city written two ways is one city.
test("an address that names no city is accepted on its street line, and a city's spellings fold", () => {
  same("100 Main St", "100 Main St, Boise, ID 83702", true);
  same("100 Main St, Boise, ID", "100 Main St", true);
  same("100 Main St, Boise, ID", "100 Main St, Boise, ID 83702", true, "a ZIP on one side only");
  same("100 Main St, Boise ID 83702", "100 Main St, Boise, ID", true, "the state riding in the city's own part");
  same("100 Main St, Saint Paul, MN", "100 Main St, St. Paul, MN", true);
  same("100 Main St, Fort Worth, TX", "100 Main St, Ft. Worth, TX", true);
});

// Model-written fields arrive empty, null, or as a district's name. Two
// addresses with no street number must not compare equal, or one submarket
// row would be "the subject's own sale" on every report in that district.
test("garbage never throws and never matches, not even itself", () => {
  const real = "100 Main St, Boise, ID 83702";
  const junk = [null, undefined, "", "   ", "Main St, Boise, ID", "Financial District (general submarket estimate)", 42, {}, []];
  for (const value of junk) {
    same(value, real, false);
    assert.equal(V.sameBuilding(value, value), false, JSON.stringify(value) + " matched itself");
  }
});

// The two halves are asked apart because the rule tells a member which one
// failed: a sale at another address, or one unit of this one.
test("sameStreetLine compares the street alone and samePlace the place alone", () => {
  const parts = V.streetParts;
  assert.equal(V.sameStreetLine(parts("100 Main St Unit 5"), parts("100 Main Street")), true, "units are not compared here");
  assert.equal(V.sameStreetLine(parts("100 Main St"), parts("102 Main St")), false);
  assert.equal(V.sameStreetLine(null, parts("100 Main St")), false);
  assert.equal(V.sameStreetLine(parts("100 Main St"), undefined), false);
  assert.equal(V.samePlace("100 Main St, Fleming Island, FL 32003", "9 Elm Rd, Orange Park, FL 32003"), true);
  assert.equal(V.samePlace("100 Main St, Boise, ID", "100 Main St, Meridian, ID"), false);
});

// --- ownSaleSource ---------------------------------------------------------

const ARTICLE = "https://www.bizjournals.com/orlando/news/2025/03/14/14-e-washington-st-sells.html";
const LISTING = "https://www.loopnet.com/Listing/14-E-Washington-St-Orlando-FL/1234567/";
const FLORIDA = "14 E Washington St, Orlando, FL 32801";   // deeds show the price
const TEXAS = "500 Commerce St, Dallas, TX 75202";         // deeds do not

// A sale nobody can point to a page for is not leaned on, and neither is one
// the search itself calls an estimate, whatever link it carries.
test("ownSaleSource refuses a sale with no page behind it, or one the search calls an estimate", () => {
  for (const url of ["", undefined, "https://www.bizjournals.com/", "https://example.com/flyer.jpg", "https://example.com/recent-transactions"]) {
    assert.deepEqual(V.ownSaleSource({ source_url: url, source_type: "news" }, FLORIDA), { ok: false, why: "no_source" }, String(url));
  }
  for (const type of ["estimate", "Estimate"]) {
    assert.deepEqual(V.ownSaleSource({ source_url: ARTICLE, source_type: type }, FLORIDA), { ok: false, why: "estimate_source" }, type);
  }
  // A listing host does not turn an estimate into half a sale.
  assert.deepEqual(V.ownSaleSource({ source_url: LISTING, source_type: "estimate" }, FLORIDA), { ok: false, why: "estimate_source" });
  assert.deepEqual(V.ownSaleSource(null, FLORIDA), { ok: false, why: "no_source" });
  assert.deepEqual(V.ownSaleSource(undefined, undefined), { ok: false, why: "no_source" });
});

// Half: real evidence with a condition attached. A listing page may be
// showing the last asking price, so the sale counts for half as much.
test("ownSaleSource halves a price cited to a listing page, by its host or by the search's own word", () => {
  assert.deepEqual(V.ownSaleSource({ source_url: LISTING, source_type: "news" }, FLORIDA), { ok: true, half: "listing_page" });
  assert.deepEqual(V.ownSaleSource({ source_url: ARTICLE, source_type: "listing" }, FLORIDA), { ok: true, half: "listing_page" });
  assert.deepEqual(V.ownSaleSource({ source_url: LISTING }, TEXAS), { ok: true, half: "listing_page" });
});

// In a non-disclosure state a deed does not show the price, so a "sale
// price" on the web is a news report or it is the last asking price. With
// no news page behind it, it counts for half.
test("ownSaleSource halves a non-disclosure state's price unless a news page reports it", () => {
  assert.deepEqual(V.ownSaleSource({ source_url: ARTICLE, source_type: "public_record" }, TEXAS), { ok: true, half: "non_disclosure" });
  assert.deepEqual(V.ownSaleSource({ source_url: ARTICLE, source_type: "public_record" }, "8000 S Federal Way, Boise, ID 83716"),
    { ok: true, half: "non_disclosure" });
  assert.deepEqual(V.ownSaleSource({ source_url: ARTICLE, source_type: "news" }, TEXAS), { ok: true, half: null });
  // Where deeds show the price, a record and an article both count in full.
  for (const type of ["public_record", "news"]) {
    assert.deepEqual(V.ownSaleSource({ source_url: ARTICLE, source_type: type }, FLORIDA), { ok: true, half: null }, JSON.stringify(type));
  }
});

// A comp whose source the search cannot classify is an "estimate". A sale of
// the subject with no kind of source at all used to be trusted in FULL, so a
// model that failed to classify its page outranked one that classified it
// honestly as a listing (0.9 against 0.45, same sale, same link). It is a
// page that exists, so it is not refused, and it counts for half.
test("ownSaleSource halves a price whose source the search did not classify", () => {
  for (const sale of [{ source_url: ARTICLE }, { source_url: ARTICLE, source_type: "" }, { source_url: ARTICLE, source_type: "broker flyer" }]) {
    assert.deepEqual(V.ownSaleSource(sale, FLORIDA), { ok: true, half: "unclassified" }, JSON.stringify(sale.source_type));
    assert.deepEqual(V.ownSaleSource(sale, TEXAS), { ok: true, half: "unclassified" }, JSON.stringify(sale.source_type));
  }
  // A marketplace's host still says "listing" by itself, classified or not.
  assert.deepEqual(V.ownSaleSource({ source_url: LISTING }, FLORIDA), { ok: true, half: "listing_page" });
});

test("a street address with no city is asked for one before the search; a market or a full address is not", () => {
  // The owner, 2026-11-28: "make it so they have to type in a city". A
  // street name alone is in every town, and the building's own sale is
  // matched to it by address.
  for (const a of ["100 Main St", "100 Main St, TX 75201", "100 Main St 83702", "100 Main St, Suite 5, TX"]) {
    assert.equal(V.missingCity(a), true, a);
  }
  for (const a of ["100 Main St, Boise, ID", "100 Main St Boise ID 83702", "100 Main Street Dallas", "Boise, ID", "", null]) {
    assert.equal(V.missingCity(a), false, String(a));
  }
  // The report form asks before the geocode and before anything is billed.
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "index.html"), "utf8");
  const submit = html.indexOf('document.getElementById("compForm").addEventListener("submit"');
  const ask = html.indexOf("VALUATION.missingCity(address)", submit);
  const geo = html.indexOf("geocodeAddress(address)", submit);
  assert.ok(submit > 0 && ask > submit && ask < geo, "the city is asked for before the geocode");
});

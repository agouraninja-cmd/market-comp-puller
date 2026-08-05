// Corpus audit — the structural integrity rules for the comp corpus.
//
// Run: npm test
//
// Every case here is drawn from a real corpus row or a real false positive
// found while designing the feature. Nothing touches a database or a network.

const test = require("node:test");
const assert = require("node:assert");

const { enforcedSourceType, isAggregateAddress, urlIdentifiesProperty } = require("../corpus-audit");

test("enforcedSourceType coerces unknown values onto the enum", () => {
  assert.equal(enforcedSourceType("costar flyer", "100 Main St, Dallas, TX"), "listing");
  assert.equal(enforcedSourceType("county assessor", "100 Main St, Dallas, TX"), "public_record");
  assert.equal(enforcedSourceType("press release", "100 Main St, Dallas, TX"), "news");
  assert.equal(enforcedSourceType("who knows", "100 Main St, Dallas, TX"), "estimate");
});

test("enforcedSourceType keeps an exact enum value", () => {
  assert.equal(enforcedSourceType("listing", "100 Main St, Dallas, TX"), "listing");
});

test("enforcedSourceType forces estimate when the address has no street number", () => {
  assert.equal(enforcedSourceType("listing", "Pocatello, ID (43,000 SF warehouse)"), "estimate");
});

test("enforcedSourceType forces estimate on an aggregate address", () => {
  assert.equal(enforcedSourceType("public_record", "100 Main St Market Median"), "estimate");
});

test("enforcedSourceType under-claims a hyphenated address range (known, recorded)", () => {
  // "7657-7695 S 5th Ave" is a genuine address range, but the street-number
  // test requires digits followed by whitespace. Under-claiming is the safe
  // direction, so this is pinned as current behavior, not fixed here.
  assert.equal(enforcedSourceType("listing", "7657-7695 S 5th Ave, Pocatello, ID"), "estimate");
});

test("isAggregateAddress catches statistic vocabulary, not bare street names", () => {
  assert.equal(isAggregateAddress("Market Median, Dallas, TX"), true);
  assert.equal(isAggregateAddress("123 Market St, Dallas, TX"), false);
});

// --- Citation specificity: does the source link name THIS property? ---------

test("a listing id of five or more digits identifies the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "322 Griffith St, Pocatello, ID", source_url: "https://realmo.com/listing/12172862", source_type: "listing" }), true);
});

test("a search-results page does not identify the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "322 Griffith St, Pocatello, ID",
      source_url: "https://realmo.com/warehouses/for-lease/id/pocatello/", source_type: "listing" }), false);
});

test("a LoopNet market search page does not identify the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "Pocatello, ID (43,000 SF warehouse, built 1980)",
      source_url: "https://loopnet.com/idaho/pocatello_warehouses-for-lease", source_type: "listing" }), false);
});

test("street number plus a street-name token identifies the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "4502 Airport Dr, Ontario, CA",
      source_url: "https://example.com/listings/4502-airport-dr", source_type: "listing" }), true);
});

test("a four-digit year in the path is not a street-number match on its own", () => {
  // The Ontario flyer PDF sits under /2025-05/ and would otherwise "match"
  // the street number of an address like 2025 Main St.
  assert.equal(urlIdentifiesProperty(
    { address: "2025 Main St, Ontario, CA",
      source_url: "https://content.ontarioca.gov/sites/default/files/2025-05/For%20Lease.pdf",
      source_type: "listing" }), false);
});

test("a news article naming the market identifies its subject (looser rule)", () => {
  // Found as a false positive while designing: a legitimate article names the
  // deal without carrying the street number.
  assert.equal(urlIdentifiesProperty(
    { address: "1800 River Park Way, Pocatello, ID 83201",
      source_url: "https://rebusinessonline.com/cbre-arranges-sale-of-59-7-acre-industrial-site-in-pocatello-ida/",
      source_type: "news" }), true);
});

test("a missing or malformed url never throws and never counts as specific", () => {
  assert.equal(urlIdentifiesProperty({ address: "100 Main St", source_url: "" }), false);
  assert.equal(urlIdentifiesProperty({ address: "100 Main St", source_url: "not a url" }), false);
  assert.equal(urlIdentifiesProperty({}), false);
});

// Corpus audit — the structural integrity rules for the comp corpus.
//
// Run: npm test
//
// Every case here is drawn from a real corpus row or a real false positive
// found while designing the feature. Nothing touches a database or a network.

const test = require("node:test");
const assert = require("node:assert");

const { enforcedSourceType, isAggregateAddress } = require("../corpus-audit");

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

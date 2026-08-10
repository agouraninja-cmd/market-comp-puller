// test/explore-query.test.js
// What someone types into the Market Explorer. Pure like city-check.js: no
// I/O, so npm test covers every table and every ordering trap with no
// network. A zip is returned as an intent for index.html to resolve.
// Spec: docs/superpowers/specs/2026-08-10-explore-query-parsing-design.md

const test = require("node:test");
const assert = require("node:assert");

const EQ = require("../explore-query");
const parse = EQ.parseExploreQuery;

test("the classic shape still parses", () => {
  assert.deepEqual(parse("industrial Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("office Dallas, TX"), { type: "Office", city: "Dallas", state: "TX" });
});

test("full state names resolve, including two-word ones", () => {
  assert.deepEqual(parse("industrial Boise Idaho"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("retail Santa Fe New Mexico"), { type: "Retail", city: "Santa Fe", state: "NM" });
  assert.deepEqual(parse("office Brooklyn New York"), { type: "Office", city: "Brooklyn", state: "NY" });
});

// The whole reason the state is resolved BEFORE fillers are stripped: eight
// abbreviations are also English words. Strip "in" first and Indiana is gone.
test("a trailing state abbreviation that is also a filler word survives", () => {
  assert.deepEqual(parse("warehouse in Gary IN"), { type: "Industrial", city: "Gary", state: "IN" });
  assert.deepEqual(parse("retail in Portland OR"), { type: "Retail", city: "Portland", state: "OR" });
});

test("filler words are dropped from the city", () => {
  assert.deepEqual(parse("industrial market in Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("office properties for sale in Tampa FL"), { type: "Office", city: "Tampa", state: "FL" });
});

// "Kansas City Kansas" is the case where the city CONTAINS a state word.
test("a city whose name contains a state word keeps it", () => {
  assert.deepEqual(parse("industrial Kansas City Kansas"), { type: "Industrial", city: "Kansas City", state: "KS" });
  assert.deepEqual(parse("office New York NY"), { type: "Office", city: "New York", state: "NY" });
});

// The empty-city guard: consuming the state must never leave a blank city.
test("a state name with no city left is no-city, not a blank city", () => {
  assert.deepEqual(parse("office New York"), { reason: "no-city" });
  assert.deepEqual(parse("industrial Idaho"), { reason: "no-city" });
});

test("two-word type synonyms win over the bare type token", () => {
  assert.deepEqual(parse("office building Boise ID"), { type: "Office", city: "Boise", state: "ID" });
  assert.deepEqual(parse("industrial park Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("shopping center Boise ID"), { type: "Retail", city: "Boise", state: "ID" });
});

test("one-word type synonyms, including the hyphenated one", () => {
  assert.deepEqual(parse("warehouse Boise ID"), { type: "Industrial", city: "Boise", state: "ID" });
  assert.deepEqual(parse("apartments Boise ID"), { type: "Multifamily", city: "Boise", state: "ID" });
  assert.deepEqual(parse("multi-family Boise ID"), { type: "Multifamily", city: "Boise", state: "ID" });
});

test("a zip becomes an intent, carrying a type when one was typed", () => {
  assert.deepEqual(parse("83301"), { reason: "zip", zip: "83301", type: null });
  assert.deepEqual(parse("warehouse 83301"), { reason: "zip", zip: "83301", type: "Industrial" });
  assert.deepEqual(parse("industrial 83301"), { reason: "zip", zip: "83301", type: "Industrial" });
});

test("unchanged refusals and hint reasons", () => {
  assert.deepEqual(parse("land Boise ID"), { reason: "unsupported-type" });
  assert.deepEqual(parse("residential Boise ID"), { reason: "unsupported-type" });
  assert.deepEqual(parse("Boise ID"), { reason: "no-type", city: "Boise", state: "ID" });
  assert.deepEqual(parse("industrial Boise"), { reason: "no-state" });
  assert.deepEqual(parse(""), { reason: "no-city" });
  assert.deepEqual(parse("   "), { reason: "no-city" });
});

test("city capitalization matches what the server expects", () => {
  // server.js title-cases after punctuation too, and city-check.js sends the
  // typed spelling to Zippopotam, so "coeur d'alene idaho" must come back
  // as "Coeur D'Alene", not "Coeur d'alene".
  assert.deepEqual(parse("industrial coeur d'alene idaho"),
    { type: "Industrial", city: "Coeur D'Alene", state: "ID" });
});

test("tables are exported and canonical", () => {
  assert.deepEqual(EQ.EXPLORE_TYPES, ["Industrial", "Office", "Retail", "Multifamily"]);
  assert.equal(EQ.STATE_NAMES.idaho, "ID");
  assert.equal(EQ.STATE_NAMES["new mexico"], "NM");
  assert.equal(Object.keys(EQ.STATE_NAMES).length, 50);   // DC rides the abbreviation list only
  assert.equal(EQ.TYPE_SYNONYMS.warehouse, "Industrial");
  assert.ok(EQ.FILLERS.includes("market"));
  assert.ok(!EQ.FILLERS.includes("the"));  // "The Dalles OR" is a real city
});

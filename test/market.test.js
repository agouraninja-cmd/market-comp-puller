"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../market");

// --- marketOf: the canonical "City, ST" key ---------------------------------
// These first tests pin the behavior marketOf() had while it lived in
// server.js. The parse is the comp corpus key (harvestComps writes under it,
// corpusRowsForMarket matches it case-sensitively), so any change here
// silently re-keys the corpus. Extraction must not move a byte of US behavior.

test("marketOf reads city + state from an ordinary address", () => {
  assert.equal(M.marketOf("5905 Kieley Pl, Cincinnati, OH 45217"), "Cincinnati, OH");
});

test("marketOf canonicalizes case: title-cased city, uppercase state", () => {
  assert.equal(M.marketOf("100 main st, ontario, ca"), "Ontario, CA");
});

test("marketOf title-cases across spaces, hyphens, apostrophes and dots", () => {
  assert.equal(M.marketOf("winston-salem, nc"), "Winston-Salem, NC");
  assert.equal(M.marketOf("coeur d'alene, id"), "Coeur D'Alene, ID");
});

test("marketOf drops parentheticals whose commas would fool the segment walk", () => {
  assert.equal(
    M.marketOf("Ontario, CA (Orden acquisition, 257,000 SF industrial/office)"),
    "Ontario, CA");
});

test("marketOf survives a trailing descriptor after the state code", () => {
  assert.equal(M.marketOf("Ontario, CA - Airport Area Submarket Warehouse"), "Ontario, CA");
});

test("marketOf strips a trailing USA suffix", () => {
  assert.equal(M.marketOf("100 Main St, Dallas, TX, USA"), "Dallas, TX");
  assert.equal(M.marketOf("100 Main St, Dallas, TX, United States"), "Dallas, TX");
});

test("marketOf keeps one city per key for slash-named submarkets", () => {
  assert.equal(M.marketOf("Ontario/San Bernardino County, CA"), "Ontario, CA");
});

test("marketOf does not read a bare zip or square-footage token as a state", () => {
  // "SF" starts a segment but is not a state; the walk must keep looking.
  assert.equal(M.marketOf("Financial District, SF Bay Area, Oakland, CA"), "Oakland, CA");
});

test("marketOf falls back to the trailing segment when no state is found", () => {
  assert.equal(M.marketOf("Somewhere, Nowhereland"), "Nowhereland");
});

test("marketOf returns a comma-less address as-is (the known non-canonical echo)", () => {
  assert.equal(M.marketOf("1394 North 28th st washougal"), "1394 North 28th st washougal");
});

test("marketOf caps the fallback at 60 chars", () => {
  const long = "x".repeat(200);
  assert.equal(M.marketOf(long).length, 60);
});

test("marketOf returns empty string for empty or missing input", () => {
  assert.equal(M.marketOf(""), "");
  assert.equal(M.marketOf(null), "");
  assert.equal(M.marketOf(undefined), "");
});

// --- marketOf: Canadian addresses (the roadmap's "Canada" fix) ---------------
// Before this module existed, every Canadian address collapsed to the literal
// key "Canada" (the trailing-segment fallback), which would file every
// Canadian city in one corpus bucket the day non-USD reports are harvested.

test("marketOf reads a Canadian province like a state", () => {
  assert.equal(M.marketOf("123 King St W, Toronto, ON, Canada"), "Toronto, ON");
});

test("marketOf handles a province with a trailing postal code", () => {
  assert.equal(M.marketOf("1055 W Georgia St, Vancouver, BC V6E 3P3"), "Vancouver, BC");
});

test("marketOf canonicalizes Canadian case too", () => {
  assert.equal(M.marketOf("montreal, qc, canada"), "Montreal, QC");
});

test("marketOf strips a trailing Canada suffix so it never becomes the key", () => {
  // No province to find, but the country name must not become a market.
  assert.equal(M.marketOf("Toronto, Canada"), "Toronto");
});

// --- marketForLog: the analytics shape guard --------------------------------

test("marketForLog passes a canonical market through", () => {
  assert.equal(M.marketForLog("Boise, ID"), "Boise, ID");
  assert.equal(M.marketForLog("Toronto, ON"), "Toronto, ON");
});

test("marketForLog drops free text, echoes and empties", () => {
  assert.equal(M.marketForLog("1394 North 28th st washougal"), "");
  assert.equal(M.marketForLog("Canada"), "");
  assert.equal(M.marketForLog(""), "");
  assert.equal(M.marketForLog(null), "");
});

// --- US_STATES: shared vocabulary, exported for server.js's validators ------

test("US_STATES holds the 50 states plus DC", () => {
  assert.equal(M.US_STATES.size, 51);
  assert.ok(M.US_STATES.has("TX"));
  assert.ok(M.US_STATES.has("DC"));
  assert.ok(!M.US_STATES.has("ON"), "provinces are not US states");
});

// --- Metro groups: neighboring suburbs that share a submarket --------

test("metroOf returns the metro for a member city and null otherwise", () => {
  assert.equal(M.metroOf("Meridian, ID"), "Boise, ID");
  assert.equal(M.metroOf("Boise, ID"), "Boise, ID");
  assert.equal(M.metroOf("Pocatello, ID"), null);
  assert.equal(M.metroOf("Nowhere, XX"), null);
  assert.equal(M.metroOf(""), null);
  assert.equal(M.metroOf(null), null);
});

test("metroOf tolerates casing and spacing variants of a real key", () => {
  assert.equal(M.metroOf("meridian, id"), "Boise, ID");
  assert.equal(M.metroOf("  Meridian,ID "), "Boise, ID");
});

test("siblingMarkets excludes the market itself and is empty when ungrouped", () => {
  const sibs = M.siblingMarkets("Meridian, ID");
  assert.ok(sibs.includes("Boise, ID"));
  assert.ok(sibs.includes("Nampa, ID"));
  assert.ok(!sibs.includes("Meridian, ID"));
  assert.deepEqual(M.siblingMarkets("Pocatello, ID"), []);
  assert.deepEqual(M.siblingMarkets(null), []);
});

// The trap this catches: the corpus is keyed by marketOf's output, and the
// lookup is an exact string match. A typo or a lowercase city in the table
// simply never matches, and the feature looks like it works while doing
// nothing at all.
test("every METRO_GROUPS entry is exactly what marketOf produces for it", () => {
  for (const [metro, members] of Object.entries(M.METRO_GROUPS)) {
    assert.equal(M.marketOf(metro), metro, `metro key ${metro}`);
    for (const m of members) {
      assert.equal(M.marketOf(m), m, `member ${m} of ${metro}`);
    }
  }
});

test("no city belongs to two metros", () => {
  const seen = new Set();
  for (const members of Object.values(M.METRO_GROUPS)) {
    for (const m of members) {
      assert.ok(!seen.has(m), `${m} appears in two groups`);
      seen.add(m);
    }
  }
});

// --- exampleMarketOrder: the Explorer's rotating example --------------------
// The placeholder is a WORKING QUERY (Tab types it in), so the constraint
// under every one of these is that the example must name a market with a
// standing page. Fed MARKET_PAGES, the committed seed, that holds by
// construction — which is why the rotation must never be fed the merged store.

test("exampleMarketOrder covers every seeded market exactly once", () => {
  const seed = require("../market-seed.json");
  const order = M.exampleMarketOrder(seed);
  assert.equal(order.length, Object.keys(seed).length);
  assert.equal(new Set(order).size, order.length, "an example must not repeat inside one cycle");
});

test("exampleMarketOrder interleaves the types instead of grouping them", () => {
  // The seed is 8 industrial / 8 office / 5 retail / 6 multifamily. Straight
  // down the file, a visitor would refresh eight times before seeing an
  // office page — the reason this rotates at all is to show the range.
  const order = M.exampleMarketOrder(require("../market-seed.json"));
  const typeOf = (s) => s.split(" ")[0];
  assert.deepEqual(order.slice(0, 4).map(typeOf),
    ["industrial", "office", "retail", "multifamily"]);
  assert.equal(order[0], "industrial Ontario, CA",
    "entry 0 is what a fresh process serves and what scripts/shot.js pins");
});

test("exampleMarketOrder lower-cases the type and keeps the comma", () => {
  const order = M.exampleMarketOrder({
    "office-dallas-tx": { type: "Office", city: "Dallas", state: "TX" },
  });
  // Lower-case matches the copy the box has always used; the comma is what
  // the rest of the product writes, and explore-query.js strips it anyway.
  assert.deepEqual(order, ["office Dallas, TX"]);
});

test("exampleMarketOrder skips incomplete entries and survives an empty map", () => {
  assert.deepEqual(M.exampleMarketOrder({}), []);
  assert.deepEqual(M.exampleMarketOrder(null), []);
  assert.deepEqual(M.exampleMarketOrder({
    ok: { type: "Retail", city: "Orlando", state: "FL" },
    noCity: { type: "Retail", state: "FL" },
    noType: { city: "Tampa", state: "FL" },
  }), ["retail Orlando, FL"]);
});

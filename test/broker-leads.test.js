"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../broker-leads");

// --- coverage keys and sets -------------------------------------------------
test("coverageKey joins market and type", () => {
  assert.equal(L.coverageKey("Boise, ID", "Industrial"), "Boise, ID|Industrial");
});

test("buildCoverageSet dedupes and skips blank rows", () => {
  const set = L.buildCoverageSet([
    { market: "Boise, ID", property_type: "Industrial" },
    { market: "Boise, ID", property_type: "Industrial" },
    { market: "", property_type: "" },
    null,
  ]);
  assert.equal(set.size, 1);
  assert.ok(set.has("Boise, ID|Industrial"));
});

test("buildCoverageSet skips a row with only one blank field, closing a wildcard match", () => {
  const cov = [{ market: "Boise, ID", property_type: "" }];
  const leads = [{ id: 1, market: "Boise, ID", type: "" }];
  assert.equal(L.filterLeadsForCoverage(leads, cov).length, 0);
});

// --- filtering ---------------------------------------------------------------
test("filterLeadsForCoverage keeps only covered market+type", () => {
  const cov = [{ market: "Boise, ID", property_type: "Industrial" }];
  const leads = [
    { id: 1, market: "Boise, ID", type: "Industrial" },
    { id: 2, market: "Boise, ID", type: "Office" },
    { id: 3, market: "Eagle, ID", type: "Industrial" },
    null,
  ];
  assert.deepEqual(L.filterLeadsForCoverage(leads, cov).map((l) => l.id), [1]);
});

test("filterLeadsForCoverage is exact on market case (canonical form is the contract)", () => {
  const cov = [{ market: "boise, id", property_type: "Industrial" }];
  const leads = [{ id: 1, market: "Boise, ID", type: "Industrial" }];
  assert.equal(L.filterLeadsForCoverage(leads, cov).length, 0);
});

test("a single lead is visible only inside coverage (the intro gate's check)", () => {
  const cov = [{ market: "Boise, ID", property_type: "Industrial" }];
  const lead = { id: 7, market: "Boise, ID", type: "Industrial" };
  assert.equal(L.filterLeadsForCoverage([lead], cov).length, 1);
  assert.equal(L.filterLeadsForCoverage([{ ...lead, type: "Office" }], cov).length, 0);
  assert.equal(L.filterLeadsForCoverage([{ ...lead, market: "Eagle, ID" }], cov).length, 0);
});

// --- market shape ------------------------------------------------------------
test("isCanonicalMarket accepts City, ST and rejects raw address text", () => {
  assert.equal(L.isCanonicalMarket("Boise, ID"), true);
  assert.equal(L.isCanonicalMarket("1394 North 28th st washougal"), false);
  assert.equal(L.isCanonicalMarket(""), false);
  assert.equal(L.isCanonicalMarket(null), false);
});

// --- anonymization -----------------------------------------------------------
test("anonymizeLead emits exactly the allowlist, nothing else, and leaks no PII value", () => {
  const out = L.anonymizeLead({
    id: 7, market: "Boise, ID", type: "Industrial", size_sqft: "42000",
    ts: "2026-08-05T00:00:00.000Z",
    // Everything below must be stripped. This test is the privacy wall.
    name: "Pat Owner", email: "pat@example.com", phone: "208-555-0100",
    company: "Owner LLC", address: "123 Main St, Boise, ID", source: "bov",
  }, new Set());
  assert.deepEqual(Object.keys(out).sort(),
    ["id", "intro_requested", "is_1031", "market", "size_sqft", "ts", "type"]);
  assert.equal(out.size_sqft, 42000);
  assert.equal(out.intro_requested, false);
  assert.equal(out.is_1031, false);
  const leaked = ["Pat Owner", "pat@example.com", "208-555-0100", "Owner LLC", "123 Main St"];
  for (const v of Object.values(out)) {
    for (const bad of leaked) assert.ok(!String(v).includes(bad), `${bad} leaked into ${v}`);
  }
});

test("anonymizeLead marks intro_requested from the set and nulls bad sizes", () => {
  const out = L.anonymizeLead({ id: 7, market: "m", type: "t", size_sqft: "n/a", ts: "" },
    new Set(["7"]));
  assert.equal(out.intro_requested, true);
  assert.equal(out.size_sqft, null);
});

test("anonymizeLead nulls an out-of-bounds size the same way cleanSizeSqft does", () => {
  const out = L.anonymizeLead({ id: 1, market: "Boise, ID", type: "Industrial", size_sqft: 1e10, ts: "" },
    new Set());
  assert.equal(out.size_sqft, null);
});

test("anonymizeLead blanks a market that is not City, ST shape", () => {
  const out = L.anonymizeLead(
    { id: 1, market: "1394 North 28th st washougal", type: "Industrial", ts: "" },
    new Set());
  assert.equal(out.market, "");
});

test("anonymizeLead tolerates a null lead and null introSet without throwing", () => {
  const out = L.anonymizeLead(null, null);
  assert.deepEqual(Object.keys(out).sort(),
    ["id", "intro_requested", "is_1031", "market", "size_sqft", "ts", "type"]);
  assert.equal(out.intro_requested, false);
});

test("anonymizeLead derives is_1031 as a boolean, never the raw source tag", () => {
  const base = { id: 1, market: "Boise, ID", type: "Industrial", ts: "" };
  assert.equal(L.anonymizeLead({ ...base, source: "1031" }, new Set()).is_1031, true);
  assert.equal(L.anonymizeLead({ ...base, source: "bov" }, new Set()).is_1031, false);
  assert.equal(L.anonymizeLead({ ...base }, new Set()).is_1031, false);
  // The allowlist carries facts, not the tag: `source` itself must not appear.
  assert.ok(!("source" in L.anonymizeLead({ ...base, source: "1031" }, new Set())));
});

// --- seeding -----------------------------------------------------------------
test("seedCoverageFromSubmissions dedupes and tags earned", () => {
  const out = L.seedCoverageFromSubmissions([
    { market: "Boise, ID", property_type: "Industrial" },
    { market: "Boise, ID", property_type: "Industrial" },
    { market: "Eagle, ID", property_type: "Industrial" },
    { market: "", property_type: "Industrial" },
    { market: "Boise, ID", property_type: "" },
  ]);
  assert.deepEqual(out, [
    { market: "Boise, ID", property_type: "Industrial", source: "earned" },
    { market: "Eagle, ID", property_type: "Industrial", source: "earned" },
  ]);
});

test("seedCoverageFromSubmissions skips a market that is not City, ST shape", () => {
  const out = L.seedCoverageFromSubmissions([
    { market: "1394 North 28th st washougal", property_type: "Industrial" },
    { market: "Boise, ID", property_type: "Industrial" },
  ]);
  assert.deepEqual(out, [
    { market: "Boise, ID", property_type: "Industrial", source: "earned" },
  ]);
});

// --- size cleaning -----------------------------------------------------------
test("cleanSizeSqft accepts numbers and grouped strings, rejects junk", () => {
  assert.equal(L.cleanSizeSqft(42000), 42000);
  assert.equal(L.cleanSizeSqft("42,000"), 42000);
  assert.equal(L.cleanSizeSqft("0"), null);
  assert.equal(L.cleanSizeSqft(-5), null);
  assert.equal(L.cleanSizeSqft("1.2M"), null);
  assert.equal(L.cleanSizeSqft(""), null);
  assert.equal(L.cleanSizeSqft(null), null);
  assert.equal(L.cleanSizeSqft(1e10), null);
});

// --- notify dedupe -----------------------------------------------------------
test("notifyTargets dedupes user ids and caps at MAX_NOTIFY_PER_LEAD", () => {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const hex = (i % 25).toString(16).padStart(2, "0");
    rows.push({ user_id: "00000000-0000-4000-8000-0000000000" + hex });
  }
  const out = L.notifyTargets(rows);
  assert.equal(out.length, L.MAX_NOTIFY_PER_LEAD);
  assert.equal(new Set(out).size, out.length);
});

test("notifyTargets skips rows without a user_id", () => {
  assert.deepEqual(
    L.notifyTargets([{ user_id: "" }, null, { user_id: "00000000-0000-4000-8000-000000000001" }]),
    ["00000000-0000-4000-8000-000000000001"]);
});

test("notifyTargets drops ids that are not UUID-shaped (defense for a PostgREST filter)", () => {
  assert.deepEqual(
    L.notifyTargets([{ user_id: "u1" }, { user_id: "00000000-0000-4000-8000-000000000001" }]),
    ["00000000-0000-4000-8000-000000000001"]);
});

// --- metro matching ---------------------------------------------------------
//
// A broker covering Boise industrial is covering Meridian industrial: those
// cities trade as one market, which is what market.js's curated METRO_GROUPS
// records. Until this shipped, that table was read by corpus retrieval and by
// nothing else, so a Meridian lead reached nobody in Boise.
//
// The adjacency function is INJECTED rather than required, so these tests can
// state the adjacency they are testing instead of depending on the live table.

const SIBS = { "Boise, ID": ["Meridian, ID", "Nampa, ID"], "Meridian, ID": ["Boise, ID", "Nampa, ID"] };
const siblingsOf = (m) => SIBS[m] || [];

test("without an adjacency function, matching is exactly what it was", () => {
  const cov = [{ market: "Boise, ID", property_type: "Industrial" }];
  const leads = [{ id: 1, market: "Meridian, ID", type: "Industrial" }];
  assert.deepEqual(L.filterLeadsForCoverage(leads, cov), [],
    "the default must stay exact-market, so every existing caller is unchanged");
});

test("a broker covering Boise sees a Meridian lead of the same type", () => {
  const cov = [{ market: "Boise, ID", property_type: "Industrial" }];
  const leads = [{ id: 1, market: "Meridian, ID", type: "Industrial" }];
  assert.deepEqual(L.filterLeadsForCoverage(leads, cov, siblingsOf).map((l) => l.id), [1]);
});

// The widening is geographic ONLY. Crossing property types would put a retail
// enquiry in an industrial broker's inbox on the strength of a shared suburb.
test("the property type is never widened along with the geography", () => {
  const cov = [{ market: "Boise, ID", property_type: "Industrial" }];
  const leads = [{ id: 1, market: "Meridian, ID", type: "Retail" }];
  assert.deepEqual(L.filterLeadsForCoverage(leads, cov, siblingsOf), []);
});

test("an ungrouped market matches only itself, adjacency function or not", () => {
  const cov = [{ market: "Denver, CO", property_type: "Industrial" }];
  const leads = [
    { id: 1, market: "Denver, CO", type: "Industrial" },
    { id: 2, market: "Boulder, CO", type: "Industrial" },
  ];
  assert.deepEqual(L.filterLeadsForCoverage(leads, cov, siblingsOf).map((l) => l.id), [1]);
});

// The set is built from a table, and a malformed entry in it must not become a
// coverage key that quietly matches nothing forever (the isCanonicalMarket
// rule the rest of this module already holds).
test("a non-canonical sibling is dropped rather than keyed", () => {
  const set = L.buildCoverageSet(
    [{ market: "Boise, ID", property_type: "Industrial" }],
    () => ["Meridian, ID", "not a market", ""]);
  assert.ok(set.has("Meridian, ID|Industrial"));
  assert.ok(!set.has("not a market|Industrial"));
});

// The notify path starts from one lead and queries coverage in SQL, so it
// cannot expand the broker's side -- it widens from the other end instead.
// The two have to agree or a broker is emailed about a lead the inbox hides,
// or shown one they were never told about.
test("coverageMarketsFor returns the lead's own market plus its metro", () => {
  assert.deepEqual(L.coverageMarketsFor("Boise, ID", siblingsOf),
    ["Boise, ID", "Meridian, ID", "Nampa, ID"]);
  assert.deepEqual(L.coverageMarketsFor("Boise, ID"), ["Boise, ID"],
    "no adjacency function means today's exact behaviour");
  assert.deepEqual(L.coverageMarketsFor("Denver, CO", siblingsOf), ["Denver, CO"]);
});

test("coverageMarketsFor refuses a non-canonical market outright", () => {
  assert.deepEqual(L.coverageMarketsFor("123 Main St", siblingsOf), [],
    "marketOf's no-state fallback must never reach a coverage query");
  assert.deepEqual(L.coverageMarketsFor("", siblingsOf), []);
});

// The inbox and the alert are two halves of one rule, so state it as one test.
test("what a lead alerts on and what an inbox shows are the same set", () => {
  const lead = { id: 1, market: "Meridian, ID", type: "Industrial" };
  const cov = [{ market: "Boise, ID", property_type: "Industrial" }];
  const seesIt = L.filterLeadsForCoverage([lead], cov, siblingsOf).length === 1;
  const alertsBoise = L.coverageMarketsFor(lead.market, siblingsOf).includes("Boise, ID");
  assert.equal(seesIt, alertsBoise);
  assert.equal(seesIt, true);
});

test("nearbyCountFor counts the EXTRA markets, for the page to disclose", () => {
  assert.equal(L.nearbyCountFor("Boise, ID", siblingsOf), 2);
  assert.equal(L.nearbyCountFor("Denver, CO", siblingsOf), 0);
  assert.equal(L.nearbyCountFor("Boise, ID"), 0, "off by default");
});

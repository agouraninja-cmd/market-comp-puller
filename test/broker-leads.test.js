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
    ["id", "intro_requested", "market", "size_sqft", "ts", "type"]);
  assert.equal(out.size_sqft, 42000);
  assert.equal(out.intro_requested, false);
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
    ["id", "intro_requested", "market", "size_sqft", "ts", "type"]);
  assert.equal(out.intro_requested, false);
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

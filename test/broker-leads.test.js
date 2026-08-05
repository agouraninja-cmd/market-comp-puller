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

// --- anonymization -----------------------------------------------------------
test("anonymizeLead emits exactly the allowlist, nothing else", () => {
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
});

test("anonymizeLead marks intro_requested from the set and nulls bad sizes", () => {
  const out = L.anonymizeLead({ id: 7, market: "m", type: "t", size_sqft: "n/a", ts: "" },
    new Set(["7"]));
  assert.equal(out.intro_requested, true);
  assert.equal(out.size_sqft, null);
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
  for (let i = 0; i < 30; i++) rows.push({ user_id: "u" + (i % 25) });
  const out = L.notifyTargets(rows);
  assert.equal(out.length, L.MAX_NOTIFY_PER_LEAD);
  assert.equal(new Set(out).size, out.length);
});

test("notifyTargets skips rows without a user_id", () => {
  assert.deepEqual(L.notifyTargets([{ user_id: "" }, null, { user_id: "a" }]), ["a"]);
});

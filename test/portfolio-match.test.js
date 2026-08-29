const test = require("node:test");
const assert = require("node:assert");
const PM = require("../portfolio-match.js");

// The real case this exists for: one Boise house typed three ways on one
// owner's desk, each way saved as its own property with its own value history.
const VERIFIED = "1210 N 17TH ST, BOISE, ID, 83702";
const rows = () => ([
  { id: "a", address: "1210N17th st", property_type: "Residential", verified_key: PM.verifiedKeyFor(VERIFIED) },
  { id: "b", address: "88 Pioneer St, Meridian, ID", property_type: "Retail", verified_key: PM.verifiedKeyFor("88 PIONEER ST, MERIDIAN, ID, 83642") },
]);

test("a differently typed address matches the property it was verified as", () => {
  for (const typed of ["1210 N 17th st Boise Idaho 83702", "1210N17th st Boise Id", "1210 n 17th street, boise"]) {
    const hit = PM.findMatch(rows(), { address: typed, propertyType: "Residential", verifiedKey: VERIFIED });
    assert.equal(hit && hit.id, "a", `"${typed}" should land on the property it verified as`);
  }
});

test("the geocoders' formatting differences do not split a property", () => {
  // Census shouts and abbreviates; Nominatim spells out and adds a country.
  // Both are answers to the same lookup, which is all normalizeVerified is
  // ever asked to absorb.
  const a = PM.verifiedKeyFor("1210 N 17TH ST, BOISE, ID, 83702");
  const b = PM.verifiedKeyFor("1210 N 17th St., Boise, ID 83702");
  assert.equal(a, b);
});

test("a different building never merges, however close the text", () => {
  const hit = PM.findMatch(rows(), {
    address: "1212 N 17th St, Boise, ID",
    propertyType: "Residential",
    verifiedKey: "1212 N 17TH ST, BOISE, ID, 83702",
  });
  assert.equal(hit, null);
});

test("the property type still has to match", () => {
  // Same building, valued as something else, is a different saved property —
  // its comps, its lookback and its whole report differ.
  const hit = PM.findMatch(rows(), { address: "x", propertyType: "Office", verifiedKey: VERIFIED });
  assert.equal(hit, null);
});

test("falls back to today's exact-address rule when nothing is verified", () => {
  const hit = PM.findMatch(rows(), { address: "1210N17th st", propertyType: "Residential" });
  assert.equal(hit && hit.id, "a");
  assert.equal(PM.findMatch(rows(), { address: "1210 N 17th st Boise Idaho 83702", propertyType: "Residential" }), null,
    "without a verified key the old behavior must be unchanged — a new spelling is a new row");
});

test("a row saved before verified keys existed still matches by address", () => {
  const legacy = [{ id: "old", address: "5 Elm St", property_type: "Office", verified_key: null }];
  const hit = PM.findMatch(legacy, { address: "5 Elm St", propertyType: "Office", verifiedKey: "5 ELM ST, BOISE, ID" });
  assert.equal(hit && hit.id, "old", "a verified key must not stop the address fallback from finding a legacy row");
});

// --- keys that must never become an identity -------------------------------
// Each of these would merge unrelated properties if it were allowed through,
// which is the one failure this module is written to avoid.
test("useless verified keys are refused rather than shared", () => {
  for (const bad of ["", null, undefined, "   ", "id", "boise, id", "12345", "  ,  ,  "]) {
    assert.equal(PM.verifiedKeyFor(bad), "", JSON.stringify(bad) + " must not become a property identity");
  }
  assert.equal(PM.verifiedKeyFor("x".repeat(PM.MAX_KEY_LENGTH + 1)), "", "an absurd label is refused");
});

test("two unplaceable properties do not collapse into one", () => {
  const desk = [
    { id: "p1", address: "Parcel A", property_type: "Land", verified_key: "" },
    { id: "p2", address: "Parcel B", property_type: "Land", verified_key: "" },
  ];
  assert.equal(PM.findMatch(desk, { address: "Parcel C", propertyType: "Land", verifiedKey: "" }), null);
  assert.equal(PM.findMatch(desk, { address: "Parcel B", propertyType: "Land", verifiedKey: "  " }).id, "p2",
    "an empty key falls through to the address, it does not match the first empty-keyed row");
});

test("a malformed stored key cannot match a good one", () => {
  const desk = [{ id: "z", address: "9 Oak", property_type: "Office", verified_key: "id" }];
  assert.equal(PM.findMatch(desk, { address: "different", propertyType: "Office", verifiedKey: "id" }), null);
});

test("findMatch tolerates junk input rather than throwing", () => {
  assert.equal(PM.findMatch(null, { address: "a", propertyType: "Office" }), null);
  assert.equal(PM.findMatch([null, undefined], { address: "a", propertyType: "Office" }), null);
  assert.equal(PM.findMatch([{ address: "a", property_type: "Office" }], undefined), null);
});

// Migration 035 runs by hand against production with no staging database to
// rehearse against — the same guard broker-properties and bov-log carry.
test("migration 035 contains no destructive statement", () => {
  const fs = require("node:fs");
  const sql = fs.readFileSync(__dirname + "/../migrations/035-portfolio-verified-key.sql", "utf8").toLowerCase();
  for (const forbidden of ["drop table", "drop column", "rename to", "rename column", "truncate", "delete from", "update portfolio_items"]) {
    assert.ok(!sql.includes(forbidden), "035 contains destructive statement: " + forbidden);
  }
  assert.ok(sql.includes("add column if not exists verified_key"),
    "035 must still add the column the portfolio read selects by name");
});

// Building-level facts — building-facts.js.
//
// Spec: docs/superpowers/specs/2026-09-03-vault-building-facts-design.md
//
// The two rules worth a test each are the two a future editor will
// "simplify": a disagreement is a CONFLICT with no value (never a quietly
// chosen winner), and a lease never inherits a size (a suite is not the
// building). Everything else here is the field table in §2, pinned in both
// directions so a new per-type field cannot land on neither side.

const test = require("node:test");
const assert = require("node:assert");

const BF = require("../building-facts");
const { migrationColumns } = require("./helpers/migration-columns");

function sale(o) {
  return Object.assign({ transaction: "sale", deal_date: "2026-03-14", price: 1000000 }, o);
}
function lease(o) {
  return Object.assign({ transaction: "lease", deal_date: "2026-01-10" }, o);
}

// ---------------------------------------------------------------------------
// The field table (§2), both ways
// ---------------------------------------------------------------------------

test("every broker_comps column is on exactly one side of the table", () => {
  // Plumbing and the publish/renewal marks are not facts about anything.
  const plumbing = new Set([
    "id", "user_id", "upload_id", "market", "address_key", "dedupe_key",
    "property_id", "published", "published_at", "published_submission_id",
    "created_at", "renewal_notified_at",
  ]);
  const cols = migrationColumns("broker_comps").filter((c) => !plumbing.has(c));
  const both = BF.BUILDING_FIELDS.filter((f) => BF.DEAL_FIELDS.includes(f));
  assert.deepEqual(both, [], "a field cannot be both the building's and the deal's");
  const neither = cols.filter((c) => !BF.BUILDING_FIELDS.includes(c) && !BF.DEAL_FIELDS.includes(c));
  assert.deepEqual(neither, [],
    `broker_comps column(s) placed on neither side: ${neither.join(", ")}. ` +
    "Decide whether it inherits (BUILDING_FIELDS) or never does (DEAL_FIELDS).");
});

test("the deal's own figures never inherit", () => {
  const facts = BF.deriveFacts([
    sale({ price: 1000000, cap_rate: 6.1, tenancy: "Single tenant", notes: "x", year_built: "1998" }),
  ]);
  for (const f of ["price", "cap_rate", "tenancy", "notes", "deal_date", "rent_psf", "rent_basis"]) {
    assert.equal(facts.values[f], undefined, `${f} must not be derived`);
  }
  assert.equal(facts.values.year_built, "1998");
});

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

test("agreement gives a value, after trim and case-fold", () => {
  const facts = BF.deriveFacts([
    sale({ year_built: "1998", clear_height: "28 ft" }),
    sale({ deal_date: "2024-01-01", year_built: " 1998 ", clear_height: "28 FT" }),
  ]);
  assert.equal(facts.values.year_built, "1998");
  assert.equal(facts.values.clear_height, "28 ft", "the most recent deal's own spelling is served");
  assert.deepEqual(facts.conflicts, {});
});

test("numbers agree as numbers", () => {
  const facts = BF.deriveFacts([sale({ units: 48 }), sale({ units: "48.0" })]);
  assert.equal(facts.values.units, 48);
  assert.deepEqual(facts.conflicts, {});
});

test("disagreement is a conflict naming both, and NO value", () => {
  const facts = BF.deriveFacts([
    sale({ deal_date: "2026-03-14", dock_doors: "12" }),
    sale({ deal_date: "2024-03-14", dock_doors: "14" }),
  ]);
  assert.equal(facts.values.dock_doors, undefined, "a quietly chosen winner is a guess");
  assert.deepEqual(facts.conflicts.dock_doors, ["12", "14"]);
});

test("blank is not a vote", () => {
  const facts = BF.deriveFacts([
    sale({ year_built: "1998" }),
    sale({ year_built: "" }),
    sale({ year_built: null }),
    sale({}),
  ]);
  assert.equal(facts.values.year_built, "1998");
  assert.deepEqual(facts.conflicts, {});
});

test("size is derived from sales only", () => {
  const facts = BF.deriveFacts([
    sale({ size_sqft: 84000 }),
    lease({ size_sqft: 4000 }),
    lease({ size_sqft: 6500 }),
  ]);
  assert.equal(facts.values.size_sqft, 84000, "the suites do not vote on the building");
  assert.deepEqual(facts.conflicts, {});
  const leasesOnly = BF.deriveFacts([lease({ size_sqft: 4000 }), lease({ size_sqft: 4000 })]);
  assert.equal(leasesOnly.values.size_sqft, undefined, "a book of leases derives no building size");
});

test("anchor_tenant: the most recent dated deal wins and the others are prior", () => {
  const facts = BF.deriveFacts([
    sale({ deal_date: "2022-05-01", anchor_tenant: "Albertsons" }),
    sale({ deal_date: "2026-05-01", anchor_tenant: "WinCo" }),
    sale({ deal_date: null, anchor_tenant: "Kmart" }),
  ]);
  assert.equal(facts.values.anchor_tenant, "WinCo");
  assert.deepEqual(facts.prior.anchor_tenant, ["Albertsons", "Kmart"]);
  assert.equal(facts.conflicts.anchor_tenant, undefined);
});

test("derived_at is the injected clock", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  assert.equal(BF.deriveFacts([], { now }).derived_at, now.toISOString());
  assert.deepEqual(BF.deriveFacts(null, { now }).values, {});
});

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

const FACTS = { values: { year_built: "1998", size_sqft: 84000, clear_height: "28 ft" }, conflicts: {}, prior: {} };

test("applyFacts fills EMPTY building cells and names them, and returns a copy", () => {
  const before = sale({ id: "c1", price: 8400000, year_built: "", clear_height: null });
  const after = BF.applyFacts(before, FACTS);
  assert.notEqual(after, before);
  assert.equal(before.year_built, "", "the input is never touched");
  assert.equal(after.year_built, "1998");
  assert.equal(after.clear_height, "28 ft");
  assert.equal(after.size_sqft, 84000);
  assert.deepEqual(after.inherited, ["year_built", "size_sqft", "clear_height", "price_per_sqft"]);
});

test("a stated cell is never overwritten, even when it disagrees with the building", () => {
  const after = BF.applyFacts(sale({ year_built: "2004", size_sqft: 80000, price_per_sqft: 12.5 }), FACTS);
  assert.equal(after.year_built, "2004");
  assert.equal(after.size_sqft, 80000);
  assert.equal(after.price_per_sqft, 12.5);
  assert.deepEqual(after.inherited, ["clear_height"]);
});

test("a lease never inherits a size, and everything else still may", () => {
  const after = BF.applyFacts(lease({ rent_psf: 1.1, rent_basis: "monthly" }), FACTS);
  assert.equal(after.size_sqft, undefined, "a suite is not the building");
  assert.equal(after.year_built, "1998");
  assert.deepEqual(after.inherited, ["year_built", "clear_height"]);
});

test("$/SF is computed from THIS deal's price only when the size was inherited onto a priced sale", () => {
  const priced = BF.applyFacts(sale({ price: 8400000 }), FACTS);
  assert.equal(priced.price_per_sqft, 100);
  assert.ok(priced.inherited.includes("price_per_sqft"));

  const unpriced = BF.applyFacts(sale({ price: null }), FACTS);
  assert.equal(unpriced.price_per_sqft, undefined, "no price, no rate");
  assert.ok(!unpriced.inherited.includes("price_per_sqft"));

  // Size stated on the deal, $/SF absent: normalizeRow would have written it,
  // so this is a row from before that rule; still not ours to invent here.
  const ownSize = BF.applyFacts(sale({ price: 8400000, size_sqft: 42000 }), FACTS);
  assert.equal(ownSize.price_per_sqft, undefined);
});

test("nothing to inherit serializes exactly as before — no `inherited` key at all", () => {
  const full = sale({ year_built: "1998", size_sqft: 84000, clear_height: "28 ft", price_per_sqft: 100 });
  const after = BF.applyFacts(full, FACTS);
  assert.equal("inherited" in after, false);
  assert.deepEqual(after, full);
  assert.deepEqual(BF.applyFacts(full, null), full);
  assert.deepEqual(BF.applyFacts(full, { values: null }), full);
  assert.equal(BF.applyFacts(null, FACTS), null);
});

test("a conflicted fact is served to nobody", () => {
  const facts = BF.deriveFacts([sale({ dock_doors: "12" }), sale({ dock_doors: "14" })]);
  const after = BF.applyFacts(sale({}), facts);
  assert.equal(after.dock_doors, undefined);
  assert.equal("inherited" in after, false);
});

// ---------------------------------------------------------------------------
// The browser's lookup
// ---------------------------------------------------------------------------

test("findBuilding matches on the caller's own key and reports the deal count and type", () => {
  const key = (v) => String(v || "").toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
  const book = [
    { address: "100 Main St, Boise, ID", property_type: "Industrial", deal_date: "2024-01-01", facts: FACTS },
    { address: "100 MAIN ST., Boise, ID", property_type: "Industrial", deal_date: "2026-01-01", facts: FACTS },
    { address: "9 Elm Ave, Boise, ID", property_type: "Retail", deal_date: "2026-01-01" },
  ];
  const hit = BF.findBuilding(book, key("100 Main St, Boise, ID"), key);
  assert.equal(hit.deals, 2);
  assert.equal(hit.type, "Industrial");
  assert.equal(hit.facts.values.year_built, "1998");
  assert.equal(BF.findBuilding(book, key("1 Nowhere Rd"), key), null);
  assert.equal(BF.findBuilding(book, "", key), null);
  // A building whose facts have not been derived yet is still known.
  const none = BF.findBuilding(book, key("9 Elm Ave, Boise, ID"), key);
  assert.equal(none.deals, 1);
  assert.deepEqual(none.facts.values, {});
});

// The vault API's comp shape — the contract between storage and the dashboard.
//
// The point of these tests is NOT that the mapper does something clever today.
// It does nothing today, deliberately. The point is that the contract is
// written down and checked against the migration, so that the coming
// restructure of broker_comps fails the build rather than silently breaking a
// dashboard that is being written in parallel right now.

const test = require("node:test");
const assert = require("node:assert");

const { toApiComp, toApiComps, API_COMP_FIELDS, INTERNAL_FIELDS , PROPERTY_FIELDS,
  SUBMISSION_FIELDS } = require("../vault-api");

// Parse the columns the migrations actually declare, rather than restating
// them here — a second hand-written list would be a second thing to keep in
// sync, and this repo already carries one such pair with a ⚠ on it. Shared
// with broker-vault.test.js's write-payload contract check, which needs the
// identical real-schema read for the same reason.
const { migrationColumns } = require("./helpers/migration-columns");

// ---------------------------------------------------------------------------
// The contract vs the schema
// ---------------------------------------------------------------------------

test("the contract covers every column broker_comps declares", () => {
  // If a migration adds a column and nobody decides whether the dashboard may
  // see it, that is a decision made by accident. This makes it a build break.
  const missing = migrationColumns().filter((c) => !API_COMP_FIELDS.includes(c));
  assert.deepEqual(missing, [],
    `broker_comps has column(s) the API contract does not mention: ${missing.join(", ")}. ` +
    `Add them to API_COMP_FIELDS, or teach toApiComp to omit them deliberately.`);
});

test("the contract claims no field the schema does not have", () => {
  // The direction that catches the RESTRUCTURE: rename or drop a column and
  // this fails until toApiComp supplies the field from wherever it now lives.
  const cols = migrationColumns();
  const phantom = API_COMP_FIELDS.filter((f) => !cols.includes(f));
  assert.deepEqual(phantom, [],
    `The API promises field(s) broker_comps no longer has: ${phantom.join(", ")}. ` +
    `toApiComp must map them from the new storage shape before this can pass.`);
});

// The same guarantee, pointed at the other table.
//
// PROPERTY_FIELDS carries what a comp inherits from its building (migration
// 017): the coordinates that let a private comp be mapped without its address
// being sent anywhere. Those are NOT broker_comps columns, so they cannot live
// in API_COMP_FIELDS without breaking the two tests above — correctly, since
// broker_comps really does not have a `lat`.
//
// The wrong fix would have been to loosen those tests until the new fields
// slipped through, which would have retired the tripwire for every future
// column. This is the right one: a second checked list, so BOTH tables stay
// honest and neither can drift silently.
test("every property-derived field is a real broker_properties column", () => {
  const cols = migrationColumns("broker_properties");
  const phantom = PROPERTY_FIELDS.filter((f) => !cols.includes(f));
  assert.deepEqual(phantom, [],
    `The API promises property field(s) broker_properties does not have: ${phantom.join(", ")}. ` +
    `Add them in a migration, or stop claiming them.`);
});

test("property fields and comp fields do not collide", () => {
  // If broker_comps ever gained its own `lat`, two different values would be
  // claiming one key on the comp shape and whichever list ran last would win
  // silently. That is precisely the per-deal duplication migration 017 exists
  // to avoid, so it should fail the build rather than pick a winner.
  const overlap = PROPERTY_FIELDS.filter((f) => API_COMP_FIELDS.includes(f));
  assert.deepEqual(overlap, [],
    `field(s) claimed by both broker_comps and broker_properties: ${overlap.join(", ")}`);
});

// The same guarantee again, pointed at a third table.
//
// SUBMISSION_FIELDS carries what a comp inherits from the submission it was
// published as: cited_count, which comp_submissions has kept since migration
// 003. Same reasoning as PROPERTY_FIELDS above — it is not a broker_comps
// column, so it cannot go in API_COMP_FIELDS, and the answer is another
// checked list rather than a looser test.
test("every submission-derived field is a real comp_submissions column", () => {
  const cols = migrationColumns("comp_submissions");
  const phantom = SUBMISSION_FIELDS.filter((f) => !cols.includes(f));
  assert.deepEqual(phantom, [],
    `The API promises submission field(s) comp_submissions does not have: ${phantom.join(", ")}. ` +
    `Add them in a migration, or stop claiming them.`);
});

test("submission fields collide with neither of the other two lists", () => {
  // Two sources claiming one key on the comp shape means whichever list ran
  // last wins, silently. Fail the build rather than pick a winner.
  const overComp = SUBMISSION_FIELDS.filter((f) => API_COMP_FIELDS.includes(f));
  assert.deepEqual(overComp, [],
    `field(s) claimed by both broker_comps and comp_submissions: ${overComp.join(", ")}`);
  const overProp = SUBMISSION_FIELDS.filter((f) => PROPERTY_FIELDS.includes(f));
  assert.deepEqual(overProp, [],
    `field(s) claimed by both broker_properties and comp_submissions: ${overProp.join(", ")}`);
});

test("the internal fields are part of the contract, not stray strings", () => {
  for (const f of INTERNAL_FIELDS) {
    assert.ok(API_COMP_FIELDS.includes(f), `${f} is marked internal but is not in the contract`);
  }
});

// ---------------------------------------------------------------------------
// Today's behaviour: nothing changes
// ---------------------------------------------------------------------------

function storedRow() {
  return {
    id: "c-1", user_id: "u-1", upload_id: "up-1",
    market: "Boise, ID", property_type: "Industrial",
    address: "1450 Mission Ave", address_key: "1450 mission ave",
    deal_date: "2026-03-14", transaction: "sale",
    price: 4250000, size_sqft: 31000, price_per_sqft: 137, cap_rate: 6.25,
    clear_height: "28'", dock_doors: "6", notes: "Off-market.",
    published: false, published_at: null, created_at: "2026-03-14T00:00:00Z",
    dedupe_key: "1450missionave|2026-03-14|4250000", published_submission_id: null,
  };
}

// The ten fields the dashboard actually reads, taken from vault-page.js — the
// page the broker dashboard is being built on top of. These are the contract
// that matters: everything else in the response is currently decoration, and
// breaking one of these breaks a screen a broker is looking at.
const DASHBOARD_FIELDS = [
  "address", "deal_date", "id", "market", "price",
  "price_per_sqft", "property_type", "published", "size_sqft", "transaction",
];

test("EVERY FIELD THE DASHBOARD READS SURVIVES THE RESTRUCTURE", () => {
  // The load-bearing one now. Migration 016 may move storage however it likes;
  // these ten must come out of the API unchanged, or a screen breaks.
  const out = toApiComp(storedRow());
  for (const f of DASHBOARD_FIELDS) {
    assert.ok(f in out, `${f} vanished from the vault API response`);
  }
  assert.equal(out.address, "1450 Mission Ave");
  assert.equal(out.price, 4250000);
  assert.equal(out.published, false);
});

test("the plumbing fields are omitted", () => {
  // Deliberately NOT byte-identical any more. Jacob confirmed nothing reads
  // these; 016 added property_id to them. This is the shape change that
  // belongs to the restructure rather than to introducing the seam.
  const out = toApiComp({ ...storedRow(), property_id: "p-1" });
  for (const f of INTERNAL_FIELDS) {
    assert.equal(f in out, false, `${f} is internal plumbing and must not reach the browser`);
  }
});

test("A NEW STORAGE COLUMN CANNOT REACH THE BROWSER BY DEFAULT", () => {
  // The allowlist's whole purpose. On a table holding brokers' private books
  // the safe failure is a missing field somebody notices, not a leaked one
  // nobody does.
  const out = toApiComp({ ...storedRow(), some_future_private_column: "SECRET" });
  assert.equal("some_future_private_column" in out, false);
  assert.equal(JSON.stringify(out).includes("SECRET"), false);
});

test("a sparse row does not gain null keys it never had", () => {
  const out = toApiComp({ id: "c-1", address: "1 Main St", market: "Boise, ID" });
  assert.deepEqual(Object.keys(out).sort(), ["address", "id", "market"]);
});

test("the mapper copies rather than handing back the stored object", () => {
  const row = storedRow();
  const out = toApiComp(row);
  assert.notEqual(out, row, "a caller mutating the response would mutate the DB row");
  out.price = 1;
  assert.equal(row.price, 4250000);
});

test("junk in does not throw", () => {
  assert.equal(toApiComp(null), null);
  assert.equal(toApiComp("nonsense"), "nonsense");
  assert.deepEqual(toApiComps(null), []);
  assert.deepEqual(toApiComps("nonsense"), []);
});

test("an empty vault answers an empty list, not null", () => {
  assert.deepEqual(toApiComps([]), []);
});

// The vault API's comp shape — the contract between storage and the dashboard.
//
// The point of these tests is NOT that the mapper does something clever today.
// It does nothing today, deliberately. The point is that the contract is
// written down and checked against the migration, so that the coming
// restructure of broker_comps fails the build rather than silently breaking a
// dashboard that is being written in parallel right now.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { toApiComp, toApiComps, API_COMP_FIELDS, INTERNAL_FIELDS } = require("../vault-api");

// Parse the columns the migrations actually declare, rather than restating
// them here — a second hand-written list would be a second thing to keep in
// sync, and this repo already carries one such pair with a ⚠ on it.
function migrationColumns() {
  const root = path.join(__dirname, "..", "migrations");
  const create = fs.readFileSync(path.join(root, "013-broker-vault.sql"), "utf8");
  const body = /create table broker_comps\s*\(([\s\S]*?)\n\);/.exec(create)[1];
  const cols = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.split("--")[0].trim();
    if (!line) continue;
    if (/^(unique|primary key|constraint|foreign key|check)\b/i.test(line)) continue;
    for (const part of line.split(",")) {
      const m = /^([a-z_]+)\s+(uuid|text|numeric|date|boolean|timestamptz|bigint|int)\b/.exec(part.trim());
      if (m) cols.push(m[1]);
    }
  }
  const alter = fs.readFileSync(path.join(root, "014-vault-publish-link.sql"), "utf8");
  for (const m of alter.matchAll(/add column if not exists ([a-z_]+)/g)) cols.push(m[1]);
  return [...new Set(cols)];
}

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

test("THE RESPONSE IS BYTE-IDENTICAL TO BEFORE THIS FILE EXISTED", () => {
  // The load-bearing one. The dashboard is being written right now against the
  // current JSON by someone who has not pushed. Step one must be incapable of
  // breaking it, whatever they have already written.
  const row = storedRow();
  assert.equal(JSON.stringify(toApiComp(row)), JSON.stringify(row));
  const rows = [storedRow(), storedRow()];
  assert.equal(JSON.stringify(toApiComps(rows)), JSON.stringify(rows));
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

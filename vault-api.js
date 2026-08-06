// ---------------------------------------------------------------------------
// The vault API's COMP SHAPE — the contract between storage and the dashboard.
//
// Spec: docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md
// Storage: migrations/013-broker-vault.sql, 014-vault-publish-link.sql
//
// WHY THIS FILE EXISTS
//
// Until now `GET /api/vault` answered `comps: rows` — raw PostgREST rows,
// straight out to the browser with no translation. That made the DATABASE
// shape and the API shape accidentally the same object, which is fine right up
// until the table changes: the moment `broker_comps` is restructured into the
// star schema (Ecosystem Plan §6), every dashboard reading that JSON breaks.
//
// This is the seam that makes those two shapes independent. The dashboard
// reads the API's shape; storage is free to move underneath it, and this
// function absorbs the difference.
//
// ---------------------------------------------------------------------------
// IT WAS A PASS-THROUGH FOR EXACTLY ONE STEP, ON PURPOSE
// ---------------------------------------------------------------------------
// When the seam was introduced it was a shallow copy and nothing else, so the
// response stayed byte-identical. That mattered for one reason: the dashboard
// was being written at that moment, against the old response, by someone who
// had not pushed. A shape change then — even an obviously good one — could
// have broken code that already existed and that nobody could see.
//
// Migration 016 is the step where the shape may change, and it does: the
// plumbing fields below are now omitted, and toApiComp is a real allowlist.
//
// ---------------------------------------------------------------------------
// WHAT THE FIELD LIST IS FOR
// ---------------------------------------------------------------------------
// API_COMP_FIELDS is the contract: every column the vault may answer with.
// The tests check it BOTH WAYS against every migration in migrations/, so
//
//   * a column exists that the contract does not mention -> the build fails,
//     and "may the dashboard see this?" can never be answered by accident;
//   * the contract promises a field the schema no longer has -> the build
//     fails, and stays failing until toApiComp maps it from wherever it now
//     lives.
//
// The guarantee is not "the table will not change". It is "the table may
// change and the API will not".
// ---------------------------------------------------------------------------

// Internal plumbing — storage detail, not product surface. These are now
// OMITTED from the response.
//
// They went out until 2026-08-06 only because `comps: rows` handed back
// whatever the table happened to hold. Jacob confirmed on the day that nothing
// in the dashboard reads any of them: user_id is a query filter and is never
// rendered, dedupe_key is a write-path conflict target that nothing reads
// back, and address_key is read by nothing at all.
//
// property_id joined them with migration 016. It is a foreign key into
// broker_properties; a dashboard that wants the building has the address,
// market and type on the comp itself.
//
// Dropping them is the shape change that BELONGS to the restructure. It was
// deliberately not made when the seam was introduced, because at that moment
// the dashboard was being written against the old response by someone who had
// not pushed.
const INTERNAL_FIELDS = Object.freeze([
  "user_id", "address_key", "dedupe_key", "property_id",
]);

// Every field `GET /api/vault` currently answers with, and therefore every
// field a dashboard may already be reading. Kept in the same order the table
// declares them so the two are diffable by eye.
const API_COMP_FIELDS = Object.freeze([
  "id",
  "user_id",
  "upload_id",
  "market",
  "property_type",
  "address",
  "address_key",
  "deal_date",
  "transaction",
  "price",
  "size_sqft",
  "price_per_sqft",
  "cap_rate",
  "clear_height",
  "dock_doors",
  "building_class",
  "floor_plate",
  "center_type",
  "anchor_tenant",
  "units",
  "price_per_unit",
  "lot_acres",
  "price_per_acre",
  "zoning",
  "beds_baths",
  "tenancy",
  "year_built",
  "notes",
  "published",
  "published_at",
  "created_at",
  "dedupe_key",
  "published_submission_id",
  "property_id",
]);

// The fields a dashboard actually receives: the contract, minus the plumbing.
const PUBLIC_COMP_FIELDS = Object.freeze(
  API_COMP_FIELDS.filter((f) => !INTERNAL_FIELDS.includes(f))
);

// One stored row, as the API presents it.
//
// An ALLOWLIST, not a copy-and-delete. A new storage column therefore cannot
// reach the browser by default — it has to be added to the contract on
// purpose, and the tests fail until someone does. That is the direction of
// safety worth having on a table holding brokers' private books: the failure
// mode is a missing field somebody notices, not a leaked one nobody does.
//
// Undefined values are skipped rather than emitted as nulls, so a sparse row
// serializes the same way it always has.
function toApiComp(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out = {};
  for (const f of PUBLIC_COMP_FIELDS) {
    if (f in row) out[f] = row[f];
  }
  return out;
}

function toApiComps(rows) {
  return Array.isArray(rows) ? rows.map(toApiComp) : [];
}

module.exports = { toApiComp, toApiComps, API_COMP_FIELDS, INTERNAL_FIELDS, PUBLIC_COMP_FIELDS };

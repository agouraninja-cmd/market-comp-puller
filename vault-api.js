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
// TODAY IT IS A PASS-THROUGH, ON PURPOSE
// ---------------------------------------------------------------------------
// `toApiComp` is a shallow copy and nothing more, so the response is BYTE-
// IDENTICAL to what it was before this file existed. That is deliberate: the
// dashboard is being written right now, against the current JSON, by someone
// who has not pushed yet. A shape change today — even an obviously-good one
// like dropping the internal `dedupe_key` — could break code that is already
// written and that nobody can see yet.
//
// So step one introduces the seam and changes nothing. Step two restructures
// the table and teaches this function to translate. The dashboard never moves.
//
// ---------------------------------------------------------------------------
// WHAT THE FIELD LIST IS FOR
// ---------------------------------------------------------------------------
// API_COMP_FIELDS is the frozen contract: the fields a dashboard may rely on.
// It is not applied as a filter today (that would change the response); it is
// asserted by the tests against the migration, so that a restructure which
// drops or renames a column FAILS THE BUILD until this function supplies the
// field again. That is the whole protection — the guarantee is not "the table
// will not change", it is "the table may change and the API will not".
//
// Three fields are deliberately in the list but marked internal below. They go
// out today only because they always have; once the dashboard's author
// confirms nothing reads them, they can be dropped here in a single edit and
// no storage change is needed.
// ---------------------------------------------------------------------------

// Internal plumbing. Reaches the browser today only for backwards
// compatibility; safe to drop from the response once the dashboard confirms it
// does not read them. Not secrets — a broker's own user id and the dedupe keys
// of their own rows — but they are storage detail, not product surface.
const INTERNAL_FIELDS = Object.freeze(["user_id", "address_key", "dedupe_key"]);

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
]);

// One stored row, as the API presents it.
//
// A shallow copy rather than the row itself: identical to serialize, but it
// means a later caller cannot mutate what came out of the database, and it
// gives the restructure a place to land that is already threaded through the
// route.
function toApiComp(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  return { ...row };
}

function toApiComps(rows) {
  return Array.isArray(rows) ? rows.map(toApiComp) : [];
}

module.exports = { toApiComp, toApiComps, API_COMP_FIELDS, INTERNAL_FIELDS };

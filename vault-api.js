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
  // 038's high-water mark. Written only by the digest run, read by nothing a
  // browser renders — see API_COMP_FIELDS.
  "renewal_notified_at",
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
  // The lease side (migration 028). rent_psf/rent_basis are what the broker
  // typed and rent_psf_yr is the canonical annual figure derived from the two,
  // carried so the page never has to redo that multiplication and disagree
  // with the stored median.
  "rent_psf",
  "rent_basis",
  "lease_type",
  "rent_psf_yr",
  // The renewal watch's two dates (038), plus its high-water mark. The dates
  // are the broker's own input and the page shows them; the mark is plumbing
  // and is stripped by INTERNAL_FIELDS below, the same way property_id is —
  // it says only that we have already mailed about this lease, which is an
  // answer to a question no dashboard asks.
  "lease_expiry",
  "option_notice_date",
  "renewal_notified_at",
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

// Fields that reach a comp from the PROPERTY DIMENSION rather than from
// broker_comps. Migration 017; spec
// docs/superpowers/specs/2026-08-06-private-comp-geocoding.md §3.
//
// These are the first fields the contract carries that are not broker_comps
// columns, and they are declared separately rather than dropped into
// API_COMP_FIELDS because the tests check that list against the broker_comps
// schema in BOTH directions. Adding them there would have made
// "the contract claims no field the schema does not have" fail — correctly,
// since broker_comps has no `lat`. Widening that test to shrug at unknown
// fields would have removed the tripwire for every future column.
//
// So the tripwire is kept and a SECOND one is added beside it: the tests check
// this list against broker_properties the same way. Both tables stay honest,
// and a coordinate column renamed in a later migration still breaks the build.
//
// This is the seam doing what its header promises — "the table may change and
// the API will not". A comp's location physically lives one join away, and
// nothing downstream needs to know that.
//
// `facts` joined them with migration 050: what the broker's own deals on this
// building AGREE on (building-facts.js), derived and stored on the dimension.
// It rides every comp on the building so the page can prefill a known
// building's empty cells without asking the server which building an address
// is — the lookup runs against rows it already holds.
const PROPERTY_FIELDS = Object.freeze(["lat", "lng", "geo_source", "facts"]);

// Fields computed at READ time and stored on NO table. `inherited` names the
// building-level cells building-facts.js's applyFacts filled on this comp
// from its building's facts, so a cell can say it is showing a value the
// broker stated on another deal. A fourth checked list rather than a loosened
// one, for the reason the other three exist: the tests hold each list to its
// own table, and this one's table is "none" — pinned in both directions.
const DERIVED_FIELDS = Object.freeze(["inherited"]);

// Fields a comp inherits from the SUBMISSION it was published as, rather than
// from broker_comps. A third list for the same reason PROPERTY_FIELDS is a
// second one: the contract tests check API_COMP_FIELDS against the
// broker_comps schema BOTH ways, so a cited_count in there would correctly
// fail as a column that table does not have. The fix is another checked list
// against its own table, never loosening the first.
//
// cited_count is the count already kept on comp_submissions and already shown
// publicly on /broker/<slug>. It rides here so the broker who EARNED it can
// see it in their own vault, which until now they could not do at all without
// first opting their profile into being public.
const SUBMISSION_FIELDS = Object.freeze(["cited_count"]);

// The fields a dashboard actually receives: the contract, minus the plumbing,
// plus what the property dimension contributes.
const PUBLIC_COMP_FIELDS = Object.freeze(
  API_COMP_FIELDS.filter((f) => !INTERNAL_FIELDS.includes(f))
    .concat(PROPERTY_FIELDS).concat(SUBMISSION_FIELDS).concat(DERIVED_FIELDS)
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

module.exports = {
  toApiComp, toApiComps,
  API_COMP_FIELDS, INTERNAL_FIELDS, PUBLIC_COMP_FIELDS, PROPERTY_FIELDS,
  SUBMISSION_FIELDS, DERIVED_FIELDS,
};

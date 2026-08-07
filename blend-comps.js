// ---------------------------------------------------------------------------
// Blended comps — a broker's own private comps, inside their own report.
//
// Spec: docs/superpowers/specs/2026-08-06-blended-comps-data-contract.md
//
// PURE, like entitlements.js, comp-gate.js and broker-vault.js: no I/O, no
// requires, no clock reads. server.js owns the read (scoped by user_id) and
// hands the rows in. That is what lets `npm test` prove the privacy wall holds
// with no database — and the wall is the entire broker product, so it is the
// one thing that must be provable rather than reviewed.
//
// ---------------------------------------------------------------------------
// THE RULE: BLEND AT SERIALIZATION, NEVER AT GENERATION
// ---------------------------------------------------------------------------
// This is the mirror image of the rule comp-gate.js already follows. There,
// gateReport() runs at serialization so the cache, harvestComps() and
// maybePublishMarketSnapshot() keep seeing WHOLE reports. Here they must keep
// seeing PUBLIC ones: private comps are added on the way out and nowhere
// upstream of it.
//
//   search -> parse -> harvestComps()             <- public report only
//                   -> cache write                <- public report only
//                   -> maybePublishMarketSnapshot() <- public report only
//                   -> gateReport()
//                   -> blendPrivateComps()        <- private comps enter HERE
//                   -> response
//
// Getting the order wrong fails silently in both directions:
//
//   * Blend BEFORE the cache write and one broker's private comps are served
//     to the next visitor who searches that address — search_cache is keyed by
//     property, not by user. Nothing would look wrong to either of them.
//   * Blend BEFORE harvestComps() and they enter the public corpus
//     permanently. That write path swallows its own errors by design, so
//     nothing alerts anyone; the same blindness already hid a total corpus
//     outage for weeks.
//
// ---------------------------------------------------------------------------
// SOURCE TYPE
// ---------------------------------------------------------------------------
// A vault comp does NOT get `verified: true` or `source_type: "verified"`.
// That badge is a PUBLIC claim — a broker vouched for a comp in the public
// records and earned visible credit for it — and a private row has earned no
// such thing. Nor may it fall through to the enum's default, because unknown
// source types normalize to "estimate", which would stamp a broker's own real,
// closed transaction as guesswork.
//
// So it carries its own value, outside the public enum. The front end renders
// it as "From your vault", an ownership statement rather than a provenance
// claim. Normalization runs at PARSE time and blending runs at serialization,
// so this value is never rewritten on the way out.
// ---------------------------------------------------------------------------

const PRIVATE_SOURCE_TYPE = "broker_vault";

// broker_comps column -> report comp key. Deliberately explicit rather than a
// spread: the vault row carries columns a report has no business seeing
// (user_id, upload_id, dedupe_key, address_key, published), and an allowlist
// cannot leak one by forgetting to delete it. Note `price` becomes
// `price_or_rate` — the report's key, and the single easiest thing to get
// wrong here, since a mismatched name renders as a blank price rather than
// as an error.
const FIELD_MAP = {
  address: "address",
  deal_date: "date",
  transaction: "transaction",
  price: "price_or_rate",
  size_sqft: "size_sqft",
  price_per_sqft: "price_per_sqft",
  cap_rate: "cap_rate",
  tenancy: "tenancy",
  year_built: "year_built",
  notes: "notes",
  clear_height: "clear_height",
  dock_doors: "dock_doors",
  building_class: "building_class",
  floor_plate: "floor_plate",
  center_type: "center_type",
  anchor_tenant: "anchor_tenant",
  units: "units",
  price_per_unit: "price_per_unit",
  lot_acres: "lot_acres",
  price_per_acre: "price_per_acre",
  zoning: "zoning",
  beds_baths: "beds_baths",

  // From the PROPERTY, not the comp — stitched on by vaultCompsForReport
  // before this runs (migration 017; spec
  // docs/superpowers/specs/2026-08-06-private-comp-geocoding.md).
  //
  // `lat`/`lng` are names index.html already understands, so a private comp
  // carrying them needs no new rendering path — only the guard that stops
  // renderMap() geocoding it anyway, which is the display half.
  //
  // These are the fields that keep an off-market address from leaving the
  // browser to place a pin, so they are the point of the whole change rather
  // than another column. Absent values are dropped by toReportComp below, so a
  // building with no coordinates produces exactly the comp shape it does today.
  lat: "lat",
  lng: "lng",
  geo_source: "geo_source",
};

// A vault row, shaped as a report comp. Empty values are dropped rather than
// carried as "" so the comp matches what the model produces for a sparse comp.
function toReportComp(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const out = {};
  for (const [col, key] of Object.entries(FIELD_MAP)) {
    const v = row[col];
    if (v === null || v === undefined || v === "") continue;
    out[key] = v;
  }
  if (!out.address) return null;      // a comp with no address cannot render
  out.source_type = PRIVATE_SOURCE_TYPE;
  out.private = true;
  return out;
}

function isPrivateComp(c) {
  return Boolean(c && typeof c === "object" && c.private === true);
}

// Add a broker's own comps to their own report.
//
// Deliberately NOT deduplicated against the public comps. A broker watching
// their own uploaded deal vanish from their report reads as data loss and they
// will notice; dropping the public row instead would move the valuation with
// no explanation. Both are shown, and only the private one is flagged.
//
// Appended rather than prepended: a private comp does not outrank a public one.
// The flag is styling, not ranking — pinning them to the top would imply a
// broker's own deals are better evidence than the public record, which is not
// a claim this product can make. The table's own sort orders them afterwards.
function blendPrivateComps(report, rows) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const list = Array.isArray(rows) ? rows : [];
  const priv = list.map(toReportComp).filter(Boolean);

  // An empty vault must leave the report BYTE-IDENTICAL to what a non-broker
  // gets. Not merely equivalent: identical, so "no non-broker sees any change"
  // is a testable claim rather than a reviewed one. That means returning the
  // very same object, adding no private_count key at all.
  if (!priv.length) return report;

  const comps = Array.isArray(report.comps) ? report.comps : [];
  return { ...report, comps: [...comps, ...priv], private_count: priv.length };
}

// Remove every private comp from a report.
//
// This exists for POST /api/share, which accepts { data, meta } FROM THE
// BROWSER — and the browser is holding a blended report. A shared report is
// public by design and has no viewer check to fall back on, so the server
// strips rather than trusting the client to have sent a clean one. Same stance
// the share route already takes on NOI, debt terms and the rent roll.
//
// Filters on the flag, not on source_type, because the flag is what the wall
// is defined in terms of; a row that somehow carried one without the other
// must still be dropped.
function stripPrivateComps(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  if (!Array.isArray(report.comps)) {
    if ("private_count" in report) {
      const { private_count, ...rest } = report;
      return rest;
    }
    return report;
  }
  const clean = report.comps.filter((c) => !isPrivateComp(c));
  if (clean.length === report.comps.length && !("private_count" in report)) return report;
  const { private_count, ...rest } = report;
  return { ...rest, comps: clean };
}

module.exports = {
  blendPrivateComps,
  stripPrivateComps,
  toReportComp,
  isPrivateComp,
  PRIVATE_SOURCE_TYPE,
  FIELD_MAP,
};

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
//                   -> blendNearbyComps()         <- saved public deals, before the paywall
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

// The ONE exception to this file's no-requires rule, and it is a pure module
// requiring a pure module (backtest.js already does the same with
// valuation.js). Taking basisRow from comp-gate rather than copying it means
// the anonymized shape a client sees is the same one a free visitor's locked
// comps use, provably, instead of by review.
const { basisRow } = require("./comp-gate.js");

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

// ---------------------------------------------------------------------------
// The SHARED vault (migration 030) — a colleague's comp, in your report.
//
// Spec §7. Everything about a firm comp is a broker_vault comp except WHOSE it
// is, and that difference is deliberately carried as ATTRIBUTION rather than
// as a new source type. Two reasons, and the second is the load-bearing one:
//
//   1. A colleague's closed deal is the same provenance class as your own.
//      The tier answers "how good is this evidence", and the answer does not
//      change with the desk it came from.
//   2. TIER_WEIGHT exists TWICE — valuation.js and comp-gate.js, a pair that
//      already carries a keep-in-step warning — plus SOURCE_TIERS in
//      index.html and eval-score.js's own read. A new tier would be four
//      places that must agree about a weight that is 1 in every one of them.
//
// So a firm comp keeps `source_type: "broker_vault"` and `private: true`, and
// EVERY downstream rule keeps working by construction rather than by review:
// POST /api/share strips or anonymizes it, exports drop it, the print and the
// PNG drop it, and the valuation still counts it at full weight. What changes
// is the badge, which reads the `firm` field below.
// ---------------------------------------------------------------------------

// The stored payload for one shared comp: exactly the keys a report can
// render, taken from FIELD_MAP itself so the two cannot drift.
//
// This is the privacy wall in one function. `user_id`, `dedupe_key`,
// `address_key`, `upload_id`, `property_id` and the `published` flags are the
// vault's own plumbing; none of them is in FIELD_MAP, so none of them can
// reach another account's database row by being forgotten here.
function firmCompPayload(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const out = {};
  for (const col of Object.keys(FIELD_MAP)) {
    const v = row[col];
    if (v === null || v === undefined || v === "") continue;
    out[col] = v;
  }
  return out.address && row.deal_date ? out : null;
}

// A stored firm comp, shaped as a report comp and attributed.
//
// `firm` is what the badge renders and is the ONLY thing distinguishing this
// from the broker's own vault comp on screen. `shared_by` names the colleague
// so a reader knows who to ask — the same reason the shelf attributes rows.
function toFirmReportComp(stored) {
  const comp = toReportComp(stored && stored.comp);
  if (!comp) return null;
  return {
    ...comp,
    firm: String((stored && stored.firm) || "") || undefined,
    shared_by: String((stored && stored.shared_by_name) || "") || undefined,
  };
}

// One deal, one row in the valuation.
//
// Two colleagues at the same firm routinely hold the SAME transaction in their
// own books — they were on opposite sides of it — so a naive blend counts it
// twice, and the second copy moves the median with nothing on screen
// explaining why. This is the one place a private comp IS deduplicated, and it
// is deliberately not the rule blendPrivateComps follows about public comps:
// there, two rows are two pieces of evidence from different sources; here they
// are one deal entered twice.
//
// The caller's OWN comp wins, so a broker's own deal keeps saying "From your
// vault" rather than being attributed to whoever else uploaded it.
function dedupeKeyOf(c) {
  const addr = String((c && c.address) || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const date = String((c && c.date) || "").slice(0, 10);
  const price = c && c.price_or_rate != null ? String(c.price_or_rate) : "";
  return `${addr}|${date}|${price}`;
}

function dedupeFirmComps(mine, firm) {
  const own = Array.isArray(mine) ? mine : [];
  const seen = new Set(own.map(dedupeKeyOf));
  const out = [];
  for (const c of Array.isArray(firm) ? firm : []) {
    const key = dedupeKeyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Coordinates a building may lend its comps (migration 017), keyed by
// property id. One rule: BOTH OR NEITHER, and null is not a coordinate.
//
// This is a function for the same reason broker-vault.js grew
// exportRowsWithCoords: `Number(null) === 0` and `Number.isFinite(0) ===
// true`, so a property row with no location on file — today, essentially
// every one, since import-time geocoding is deferred — slipped a bare
// Number() guard and stitched its comps to lat 0 / lng 0. Null Island is
// ~7,500 mi from any US subject, and the report's Distance column printed
// exactly that; the fake-but-finite coordinates also satisfied renderMap()'s
// "already located, don't geocode" privacy guard, so the pin logic worked
// from the Gulf of Guinea instead of skipping. An unlocated building must
// contribute NO coordinate keys at all — toReportComp then drops them and
// the comp renders exactly as it did before migration 017.
function propertyCoordsById(props) {
  const byId = new Map();
  for (const p of Array.isArray(props) ? props : []) {
    if (!p || p.id == null) continue;
    const located = p.lat != null && p.lng != null &&
      Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
    if (!located) continue;
    byId.set(p.id, { lat: Number(p.lat), lng: Number(p.lng), geo_source: p.geo_source || null });
  }
  return byId;
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

// Replace every private comp with its anonymized basis row.
//
// This is what an INVITED share does by default, where stripPrivateComps is
// what a PUBLIC share does. The difference matters to the number on the page:
// the browser computes the valuation from includedComps() plus lockedBasis(),
// so a stripped report shows the client a DIFFERENT range than the broker saw,
// while an anonymized one matches to the dollar.
//
// What travels: date, transaction, size, $/SF, provenance. What does not:
// address, total price, notes, source url, coordinates. A basis row is a bar
// on a histogram — it cannot be resold, cited, or tied to a property.
//
// private_count is deliberately KEPT. The client is told how many of their
// broker's own deals are inside the number; hiding that would make the range
// unexplainable.
function anonymizePrivateComps(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  if (!Array.isArray(report.comps)) return report;
  const priv = report.comps.filter(isPrivateComp);
  if (!priv.length) return report;      // untouched, same object — see blendPrivateComps
  const basis = Array.isArray(report.locked_basis) ? report.locked_basis : [];
  return {
    ...report,
    comps: report.comps.filter((c) => !isPrivateComp(c)),
    locked_basis: [...basis, ...priv.map(basisRow)],
  };
}

module.exports = {
  firmCompPayload,
  toFirmReportComp,
  dedupeFirmComps,
  dedupeKeyOf,
  blendPrivateComps,
  stripPrivateComps,
  anonymizePrivateComps,
  toReportComp,
  isPrivateComp,
  propertyCoordsById,
  PRIVATE_SOURCE_TYPE,
  FIELD_MAP,
};

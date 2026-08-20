// ---------------------------------------------------------------------------
// Radius corpus blend — saved public deals, inside the report that is
// searching near them.
//
// Spec: docs/superpowers/specs/2026-08-14-radius-corpus-blend-design.md
//
// PURE, like blend-comps.js: no I/O, no clock reads (the caller passes `now`),
// no Census. server.js owns the corpus read and the geocode. That is what lets
// `npm test` prove "in range" without a network, and what keeps a mile rule
// from silently becoming "same city" because the module got tired of missing
// coordinates. Residential is 1 mile unless the market note names a radius
// (a "2.5 miles" note is the neighborhood for that search); CRE is 10.
//
// ---------------------------------------------------------------------------
// THE RULE: BLEND AT SERIALIZATION, BEFORE THE PAYWALL, NEVER AT GENERATION
// ---------------------------------------------------------------------------
// Mirror of blend-comps.js, with one extra constraint: these rows are PUBLIC,
// so they must run through gateReport() the way search comps do. A free
// visitor's extra saved deals become locked_basis. Blending them after the
// gate would print their addresses on a 4-comp report.
//
//   search -> parse -> harvestComps()              <- public report only
//                   -> cache write                 <- public report only
//                   -> maybePublishMarketSnapshot() <- public report only
//                   -> blendNearbyComps()          <- saved public deals HERE
//                   -> gateReport()
//                   -> blendPrivateComps()         <- vault, after the paywall
//                   -> response
//
// Blend before the cache write and every later visitor of that address gets a
// frozen extra set that never picks up deals harvested after the cache write,
// which is the opposite of "every transaction in the area joins the math."
// Blend before harvestComps() and the extras are already in the corpus, so the
// write is a no-op — but the cache would then store them, and a CORPUS_RADIUS=off
// rollback would not actually roll back cached reports.
// ---------------------------------------------------------------------------

const { isAggregateAddress } = require("./corpus-audit.js");

const RADIUS_MILES = 10;
// Houses trade by neighborhood, not metro. The search prompt already asks
// for comps within about a mile; auto-including every saved deal inside the
// CRE 10-mile circle undoes that and prices a $2M home off $800k sales from
// the next pocket over. Industrial / office / retail stay at 10.
const RESIDENTIAL_RADIUS_MILES = 1;
// A house more than 1.5× the subject's implied $/SF (from the ask ÷ size)
// is a different product even when it sits inside that mile — the other
// side of a highway, a cheaper subdivision. Missing ask or size is
// neutral: the 1-mile radius still holds. CRE is not filtered this way;
// warehouse $/SF routinely spans more than 1.5× inside one submarket.
const RESIDENTIAL_PRICE_TIER_RATIO = 1.5;
const EARTH_MILES = 3959;

function radiusMilesFor(type, note) {
  const fromNote = parseRadiusMiles(note);
  if (fromNote != null) return fromNote;
  return type === "Residential" ? RESIDENTIAL_RADIUS_MILES : RADIUS_MILES;
}

// ⚠ MIRROR valuation.js parseRadiusMiles. The blend radius and the
// distance free-pass must read the same market note the same way, or a
// "2.5 miles" search would auto-include a different circle than the one
// the hero treats as in-market.
function parseRadiusMiles(note) {
  if (note == null || note === "") return null;
  const m = String(note).match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 50 ? n : null;
}

const FIELD_MAP = {
  address: "address",
  deal_date: "date",
  date: "date",
  transaction: "transaction",
  price_or_rate: "price_or_rate",
  size_sqft: "size_sqft",
  price_per_sqft: "price_per_sqft",
  cap_rate: "cap_rate",
  tenancy: "tenancy",
  year_built: "year_built",
  notes: "notes",
  source_url: "source_url",
  source_type: "source_type",
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
  lat: "lat",
  lng: "lng",
};

function milesBetween(a, b) {
  if (!a || !b) return NaN;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.asin(Math.sqrt(h));
}

// BOTH OR NEITHER, and null is not a coordinate. Number(null) === 0 and
// Number("") === 0, so a missing pair would otherwise sit on Null Island and
// count as "within 10 miles" of nothing on this continent.
function parseCoords(row) {
  if (!row || typeof row !== "object") return null;
  const latRaw = row.lat;
  const lngRaw = row.lng;
  if (latRaw == null || lngRaw == null || latRaw === "" || lngRaw === "") return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function coordsFromReport(report) {
  if (!report || typeof report !== "object") return null;
  return parseCoords({ lat: report.subject_lat, lng: report.subject_lng });
}

function moneyNumber(v) {
  const x = Number(String(v == null ? "" : v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function priced(row) {
  return moneyNumber(row && row.price_or_rate) > 0 || moneyNumber(row && row.price_per_sqft) > 0;
}

function salePsfOf(row) {
  const psf = moneyNumber(row && row.price_per_sqft);
  if (psf > 0) return psf;
  const p = moneyNumber(row && row.price_or_rate);
  const s = moneyNumber(row && row.size_sqft);
  if (p > 0 && s > 0) {
    const d = p / s;
    if (d >= 1 && d <= 100000) return d;
  }
  return 0;
}

// Ask ÷ living area, when both exist. `opts.subjectPsf` wins so a caller
// that already did the division (server.js has the typed size) does not
// re-parse. Missing data returns 0, never a guess.
function impliedSubjectPsf(report, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (Number(o.subjectPsf) > 0) return Number(o.subjectPsf);
  const ask = moneyNumber(report && report.subject_asking && report.subject_asking.price);
  const sf = moneyNumber(o.subjectSize) || moneyNumber(report && report.subject_size_sqft);
  if (ask > 0 && sf > 0) {
    const d = ask / sf;
    if (d >= 1 && d <= 100000) return d;
  }
  return 0;
}

function samePriceTier(extraPsf, subjectPsf) {
  if (!(extraPsf > 0) || !(subjectPsf > 0)) return true;
  return Math.abs(Math.log2(extraPsf / subjectPsf)) <= Math.log2(RESIDENTIAL_PRICE_TIER_RATIO);
}

function lookbackCutoffFrac(months, now) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) return null;
  const cutoff = new Date(d.getFullYear(), d.getMonth() - Number(months), 1);
  return cutoff.getFullYear() + (cutoff.getMonth() + 0.5) / 12;
}

function normAddr(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toReportComp(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const out = {};
  for (const [col, key] of Object.entries(FIELD_MAP)) {
    const v = row[col];
    if (v === null || v === undefined || v === "") continue;
    // deal_date is mapped first; a row that also carries `date` may overwrite.
    out[key] = v;
  }
  if (!out.address) return null;
  if (row.verified === true || row.verified === "true") out.verified = true;
  out.from_corpus = true;
  return out;
}

function defaultKeyOf(c) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return [norm(c && c.address), norm(c && (c.date || c.deal_date)), norm(c && c.price_or_rate)].join("|");
}

function blendNearbyComps(report, rows, opts) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const o = opts && typeof opts === "object" ? opts : {};
  const subject = coordsFromReport(report) || parseCoords(o.subject) || null;
  if (!subject) return report;

  const parseDealDate = typeof o.parseDealDate === "function" ? o.parseDealDate : () => null;
  const keyOf = typeof o.keyOf === "function" ? o.keyOf : defaultKeyOf;
  const aggregateOf = typeof o.isAggregateAddress === "function" ? o.isAggregateAddress : isAggregateAddress;
  const cutoff = lookbackCutoffFrac(o.months, o.now);
  const subjectKey = normAddr(o.subjectAddress);
  const radius = Number.isFinite(Number(o.radiusMiles))
    ? Number(o.radiusMiles)
    : radiusMilesFor(o.propertyType, o.marketNote);
  const subjectPsf = o.propertyType === "Residential" ? impliedSubjectPsf(report, o) : 0;

  const comps = Array.isArray(report.comps) ? report.comps : [];
  const seen = new Set(comps.map((c) => keyOf(c)));
  const extras = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    if (!priced(row)) continue;
    if (aggregateOf(row.address)) continue;
    const d = parseDealDate(row.deal_date || row.date);
    if (d == null || cutoff == null || d < cutoff) continue;
    const ll = parseCoords(row);
    if (!ll) continue;
    const mi = milesBetween(subject, ll);
    if (!(mi <= radius)) continue;
    if (subjectKey && normAddr(row.address) === subjectKey) continue;
    if (subjectPsf > 0 && !samePriceTier(salePsfOf(row), subjectPsf)) continue;
    const shaped = toReportComp(row);
    if (!shaped) continue;
    const key = keyOf(shaped);
    if (seen.has(key)) continue;
    seen.add(key);
    shaped.distance_mi = Math.round(mi * 10) / 10;
    extras.push(shaped);
  }

  if (!extras.length) return report;
  return { ...report, comps: [...comps, ...extras], corpus_count: extras.length };
}

// Write `distance_mi` onto comps that already have coordinates, without
// mutating the caller's array (the cache object must stay clean). Comps that
// already carry a distance, or that have no point, are left alone. Missing
// data stays missing: that is what keeps an unplaced search comp's weight
// identical to yesterday's until the map locates it.
function attachCompDistances(report, subject) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  const subj = coordsFromReport(report) || parseCoords(subject) || null;
  if (!subj) return report;
  const comps = Array.isArray(report.comps) ? report.comps : [];
  let changed = false;
  const next = comps.map((c) => {
    if (!c || typeof c !== "object") return c;
    if (c.distance_mi != null && c.distance_mi !== "") return c;
    const ll = parseCoords(c);
    if (!ll) return c;
    const mi = milesBetween(subj, ll);
    if (!(mi >= 0) || !Number.isFinite(mi)) return c;
    changed = true;
    return { ...c, distance_mi: Math.round(mi * 10) / 10 };
  });
  return changed ? { ...report, comps: next } : report;
}

module.exports = {
  blendNearbyComps,
  toReportComp,
  parseCoords,
  coordsFromReport,
  milesBetween,
  priced,
  lookbackCutoffFrac,
  RADIUS_MILES,
  RESIDENTIAL_RADIUS_MILES,
  RESIDENTIAL_PRICE_TIER_RATIO,
  radiusMilesFor,
  parseRadiusMiles,
  impliedSubjectPsf,
  samePriceTier,
  salePsfOf,
  FIELD_MAP,
  attachCompDistances,
};

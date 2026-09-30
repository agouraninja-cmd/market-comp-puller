// permit-zoning.js — the land-use zoning of a permit's parcel, and whether
// that zoning is industrial.
//
// Ported 2026-09-16 from the permit tracker's zoning.js (spec:
// docs/superpowers/specs/2026-09-16-permit-signals-design.md, §3).
//
// Neither Accela nor EnerGov publishes a zoning district on a permit page
// (Boise's detail page has only "Airport Influence Zone" and "Flood Zone").
// The zoning comes from the county parcel layer instead: Ada County's public
// ArcGIS feature service carries ZONING keyed by PARCEL, so one GET per
// parcel number resolves it — no geocoding, no spatial query, and no
// address leaves the process. Covers Boise and Meridian (both Ada County).
// Nampa is Canyon County and has no equivalent wired up, so Nampa rows keep
// permit-portals.js's keyword-only industrial heuristic.
//
// Verified live 2026-08-10 on the tracker:
//   R2598270010 -> I-1 (4.68 ac)   S1607336220 -> I-1 (6.086 ac)
//   R8509140080 -> L-O (0.518 ac)
//
// Pure: the fetch is injected. The rule that matters is that this NEVER
// throws and never guesses — an unknown parcel, a GIS outage or a malformed
// answer all come back as {} and the caller keeps the keyword flag it had.

const ADA_PARCELS_URL =
  "https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Ada_County_Parcels/FeatureServer/142/query";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CompNinjaPermitSweep/1.0";

// Ada County zoning strings carry overlays and agreement suffixes on top of
// a base district: "I-2/AI-O", "I-1/DA", "M2-DA", "C-2-DA-P". Reduce to the
// base district before deciding whether it is industrial.
function baseZone(zoning) {
  let z = String(zoning || "").trim().toUpperCase();
  if (!z) return "";
  z = z.split("/")[0];                     // drop overlays: I-2/AI-O -> I-2
  z = z.replace(/[-/]?DA(-P)?$/, "");      // drop dev-agreement: I-1-DA -> I-1
  z = z.replace(/-P$/, "");                // drop planned-unit marker
  return z.trim();
}

// Industrial base districts across the Ada County code lists (Boise's own
// I-1/I-2/I-3 plus the M-series and light-industrial variants other Ada
// cities use). BP (Business Park) is included deliberately — it is where
// flex and light-industrial product gets built.
const INDUSTRIAL_ZONES = new Set([
  "I-1", "I-2", "I-3", "I-L", "IL", "I",
  "M-1", "M-2", "M-3", "M1", "M2", "M3", "M", "M-E",
  "LI", "BP",
]);

function isIndustrialZone(zoning) {
  const z = baseZone(zoning);
  return !!z && INDUSTRIAL_ZONES.has(z);
}

// Zoning beats the keyword flag when it is known; the keyword flag carries
// Nampa and any parcel the county layer does not know.
function industrialFor(keywordFlag, zoning) {
  return zoning ? isIndustrialZone(zoning) : !!keywordFlag;
}

// Parcel numbers are alphanumeric, 6-20 characters (R2598270010,
// S1607336220). Anything else is refused BEFORE it reaches a query string.
function cleanParcel(parcelNumber) {
  const p = String(parcelNumber || "").trim().toUpperCase();
  return /^[A-Z0-9]{6,20}$/.test(p) ? p : "";
}

// The GIS query for one parcel; exported so a test and a stub can agree on
// the exact request without either re-deriving it.
function parcelQueryUrl(parcel, url = ADA_PARCELS_URL) {
  const q = new URLSearchParams({
    where: `PARCEL='${parcel}'`,
    outFields: "PARCEL,ZONING,ACRES",
    returnGeometry: "false",
    f: "json",
  });
  return `${url}?${q}`;
}

// { zoning, zoning_acres } for a parcel number, or {} when unknown.
function parseParcelAnswer(data) {
  const a = data && Array.isArray(data.features) && data.features[0] && data.features[0].attributes;
  if (!a) return {};
  const zoning = String(a.ZONING || "").trim();
  if (!zoning) return {};
  return { zoning, zoning_acres: typeof a.ACRES === "number" ? a.ACRES : null };
}

async function fetchZoningByParcel(parcelNumber, deps) {
  try {
    const parcel = cleanParcel(parcelNumber);
    if (!parcel) return {};
    const url = (deps && deps.parcelsUrl) || ADA_PARCELS_URL;
    const res = await deps.fetch(parcelQueryUrl(parcel, url), {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return {};
    return parseParcelAnswer(await res.json());
  } catch (_) {
    return {};
  }
}

// The Permit tracker's property type (2026-09-29, the owner's pick of Draft A:
// a Property type menu in place of the "Industrial only" box). Nothing new is
// stored or read from a city: the type is worked out at READ time from what a
// filing already carries, so it moves the day this rule does.
//
// Four rules:
//  - INDUSTRIAL IS THE STORED FLAG, unchanged, so picking Industrial shows
//    exactly what the old box showed.
//  - Zoning cannot tell office from retail (a commercial parcel allows both),
//    so the permit's own words decide there; an office zone with words that
//    say nothing is Office.
//  - Shops below apartments is MIXED USE only (a mixed-use zone, the phrase,
//    or both kinds of words) — never also Multifamily, so the counts add up.
//  - MISS RATHER THAN GUESS: a permit whose words and zoning do not say is
//    Other, never a best guess.
const PROPERTY_TYPES = Object.freeze(["Industrial", "Office", "Retail", "Multifamily", "Mixed use", "Other"]);

const MULTIFAMILY_RE = /\b(apartments?|multi-?family|dwelling units|residential units|senior living)\b/;
const RETAIL_RE = /\b(retail|restaurant|coffee|drive[- ]?thru|store|salon|grocery|brewery|taproom|bakery|pharmacy|fitness|car wash|bank|credit union)\b/;
const OFFICE_RE = /\b(office|offices|dental|dentist|medical clinic|clinic|orthodont\w*|law firm|insurance agency|call center)\b/;
const OFFICE_ZONES = new Set(["L-O", "N-O", "R-O", "O", "H-E"]);

// `f` is a filing view (isIndustrial, zoning, description, projectName, type)
// or a stored row (is_industrial, permit_type, project_name) — both shapes.
function propertyTypeOf(f) {
  const o = f || {};
  if (o.isIndustrial === true || o.is_industrial === true) return "Industrial";
  const words = [o.description, o.projectName || o.project_name, o.type || o.permit_type]
    .filter(Boolean).join(" ").toLowerCase();
  const z = baseZone(o.zoning);
  const mf = MULTIFAMILY_RE.test(words);
  const rt = RETAIL_RE.test(words);
  const of = OFFICE_RE.test(words);
  if (/^MX/.test(z) || z === "TN-C" || /\bmixed[- ]use\b/.test(words) || (mf && rt)) return "Mixed use";
  if (mf) return "Multifamily";
  if (rt && !of) return "Retail";
  if (of && !rt) return "Office";
  if (!rt && !of && OFFICE_ZONES.has(z)) return "Office";
  return "Other";
}

module.exports = {
  PROPERTY_TYPES, propertyTypeOf,
  ADA_PARCELS_URL, INDUSTRIAL_ZONES,
  baseZone, isIndustrialZone, industrialFor, cleanParcel, parcelQueryUrl,
  parseParcelAnswer, fetchZoningByParcel,
};

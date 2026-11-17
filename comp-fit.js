// ---------------------------------------------------------------------------
// Comp fit — which comps a search found are good enough to value THIS
// property, and when the set left over is too thin to report without a
// second, wider look.
//
// Why this exists (2026-11-17, a 32,000 SF industrial building at 76
// Inverness Dr E, Englewood CO): the report valued it on four comps. Two were
// 7,200 and 7,260 SF buildings (less than a quarter of its size), one was a
// condo unit ("Unit C") whose only source was a parked, for-sale domain, and
// two sat ~9 miles away in another submarket while closer sales existed. The
// prompt already ASKED for half-to-twice the size and for real sources, and
// compWeight already down-weights an off-size comp, but on a four-comp set
// down-weighting changes nothing: the median of four is still set by the two
// that should never have been there. Prompt rules are requests; this module
// is the guarantee, the same split normalizeSourceTypes makes.
//
// Four rules, each a reason a comp is SET ASIDE (kept on the report's
// `set_aside` list for the audit trail and the corpus, never valued):
//   - "dead_source": its source link was dead or a parked domain at search
//     time (link-check.js decides that; this only reads the verdicts).
//   - "unit": a condo or unit SALE ("Unit C", "Suite 200", "#4") valued
//     against a whole building. Leases of a suite are normal and kept.
//   - "size": outside HARD_SIZE_MIN..HARD_SIZE_MAX of the subject's size.
//     Deliberately wider than the prompt's 0.5x-2x ask, so the model's
//     reasonable reach is kept and only a different size class is cut.
//   - "distance": farther than FAR_MILES (or the typed radius, if larger)
//     when at least NEAR_MIN comps already sit within NEAR_MILES. A far comp
//     is only cut when closer ones are there to replace it.
//
// The floor: size and distance never cut the set below MIN_PRICED_SALES
// priced sales. When they would, the best-fitting of those comps (closest in
// size, then nearest) come back, so a thin market still gets a number and the
// trust line's size-class warning still fires. Dead sources and unit sales
// never come back: they are not evidence about this building at all.
//
// needsWiderSearch() says when the kept set is too thin and the server should
// spend one more search on size-matched sales (server.js, getComps). It reads
// only the kept set, so the decision and the report always agree.
//
// Pure, no I/O, like comp-gate.js and link-check.js: the whole decision table
// runs under `npm test` (test/comp-fit.test.js).
// ---------------------------------------------------------------------------

"use strict";

// The types whose $/SF is set by building size. Residential has its own
// neighborhood/beds/vintage rules; Land is valued per acre of LOT; and
// Multifamily is valued per unit, so its building SF is not the yardstick.
const SIZE_TYPES = new Set(["Industrial", "Office", "Retail"]);
// Whole-building product types where a condo/unit sale is a different thing.
const UNIT_TYPES = new Set(["Industrial", "Office", "Retail", "Multifamily"]);
// Distance rule: every type but Residential (houses carry their own
// one-mile neighborhood rule in the prompt and a 1-mile free pass in
// compWeight).
const DISTANCE_EXEMPT = new Set(["Residential"]);

const HARD_SIZE_MIN = 0.4;   // 7,200 SF against 32,000 SF is 0.225
const HARD_SIZE_MAX = 2.5;
const BAND_MIN = 0.5;        // the prompt's SIZE FIT ask, and compWeight's free window
const BAND_MAX = 2;
const NEAR_MILES = 5;
const NEAR_MIN = 4;
const FAR_MILES = 8;
const MIN_PRICED_SALES = 3;
// A sale report with fewer than this many priced, in-band sales gets one
// wider search (needsWiderSearch).
const WIDER_SEARCH_BELOW = 4;

// Which set-aside comps are still real deals worth keeping in the corpus.
// A different size or a farther location is a perfectly good comp for some
// OTHER subject; a dead source or a condo unit is not one we want to store.
const HARVESTABLE_REASONS = new Set(["size", "distance"]);

function num(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function isSale(c) {
  return !String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

function isPricedSale(c) {
  if (!c || !isSale(c)) return false;
  return num(c.price_or_rate) > 0 || num(c.price_per_sqft) > 0;
}

// A unit inside a building, not the building. Narrower than
// building-photo.js's unitDesignatorOf on purpose: "Building C" in an
// industrial park is usually a whole building, which is exactly the product a
// whole-building subject should be valued against, so "bldg"/"building" do
// NOT count here. The ZIP tail is stripped first so "CO 80112" is not "#".
const UNIT_RE = /(?:^|[\s,])(?:#\s*[a-z0-9-]+|(?:unit|units|ste|suite|apt|apartment|condo|spc|space|fl|floor|rm|room)\.?\s*[a-z0-9-]*\d[a-z0-9-]*|(?:unit|ste|suite|apt|space)\.?\s+[a-z]{1,2})(?=$|[\s,])/i;
const ZIP_TAIL_RE = /,?\s*(?:[a-z]{2}\s+)?\d{5}(?:-\d{4})?\s*$/i;
const CONDO_NOTE_RE = /\b(condo(minium)?s?|unit sale|business condo|office condo|industrial condo|flex condo)\b/i;

function unitOf(address) {
  const cleaned = String(address || "").replace(ZIP_TAIL_RE, "");
  const m = UNIT_RE.exec(cleaned);
  return m ? m[0].trim() : null;
}

function isUnitSale(c) {
  if (!c || !isSale(c)) return false;
  if (unitOf(c.address)) return true;
  return CONDO_NOTE_RE.test(String(c.notes || ""));
}

function sizeRatio(c, subjectSqft) {
  const s = num(c && c.size_sqft);
  if (!(subjectSqft > 0) || !(s > 0)) return NaN;
  return s / subjectSqft;
}

function inBand(c, subjectSqft) {
  const r = sizeRatio(c, subjectSqft);
  return r >= BAND_MIN && r <= BAND_MAX;
}

function distanceOf(c) {
  const d = num(c && c.distance_mi);
  return Number.isFinite(d) && d >= 0 ? d : NaN;
}

// How badly a set-aside comp fits, for choosing which to bring back under the
// floor: octaves of size difference first, then miles.
function misfit(c, subjectSqft) {
  const r = sizeRatio(c, subjectSqft);
  const octaves = r > 0 ? Math.abs(Math.log2(r)) : 0;
  const d = distanceOf(c);
  return octaves * 100 + (Number.isFinite(d) ? d : 0);
}

/**
 * Decide which comps a report keeps. MUTATES the report, like the other
 * normalizers in the pipeline: `comps` becomes the kept set, and the cut ones
 * are appended to `set_aside`, each a copy of the comp carrying `set_aside`
 * (the reason). Returns { kept, setAside, counts }.
 *
 * opts: { subjectSqft, propertyType, subjectAddress, deadUrls (Set or array
 *         of source URLs link-check called dead), radiusMiles (typed) }
 */
function applyCompFit(report, opts = {}) {
  const out = { kept: 0, setAside: 0, counts: {} };
  if (!report || !Array.isArray(report.comps)) return out;
  const type = String(opts.propertyType || "");
  const subjectSqft = num(opts.subjectSqft) > 0 ? num(opts.subjectSqft) : 0;
  const dead = opts.deadUrls instanceof Set ? opts.deadUrls : new Set(opts.deadUrls || []);
  const subjectIsUnit = Boolean(unitOf(opts.subjectAddress));
  const radius = num(opts.radiusMiles) > 0 ? num(opts.radiusMiles) : 0;

  const keep = [];
  const cut = [];   // { c, reason, restorable }
  for (const c of report.comps) {
    if (!c || typeof c !== "object") continue;
    // A broker-verified comp is our own record, vouched for: never second-guessed.
    if (c.verified === true) { keep.push(c); continue; }
    const url = String(c.source_url || "").trim();
    if (url && dead.has(url)) { cut.push({ c, reason: "dead_source", restorable: false }); continue; }
    if (UNIT_TYPES.has(type) && !subjectIsUnit && isUnitSale(c)) {
      cut.push({ c, reason: "unit", restorable: false }); continue;
    }
    if (SIZE_TYPES.has(type) && subjectSqft > 0) {
      const r = sizeRatio(c, subjectSqft);
      if (r > 0 && (r < HARD_SIZE_MIN || r > HARD_SIZE_MAX)) {
        cut.push({ c, reason: "size", restorable: true }); continue;
      }
    }
    keep.push(c);
  }

  // Distance: only once enough near comps exist to stand in for the far ones.
  if (!DISTANCE_EXEMPT.has(type)) {
    const near = keep.filter((c) => distanceOf(c) <= NEAR_MILES).length;
    if (near >= NEAR_MIN) {
      const far = Math.max(FAR_MILES, radius);
      for (let i = keep.length - 1; i >= 0; i--) {
        const c = keep[i];
        if (c.verified === true) continue;
        if (distanceOf(c) > far) {
          cut.push({ c, reason: "distance", restorable: true });
          keep.splice(i, 1);
        }
      }
    }
  }

  // The floor: never let size/distance leave fewer than MIN_PRICED_SALES
  // priced sales. Bring back the best-fitting restorable ones.
  let priced = keep.filter(isPricedSale).length;
  if (priced < MIN_PRICED_SALES) {
    const back = cut
      .filter((x) => x.restorable && isPricedSale(x.c))
      .sort((a, b) => misfit(a.c, subjectSqft) - misfit(b.c, subjectSqft));
    for (const x of back) {
      if (priced >= MIN_PRICED_SALES) break;
      keep.push(x.c);
      x.restored = true;
      priced += 1;
    }
  }

  // Keep the report's own order for what stays (the table numbers comps).
  const keptSet = new Set(keep);
  report.comps = report.comps.filter((c) => keptSet.has(c));
  const aside = cut.filter((x) => !x.restored);
  if (aside.length) {
    report.set_aside = (Array.isArray(report.set_aside) ? report.set_aside : [])
      .concat(aside.map((x) => ({ ...x.c, set_aside: x.reason })));
  }
  const counts = {};
  for (const x of report.set_aside || []) counts[x.set_aside] = (counts[x.set_aside] || 0) + 1;
  if (Object.keys(counts).length) report.set_aside_counts = counts;
  else delete report.set_aside_counts;
  out.kept = report.comps.length;
  out.setAside = aside.length;
  out.counts = counts;
  return out;
}

/** Priced sale comps inside the 0.5x-2x band (or any priced sale when the
 *  subject's size is unknown). */
function goodSaleCount(report, subjectSqft) {
  const comps = report && Array.isArray(report.comps) ? report.comps : [];
  const s = num(subjectSqft) > 0 ? num(subjectSqft) : 0;
  return comps.filter((c) => isPricedSale(c) && (!s || inBand(c, s))).length;
}

/**
 * Whether the kept set is too thin to report without one wider search for
 * size-matched sales. Only for the size-driven commercial types, only when
 * the search wants sales, and only once the subject's size is known (the
 * wider search is TOLD the size band, so without one it would only repeat
 * the first search).
 */
function needsWiderSearch(report, { propertyType, txFocus, subjectSqft } = {}) {
  if (!SIZE_TYPES.has(String(propertyType || ""))) return false;
  if (txFocus === "leases") return false;
  if (!(num(subjectSqft) > 0)) return false;
  return goodSaleCount(report, subjectSqft) < WIDER_SEARCH_BELOW;
}

function addressKey(a) {
  return String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Every address the report already holds or set aside, for the wider
 *  search's "do not return these" list. */
function knownAddresses(report) {
  const all = [].concat((report && report.comps) || [], (report && report.set_aside) || []);
  const seen = new Set();
  const out = [];
  for (const c of all) {
    const a = String((c && c.address) || "").trim();
    const k = addressKey(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * Fold the wider search's comps into the report: new addresses only (checked
 * against both the kept comps and the set-aside ones, so a comp cut for its
 * size cannot walk back in), appended after the first search's comps, and
 * capped at maxComps. MUTATES. Returns how many were added.
 */
function mergeWiderComps(report, wider, maxComps) {
  if (!report || !wider || !Array.isArray(wider.comps) || !wider.comps.length) return 0;
  if (String(wider.currency || "USD") !== String(report.currency || "USD")) return 0;
  const seen = new Set(knownAddresses(report).map(addressKey));
  const cap = Number(maxComps) > 0 ? Number(maxComps) : Infinity;
  report.comps = Array.isArray(report.comps) ? report.comps : [];
  let added = 0;
  for (const c of wider.comps) {
    if (report.comps.length >= cap) break;
    const k = addressKey(c && c.address);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    report.comps.push(c);
    added += 1;
  }
  return added;
}

/** The set-aside comps still worth harvesting into the corpus. */
function harvestableSetAside(report) {
  const list = report && Array.isArray(report.set_aside) ? report.set_aside : [];
  return list.filter((c) => c && HARVESTABLE_REASONS.has(c.set_aside));
}

/** A viewer never receives the set-aside comps themselves (they are full
 *  comps with addresses and sources, and the paywall gates comps), only the
 *  counts. Returns a NEW object; the cached report keeps its list. */
function stripSetAside(report) {
  if (!report || typeof report !== "object" || !("set_aside" in report)) return report;
  const { set_aside, ...rest } = report;   // eslint-disable-line no-unused-vars
  return rest;
}

module.exports = {
  applyCompFit, needsWiderSearch, goodSaleCount, knownAddresses, mergeWiderComps,
  harvestableSetAside, stripSetAside, unitOf, isUnitSale,
  SIZE_TYPES, HARD_SIZE_MIN, HARD_SIZE_MAX, BAND_MIN, BAND_MAX,
  NEAR_MILES, NEAR_MIN, FAR_MILES, MIN_PRICED_SALES, WIDER_SEARCH_BELOW,
};

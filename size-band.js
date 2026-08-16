// ---------------------------------------------------------------------------
// Comp size band — "only comps within ±N% of the subject's square footage".
//
// The valuation multiplies the subject's size by a $/SF drawn from the comps,
// so a comp of a wholly different scale sets the headline for a building that
// does not exist. The prompt has asked for a half-to-twice size fit since the
// beginning, and compWeight discounts what falls outside it — but both are
// requests. This module is the guarantee: comps outside the band are REMOVED
// from the report, and the removal is counted so the report can say so.
//
// PURE, like comp-gate.js and blend-corpus.js: no I/O, no clock reads, no
// requires. server.js owns the reads and decides when to apply it. That is
// what lets `npm test` exercise the whole rule with no database.
//
// Five rules a future editor will otherwise break:
//
// 1. A comp with NO readable size is never dropped. It cannot be judged, and
//    judging "unknown" as out-of-band would delete exactly the rows the prompt
//    fights hardest for — a priced sale whose size is still being looked up,
//    and a lease listing that never states one. Unknown sizes are a gap in the
//    evidence, not evidence of a mismatch.
// 2. No subject size, no band. The band is a ratio against the subject; with
//    nothing to divide by there is nothing to enforce, and refusing every comp
//    would be the worst possible reading of "we could not find the size".
//    Falls open, deliberately.
// 3. "Off" is a real setting, not a missing one. normalizeTolerancePct
//    distinguishes absent (take the default) from explicitly off (no band) —
//    collapsing the two would make the widest setting unreachable.
// 4. Drops are DISCLOSED, never silent. applySizeBand writes size_band and
//    size_filtered_count onto the report so the client can say how many comps
//    the setting removed and what the window was. A report that quietly holds
//    three comps in a market that offered nine reads as a thin market rather
//    than as a filter the reader can widen.
// 5. It is applied at SERIALIZATION, like gateReport() and the two blends —
//    downstream of the cache write, harvestComps() and the market snapshot, so
//    the corpus keeps every comp the search actually found. The band is one
//    visitor's question about one building, not a fact about the market.
// ---------------------------------------------------------------------------

// Default: comps must be within 30% of the subject's size, in either
// direction. Chosen as the tightest band that still leaves an ordinary market
// with comps to return; the setting exists because "ordinary" is not every
// market, and a broker with a 400,000 SF distribution building has a very
// different opinion about it than one with a duplex.
const DEFAULT_TOLERANCE_PCT = 30;
// 1% is a band nobody can fill and 500% is wider than the old 0.5x-2x prompt
// rule, so both ends are limits rather than choices. Clamped, not rejected:
// this arrives from a request body, and a nonsense number should still return
// a report.
const MIN_TOLERANCE_PCT = 1;
const MAX_TOLERANCE_PCT = 500;

const OFF_WORDS = new Set(["off", "any", "none", "all", "false", "0"]);

function numericValue(str) {
  if (str == null) return NaN;
  const m = String(str).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/**
 * Resolve a request's tolerance into a percentage, or null for "no band".
 *
 * undefined / null / "" -> the fallback (the default band)
 * "off" / "any" / 0     -> null, meaning no filtering at all
 * a number              -> clamped into [MIN, MAX], one decimal place
 * anything unreadable   -> the fallback
 */
function normalizeTolerancePct(value, fallback = DEFAULT_TOLERANCE_PCT) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && OFF_WORDS.has(value.trim().toLowerCase())) return null;
  if (value === false) return null;
  const n = typeof value === "number" ? value : numericValue(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return null;
  const clamped = Math.min(MAX_TOLERANCE_PCT, Math.max(MIN_TOLERANCE_PCT, n));
  return Math.round(clamped * 10) / 10;
}

/**
 * The size window a comp has to land in, or null when there is nothing to
 * enforce (no subject size, or the band is off).
 */
function sizeBandFor(subjectSqft, pct) {
  const sf = Number(subjectSqft);
  const p = Number(pct);
  if (!Number.isFinite(sf) || sf <= 0) return null;
  if (!Number.isFinite(p) || p <= 0) return null;
  return {
    pct: p,
    min: Math.round(sf * (1 - Math.min(p, 99.9) / 100)),
    max: Math.round(sf * (1 + p / 100)),
    // The size everything here is a percentage OF. Carried on the band rather
    // than recovered from min/max later, which would round: widenToInclude
    // needs the real figure to name a percentage a re-run can be run at.
    subject: sf,
  };
}

// The smallest setting that would have kept every comp the band removed —
// what the report offers as a one-click "widen it" rather than making someone
// guess a number. Rounded UP to the next 5 so the answer is a figure a person
// would choose, and `"off"` when no allowed percentage reaches far enough (a
// comp twenty times the subject's size needs 1,900%, and a button promising
// to bring it back at 500% would simply be wrong).
function widenToInclude(dropped, band) {
  if (!band || !(band.subject > 0)) return null;
  let needed = 0;
  for (const c of Array.isArray(dropped) ? dropped : []) {
    const sf = compSizeSqft(c);
    if (!sf) continue;
    needed = Math.max(needed, Math.abs(sf / band.subject - 1) * 100);
  }
  if (!(needed > 0)) return null;
  // Rounded to the nearest thousandth before the ceiling: 40,000 ÷ 25,000 - 1
  // is 0.6000000000000001 in floating point, which would otherwise offer 65%
  // for a comp that is exactly 60% over.
  const rounded = Math.ceil(Math.round(needed * 1000) / 1000 / 5) * 5;
  return rounded > MAX_TOLERANCE_PCT ? "off" : rounded;
}

// A comp's own square footage. 0 means "not stated", which rule 1 protects.
function compSizeSqft(comp) {
  const n = numericValue(comp && comp.size_sqft);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function fitsSizeBand(comp, band) {
  if (!band) return true;
  const sf = compSizeSqft(comp);
  if (!sf) return true;            // rule 1: unknown is not a mismatch
  return sf >= band.min && sf <= band.max;
}

/**
 * Split a list of comps into the ones the band keeps and the ones it removes.
 * Used for the vault blend, where the rows are not a report yet.
 */
function splitBySizeBand(comps, band) {
  const list = Array.isArray(comps) ? comps : [];
  if (!band) return { kept: list, dropped: [] };
  const kept = [], dropped = [];
  for (const c of list) (fitsSizeBand(c, band) ? kept : dropped).push(c);
  return { kept, dropped };
}

/**
 * Apply the band to a whole report. Returns a NEW object (the caller may be
 * holding the cached report, which must never be mutated) carrying the band
 * and how many comps it removed. With no band, the report is returned
 * untouched — a search with the filter off is byte-identical to one from
 * before this module existed.
 */
function applySizeBand(report, band) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return report;
  if (!band) return report;
  const comps = Array.isArray(report.comps) ? report.comps : [];
  const { kept, dropped } = splitBySizeBand(comps, band);
  const widen = widenToInclude(dropped, band);
  return {
    ...report,
    comps: kept,
    size_band: { pct: band.pct, min: band.min, max: band.max },
    size_filtered_count: dropped.length,
    // A number (or "off") only when something was actually removed, so the
    // client can test for its presence. Deliberately NOT the dropped comps'
    // sizes: this is one figure, not a description of rows the visitor asked
    // not to see.
    ...(widen == null ? {} : { size_widen_pct: widen }),
  };
}

// "17,500-32,500 SF" — the window itself, for prompts and UI copy. The
// percentage is stated separately by every caller, so it is not repeated here.
function describeSizeBand(band) {
  if (!band) return "";
  const n = (v) => Math.round(v).toLocaleString("en-US");
  return `${n(band.min)}-${n(band.max)} SF`;
}

module.exports = {
  DEFAULT_TOLERANCE_PCT, MIN_TOLERANCE_PCT, MAX_TOLERANCE_PCT,
  normalizeTolerancePct, sizeBandFor, compSizeSqft, fitsSizeBand,
  splitBySizeBand, applySizeBand, describeSizeBand, widenToInclude,
};

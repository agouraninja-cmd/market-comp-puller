// ---------------------------------------------------------------------------
// Valuation backtest: how far the reconciliation lands from a known price.
//
// Hold-one-out over the comp corpus. Any priced, sized corpus row of decent
// provenance is a known outcome, and the rows around it are the comps a search
// would have used. Take one out, value it from its peers with the PRODUCTION
// math, and compare.
//
// Pure, like corpus-audit.js: no I/O, no clock reads (the caller passes `now`),
// and the only require is valuation.js. server.js owns the database read, the
// memo and the route.
//
// WHAT THIS MEASURES: the math, not the comp-finding. It feeds the valuation
// comps that are already in the corpus rather than running a search, so it
// cannot say whether the model finds good comps. It also runs the UNTRENDED
// path, because corpus rows do not store the market trend the search ran with.
// Both limits belong on screen next to the numbers.
//
// See docs/superpowers/specs/2026-08-06-valuation-backtest-design.md.
// ---------------------------------------------------------------------------

"use strict";

const VALUATION = require("./valuation");

// Ground truth needs provenance better than a model guess. This is
// DELIBERATELY STRICTER than what corpusRowsForMarket / retrieveCorpusComps
// (server.js) call "usable" for a live search: that path is a DENYLIST -- it
// excludes only "estimate" and "news", admitting everything else, including
// "user" and an unrecognized or empty source_type. This is an ALLOWLIST of
// the three tiers trusted to stand in as a known, priced sale, which also
// excludes "user" (someone's own typed entry, not an independent
// transaction) and anything unfamiliar. The two lists are not the same
// standard and are not meant to be: scoring predictions against whatever a
// live search would accept is a different, weaker claim than scoring them
// against comps good enough to be the answer key.
const GROUND_TRUTH_TIERS = ["verified", "public_record", "listing"];

// Address-key used ONLY to decide whether two corpus rows are the same real
// building, so a peer-exclusion test can fire across the spelling variants
// the model actually produces across separate searches.
//
// This deliberately DIVERGES from corpusKeyOf (server.js:2299), which is
// what the corpus dedupes WRITES with. corpusKeyOf compares two HARVESTS OF
// THE SAME MODEL OUTPUT -- the address string is byte-identical by
// construction there, and the key is paired with date and price precisely
// because the address contributes nothing on its own. Reused here as a
// cross-search identity test, that byte-identity assumption is false: the
// model wrote "19127 Red Label Lane, Caldwell, ID 83607" one search and
// "19127 Red Label Ln, Caldwell, ID 83605" (wrong zip, abbreviated suffix)
// the next, for the same warehouse. Plain lowercase-and-collapse-whitespace
// treats those as different buildings, so the peer-exclusion filter below
// (`p.key !== subj.key`) never fired: the harness scored three spelling
// variants of ONE building as three independent subjects, each valued from
// the others, each landing at 0.0% error -- and that inflated the published
// headline (verified 2026-08-06: median error 15.6% -> 19.3%, Industrial
// 3.4% -> 9.4%, both errors in the flattering direction on the one number
// meant to be trusted).
//
// The fix: key on the STREET LINE (the text before the first comma, where a
// zip typo can't reach) with trailing punctuation stripped and common
// suffixes/directionals folded to one spelling. This is a dedupe heuristic,
// not an address parser -- it will never catch everything, which is why
// isSameProperty below also checks size + price as a second, independent
// line of defense.
const STREET_SUFFIXES = {
  lane: "ln", street: "st", avenue: "ave", drive: "dr", road: "rd",
  boulevard: "blvd", court: "ct", place: "pl", parkway: "pkwy", highway: "hwy",
};
const DIRECTIONALS = { north: "n", south: "s", east: "e", west: "w" };

function normAddress(s) {
  const streetLine = String(s || "").split(",")[0] || "";
  return streetLine
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => STREET_SUFFIXES[w] || DIRECTIONALS[w] || w)
    .join(" ");
}

// Belt and braces: suffix folding will never catch every spelling variant
// (a transposed street number, "Building A" appended on only one harvest,
// two towns' worth of ZIP typos), so also treat two rows as the same
// property when their size AND price match EXACTLY -- a coincidence real
// distinct buildings essentially never share, and precisely what the four
// Red Label Lane rows above have in common besides the address.
function isSameProperty(a, b) {
  if (a.key === b.key) return true;
  const asz = VALUATION.numericValue(a.row.size_sqft);
  const bsz = VALUATION.numericValue(b.row.size_sqft);
  if (!(asz > 0) || asz !== bsz) return false;
  const ap = VALUATION.numericValue(a.row.price_or_rate);
  const bp = VALUATION.numericValue(b.row.price_or_rate);
  return ap > 0 && ap === bp;
}

// A subject's peer set can otherwise hold the same OTHER building twice (it
// was harvested more than once), which pulls the weighted band toward that
// one building's price twice over. Keep one row per key, the one closest to
// the subject's own deal date -- the most relevant copy of that building's
// price for valuing something sold around then.
function dedupePeers(peers, subjDy) {
  const byKey = new Map();
  peers.forEach((p) => {
    const existing = byKey.get(p.key);
    if (!existing || Math.abs(p.dy - subjDy) < Math.abs(existing.dy - subjDy)) {
      byKey.set(p.key, p);
    }
  });
  return Array.from(byKey.values());
}

// parseDealDate returns a decimal year; compAgeYears needs something
// Date.parse can read. Mid-month keeps the error under two weeks, which is
// noise next to a two-year half-life. A bare year ("2026" -> 2026.5) lands in
// July, which is the intended mid-year reading.
function isoFromDecimalYear(dy) {
  const year = Math.floor(dy);
  let month = Math.round((dy - year) * 12 + 0.5);
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  return year + "-" + String(month).padStart(2, "0") + "-15";
}

// A corpus row, shaped like a report comp so valuation.js can read it.
function compFromRow(row, dy) {
  return {
    address: row.address,
    transaction: row.transaction || "",
    date: isoFromDecimalYear(dy),
    size_sqft: row.size_sqft,
    price_or_rate: row.price_or_rate,
    price_per_sqft: row.price_per_sqft,
    source_type: row.source_type,
    verified: row.verified,
  };
}

// Usable at all: a dated, priced, sized sale. Tier is not tested here, because
// peers of every tier are legitimate; see isGroundTruth.
function prepare(row, parseDealDate) {
  if (!row) return null;
  if (String(row.transaction || "").toLowerCase().startsWith("lease")) return null;
  const dy = parseDealDate(row.deal_date);
  if (dy == null) return null;
  const comp = compFromRow(row, dy);
  const psf = VALUATION.salePsfOf(comp);
  if (!(psf > 0)) return null;
  if (!(VALUATION.numericValue(row.size_sqft) > 0)) return null;
  return { row, dy, comp, psf, key: normAddress(row.address) };
}

function isGroundTruth(p) {
  return GROUND_TRUTH_TIERS.indexOf(VALUATION.tierOf(p.row)) >= 0;
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarize(rs) {
  return {
    scored: rs.length,
    medianAbsError: median(rs.map((r) => r.absError)),
    bandCoverage: rs.length ? rs.filter((r) => r.inBand).length / rs.length : null,
    medianBandWidth: median(rs.map((r) => r.bandWidth)),
  };
}

function score(rows, opts) {
  const o = opts || {};
  const parseDealDate = o.parseDealDate;
  const minPeers = o.minPeers == null ? 3 : o.minPeers;
  const minSubjects = o.minSubjects == null ? 20 : o.minSubjects;

  const pool = [];
  let unusable = 0;
  (rows || []).forEach((r) => {
    const p = prepare(r, parseDealDate);
    if (p) pool.push(p); else unusable += 1;
  });

  // Bucket by market + type. The market comparison is case-SENSITIVE, matching
  // the `eq` filter corpusRowsForMarket uses; marketOf() canonicalizes on the
  // write side for exactly this reason.
  const buckets = new Map();
  pool.forEach((p) => {
    const k = p.row.market + "|" + p.row.property_type;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  });

  let notGroundTruth = 0;
  let thinPeers = 0;
  let duplicateAddress = 0;
  const results = [];

  buckets.forEach((group) => {
    // A building harvested more than once (the same real property, a
    // different date, price, or spelling each time -- see isSameProperty) is
    // not independent ground truth: scoring every copy against the same peer
    // pool would let one repeatedly-harvested building count several times
    // in the aggregate. `claimed` holds the prepared subjects that have
    // ACTUALLY scored so far in this bucket, checked with the same
    // same-property test the peer filter uses below, so a spelling variant
    // or a size/price twin of an already-scored building is caught even when
    // its key differs.
    //
    // Claimed only once a row ACTUALLY scores (right before it is pushed to
    // `results`) -- never on a bare attempt. Claiming on attempt would let
    // whichever copy happens to sort first permanently block a later,
    // perfectly scoreable copy of the same building just for being
    // thin-peered or the wrong tier; corpusRowsForMarket returns
    // newest-harvest-first, so that would have been a systematic bias
    // against older harvests, not a rare accident.
    const claimed = [];
    group.forEach((subj) => {
      if (claimed.some((c) => isSameProperty(c, subj))) { duplicateAddress += 1; return; }

      if (!isGroundTruth(subj)) { notGroundTruth += 1; return; }
      // On or before: parseDealDate has only month granularity, so a peer
      // recorded in the same month as the subject is legitimate known
      // history, not a look-ahead. (Design spec 2026-08-06: "dated on or
      // before the subject's deal_date".)
      let peers = group.filter((p) => !isSameProperty(subj, p) && p.dy <= subj.dy);
      // Collapse a building that itself was harvested more than once down to
      // its single date-nearest row, so it enters the weighted band once.
      peers = dedupePeers(peers, subj.dy);
      if (peers.length < minPeers) { thinPeers += 1; return; }
      const v = VALUATION.valueFromComps(peers.map((p) => p.comp), {
        subjectSF: VALUATION.numericValue(subj.row.size_sqft),
        asOf: Date.parse(subj.comp.date),
        trendPct: null,
        propertyType: subj.row.property_type,
      });
      if (!v || !(v.psfMid > 0)) { thinPeers += 1; return; }
      claimed.push(subj);
      results.push({
        type: subj.row.property_type,
        absError: Math.abs(v.psfMid - subj.psf) / subj.psf,
        inBand: subj.psf >= v.psfLow && subj.psf <= v.psfHigh,
        bandWidth: (v.psfHigh - v.psfLow) / v.psfMid,
      });
    });
  });

  const overall = summarize(results);
  const belowFloor = results.length < minSubjects;

  const types = Array.from(new Set(results.map((r) => r.type))).sort();
  const byType = types.map((t) =>
    Object.assign({ type: t }, summarize(results.filter((r) => r.type === t))));

  return {
    scored: results.length,
    minSubjects,
    belowFloor,
    skipped: { unusable, notGroundTruth, thinPeers, duplicateAddress },
    // Withheld below the floor: a median over a handful of subjects swings
    // enough that tuning against it would be tuning against noise.
    medianAbsError: belowFloor ? null : overall.medianAbsError,
    bandCoverage: belowFloor ? null : overall.bandCoverage,
    medianBandWidth: belowFloor ? null : overall.medianBandWidth,
    byType: belowFloor ? [] : byType,
  };
}

module.exports = { score, normAddress, isSameProperty, isoFromDecimalYear, GROUND_TRUTH_TIERS };

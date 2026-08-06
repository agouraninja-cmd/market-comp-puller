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

// Ground truth needs provenance better than a model guess. This is the same
// standard corpus-first retrieval calls "usable".
const GROUND_TRUTH_TIERS = ["verified", "public_record", "listing"];

// Mirrors the `norm` inside corpusKeyOf (server.js:2256), which is what the
// corpus dedupes addresses with. Kept byte-identical on purpose: if the two
// drift, a building harvested twice could help value itself.
function normAddress(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
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
  const results = [];

  buckets.forEach((group) => {
    // A building harvested more than once (same normalized address, a
    // different date or price each time) is not independent ground truth:
    // holding out EVERY copy and scoring each against the same peer pool
    // would let one repeatedly-harvested building count several times in
    // the aggregate. Each address gets at most one turn as the held-out
    // subject; later copies are skipped outright (not counted as thin-peer
    // or not-ground-truth, since neither is why they were skipped).
    const claimed = new Set();
    group.forEach((subj) => {
      if (claimed.has(subj.key)) return;
      claimed.add(subj.key);

      if (!isGroundTruth(subj)) { notGroundTruth += 1; return; }
      // Strictly earlier, not on-or-before: a same-dated row is not known
      // history as of the subject's own sale, so it can never be one of the
      // subject's peers. This also means two same-dated rows can never
      // score each other, categorically, not just in the calibrated case the
      // base fixture relies on.
      const peers = group.filter((p) => p.key !== subj.key && p.dy < subj.dy);
      if (peers.length < minPeers) { thinPeers += 1; return; }
      const v = VALUATION.valueFromComps(peers.map((p) => p.comp), {
        subjectSF: VALUATION.numericValue(subj.row.size_sqft),
        asOf: Date.parse(subj.comp.date),
        trendPct: null,
      });
      if (!v || !(v.psfMid > 0)) { thinPeers += 1; return; }
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
    skipped: { unusable, notGroundTruth, thinPeers },
    // Withheld below the floor: a median over a handful of subjects swings
    // enough that tuning against it would be tuning against noise.
    medianAbsError: belowFloor ? null : overall.medianAbsError,
    bandCoverage: belowFloor ? null : overall.bandCoverage,
    medianBandWidth: belowFloor ? null : overall.medianBandWidth,
    byType: belowFloor ? [] : byType,
  };
}

module.exports = { score, normAddress, isoFromDecimalYear, GROUND_TRUTH_TIERS };

// ---------------------------------------------------------------------------
// The valuation core: how a set of comps becomes a value range.
//
// Extracted from index.html on 2026-08-06 so the browser and the accuracy
// harness (backtest.js) run ONE copy of this math. A second copy would let the
// harness report a healthy number for arithmetic no customer runs, and nothing
// would catch it. The repo already carries two such pairs (compWeight and
// exportReportKey, both flagged in CLAUDE.md); this module exists so the
// valuation is not a third.
//
// PURE, like entitlements.js, comp-gate.js and corpus-audit.js: no DOM, no
// globals, no fetch, and no clock reads. The caller passes `asOf` and the
// market trend. That is what lets `npm test` exercise the whole thing.
//
// Loads in both a browser (as the global `VALUATION`) and Node (as a CommonJS
// module), which is new for this repo: every other pure module here is
// Node-only.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VALUATION = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function numericValue(str) {
    if (str == null) return NaN;
    const m = String(str).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  // A sale comp's $/SF for the valuation math. Fresh reports arrive with the
  // server's reconciled figure; saved and shared reports from before that
  // change never re-touch the server, so derive price / size at read time or
  // their unpriced comps silently drop out of the range. The sane per-SF band
  // guards against numericValue's shorthand hazard ("$1.2M" -> 1.2).
  function salePsfOf(c) {
    const v = numericValue(c.price_per_sqft);
    if (v > 0) return v;
    const p = numericValue(c.price_or_rate), s = numericValue(c.size_sqft);
    if (p > 0 && s > 0) {
      const d = p / s;
      if (d >= 1 && d <= 100000) return d;
    }
    return NaN;
  }

  // Weighted percentile band. Four or more comps get an outlier-resistant
  // interquartile band; below that there is nothing to trim, so the raw spread
  // stands and `trimmed` says so.
  function robustPpsfRange(vals) {
    const items = vals
      .map((x) => (typeof x === "number" ? { v: x, w: 1 } : x))
      .sort((a, b) => a.v - b.v);
    const n = items.length;
    const total = items.reduce((sum, x) => sum + x.w, 0);
    let cum = 0;
    const pos = items.map((x) => { const p = (cum + x.w / 2) / total; cum += x.w; return p; });
    const q = (p) => {
      if (p <= pos[0]) return items[0].v;
      if (p >= pos[n - 1]) return items[n - 1].v;
      let i = 0;
      while (pos[i + 1] < p) i++;
      const t = (p - pos[i]) / (pos[i + 1] - pos[i]);
      return items[i].v + t * (items[i + 1].v - items[i].v);
    };
    if (n >= 4) return { low: q(0.25), mid: q(0.5), high: q(0.75), trimmed: true };
    return { low: items[0].v, mid: q(0.5), high: items[n - 1].v, trimmed: false };
  }

  // Display rounding for TOTAL dollar figures. "$926,987" projects a precision
  // the math does not have: it is an interpolated percentile of a handful of
  // comps times a size range.
  function heroRound(v) {
    if (!isFinite(v) || v === 0) return v;
    const a = Math.abs(v);
    const step = a >= 10e6 ? 100000 : a >= 1e6 ? 25000 : a >= 100000 ? 5000 : 1000;
    return Math.round(v / step) * step;
  }

  // Source-tier weights. Also the tier vocabulary: index.html's SOURCE_TIERS
  // holds the badge labels and CSS classes for the same six keys, and tierOf
  // below is the ONE place a comp's tier is decided.
  const TIER_WEIGHT = { verified: 1, user: 1, public_record: 1, listing: 0.85, news: 0.7, estimate: 0.5 };

  function tierOf(comp) {
    if (comp.verified === true || String(comp.verified).toLowerCase() === "true") return "verified";
    return TIER_WEIGHT[comp.source_type] != null ? comp.source_type : null;
  }

  // Age in years at `asOf`, capped at five. A future-dated comp reads as 0
  // rather than negative, and an unparseable date reads as null (neutral).
  function compAgeYears(c, asOf) {
    const d = Date.parse(c.date);
    if (isNaN(d)) return null;
    const yrs = (asOf - d) / (365.25 * 24 * 3600 * 1000);
    return yrs > 0 ? Math.min(yrs, 5) : 0;
  }

  // Three quiet factors, multiplied:
  //   recency      2-year half-life on the comp's age at the report date
  //   size match   free pass within 0.5x-2x of the subject, halving per
  //                further doubling (a 5k SF building should not be priced by
  //                a 100k SF warehouse: big buildings trade at lower $/SF)
  //   source       verified/public-record full weight, down to half for model
  //                estimates (mirrors the badge tiers)
  // Floored at 0.15 so no comp silently vanishes from a range it visibly sits
  // in. Missing data is neutral, never a penalty.
  function compWeight(c, asOf, subjSF) {
    let w = 1;
    const age = compAgeYears(c, asOf);
    if (age !== null) w *= Math.pow(0.5, age / 2);
    const compSF = numericValue(c.size_sqft);
    if (subjSF > 0 && compSF > 0) {
      const octaves = Math.abs(Math.log2(compSF / subjSF));
      if (octaves > 1) w *= Math.pow(0.5, octaves - 1);
    }
    const tier = tierOf(c);
    if (tier && TIER_WEIGHT[tier] != null) w *= TIER_WEIGHT[tier];
    return Math.max(0.15, w);
  }

  // Index an older comp's price to the report date at the market's annual
  // trend, compounded over the comp's age and capped at three years so an
  // out-of-window straggler is never extrapolated into fiction. `trendPct` is
  // the model's market-level figure (server-bounded to +/-30%/yr, null when
  // its searches showed no clear trend).
  function trendFactor(c, asOf, trendPct) {
    const pct = Number(trendPct);
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 30) return 1;
    const age = compAgeYears(c, asOf);
    if (!age) return 1;
    return Math.pow(1 + pct / 100, Math.min(age, 3));
  }

  return {
    numericValue, salePsfOf, robustPpsfRange, heroRound,
    TIER_WEIGHT, tierOf, compAgeYears, compWeight, trendFactor,
  };
});

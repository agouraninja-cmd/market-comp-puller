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

  // Robust $/SF range for the value hero. A single freak comp (a trophy sale,
  // a distressed flip) used to blow the Low/High wide open because they were
  // the literal min and max. With 4+ comps this instead takes the
  // interquartile band (25th-75th percentile) around the median, so outliers
  // can't dominate the headline; below that there is nothing to trust as an
  // outlier, so the full observed spread stands instead, and `trimmed` says
  // which case fired.
  //
  // Accepts plain numbers (each weighs 1) or {v, w} items: the percentiles
  // are weighted, so a stale, off-size, or weakly-sourced comp pulls the band
  // less than a fresh well-documented one (see compWeight). Each item sits at
  // the center of its weight span on the cumulative scale, with linear
  // interpolation between neighbors, so equal weights reproduce the familiar
  // evenly-spaced percentile positions.
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
  // holds the badge labels and CSS classes for the same seven keys, and tierOf
  // below is the ONE place a comp's tier is decided.
  //
  // broker_vault is a blended private comp (blend-comps.js). Weight 1 changes
  // nothing in the valuation — before the key existed, tierOf returned null
  // for these comps and compWeight skipped the multiplier, an implicit 1 —
  // but without the key tierOf's null meant NO tier, so index.html's
  // sourceBadge() rendered no "From your vault" badge and the legend omitted
  // the tier entirely. The key exists so the tier does; the weight is just
  // written down instead of implied. Full weight is deliberate: it is the
  // broker's own closed deal, the one provenance they can vouch for
  // personally. Mirrored in comp-gate.js — keep the two in step.
  const TIER_WEIGHT = { verified: 1, user: 1, public_record: 1, listing: 0.85, news: 0.7, estimate: 0.5, broker_vault: 1 };

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

  // A 4-digit construction year, or null. Accepts a number or a string that
  // IS the year ("1994"); a note like "c. 1994" or "built 1994" is dropped
  // rather than guessed, matching the rest of this module's reject-not-guess
  // stance. Bounded to 1800-2100 so a size or a price that leaked into the
  // year field cannot become a vintage penalty.
  function yearOf(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && Number.isFinite(v)) {
      const y = Math.round(v);
      return y >= 1800 && y <= 2100 ? y : null;
    }
    const m = String(v).trim().match(/^(18|19|20)\d{2}$/);
    return m ? Number(m[0]) : null;
  }

  // Miles from the subject, or null. Reads the numeric `distance_mi` the
  // report already shows in the Distance column ("2.3 mi", 2.3, "< 0.1 mi").
  // Coordinates themselves never enter the weight: locked_basis is allowed
  // to carry a distance and must never carry a lat/lng.
  function distanceMiles(c) {
    const v = numericValue(c && c.distance_mi);
    return v >= 0 && Number.isFinite(v) ? v : null;
  }

  // Five quiet factors, multiplied:
  //   recency      2-year half-life on the comp's age at the report date
  //   size match   free pass within 0.5x-2x of the subject, halving per
  //                further doubling (a 5k SF building should not be priced by
  //                a 100k SF warehouse: big buildings trade at lower $/SF)
  //   vintage      free pass within 15 years of the subject's year built,
  //                then halving per further 15 years (a 1994 house should not
  //                be priced by 2024 new construction: they are different
  //                products even on the same block)
  //   distance     free pass within 1 mile, then a half-life (4 miles for
  //                CRE, 2 miles for Residential — a sale five miles away is
  //                a different pocket; the 4-mile CRE half-life still let
  //                cheaper houses a few miles over pull a $2M home to $1M)
  //   source       verified/public-record full weight, down to half for model
  //                estimates (mirrors the badge tiers)
  // Floored at 0.15 so no comp silently vanishes from a range it visibly sits
  // in. Missing data is neutral, never a penalty. `subjYear` is optional so
  // callers that have no year (the accuracy backtest, a report whose lookup
  // found none) keep the pre-vintage weights exactly. Missing distance is
  // the same: a comp the map has not placed yet must not be punished.
  // `opts.propertyType` (or a 5th-arg string) switches the distance half-life
  // for Residential; omitted keeps the CRE 4-mile curve so existing callers
  // do not move.
  function distanceHalfLifeMiles(propType) {
    return propType === "Residential" ? 2 : 4;
  }

  function compWeight(c, asOf, subjSF, subjYear, opts) {
    const o = opts && typeof opts === "object" && !Array.isArray(opts) ? opts : {};
    const propType = typeof opts === "string" ? opts : o.propertyType;
    let w = 1;
    const age = compAgeYears(c, asOf);
    if (age !== null) w *= Math.pow(0.5, age / 2);
    const compSF = numericValue(c.size_sqft);
    if (subjSF > 0 && compSF > 0) {
      const octaves = Math.abs(Math.log2(compSF / subjSF));
      if (octaves > 1) w *= Math.pow(0.5, octaves - 1);
    }
    const ySub = yearOf(subjYear), yComp = yearOf(c && c.year_built);
    if (ySub != null && yComp != null) {
      const dy = Math.abs(yComp - ySub);
      if (dy > 15) w *= Math.pow(0.5, (dy - 15) / 15);
    }
    const mi = distanceMiles(c);
    const halfLife = distanceHalfLifeMiles(propType);
    if (mi !== null && mi > 1) w *= Math.pow(0.5, (mi - 1) / halfLife);
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

  // The whole sequence, in one place: filter to sales, read each comp's value,
  // index it to the report date, weight it, take the band, and apply the
  // subject's size. index.html wrote this out three times and the harness in
  // backtest.js would have been a fourth. It is the composition, not the
  // leaves, that has to be shared: leaves alone still let two callers disagree
  // about the ORDER of operations, which is exactly what an accuracy harness
  // must not do.
  //
  // `subjectSF` is a number or { min, max }. The range form is what the hero
  // uses: low $/SF against the smallest size, high against the largest.
  function valueFromComps(comps, opts) {
    const o = opts || {};
    // Named `readValue`, not `valueOf`: every JS object inherits a `valueOf`
    // from Object.prototype, so `o.valueOf || salePsfOf` could never reach
    // the default (o.valueOf is always a truthy function, even when the
    // caller never set it) and even an own-property check only closes the
    // "key absent" case, not `{ valueOf: undefined }` from a conditional
    // spread. The typeof guard treats absent, explicitly-undefined, and
    // explicitly-non-function all the same way: fall back to salePsfOf.
    const readValue = typeof o.readValue === "function" ? o.readValue : salePsfOf;
    const sf = o.subjectSF;
    const isRange = sf && typeof sf === "object";
    const sizeMin = Number(isRange ? sf.min : sf) || 0;
    const sizeMax = Number(isRange ? sf.max : sf) || 0;
    const sizeMid = (sizeMin + sizeMax) / 2;

    const items = (comps || [])
      .filter((c) => c && !String(c.transaction || "").toLowerCase().startsWith("lease"))
      .map((c) => ({ comp: c, v: readValue(c) }))
      .filter((x) => x.v > 0);
    if (!items.length) return null;

    const rr = robustPpsfRange(items.map((x) => ({
      v: x.v * trendFactor(x.comp, o.asOf, o.trendPct),
      w: compWeight(x.comp, o.asOf, sizeMid, o.subjectYear, {
        propertyType: o.propertyType,
      }),
    })));

    return {
      psfLow: rr.low, psfMid: rr.mid, psfHigh: rr.high,
      low: heroRound(rr.low * sizeMin),
      mid: heroRound(rr.mid * sizeMid),
      high: heroRound(rr.high * sizeMax),
      n: items.length,
      trimmed: rr.trimmed,
      raw: items.map((x) => x.v),
    };
  }

  // How the subject's own size sits against the sizes the comps actually cover.
  // `offSize` counts the comps outside compWeight's 0.5x-2x free pass — the
  // figure the hero's trust line reports as "N comps are a different size
  // class" — and this is the single owner of that comparison so the note and
  // the warning below can never disagree about which comps they mean.
  //
  // `unsupported` is that reading turned around. When EVERY sized comp falls
  // outside the window AND the subject sits entirely past one end of their
  // range, the odd one out is no longer the comps: it is the SUBJECT SIZE. That
  // matters more than any other suspect number in the report because the hero
  // multiplies it. On 2026-08-13 a mobile home listed at $52,000 was reported
  // at $795,000: the eight comps were right (manufactured homes, 460-1,492 SF,
  // $61-158/SF) and the size box was wrong (10,100 SF, measured off a bike shop
  // 81 m away). The report's only hint was "8 comps are a different size class
  // and count less", which reads as a footnote about the comps rather than a
  // warning that the headline is extrapolated 6.8x past every one of them.
  //
  // Below three sized comps this stays quiet: "all of them" is not evidence
  // when there are two, and the same 3-comp floor guards the per-unit and
  // per-acre cross-checks.
  var SIZE_FIT_MIN_COMPS = 3;
  function subjectSizeFit(subjectSF, comps) {
    var sf = Number(subjectSF);
    if (!(sf > 0)) return null;
    var sizes = (comps || [])
      .filter(function (c) { return c && !String(c.transaction || "").toLowerCase().startsWith("lease"); })
      .map(function (c) { return numericValue(c.size_sqft); })
      .filter(function (v) { return v > 0; });
    if (!sizes.length) return null;
    // Same octave test compWeight applies, so "different size class" means one
    // thing in this app.
    var off = sizes.filter(function (v) { return Math.abs(Math.log2(v / sf)) > 1; });
    var fit = { sized: sizes.length, offSize: off.length, unsupported: false };
    if (sizes.length < SIZE_FIT_MIN_COMPS || off.length < sizes.length) return fit;
    var min = Math.min.apply(null, sizes), max = Math.max.apply(null, sizes);
    // Deliberately NOT fired when the comps straddle the subject (one comp far
    // smaller, another far larger). That is a scattered comp set, which the
    // per-comp weighting already handles and `offSize` already reports; it is
    // not the size box holding a number from a different building.
    if (sf > max * 2) {
      fit.unsupported = true; fit.dir = "larger"; fit.nearest = max; fit.factor = Math.round((sf / max) * 10) / 10;
    } else if (sf < min / 2) {
      fit.unsupported = true; fit.dir = "smaller"; fit.nearest = min; fit.factor = Math.round((min / sf) * 10) / 10;
    }
    return fit;
  }

  // Is this displayed $/SF an outlier against the hero's displayed band?
  // Returns null, or { dir, pct } where pct is the integer percent distance
  // from the NEAREST band edge (+38 means 38% above the band top).
  // ⚠ 25% and the nearest-edge delta semantics are the SAME product rule as
  // gut-check.js's OUTLIER_PCT/outlierOf and its band-delta math. Change them together.
  var OUTLIER_PCT = 0.25;
  function outlierOf(ppsf, band) {
    if (!band || !(ppsf > 0)) return null;
    var low = band.low, high = band.high;
    if (!(low > 0) || !(high > 0) || high < low) return null;
    if (ppsf > high * (1 + OUTLIER_PCT)) return { dir: "above", pct: Math.round(((ppsf - high) / high) * 100) };
    if (ppsf < low * (1 - OUTLIER_PCT)) return { dir: "below", pct: Math.round(((low - ppsf) / low) * 100) };
    return null;
  }

  // Is the sales-comparison mid far from a known asking / listing price?
  // Same 25% rule as outlierOf (OUTLIER_PCT): inside that band the listing
  // and the comps agree closely enough to leave alone; past it, one of them
  // is the wrong product.
  //
  // The 2026-08-13 Austin Rosedale case: a 1994 house listed at $1,250,000
  // ($454/SF, at the neighborhood median) was reported at $1,650,000
  // ($599/SF) because the comps were the expensive tail ($486–$653/SF) and
  // a +5.5%/yr trend was applied in a market whose sold prices were falling.
  // Size was right; the comp set was a different vintage and pocket. The
  // listing was sitting on the same page the size was read from and never
  // entered the report.
  //
  // This never changes the range — a list price is not a fourth valuation
  // figure, any more than the subject's last sale is. It says when the
  // comps and the listing disagree enough that the reader should look at
  // Year Built before trusting the headline.
  function askFit(askPrice, midValue) {
    var ask = Number(askPrice), mid = Number(midValue);
    if (!(ask > 0) || !(mid > 0)) return null;
    var pct = (mid - ask) / ask;
    var dir = pct > 0 ? "above" : (pct < 0 ? "below" : "even");
    var out = { skewed: false, dir: dir, pct: Math.round(Math.abs(pct) * 100), ask: ask, mid: mid };
    if (Math.abs(pct) <= OUTLIER_PCT) return out;
    out.skewed = true;
    return out;
  }

  return {
    numericValue, salePsfOf, robustPpsfRange, heroRound,
    TIER_WEIGHT, tierOf, compAgeYears, yearOf, distanceMiles, distanceHalfLifeMiles,
    compWeight, trendFactor,
    valueFromComps, outlierOf, OUTLIER_PCT, subjectSizeFit, askFit,
  };
});

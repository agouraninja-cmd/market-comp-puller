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

  // An asking price that has not sold: the search writes "Active" for a live
  // listing with no post date and "Listed Mar 2025" for one that has it (the
  // date rule in server.js's buildPrompt), and the corpus stores the same two
  // shapes. This is the single reader of that convention for the math.
  function isOnMarket(c) {
    return /^\s*(?:active|listed)\b/i.test(String((c && c.date) || ""));
  }

  // When a comp's deal happened, in ms, or NaN.
  //
  // This used to be a bare Date.parse(c.date), and `date` is free text the
  // model (or a broker's spreadsheet) wrote. Three things went wrong with
  // that, all silently:
  //   * "Q3 2025" is a real stored value and Date.parse answers NaN for it,
  //     so a two-year-old quarter-dated sale read as "age unknown": FULL
  //     recency weight and no trend index, outranking a sale dated "Sep 2025"
  //     in the same table.
  //   * "2025" parsed as 1 January (and "Late 2025" as 1 January too, V8
  //     skipping the word it did not know), up to a year older than the deal.
  //   * Reading anything but the ISO form is implementation-defined in
  //     ECMAScript. "Mar 2025" is what nearly every comp carries, so the
  //     weights and the indexed prices depended on the browser's leniency.
  // The shapes below are read explicitly, the same vocabulary deal-date.js
  // reads on the server (that module is Node-only, and this one may require
  // nothing). "Mon YYYY" stays the 1st of the month at local midnight, which
  // is exactly what V8 answered, so no existing report moves. Only a shape
  // not listed here falls through to Date.parse, as before.
  var MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var PART_OF_YEAR = { early: 1, mid: 6, late: 10 };
  var MONTH_YEAR = new RegExp("^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|"
    + "sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?,?\\s+((?:19|20)\\d{2})$");
  function dealDateMs(raw) {
    const text = String(raw == null ? "" : raw).trim().replace(/^listed\s+/i, "");
    const t = text.toLowerCase();
    if (!t) return NaN;
    let m;
    // A bare year is the middle of it, not its first day.
    if ((m = t.match(/^((?:19|20)\d{2})$/))) return new Date(Number(m[1]), 6, 1).getTime();
    // "Q3 2025" / "2025 Q3": the middle of the quarter.
    if ((m = t.match(/^q([1-4])[\s,'-]*((?:19|20)\d{2})$/))) return new Date(Number(m[2]), (Number(m[1]) - 1) * 3 + 1, 15).getTime();
    if ((m = t.match(/^((?:19|20)\d{2})[\s,-]*q([1-4])$/))) return new Date(Number(m[1]), (Number(m[2]) - 1) * 3 + 1, 15).getTime();
    // "H2 2025": the middle of the half.
    if ((m = t.match(/^h([12])[\s,-]*((?:19|20)\d{2})$/))) return new Date(Number(m[2]), m[1] === "1" ? 3 : 9, 1).getTime();
    if ((m = t.match(/^(early|mid|late)[\s-]+((?:19|20)\d{2})$/))) return new Date(Number(m[2]), PART_OF_YEAR[m[1]], 1).getTime();
    // "Mar 2025", "March 2025", "Sept. 2025". A real month name only: a
    // word that merely starts like one ("Marble 2025") is not a date here.
    if ((m = t.match(MONTH_YEAR))) return new Date(Number(m[2]), MONTH_INDEX[m[1].slice(0, 3)], 1).getTime();
    // "04/2026".
    if ((m = t.match(/^(\d{1,2})\/((?:19|20)\d{2})$/))) {
      const mo = Number(m[1]);
      if (mo >= 1 && mo <= 12) return new Date(Number(m[2]), mo - 1, 1).getTime();
    }
    return Date.parse(text);
  }

  // Age in years at `asOf`, capped at five. A future-dated comp reads as 0
  // rather than negative, and an unparseable date reads as null (neutral).
  function compAgeYears(c, asOf) {
    const d = dealDateMs(c && c.date);
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
  //   distance     free pass out to the search radius (10 miles for CRE,
  //                1 for Residential), then a half-life (4 miles for
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

  // How far a comp may sit before distance starts costing it weight, when the
  // caller names no radius. ⚠ MIRRORS blend-corpus.js radiusMilesFor, which is
  // the module that already decides what "in this market" means: RADIUS_MILES
  // 10 for CRE, RESIDENTIAL_RADIUS_MILES 1 for houses. That file's own header
  // says the blend radius and this free pass must agree; they did not. This
  // fell back to a bare 1 mile for every type, so a warehouse comp 13 miles
  // out — an ordinary distance in a secondary market, and one the corpus blend
  // was already treating as in-market — took 0.5^((13-1)/4) = 0.125 and floored
  // to Weak. Whole comp tables read Weak under a confident range because of it.
  // Houses are unchanged at 1: they trade by neighborhood, and the search
  // prompt asks for a mile.
  function defaultFreePassMiles(propType) {
    return propType === "Residential" ? 1 : 10;
  }

  // "2.5 miles", "within 2.5 mi", "2.5 mile radius". Null when the note does
  // not name a distance: the type default above stands. Capped at 50 so a
  // stray "1000 miles" cannot become the blend radius.
  function parseRadiusMiles(note) {
    if (note == null || note === "") return null;
    const m = String(note).match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
    if (!m) return null;
    const n = Number(m[1]);
    return n > 0 && n <= 50 ? n : null;
  }

  // A stated radius is only a CLAIM. The report prints it above the comp
  // table ("Search radius: Immediate submarket, ~5 miles") and then prints
  // the measured spread two lines below it ("Located comps sit 13 mi to
  // 20 mi from your property"), and nothing ever reconciled the two — the
  // first comes from the search model, the second from real geocodes. A
  // reader met both and had no way to know which to believe.
  //
  // Measurement wins. This says whether the claim survives contact with it,
  // so the caller can drop a sentence rather than print a contradiction.
  //
  // The 25% slack is the same "close enough not to be worth flagging" bar
  // outlierOf and askFit already use, and it matters here because a radius
  // is approximate by nature: a model that says "about 5 miles" and returns
  // a comp at 5.8 was describing the search honestly, and blanking its line
  // would cost the reader real context ("Immediate submarket") to fix
  // nothing. A comp at 13 against a claimed 5 is a different statement.
  //
  // Returns false whenever there is nothing to compare — no claim, no
  // parseable mileage in the claim (it is free-form model prose), or no
  // measured distance. Missing data is never treated as a contradiction,
  // the same rule compWeight follows.
  var RADIUS_CLAIM_SLACK = 1.25;
  function radiusClaimContradicted(radiusText, farthestMiles) {
    const claimed = parseRadiusMiles(radiusText);
    if (claimed == null) return false;
    const far = Number(farthestMiles);
    if (!isFinite(far) || far <= 0) return false;
    return far > claimed * RADIUS_CLAIM_SLACK;
  }

  // A house more than 1.5× the subject's implied $/SF is a different
  // pocket, even at 0.3 miles. Same 1.5× bar blend-corpus.js uses on
  // extras (RESIDENTIAL_PRICE_TIER_RATIO). Past it, the weight floors so
  // 15 cheaper sales cannot outvote 4 true comps in the IQR. Missing
  // subject $/SF is neutral — we do not invent a tier.
  var PRICE_TIER_RATIO = 1.5;
  function priceTierFactor(compPsf, subjectPsf) {
    if (!(compPsf > 0) || !(subjectPsf > 0)) return 1;
    const octaves = Math.abs(Math.log2(compPsf / subjectPsf));
    if (octaves <= Math.log2(PRICE_TIER_RATIO)) return 1;
    return 0.15;
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
    const freePass = Number(o.radiusMiles) > 0 ? Number(o.radiusMiles) : defaultFreePassMiles(propType);
    if (mi !== null && mi > freePass) w *= Math.pow(0.5, (mi - freePass) / halfLife);
    if (propType === "Residential") w *= priceTierFactor(salePsfOf(c), o.subjectPsf);
    const tier = tierOf(c);
    if (tier && TIER_WEIGHT[tier] != null) w *= TIER_WEIGHT[tier];
    return Math.max(0.15, w);
  }

  // Index an older comp's price to the report date at the market's annual
  // trend, compounded over the comp's age and capped at three years so an
  // out-of-window straggler is never extrapolated into fiction. `trendPct` is
  // the model's market-level figure (server-bounded to +/-30%/yr, null when
  // its searches showed no clear trend).
  //
  // An on-market listing is never indexed. Its price is what the seller is
  // asking TODAY, not a price struck on the day it was posted, so compounding
  // it forward from "Listed Mar 2025" raised an ask that has sat unsold for a
  // year in a rising market, which is the opposite of what a year unsold
  // says about it. Its recency weight still fades from the listed date: a
  // stale ask is weaker evidence, and that half was already right.
  function trendFactor(c, asOf, trendPct) {
    const pct = Number(trendPct);
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 30) return 1;
    if (isOnMarket(c)) return 1;
    const age = compAgeYears(c, asOf);
    if (!age) return 1;
    return Math.pow(1 + pct / 100, Math.min(age, 3));
  }

  // ---------------------------------------------------------------------------
  // The adjustment grid: what a comp's $/SF would be at the SUBJECT's size and
  // age (2026-11-10).
  //
  // compWeight above decides how much a comp counts. Until this existed it was
  // the only thing size and vintage could do: a warehouse four times the
  // subject's size counted half as much, and then voted with its own
  // unadjusted $/SF. But big buildings trade at lower $/SF and old ones at
  // lower $/SF than new, so a comp set that leans larger or older than the
  // subject pulled the whole range down no matter how it was weighted, and
  // one that leans smaller or newer pulled it up. An appraiser adjusts each
  // comp toward the subject before reconciling; this is that step.
  //
  // MEASURED, not assumed (scripts/accuracy-bench.js, the hold-one-out over
  // market-seed.json's sale comps; run it to reproduce). Within a market,
  // $/SF fell about 0.18% for each 1% of extra building size and rose about
  // 1.2% for each year newer, both far outside noise (t = -4.9 and 6.2 on
  // 217 comps). Applying the two round, deliberately smaller figures below
  // cut the benchmark's median error from 34.8% to 29.5% and its mean log
  // error by 7.9% (95% interval 1.3% to 14.6%, resampling whole markets),
  // and improved every one of the four types measured. Fitting the
  // coefficients on every market except the one being scored gave the same
  // gain when this was built, so it is not the benchmark memorising itself.
  // Those absolute errors are a citywide comp set's, far wider than a
  // report's; the change is the finding (the script's header says why).
  //
  // Four rules:
  //   * Only the types measured. Industrial, Office, Retail and Multifamily
  //     are the whole benchmark. Residential and Land are untouched: there is
  //     no evidence here for either, a house's $/SF falls with size far
  //     faster than a warehouse's, and land has no year built at all. An
  //     omitted property type is untouched too, so a caller that names none
  //     keeps the pre-adjustment figures exactly.
  //   * Only the $/SF basis. A caller that reads its own value (per unit,
  //     per acre) gets the trend index and nothing else; a size elasticity
  //     measured on $/SF says nothing about $/unit.
  //   * Each adjustment is capped at a quarter (0.25 in log terms, about
  //     +28% / -22%). Past that the comp is a different product, the weight
  //     is already fading it out, and the cap is what keeps one extreme
  //     mismatch from being extrapolated into a confident figure.
  //   * Missing data is neutral, as everywhere in this module: no subject
  //     size, no comp size, no subject year or no comp year means no
  //     adjustment for that factor, never a guess.
  //
  // The weights are deliberately unchanged. An adjusted far-off comp is still
  // a worse comp than a close one (measured while this was built: with the
  // adjustments on and the weights off the benchmark scored about 10%
  // worse), so the two work together.
  // ---------------------------------------------------------------------------
  var ADJUSTED_TYPES = { Industrial: true, Office: true, Retail: true, Multifamily: true };
  var SIZE_ELASTICITY = -0.15;        // d ln($/SF) / d ln(building SF)
  var VINTAGE_LOG_PER_YEAR = 0.01;    // d ln($/SF) per year newer
  var ADJUSTMENT_CAP = 0.25;          // per factor, in log terms

  function clampAdjustment(a) {
    return Math.max(-ADJUSTMENT_CAP, Math.min(ADJUSTMENT_CAP, a));
  }
  // Own-property lookup, for rankOf's reason below: ADJUSTED_TYPES["toString"]
  // is a function on a plain object literal, and a function is truthy.
  function isAdjustedType(propType) {
    return Object.prototype.hasOwnProperty.call(ADJUSTED_TYPES, propType) && ADJUSTED_TYPES[propType] === true;
  }

  // The factor that restates a comp's $/SF at the subject's size. A comp
  // LARGER than the subject is raised (it sold at a big-building discount the
  // subject would not get); a smaller one is lowered.
  function sizeAdjustment(c, subjSF, propType) {
    if (!isAdjustedType(propType)) return 1;
    const compSF = numericValue(c && c.size_sqft);
    if (!(subjSF > 0) || !(compSF > 0)) return 1;
    return Math.exp(clampAdjustment(SIZE_ELASTICITY * Math.log(subjSF / compSF)));
  }

  // The factor that restates a comp's $/SF at the subject's age. A comp OLDER
  // than the subject is raised; a newer one is lowered.
  function vintageAdjustment(c, subjYear, propType) {
    if (!isAdjustedType(propType)) return 1;
    const ySub = yearOf(subjYear), yComp = yearOf(c && c.year_built);
    if (ySub == null || yComp == null) return 1;
    return Math.exp(clampAdjustment(VINTAGE_LOG_PER_YEAR * (ySub - yComp)));
  }

  // Every factor the valuation multiplies a comp's reported $/SF by, in one
  // place. valueFromComps reads `total`; index.html's "adj" mark reads the
  // parts, so the figure a reader is told a comp "counts as" is by
  // construction the figure the range was computed from.
  // opts: { asOf, trendPct, subjectSF (one number), subjectYear, propertyType,
  //         perSF (false switches size and vintage off; see the rules above) }
  function compAdjustment(c, opts) {
    const o = opts || {};
    const trend = trendFactor(c, o.asOf, o.trendPct);
    const onBasis = o.perSF !== false;
    const size = onBasis ? sizeAdjustment(c, Number(o.subjectSF) || 0, o.propertyType) : 1;
    const vintage = onBasis ? vintageAdjustment(c, o.subjectYear, o.propertyType) : 1;
    return { trend: trend, size: size, vintage: vintage, total: trend * size * vintage };
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
    const perSF = typeof o.readValue !== "function";
    const readValue = perSF ? salePsfOf : o.readValue;
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

    // Each comp is restated at the report date and (on the $/SF basis, for
    // the types compAdjustment covers) at the subject's size and age, THEN
    // weighted. `perSF` is false for a caller that reads its own value.
    const rr = robustPpsfRange(items.map((x) => ({
      v: x.v * compAdjustment(x.comp, {
        asOf: o.asOf, trendPct: o.trendPct, subjectSF: sizeMid,
        subjectYear: o.subjectYear, propertyType: o.propertyType, perSF: perSF,
      }).total,
      w: compWeight(x.comp, o.asOf, sizeMid, o.subjectYear, {
        propertyType: o.propertyType,
        radiusMiles: o.radiusMiles,
        subjectPsf: o.subjectPsf,
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

  // The residual spread: what the comps still disagree about AFTER every
  // factor this report can control for.
  //
  // compWeight discounts a comp for sale recency, size ratio, vintage,
  // distance, price tier and source quality. Whatever spread survives all six
  // is, by construction, driven by what no public record carries: condition,
  // finish quality, layout, how the last owner kept the place. On a house that
  // is the single largest unmodeled variance in the estimate, and no report
  // said so until 2026-08-16 — a gut-renovated home and an untouched one on
  // the same street, same size, same vintage, priced identically to the dollar.
  //
  // Deliberately derived from THIS report's own band rather than a published
  // industry constant. In a single-builder subdivision the band comes in tight
  // and condition really does matter less; in a mixed-vintage neighborhood it
  // comes in wide. A hardcoded "10-20%" would be wrong in both directions, and
  // would be the one figure in the hero with no source standing behind it.
  //
  // Requires `trimmed` (4+ sale comps). Below that the band is the raw observed
  // spread rather than an interquartile one, so it measures how scattered a
  // tiny sample is, not what this market pays for condition — index.html's
  // smallNNote already covers that case in its own words.
  //
  // `pct` uses the same (high - low) / mid ratio index.html's spreadPhrase
  // reads, so "spread" means one thing across the hero.
  //
  // `swing` is quoted at ONE size, the caller's mid, and NOT as the ledger's
  // Low-to-High distance: those two totals apply psfLow to the smallest size
  // and psfHigh to the largest, so their difference folds size uncertainty
  // into a figure whose whole job is to isolate the $/SF spread.
  function conditionSpread(band, subjectSF) {
    if (!band || band.trimmed !== true) return null;
    var low = Number(band.low), high = Number(band.high), mid = Number(band.mid);
    if (!(low > 0) || !(high > low) || !(mid > 0)) return null;
    var out = { psfLow: low, psfHigh: high, pct: Math.round(((high - low) / mid) * 100) };
    var sf = Number(subjectSF);
    if (sf > 0) out.swing = heroRound((high - low) * sf);
    return out;
  }

  // How much of a property's gain since its own last sale the market's drift
  // does NOT explain.
  //
  // Compound the prior sale price forward at the market's annual trend to the
  // report date, then compare against what the property asks today. The
  // remainder is the part of the gain the market did not hand over, and on a
  // house the usual explanation is that money went into it. That makes this
  // the closest this product can honestly get to "how much was spent on the
  // renovation" without permit data — and permit data would not settle it
  // either: declared permit valuations understate real spend, unpermitted and
  // cosmetic work never appears at all, and spend is not value in any case.
  //
  // Evidence, never a fourth ledger figure — the same rule subject_last_sale
  // and subject_asking already follow. It does not enter the range.
  //
  // Four deliberate refusals:
  //   * No trend, no answer. report-parse.js already normalizes
  //     annual_price_trend_pct to null unless it is a nonzero number within
  //     +/-30, and without it there is no drift model at all. Reading a missing
  //     trend as flat would report every appreciating market as a renovation.
  //   * Only the ABOVE direction speaks. A property asking LESS than drift
  //     explains is a real signal with unknowable causes (a distressed sale, a
  //     divorce, deferred maintenance, an overpriced original purchase), and
  //     naming any of them about somebody's specific home is not a claim this
  //     report can defend.
  //   * Bounded to 10 years back. One current annual rate compounded across a
  //     decade is already a stretch; across thirty it is fiction. The floor
  //     keeps a same-quarter relist from dividing by noise while still
  //     catching the classic buy-renovate-list flip.
  //   * Below the shared 25% bar it stays quiet, so this can never disagree
  //     with askFit or outlierOf about what counts as a gap worth naming.
  //
  // The three reported figures are derived from the ROUNDED expected value so
  // they reconcile against each other on screen (expected + unexplained is
  // exactly the ask, always). The 25% gate above deliberately tests the
  // unrounded math instead, so display rounding can never decide whether the
  // line appears.

  // Month names are spelled out rather than matched as "3-9 letters" so that
  // "Sometime 2021" cannot pass for a date the way a generic word class would
  // let it.
  var MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  var SALE_DATE_SHAPES = [
    /^(?:18|19|20)\d{2}[-/](?:0?[1-9]|1[0-2])(?:[-/](?:0?[1-9]|[12]\d|3[01]))?$/,   // 2021-06-01, 2021-06
    // "6/2021" matches this shape but Date.parse answers NaN for it, so it is
    // refused a line later. Left in rather than tightened: the shape list is
    // the readable statement of intent, and the parse is the backstop.
    /^(?:0?[1-9]|1[0-2])\/(?:(?:0?[1-9]|[12]\d|3[01])\/)?(?:18|19|20)\d{2}$/,       // 6/1/2021
    new RegExp("^" + MONTH + "\\s+(?:\\d{1,2},?\\s+)?(?:18|19|20)\\d{2}$", "i"),    // June 2021, Jun 1, 2021
    new RegExp("^\\d{1,2}\\s+" + MONTH + "\\s+(?:18|19|20)\\d{2}$", "i"),           // 1 June 2021
  ];
  var GAIN_MIN_YEARS = 0.25;
  var GAIN_MAX_YEARS = 10;
  function unexplainedGain(opts) {
    var o = opts || {};
    var paid = Number(o.lastPrice), ask = Number(o.askPrice), pct = Number(o.trendPct);
    if (!(paid > 0) || !(ask > 0)) return null;
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 30) return null;
    // subject_last_sale.date is model-written free text, and Date.parse alone
    // is far too lenient to guard a dollar figure: V8 answers
    // "sometime in 2021" with 2021-01-01 rather than NaN, silently anchoring
    // the whole calculation to a January that nothing in the report claims.
    // So the string must match a real date SHAPE first — same reject-rather-
    // than-guess stance yearOf takes with "c. 1994". A bare year is refused
    // too: it is the ambiguous case, not a lucky one.
    //
    // Month-level slack past that is tolerable. Half a year of drift moves
    // `expected` by a few percent against a 25% gate, and the last-sale line
    // above prints the raw date text, so the reader sees the precision they
    // are actually being given.
    var raw = String(o.lastDate == null ? "" : o.lastDate).trim();
    if (!SALE_DATE_SHAPES.some(function (re) { return re.test(raw); })) return null;
    var then = Date.parse(raw);
    if (isNaN(then)) return null;
    var years = (Number(o.asOf) - then) / (365.25 * 24 * 3600 * 1000);
    if (!(years >= GAIN_MIN_YEARS) || years > GAIN_MAX_YEARS) return null;
    var expected = paid * Math.pow(1 + pct / 100, years);
    if (!(expected > 0) || !((ask - expected) / expected > OUTLIER_PCT)) return null;
    var expectedR = heroRound(expected);
    if (!(expectedR > 0)) return null;
    return {
      years: Math.round(years * 10) / 10,
      expected: expectedR,
      unexplained: ask - expectedR,
      pct: Math.round(((ask - expectedR) / expectedR) * 100),
    };
  }

  // Where the subject sits in the condition spread the comps show — the payoff
  // for asking the question at all.
  //
  // conditionSpread above says a house's condition is worth $X of the range and
  // that the estimate cannot see it. Once the OWNER has told us their own
  // condition, and enough comps carry one, the report can say which half of
  // that range is the fairer read for this particular house. That is guidance
  // about where to look inside the existing band, not a fourth figure and not a
  // change to Low/Likely/High — the same standing askFit and subjectSizeFit
  // have.
  //
  // The vocabulary is report-parse.js's CONDITION_VALUES and the ranks are its
  // order. Keep the two in step; a word here that the parser drops to "" would
  // be a rank nothing can ever reach.
  //
  // Two deliberate silences:
  //   * Under three RATED comps it returns null. "Most of the comps" is not a
  //     claim two houses can support, and it is the same floor subjectSizeFit
  //     uses for the same reason.
  //   * A subject that sits among its comps returns dir "inline", and the
  //     caller is expected to say NOTHING. The trust line measured 1,034
  //     characters on 2026-08-16 precisely because every computable sentence
  //     got printed; a sentence that reports no difference is one to leave out.
  var CONDITION_RANK = { "Needs work": 0, "Original": 1, "Updated": 2, "Renovated": 3 };
  var CONDITION_FIT_MIN_COMPS = 3;
  var CONDITION_FIT_SHARE = 2 / 3;
  // Own-property lookup, NOT CONDITION_RANK[v]. A plain object literal inherits
  // from Object.prototype, so CONDITION_RANK["toString"] is a FUNCTION, not
  // undefined — and a function passes an `== null` guard. Before this,
  // conditionFit("constructor", …) returned dir "below" and the trust line
  // would have stated, confidently, that three comps were more updated than a
  // house whose condition was the word "constructor". The server gates both
  // sides onto the vocabulary (normalizeConditions, SUBJECT_FIELD_ENUMS), but
  // this module is shared with backtest.js and reads saved and shared reports
  // written before that gate existed, so it defends itself.
  function rankOf(v) {
    return Object.prototype.hasOwnProperty.call(CONDITION_RANK, v) ? CONDITION_RANK[v] : null;
  }
  function conditionFit(subjectCondition, comps) {
    var subj = rankOf(subjectCondition);
    if (subj == null) return null;
    var ranks = (comps || [])
      .filter(function (c) { return c && !String(c.transaction || "").toLowerCase().startsWith("lease"); })
      .map(function (c) { return rankOf(c && c.condition); })
      .filter(function (r) { return r != null; });
    if (ranks.length < CONDITION_FIT_MIN_COMPS) return null;
    var below = ranks.filter(function (r) { return r < subj; }).length;
    var above = ranks.filter(function (r) { return r > subj; }).length;
    var out = { subject: subjectCondition, rated: ranks.length, below: below, above: above, dir: "inline" };
    if (below >= ranks.length * CONDITION_FIT_SHARE) out.dir = "above";
    else if (above >= ranks.length * CONDITION_FIT_SHARE) out.dir = "below";
    return out;
  }

  return {
    numericValue, salePsfOf, robustPpsfRange, heroRound,
    TIER_WEIGHT, tierOf, isOnMarket, dealDateMs, compAgeYears, yearOf, distanceMiles, distanceHalfLifeMiles,
    sizeAdjustment, vintageAdjustment, compAdjustment,
    ADJUSTED_TYPES, SIZE_ELASTICITY, VINTAGE_LOG_PER_YEAR, ADJUSTMENT_CAP,
    defaultFreePassMiles,
    parseRadiusMiles, radiusClaimContradicted, RADIUS_CLAIM_SLACK,
    priceTierFactor, PRICE_TIER_RATIO,
    compWeight, trendFactor,
    valueFromComps, outlierOf, OUTLIER_PCT, subjectSizeFit, askFit,
    conditionSpread, unexplainedGain, conditionFit, CONDITION_RANK,
  };
});

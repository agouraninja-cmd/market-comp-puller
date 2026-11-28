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
  // the literal min and max. With 4+ comps this instead takes a trimmed band
  // around the median, the weighted 15th to 85th percentile (the middle 70%),
  // so outliers can't dominate the headline; below that there is nothing to
  // trust as an outlier, so the full observed spread stands instead, and
  // `trimmed` says which case fired.
  //
  // WHY 15-85 AND NOT THE QUARTILES. Until 2026-11-16 this was the
  // interquartile band (25th-75th), which holds the middle half of the comps
  // by construction, and so held the answer about half the time: over 242
  // held-out sales (scripts/accuracy-lab.js) the real figure landed between
  // Low and High 48% of the time. A reader takes "Low" and "High" for bounds,
  // and a bound that fails every other time is not one. 15-85 catches 62% at
  // a median width of 45% of Likely against 31% (houses 64%; commercial 54%,
  // where the comps simply disagree more). 10-90 catches 70% at 57%, most of
  // the way back to the raw min and max this function exists to avoid. The
  // owner's call, made with those figures in hand. Likely is the median
  // either way and did not move.
  //
  // With only four to six comps the 15th and 85th sit close to the cheapest
  // and dearest of them: that is the honest reading of so few, and
  // `trimmed` still says an outlier trim was applied.
  //
  // Accepts plain numbers (each weighs 1) or {v, w} items: the percentiles
  // are weighted, so a stale, off-size, or weakly-sourced comp pulls the band
  // less than a fresh well-documented one (see compWeight). Each item sits at
  // the center of its weight span on the cumulative scale, with linear
  // interpolation between neighbors, so equal weights reproduce the familiar
  // evenly-spaced percentile positions.
  var BAND_LOW_PCT = 0.15, BAND_HIGH_PCT = 0.85;
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
    if (n >= 4) return { low: q(BAND_LOW_PCT), mid: q(0.5), high: q(BAND_HIGH_PCT), trimmed: true };
    return { low: items[0].v, mid: q(0.5), high: items[n - 1].v, trimmed: false };
  }

  // Display rounding for TOTAL dollar figures. "$926,987" projects a precision
  // the math does not have: it is an interpolated percentile of a handful of
  // comps times a size range.
  function heroStep(v) {
    const a = Math.abs(v);
    return a >= 10e6 ? 100000 : a >= 1e6 ? 25000 : a >= 100000 ? 5000 : 1000;
  }
  function heroRound(v) {
    if (!isFinite(v) || v === 0) return v;
    const step = heroStep(v);
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

  // When a comp's date text falls, as epoch ms, or NaN when it names no date.
  //
  // Comp dates are model-written: the prompt asks for "Mar 2025", and
  // "Q3 2025", "2025" and "03/2025" arrive as well. Until 2026-11-10 this was
  // a bare Date.parse, which for anything but an ISO string is the engine's
  // own guess: V8 answers NaN for "Q3 2024", so that comp read as undated and
  // weighed 1.0 where the same quarter written "Aug 2024" weighed 0.45, with
  // no trend indexing, and another browser need not agree with V8 about
  // "Mar 2025" either. So the shapes deal-date.js accepts are read here by
  // rule, each to the instant V8 already gave the ones it could read (the 1st
  // of the month in local time, ISO forms in UTC), which is why no existing
  // weight moved. A quarter is its middle month. Everything else still goes
  // to Date.parse.
  // ⚠ MIRRORED in comp-gate.js compDateMs, body for body;
  // test/comp-gate.test.js compares the two.
  function compDateMs(text) {
    const t = String(text == null ? "" : text).trim().toLowerCase();
    let m;
    if ((m = t.match(/^((?:19|20)\d{2})(?:-(\d{2})(?:-(\d{2}))?)?$/))) {
      const mo = m[2] ? Number(m[2]) : 1, day = m[3] ? Number(m[3]) : 1;
      const ms = Date.UTC(Number(m[1]), mo - 1, day);
      if (mo >= 1 && mo <= 12 && day >= 1 && new Date(ms).getUTCMonth() === mo - 1) return ms;
    }
    if ((m = t.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+((?:19|20)\d{2})$/))) {
      const mo = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }[m[1].slice(0, 3)];
      return new Date(Number(m[2]), mo, 1).getTime();
    }
    if ((m = t.match(/^q([1-4])\s*((?:19|20)\d{2})$/))) {
      return new Date(Number(m[2]), Number(m[1]) * 3 - 2, 1).getTime();
    }
    if ((m = t.match(/^(\d{1,2})\/((?:19|20)\d{2})$/)) && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
      return new Date(Number(m[2]), Number(m[1]) - 1, 1).getTime();
    }
    // A comp on the market: "Active" names no date, and "Listed Mar 2025" is
    // the month it was listed, read by the rules above. V8 read the second
    // that way only by guessing past the word, which no other engine is
    // bound to do: a comp one browser ages, another may weigh as undated.
    if (/^active\b/.test(t)) return NaN;
    if ((m = t.match(/^listed\s+(\S.*)$/))) return compDateMs(m[1]);
    return Date.parse(text);
  }

  // An ASKING price, not a sale. The search prompt's own convention, which
  // deal-date.js refuses on purpose so no aggregate over the corpus mistakes
  // one for a closed deal (corpus.md): a comp that is on the market is dated
  // "Active", or "Listed Mar 2025" when its page shows a post date.
  function isOnMarket(c) {
    return /^\s*(?:active|listed)\b/i.test(String(c == null || c.date == null ? "" : c.date));
  }

  // Age in years at `asOf`, capped at five. A future-dated comp reads as 0
  // rather than negative, and an unparseable date reads as null (neutral).
  function compAgeYears(c, asOf) {
    const d = compDateMs(c.date);
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
  //   construction x0.6 when the comp is built differently from the subject
  //                (opts.subjectConstruction; tilt-up vs metal building)
  //   distance     free pass out to the search radius (10 miles for CRE,
  //                1 for Residential), then a half-life (4 miles for
  //                CRE, 2 miles for Residential — a sale five miles away is
  //                a different pocket; the 4-mile CRE half-life still let
  //                cheaper houses a few miles over pull a $2M home to $1M)
  //   source       verified/public-record full weight, down to half for model
  //                estimates (mirrors the badge tiers)
  // Floored at 0.15 so no comp silently vanishes from a range it visibly sits
  // in. Missing data is neutral, never a penalty. `subjYear` is optional so
  // callers that have no year (a report whose lookup found none, a corpus row
  // without one in the accuracy backtest) keep the pre-vintage weights exactly. Missing distance is
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
  // A leading-dot decimal and a fraction are read as written: until
  // 2026-11-10 ".5 miles" was 5 and "1/2 mile" was 2, so a half-mile house
  // search treated a comp five miles out as in the neighborhood. The number
  // may not follow a digit, a dot or a slash, which is what stops it being
  // the tail of one. No lookbehind: this file runs in Safari.
  // ⚠ MIRRORED in blend-corpus.js parseRadiusMiles, body for body;
  // test/blend-corpus.test.js compares the two.
  function parseRadiusMiles(note) {
    if (note == null || note === "") return null;
    const m = String(note).match(
      /(?:^|[^\d.\/])(?:(?:(\d+)[\s-]+)?(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d+)?|\.\d+))\s*(?:miles?|mi)\b/i);
    if (!m) return null;
    const n = m[4] != null ? Number(m[4]) : Number(m[1] || 0) + Number(m[2]) / Number(m[3]);
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

  // How a building is built (2026-11-19): "Tilt-up concrete", "Metal
  // building", ... — the closed vocabulary report-parse.js normalizes onto.
  // Compared case-insensitively; anything empty is unknown and neutral.
  // A comp built differently from the subject counts at CONSTRUCTION_MISMATCH:
  // a real but partial penalty, smaller than a vintage gap of a generation,
  // because the model reads construction off fewer pages than year built and
  // a wrong word should cost a comp some weight, never its place in the range.
  var CONSTRUCTION_MISMATCH = 0.6;
  function constructionOf(v) {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    return s || null;
  }
  function constructionMismatch(c, subjConstruction) {
    const a = constructionOf(subjConstruction), b = constructionOf(c && c.construction);
    return a != null && b != null && a !== b;
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
    if (constructionMismatch(c, o.subjectConstruction)) w *= CONSTRUCTION_MISMATCH;
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
  // Never an asking price (2026-11-27). The index answers "what would this
  // PAST price be today"; a listing that is still on the market at its ask is
  // already today's price, whenever it was first posted. Indexing it from its
  // list date moved it the wrong way: in a market rising 6% a year a
  // warehouse listed 18 months ago and still unsold counted 9% ABOVE its own
  // asking price, when sitting that long says the ask was high to begin with.
  // Its list date still ages its WEIGHT (compWeight), which is the right half:
  // a stale ask is weaker evidence, not a cheaper building.
  function trendFactor(c, asOf, trendPct) {
    const pct = Number(trendPct);
    if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 30) return 1;
    if (isOnMarket(c)) return 1;
    const age = compAgeYears(c, asOf);
    if (!age) return 1;
    return Math.pow(1 + pct / 100, Math.min(age, 3));
  }

  // Restate a comp's $/SF at the SUBJECT's size.
  //
  // Big buildings trade for less per square foot than small ones, and
  // compWeight only ever answered that by making an off-size comp count LESS.
  // It still counted at its own $/SF. So a 78,000 SF warehouse valued from a
  // 32,000, a 19,000 and a 2,000 SF building was quoted at their $159-$481/SF
  // when its own price was $101, and inside the 0.5x-2x free pass a comp twice the
  // subject's size was read as an exact match while understating it by about
  // 13%. This is the adjustment an appraiser's grid makes on its size line:
  // the comp's figure is moved to what a building of the subject's size would
  // have fetched, and THEN weighted.
  //
  // $/SF is taken to scale as size^elasticity, so the factor is
  // (subject / comp)^elasticity: at -0.2 a comp twice the subject's size
  // counts about 15% higher, one half its size about 13% lower. The ratio is
  // capped at 8x either way (a factor of 0.66 to 1.52), so a size from the
  // wrong building cannot become a price.
  //
  // MEASURED, not chosen by feel (scripts/accuracy-lab.js over the 678-row
  // corpus, 2026-11-15; hold-one-out, 48 Industrial, Office and Retail sales
  // in 13 markets): median miss 34.1% -> 25.6%, within 20% of the held-out
  // price 27% -> 40% of the time, better on 69% of them, in a range that got
  // NARROWER (62% -> 48% of the likely figure) while catching that price
  // more often (42% -> 48%). The held-out prices include asking prices (see
  // corpus.md on the answer key), so this ranks before against after; it is
  // not a distance from closed sales. The interval from resampling whole markets stays
  // below zero (-14.9 to -0.5 points). Office alone 30.1% -> 22.9%,
  // Industrial 40.2% -> 27.9%. -0.2 sits in the flat part of the curve: -0.15
  // to -0.3 score within a point or two of it, and the slope fitted to each
  // comp set on its own did no better than this one fixed figure.
  //
  // Commercial buildings only, and that is the data's call as well. On 189
  // HOUSES the same restatement moved the median by a point and the mean by
  // nothing, inside the noise at every strength: a bigger house on the same
  // street is usually a better house too, which the size curve cannot see.
  // Multifamily and Land are quoted per unit and per acre (a custom
  // `readValue`, which this never touches) and had too few $/SF sales to
  // measure, so they stay as they were until the corpus can say otherwise.
  // Add a type here only with a lab run that clears the noise.
  var SIZE_ELASTICITY = { Industrial: -0.2, Office: -0.2, Retail: -0.2 };
  var SIZE_RESTATE_MAX_RATIO = 8;
  function sizeRestateFactor(compSF, subjectSF, propType) {
    if (!Object.prototype.hasOwnProperty.call(SIZE_ELASTICITY, propType)) return 1;
    var c = Number(compSF), s = Number(subjectSF);
    if (!(c > 0) || !(s > 0)) return 1;
    var ratio = Math.min(SIZE_RESTATE_MAX_RATIO, Math.max(1 / SIZE_RESTATE_MAX_RATIO, s / c));
    return Math.pow(ratio, SIZE_ELASTICITY[propType]);
  }

  // The whole sequence, in one place: filter to sales, read each comp's value,
  // index it to the report date, restate it at the subject's size, weight it,
  // take the band, and apply the subject's size. index.html wrote this out three times and the harness in
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
    // The size curve is a statement about $/SF. A per-unit or per-acre basis
    // (a custom readValue) has its own, unmeasured one and is left alone.
    const perSF = readValue === salePsfOf;
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

    let sizeRestated = 0;
    const rr = robustPpsfRange(items.map((x) => {
      const sizeF = perSF ? sizeRestateFactor(numericValue(x.comp.size_sqft), sizeMid, o.propertyType) : 1;
      if (sizeF !== 1) sizeRestated += 1;
      return {
        v: x.v * trendFactor(x.comp, o.asOf, o.trendPct) * sizeF,
        w: compWeight(x.comp, o.asOf, sizeMid, o.subjectYear, {
          propertyType: o.propertyType,
          radiusMiles: o.radiusMiles,
          subjectPsf: o.subjectPsf,
          subjectConstruction: o.subjectConstruction,
        }),
      };
    }));

    return {
      psfLow: rr.low, psfMid: rr.mid, psfHigh: rr.high,
      low: heroRound(rr.low * sizeMin),
      mid: heroRound(rr.mid * sizeMid),
      high: heroRound(rr.high * sizeMax),
      n: items.length,
      trimmed: rr.trimmed,
      raw: items.map((x) => x.v),
      // How many comps counted at a restated $/SF, so a caller can say so.
      sizeRestated,
    };
  }

  // The $/SF one sale comp COUNTS as: its reported figure, indexed to the
  // report date and restated at the subject's size. The table shows the raw
  // figure so the audit trail never moves; this is the one the band is taken
  // over, for the "adj" mark that discloses the difference and for anything
  // that compares a comp against the band. Same two factors, in the same
  // order, as valueFromComps: this must stay a reading of it, never a second
  // opinion.
  function countedPsf(comp, opts) {
    const o = opts || {};
    const raw = salePsfOf(comp || {});
    if (!(raw > 0)) return null;
    const sf = o.subjectSF;
    const isRange = sf && typeof sf === "object";
    const sizeMid = ((Number(isRange ? sf.min : sf) || 0) + (Number(isRange ? sf.max : sf) || 0)) / 2;
    const trend = trendFactor(comp, o.asOf, o.trendPct);
    const size = sizeRestateFactor(numericValue(comp.size_sqft), sizeMid, o.propertyType);
    return { raw, value: raw * trend * size, trend, size };
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
  // This function never changes the range: a list price is not a fourth
  // valuation figure. It says when the comps and the listing disagree enough
  // that the reader should look at Year Built before trusting the headline.
  // (Until 2026-11-27 the same was true of the subject's last sale. A vetted
  // one is weighed into the range now, "The building's own sale" below, and
  // that rule is the one place a found listing can move a figure: an ask far
  // from the sale halves the sale's weight, and an ask equal to it refuses
  // it.)
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
  // spread rather than the trimmed middle 70%, so it measures how scattered a
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

  // -------------------------------------------------------------------------
  // Net lease (2026-11-23). A single-tenant net-leased property is priced on
  // its lease: net rent over a cap rate, the rate set by the tenant's credit
  // and the years left. Its building's $/SF says almost nothing. The first
  // report run on one (a 3,600 SF auto shop on a 15-year absolute NNN lease,
  // listed near $2.6M on a 7% cap) was valued near $800,000 off the $/SF of
  // small industrial sales.
  //
  // ONE definition of "this subject is net leased", read by the browser (the
  // hero), by server.js (the prompt) and by comp-fit.js's caller, so the three
  // cannot disagree about which reports are in the mode. Retail only for now:
  // "Single-tenant NNN" is a Retail center type the form already offers, so
  // the mode needs no new field, no column and no migration.
  var NET_LEASE_TYPES = ["Retail"];
  var NET_LEASE_CENTER_TYPE = "Single-tenant NNN";
  function isNetLease(type, details) {
    if (NET_LEASE_TYPES.indexOf(String(type || "")) < 0) return false;
    var ct = String((details && details.center_type) || "").trim().toLowerCase();
    return ct === NET_LEASE_CENTER_TYPE.toLowerCase();
  }

  // A SALE comp's cap rate as a percent (6.5, not 0.065), or NaN. Refuses
  // rather than guesses, the displayMoney rule: a decimal fraction ("0.065"),
  // a range ("6.0-6.5%") and anything outside the plausible window are all
  // NaN, because a comp read at the wrong rate moves the value by a multiple
  // and nothing downstream could tell. Leases never carry one that prices a
  // sale.
  var CAP_RATE_MIN = 2, CAP_RATE_MAX = 20;
  function capRateOf(c) {
    if (!c || String(c.transaction || "").toLowerCase().startsWith("lease")) return NaN;
    var raw = String(c.cap_rate == null ? "" : c.cap_rate).trim();
    // Exactly one number: "6.0-6.5%" and "6% to 7%" are ranges, not a rate.
    if (!raw || (raw.match(/\d+(?:\.\d+)?/g) || []).length !== 1) return NaN;
    var v = numericValue(raw);
    return v >= CAP_RATE_MIN && v <= CAP_RATE_MAX ? v : NaN;
  }

  // The cap rates a set of comps traded at: robustPpsfRange's band (the
  // middle 70% at four or more, the full spread under that), UNWEIGHTED. The
  // $/SF weighting is not borrowed: its size and price-tier factors are about
  // buildings, its trend index is a price index, and no lab run says what
  // weights a cap rate. Every comp counts the same until one does
  // (rentFromComps' rule). null under CAP_BAND_MIN_COMPS: one or two rates is
  // not a range, and the caller falls back to the market's own.
  var CAP_BAND_MIN_COMPS = 3;
  function capRateBand(comps) {
    var rates = (comps || []).map(capRateOf).filter(function (v) { return v > 0; })
      .sort(function (a, b) { return a - b; });
    if (rates.length < CAP_BAND_MIN_COMPS) return null;
    var rr = robustPpsfRange(rates);
    return { low: rr.low, mid: rr.mid, high: rr.high, trimmed: rr.trimmed, n: rates.length, rates: rates };
  }

  // Net income over a cap-rate band. The LOWEST rate gives the HIGH value.
  // Unrounded: the caller rounds for display (heroRound). A band with no mid
  // (the market's low-high range) takes the geometric middle, which is what
  // the income-led hero has always shown as its midpoint.
  function netLeaseValue(noi, band) {
    var n = Number(noi);
    if (!(n > 0) || !band) return null;
    var lo = Number(band.low), hi = Number(band.high);
    if (!(lo > 0) || !(hi >= lo)) return null;
    var mid = Number(band.mid) > 0 ? Number(band.mid) : Math.sqrt(lo * hi);
    return { low: n / (hi / 100), likely: n / (mid / 100), high: n / (lo / 100) };
  }

  // The cap rate a price implies for an income, as a percent, or null.
  function impliedCapRate(noi, price) {
    var n = Number(noi), p = Number(price);
    if (!(n > 0) || !(p > 0)) return null;
    var pct = (n / p) * 100;
    return pct > 0 && pct < 100 ? pct : null;
  }

  // -------------------------------------------------------------------------
  // The building's own sale (2026-11-27).
  //
  // Every report looks up what the subject itself last sold for
  // (`subject_last_sale`), and until this date the value ignored it: Low,
  // Likely and High were the comps' $/SF times the size and nothing else, and
  // the building's own price was one line of "evidence" underneath.
  // scripts/truth-test.js put a number on what that cost. On 47 commercial
  // buildings that had sold, the report's Likely landed a typical 28-33% from
  // the price, because it priced each building off OTHER buildings: a $67/SF
  // office off $82-$139/SF offices, a net-leased center at $483/SF off strip
  // centers at $121-$362. More comps did not help (two whole searches of one
  // building, averaged: 24%), dropping unsold listings or duplicate rows did
  // not help, and for 16 of the 47 the true $/SF sat outside the whole range
  // of the comps, where no weighting of them can reach. An audit of each
  // building against the web gave the reason for 21 of them: the comps were
  // a different kind of building (leased against vacant, new against old).
  //
  // What a building itself recently sold for already prices in everything the
  // comps cannot see (the condition, the leases, the lot), and it is the
  // first thing an appraisal looks at: USPAP Standards Rule 1-5 has every sale
  // of the subject in the three years before the valuation analyzed. So when
  // the report holds a sale of the subject that passes the
  // checks below, the estimate LEANS on it and the comps become the check on
  // it.
  //
  //   anchor  A = the price, moved to the report date with the market's
  //             trend: the comps' own trendFactor, held to OWN_SALE_TREND_CAP
  //             a year and OWN_SALE_INDEX_CAP in all. The trend is the
  //             search's own estimate (it came back -2.5, +1.5 and +0.5 for
  //             one Anaheim office across three runs), and on a comp it moves
  //             one vote among several; here it would multiply most of the
  //             headline.
  //   weight  w = OWN_SALE_WEIGHT_NEW (0.9) through the first year, then a
  //             straight line to nothing at OWN_SALE_MAX_YEARS (three). Halved
  //             and capped at OWN_SALE_HALF for a sale with a condition
  //             attached (see "half" below).
  //   comps   held to within OWN_SALE_COMPS_PULL (1.5x) of A before they are
  //             blended: past that they are describing a different kind of
  //             building (valuation.js already calls 1.5x a different price
  //             tier), and unheld, the worst comp sets pulled hardest.
  //             In full while the sale leads (w at OWN_SALE_LEADS_AT or
  //             more); under that the hold fades with w, to none at w = 0, so
  //             a sale said to carry a tenth does not pin the headline to
  //             itself, and nothing jumps when an aging sale drops out.
  //   Likely  = w x A + (1 - w) x the comps' Likely
  //   Low/High: the same blend of the comps' Low and High with A less and
  //             plus ownSaleSpread (10% in the first year, five more points
  //             for each year after), and while the sale leads the range is
  //             widened to hold both the price paid and A, and Likely is kept
  //             inside that allowance of A: the comps are the check on the
  //             sale, and a check does not move the answer past its own
  //             margin.
  //
  // WHERE THE NUMBERS COME FROM, said plainly because the test cannot supply
  // them. The truth test's answer key IS the sale, so on it the best possible
  // rule is "print the sale price": it cannot tell 0.9 from 0.7, five years
  // from three, or an index from none. So:
  //   0.9   is arithmetic on two outside figures: comps here miss by about
  //         28%, and one arm's-length price is good to about 10% (appraisers
  //         with the leases in hand land 8-12% from the next sale), and
  //         28^2 / (28^2 + 10^2) is 0.89.
  //   three years, and the spread, are JUDGMENTS, and cautious ones. The
  //         same arithmetic would still give a three-year-old sale most of
  //         the answer; the line ends there because nothing here can see
  //         whether a building was renovated, re-leased or emptied since it
  //         sold, because no sale in the test is older than 27 months,
  //         because it is where the trend index stops compounding, and
  //         because three years is the look-back the appraisal standard
  //         names. On the one building in the test that sold twice (14 E
  //         Washington St, Orlando: $4.5M, then $5.6M 22 months later) the
  //         older sale made the estimate WORSE than the comps alone. They
  //         want a repeat-sale test (buildings that sold twice: predict the
  //         later price from the earlier one), and the corpus holds no such
  //         pairs yet. Do not widen the window or raise a weight on the
  //         strength of the truth test's own-sale score: that score is an
  //         echo.
  //
  // WHEN IT DOES NOT LEAN ON THE SALE, and says why (`refused`). Most of these
  // came out of auditing the 47 buildings against the web and out of two
  // adversarial reviews of the first draft, which leaned on 9 sales it should
  // not have:
  //   "no_price" / "no_date" / "future": nothing to hang dollars on. A date
  //                ahead of the report is a deal announced, not closed.
  //   "old"        too old to carry a tenth of the answer: the line of
  //                history it has always been.
  //   "type"       not a type the rule was measured on (OWN_SALE_TYPES).
  //   "currency"   not a US-dollar report.
  //   "unsettled"  the server has not vetted it (no `settled` stamp): every
  //                report cached, saved or shared before this rule existed.
  //                Those are valued exactly as they were.
  //   "off"        the member turned it off (the building changed since).
  //   "unusable"   the server's own finding: its source link is dead, or the
  //                page was read and says the price was not disclosed.
  //   "basis"      the search's word for the sale (ownSaleBasis) is not an
  //                ordinary sale of this whole property: a portfolio's price,
  //                part of the ownership, related parties, a distressed sale,
  //                land, a deal not closed, or no word at all. A blank is not
  //                a clean bill.
  //   "no_source"  no link to a page that could state it (specificPage), or
  //                the search called its own source an estimate.
  //   "no_address" / "other_address" / "unit": the search did not say which
  //                address the sale is recorded for, or it is another
  //                address, or one unit of the building (or the subject is).
  //   "scope"      the sale covered an area more than OWN_SALE_SCOPE_TOL away
  //                from the size this report values: two buildings' price on
  //                one building.
  //   "implausible" the price over the subject's size is outside any price a
  //                building fetches (a record printed in thousands, a
  //                whole-building price on a suite).
  //   "predates_building"  it sold before the building was built.
  //   "matches_asking"     it is the current LISTING's price, to within
  //                OWN_SALE_ASK_MATCH (half a percent, so a figure a page
  //                rounded still matches): the listing, read as a closing.
  //   "disagree"   A is more than OWN_SALE_DISAGREE times the comps' figure,
  //                or under 1/that. One of the two is describing a different
  //                thing and nothing here can say which, so the comps stand
  //                and the page says the two do not agree and what to check.
  //                With no comps' figure in dollars but priced comps in the
  //                table (opts.compPsf), the sale's $/SF is held to theirs.
  //   "unchecked"  priced comps came back, but neither the subject nor the
  //                sale has a size, so nothing can check the sale against
  //                them; it does not stand alone while they sit in the table.
  //   "alone_weak" no comps to check it against, and it is not a clean sale
  //                inside its first year: with nothing beside it, only the
  //                strongest sale may be the whole headline.
  //
  // HALF: a sale that is real evidence with a condition attached counts for
  // half as much and never for more than OWN_SALE_HALF, with the reason on
  // the page: a sale-leaseback, this building's stated share of a larger
  // deal, a price cited to a listing page (which may be the last asking
  // price), a price whose source the search did not classify (a comp's
  // unknown source is an "estimate"; this one is a page that exists, so it
  // is not refused, but it is not a record or an article either), a price in
  // a non-disclosure state that no news page reports, a sale the server read
  // off a COMP row whose notes say nothing about what kind of sale it was
  // (a comp is never asked), and a building that is LISTED today more than a
  // quarter away from A (its own two prices disagree, which is what
  // "improved since" looks like).
  //
  // THE ASKING PRICE HERE IS THE LISTING THE SEARCH FOUND, never the one a
  // member typed. A typed price is the member's question ("is $9M right?"),
  // and a question must not move the answer: typed into the form, it would
  // switch the sale off and drop the estimate by the whole gap to the comps
  // under the reader's cursor.
  //
  // What this is NOT: a measurement of how good the comps are. A sold
  // building's report now lands near its sale price because it starts from
  // that price. A building with no usable sale of its own is valued exactly
  // as before, and the truth test scores the two cases separately and never
  // as one figure.
  //
  // NOT DONE, on purpose: leaning on the building's ASKING price. Seventeen
  // of the audited buildings had a findable ask before they sold, and the
  // sale landed a median 11% under it, so the ask alone would have beaten the
  // comps. But an ask is the seller's opinion, not a price a market cleared,
  // and an owner who asks what the building is worth must not be handed
  // their own listing back. It stays evidence (askFit).
  // -------------------------------------------------------------------------
  var OWN_SALE_MAX_YEARS = 3;
  var OWN_SALE_FULL_YEARS = 1;
  var OWN_SALE_WEIGHT_NEW = 0.9;
  var OWN_SALE_HALF = 0.5;
  // Under a tenth of the answer the sale is not "weighed", it is history.
  var OWN_SALE_MIN_WEIGHT = 0.1;
  var OWN_SALE_DISAGREE = 3;
  var OWN_SALE_COMPS_PULL = 1.5;
  // A recorded "sale" under this is a nominal-consideration deed ($10 and
  // other good and valuable consideration), not a price.
  var OWN_SALE_MIN_PRICE = 10000;
  // Two days, for clocks and time zones. A month-and-year date reads as the
  // first of that month, so anything later is at least next month's deal.
  var OWN_SALE_FUTURE_SLACK_YEARS = 2 / 365.25;
  // How far either side of its own price a building may be worth: 10% inside
  // the first year (one sale is one buyer's price), five more points for each
  // year after. A stated allowance, not a measurement; see the header.
  var OWN_SALE_SPREAD_BASE = 0.10;
  var OWN_SALE_SPREAD_PER_YEAR = 0.05;
  var OWN_SALE_TREND_CAP = 10;        // percent a year, either way
  var OWN_SALE_INDEX_CAP = 0.15;      // in all, either way
  // A "sale" at the building's current asking price is the listing, read as
  // a closing. Half a percent of slack, because one page rounds what another
  // prints in full ($2,008,000 and "$2.0M" are one asking price).
  var OWN_SALE_ASK_MATCH = 0.005;
  // The sale's stated area against the size being valued. In the audit the
  // harmless differences (rentable against gross) were all under 10% and the
  // harmful ones (two buildings, a whole park) were 1.9x and up.
  var OWN_SALE_SCOPE_TOL = 0.15;
  // Dollars a square foot no whole commercial building sells outside of.
  var OWN_SALE_PSF_MIN = 15;
  var OWN_SALE_PSF_MAX = 2500;
  // The estimate "leans on" the sale from here up; below it the comps lead
  // and the sale helps. The page's words turn on it.
  var OWN_SALE_LEADS_AT = 0.5;
  // Measured on these three types and no other (scripts/truth-test.js: 24
  // Industrial, 15 Office and 8 Retail buildings). A house is bought, redone
  // and resold inside a year, an apartment building is bought to be renovated
  // and re-rented, and land is bought to be entitled: for those a recent
  // price is a weaker statement about today, and nothing here has measured
  // how much weaker. Add a type with a truth-test run on that type, the rule
  // SIZE_ELASTICITY keeps. Elsewhere the sale is the evidence line it was.
  var OWN_SALE_TYPES = { Industrial: true, Office: true, Retail: true };
  var YEAR_MS = 365.25 * 24 * 3600 * 1000;

  // A dollar figure written the ways a sale price is written: "$12,450,000",
  // "12450000", "$9.75M", "$12.45 million". NaN for anything else: a range,
  // two numbers, "about $9M", another currency's sign. numericValue would
  // read "$9.75M" as 9.75, and this figure becomes the headline.
  function moneyOf(v) {
    if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : NaN;
    var s = String(v == null ? "" : v).trim().toLowerCase()
      .replace(/^(?:usd|us\$)\s*/, "").replace(/\s*(?:usd|dollars?)$/, "");
    var m = s.match(/^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(k|thousand|m|mm|mil|million|b|bn|billion)?$/);
    if (!m) return NaN;
    var n = parseFloat(m[1].replace(/,/g, "") + (m[2] || ""));
    var mult = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mil: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 }[m[3]] || 1;
    return n > 0 ? n * mult : NaN;
  }

  // When a sale closed, as epoch ms, or NaN. Only a real date SHAPE is read
  // (unexplainedGain's list: Date.parse alone answers "sometime in 2021" with
  // a January nothing claimed), plus the quarter and month/year shapes
  // compDateMs reads by rule. A bare year is refused: it cannot be aged. So
  // is a day that does not exist, in every shape that names one
  // ("2025-02-30", "Feb 30, 2025" and "2/30/2025" would all roll into March).
  // And a word in it has to BE a month: the shape list lets through any word
  // that starts like one, and Date.parse then reads its first three letters,
  // so "Marketed 2024" was a March closing and "Mayor 2021" a May one.
  var MONTH_WORDS = {
    jan: 1, january: 1, feb: 1, february: 1, mar: 1, march: 1, apr: 1, april: 1, may: 1, jun: 1, june: 1,
    jul: 1, july: 1, aug: 1, august: 1, sep: 1, sept: 1, september: 1, oct: 1, october: 1, nov: 1, november: 1,
    dec: 1, december: 1,
  };
  function saleDateMs(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw || /^(?:19|20)\d{2}$/.test(raw)) return NaN;
    var ruled = /^q[1-4]\s*(?:19|20)\d{2}$/i.test(raw) || /^\d{1,2}\/(?:19|20)\d{2}$/.test(raw)
      || /^(?:19|20)\d{2}-\d{2}(?:-\d{2})?$/.test(raw);
    if (!ruled && !SALE_DATE_SHAPES.some(function (re) { return re.test(raw); })) return NaN;
    if (!ruled && (raw.toLowerCase().match(/[a-z]+/g) || []).some(function (w) { return MONTH_WORDS[w] !== 1; })) return NaN;
    var iso = raw.match(/^((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (iso) {
      var probe = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
      if (probe.getUTCMonth() !== Number(iso[2]) - 1) return NaN;
    }
    var ms = compDateMs(raw);
    var day = raw.match(/^\d{1,2}\/(\d{1,2})\/\d{4}$/) || raw.match(/^[a-z]+\.?\s+(\d{1,2}),?\s+\d{4}$/i)
      || raw.match(/^(\d{1,2})\s+[a-z]+\.?,?\s+\d{4}$/i);
    if (day && !isNaN(ms) && new Date(ms).getDate() !== Number(day[1])) return NaN;
    return ms;
  }

  function ownSaleWeight(ageYears) {
    // Number(null), Number("") and Number([]) are all 0, "a sale that closed
    // today": an age that is not a number weighs nothing.
    var a = typeof ageYears === "number" ? ageYears
      : (typeof ageYears === "string" && ageYears.trim() !== "" ? Number(ageYears) : NaN);
    if (!(a >= 0) || a >= OWN_SALE_MAX_YEARS) return 0;
    if (a <= OWN_SALE_FULL_YEARS) return OWN_SALE_WEIGHT_NEW;
    return OWN_SALE_WEIGHT_NEW * (OWN_SALE_MAX_YEARS - a) / (OWN_SALE_MAX_YEARS - OWN_SALE_FULL_YEARS);
  }

  function ownSaleSpread(ageYears) {
    var a = Number(ageYears);
    return OWN_SALE_SPREAD_BASE + OWN_SALE_SPREAD_PER_YEAR * Math.max(0, (a > 0 ? a : 0) - OWN_SALE_FULL_YEARS);
  }

  // The factor that moves the sale's price to the report date: the comps'
  // own trendFactor, on a trend held to OWN_SALE_TREND_CAP a year and a total
  // held to OWN_SALE_INDEX_CAP (see the header for why it is held at all).
  function ownSaleIndex(dateText, asOf, trendPct) {
    var pct = Number(trendPct);
    if (!Number.isFinite(pct)) return 1;
    // A trend the comps' own index disbelieves (past 30% a year either way)
    // moves the sale no more than it moves them: tested before the cap below,
    // which would otherwise turn "40% a year, not believed" into 10.
    if (trendFactor({ date: dateText }, asOf, pct) === 1) return 1;
    var held = Math.max(-OWN_SALE_TREND_CAP, Math.min(OWN_SALE_TREND_CAP, pct));
    var f = trendFactor({ date: dateText }, asOf, held);
    return Math.max(1 - OWN_SALE_INDEX_CAP, Math.min(1 + OWN_SALE_INDEX_CAP, f));
  }

  // What KIND of sale it was, in the search prompt's closed vocabulary.
  // Strict the way `condition` is: the prompt gives the words, a few plain
  // spellings of each are read, and anything else is "other". A blank is
  // "unstated". Neither leans: an unknown caveat may cost a good sale, it
  // must never pass for a clean one.
  //   full weight   arms_length
  //   half weight   sale_leaseback, allocated (OWN_SALE_HALF_BASES)
  //   not used      portfolio, leasehold, redevelopment, partial_interest,
  //                 related_party, distressed, land, not_closed, unstated,
  //                 other
  var OWN_SALE_BASIS_WORDS = {
    arms_length: ["arms length", "arm s length", "arms length sale", "arm s length sale", "ordinary", "ordinary sale", "market sale", "open market", "open market sale"],
    sale_leaseback: ["sale leaseback", "leaseback"],
    allocated: ["allocated", "allocated share", "allocation", "allocated price"],
    portfolio: ["portfolio", "portfolio sale", "multi property", "multi property sale", "package", "package sale", "bulk sale"],
    leasehold: ["leasehold", "leasehold interest", "ground lease", "ground leased"],
    redevelopment: ["redevelopment", "redevelopment site", "teardown", "tear down", "conversion"],
    partial_interest: ["partial interest", "partial", "minority interest", "fractional interest", "recapitalization", "recapitalisation", "recap", "joint venture"],
    related_party: ["related party", "related parties", "affiliate", "affiliated", "family transfer", "not arms length", "non arms length", "not arm s length", "non arm s length"],
    distressed: ["distressed", "distressed sale", "foreclosure", "auction", "reo", "bank owned", "short sale", "bankruptcy", "bankruptcy sale", "deed in lieu"],
    land: ["land", "land sale", "land only", "shell", "land or shell"],
    not_closed: ["not closed", "asking", "asking price", "list price", "listing", "listed", "pending", "under contract"],
  };
  var OWN_SALE_HALF_BASES = { sale_leaseback: true, allocated: true };
  function ownSaleBasis(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!s) return "unstated";
    for (var key in OWN_SALE_BASIS_WORDS) {
      if (!Object.prototype.hasOwnProperty.call(OWN_SALE_BASIS_WORDS, key)) continue;
      if (s === key.replace(/_/g, " ") || OWN_SALE_BASIS_WORDS[key].indexOf(s) !== -1) return key;
    }
    return "other";
  }

  // What a comp row's own NOTES say about its sale, for the one case a comp
  // row becomes the building's sale (the server promotes a same-address row
  // when the reported sale has no price). A comp is never asked for a basis,
  // so its notes are all there is: the server's comp-fit rules read four
  // kinds out of them (portfolio, partial interest, related party,
  // distressed) and this reads the rest of the vocabulary above. Each
  // pattern names the SALE, the comp-fit doctrine: "redevelopment" alone is
  // also what is happening next door.
  // Returns a key of OWN_SALE_BASIS_WORDS, "other" when the notes say the
  // price itself is not a stated closing price (estimated, undisclosed), or
  // "" when they say nothing. The refusing kinds are read first.
  var NOTE_BASIS = [
    ["other", /\b(?:price|figure|amount|value)\b[^.;]{0,40}\b(?:estimated|approximate|approximated|implied|derived|assumed|imputed|undisclosed|not disclosed)\b|\bestimated (?:sale |purchase )?price\b|\b(?:from|based on|per) (?:the )?transfer tax\b|\bterms (?:were |are )?(?:not disclosed|undisclosed)\b|\bundisclosed (?:price|sum|amount|terms)\b/i],
    ["leasehold", /\bleasehold\b|\bground[\s-]?leas(?:e|ed)\b/i],
    ["land", /\bsold as land\b|\bland (?:sale|value|only)\b|\bvacant (?:land|lot|parcel)\b|\bshell (?:building|condition|sale)\b|\bbefore (?:the )?(?:building|construction) (?:was|is|began|started)\b/i],
    ["redevelopment", /\bfor redevelopment\b|\bredevelopment (?:site|play|opportunity|project)\b|\b(?:to|will) be (?:redeveloped|demolished|razed|converted|torn down)\b|\b(?:slated|planned|bought|purchased|acquired) for (?:demolition|redevelopment|conversion)\b|\btear[\s-]?down\b/i],
    ["sale_leaseback", /\bsale[\s-]?lease[\s-]?back\b|\blease[\s-]?back\b|\bleased? (?:it|the (?:building|property|site|facility)) back\b/i],
    ["allocated", /\ballocat(?:ed|ion)\b/i],
  ];
  var NOTE_NEGATED = /(?:\bnot|\bno|\bnon|\bnever|n't)[\s-]+(?:an?\s+|the\s+)?$/i;
  function ownSaleNoteBasis(text) {
    var t = String(text == null ? "" : text);
    if (!t.trim()) return "";
    for (var i = 0; i < NOTE_BASIS.length; i++) {
      var re = new RegExp(NOTE_BASIS[i][1].source, "gi"), m;
      while ((m = re.exec(t))) {
        if (!NOTE_NEGATED.test(t.slice(Math.max(0, m.index - 24), m.index))) return NOTE_BASIS[i][0];
        if (m[0] === "") re.lastIndex += 1;
      }
    }
    return "";
  }

  // A link to a page that could state the sale, not a site's front door:
  // http(s) with a path or a query behind the host, that is not a picture and
  // not a search or index page. The prompt asks for "the page that states
  // it", and of the own sales the audit found cited to a bare home page, one
  // was an asking price and one a portfolio allocation; another was cited to
  // a flyer image uploaded three months before the sale it was cited for.
  //
  // A query string does not make a page out of one that is not: "/search?q=…"
  // is still a search and "/listings?page=2" still an index, whatever rides
  // behind the "?". And with NO path, the query has to name a record
  // ("?parcel=R123", how some county sites address one): a tracker's key or a
  // search box's own ("?utm_source=…", "?q=…") is still the front door.
  var NON_PAGE_KEYS = /^(?:utm_[a-z_]+|gclid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_hsenc|_hsmi|ref|source|q|query|s|search|keywords?|k|p|page|sort|order)$/i;
  function specificPage(url) {
    var m = String(url == null ? "" : url).trim().match(/^https?:\/\/[^\/?#\s]+([^?#\s]*)(\?[^#\s]*)?/i);
    if (!m) return false;
    var path = (m[1] || "").replace(/\/+$/, "");
    if (/\.(?:jpe?g|png|gif|webp|svg|bmp)$/i.test(path)) return false;
    if (/\/(?:search|for-sale|sold|listings|properties|recent-transactions|transactions)$/i.test(path)) return false;
    if (path !== "") return true;
    var keys = (m[2] || "").replace(/^\?/, "").split("&").map(function (kv) { return kv.split("=")[0]; }).filter(Boolean);
    return keys.some(function (k) { return !NON_PAGE_KEYS.test(k); });
  }

  // Marketplaces whose pages show an ASKING price, and a "sold" figure that
  // is often the last ask. A sale cited to one counts for half.
  var LISTING_HOSTS = ["loopnet.com", "crexi.com", "compass.com", "homes.com", "realtor.com", "realnex.com",
    "propertyshark.com", "zillow.com", "redfin.com", "trulia.com", "commercialsearch.com", "commercialcafe.com",
    "showcase.com", "cityfeet.com", "officespace.com", "42floors.com", "coldwellbankerhomes.com"];
  function hostOf(url) {
    var m = String(url == null ? "" : url).trim().toLowerCase().match(/^https?:\/\/([^\/?#:\s]+)/);
    return m ? m[1].replace(/^www\./, "") : "";
  }
  function isListingHost(url) {
    var h = hostOf(url);
    return h !== "" && LISTING_HOSTS.some(function (d) { return h === d || h.slice(-(d.length + 1)) === "." + d; });
  }
  // States where a deed does not show the price, so a "sale price" on the web
  // is a news report or it is the last asking price.
  var NON_DISCLOSURE = { AK: 1, ID: 1, KS: 1, LA: 1, MS: 1, MO: 1, MT: 1, NM: 1, ND: 1, TX: 1, UT: 1, WY: 1 };
  // --- Where an address is: its ZIP, its state, its city -------------------
  // Read off the END of the address, past a trailing country, in the shapes
  // members and pages write: ", ID 83702", ", ID, 83702", " Boise ID",
  // ", Idaho", ", ID 83702, USA". The state decides which rule a source is
  // held to and whether two addresses can be one building, and read only as
  // ", ST" at the very end it was missed in every other shape: "Springfield
  // IL" and "Springfield, MO" came out as one place.
  // A state is looked for only AFTER the street part (the first comma),
  // because a street's own suffix is not a state: "100 Maple Ct" is a court,
  // not Connecticut. A spelled-out name counts only with something before it
  // in that tail, so "..., New York" alone is still the city.
  var US_STATES = {
    AL: 1, AK: 1, AZ: 1, AR: 1, CA: 1, CO: 1, CT: 1, DE: 1, FL: 1, GA: 1, HI: 1, ID: 1, IL: 1, IN: 1, IA: 1, KS: 1,
    KY: 1, LA: 1, ME: 1, MD: 1, MA: 1, MI: 1, MN: 1, MS: 1, MO: 1, MT: 1, NE: 1, NV: 1, NH: 1, NJ: 1, NM: 1, NY: 1,
    NC: 1, ND: 1, OH: 1, OK: 1, OR: 1, PA: 1, RI: 1, SC: 1, SD: 1, TN: 1, TX: 1, UT: 1, VT: 1, VA: 1, WA: 1, WV: 1,
    WI: 1, WY: 1, DC: 1,
  };
  var STATE_NAMES = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
    connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
    indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
    nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
    vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
    "district of columbia": "DC",
  };
  // Longest first: "west virginia" before "virginia", "arkansas" before "kansas".
  var STATE_NAME_LIST = Object.keys(STATE_NAMES).sort(function (a, b) { return b.length - a.length; });
  // { zip, state, head }: head is the address with the country, the ZIP and
  // the state taken off its end, which is where cityKey reads the city.
  function placeOf(address) {
    var s = String(address == null ? "" : address).trim()
      .replace(/[,\s]+(?:usa|u\.s\.a\.?|u\.s\.|united states(?: of america)?)\.?\s*$/i, "");
    var zip = "";
    var z = s.match(/[,\s]\s*(\d{5})(?:-\d{4})?\s*$/);
    if (z) { zip = z[1]; s = s.slice(0, z.index); }
    s = s.replace(/[,\s]+$/, "");
    var state = "", head = s;
    var comma = s.indexOf(",");
    if (comma >= 0) {
      var tail = s.slice(comma + 1);
      var code = tail.match(/(^|[,\s])([A-Za-z]{2})\.?$/);
      if (code && US_STATES[code[2].toUpperCase()] === 1) {
        state = code[2].toUpperCase();
        head = s.slice(0, s.length - (tail.length - code.index));
      } else {
        var low = tail.toLowerCase().replace(/\./g, "");
        for (var i = 0; i < STATE_NAME_LIST.length && !state; i++) {
          var name = STATE_NAME_LIST[i];
          var at = low.length - name.length;
          if (at < 1 || low.slice(at) !== name || /[a-z]/.test(low.charAt(at - 1))) continue;
          // Something has to stand before it: a city, or a unit and a city.
          if (low.slice(0, at).replace(/[,\s]/g, "") === "") continue;
          state = STATE_NAMES[name];
          head = s.slice(0, s.length - (tail.length - at));
        }
      }
    }
    return { zip: zip, state: state, head: head.replace(/[,\s]+$/, "") };
  }
  function stateOf(address) { return placeOf(address).state; }
  function zipOf(address) { return placeOf(address).zip; }

  // --- Is this sale recorded for THIS building? ---------------------------
  // The street line, taken apart: its number (or range), its name, its
  // directionals and its suffix. backtest.js normAddress folds the same
  // spellings ("19127 Red Label Lane ... 83607" and "19127 Red Label Ln ...
  // 83605" are one warehouse); this goes further because it decides which
  // sale carries most of a headline.
  var STREET_FOLD = {
    lane: "ln", street: "st", avenue: "ave", drive: "dr", road: "rd", boulevard: "blvd",
    court: "ct", place: "pl", parkway: "pkwy", highway: "hwy", circle: "cir", terrace: "ter",
    trail: "trl", square: "sq", expressway: "expy", freeway: "fwy",
    center: "ctr", centre: "ctr", saint: "st", mount: "mt", fort: "ft",
    first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th",
    sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
    north: "n", south: "s", east: "e", west: "w",
    northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  };
  var STREET_SUFFIX = { ln: 1, st: 1, ave: 1, dr: 1, rd: 1, blvd: 1, ct: 1, pl: 1, pkwy: 1, hwy: 1, cir: 1, ter: 1, trl: 1, sq: 1, way: 1, loop: 1, expy: 1, fwy: 1 };
  var STREET_DIR = { n: 1, s: 1, e: 1, w: 1, ne: 1, nw: 1, se: 1, sw: 1 };
  // A unit: one of these words, then an identifier that carries a digit or is
  // one or two letters ("Suite 200", "Apt 4B", "Bldg B", "Units 1-3"). The
  // identifier rule is what leaves a street NAMED with one of these words
  // whole: "2101 Space Park Dr" and "5600 Building C Way" are streets.
  // Tower, pad, phase, lot, wing and parcel name one building of a campus
  // ("Building One", "Tower 2", "Pad C", "Phase II", "Lot 5"): read as part
  // of the street they let a sibling's sale pass for the subject's.
  var UNIT_WORDS = "unit|units|ste|suite|suites|apt|apartment|condo|spc|space|bldg|building|fl|floor|rm|room|tower|twr|pad|phase|lot|wing|parcel";
  var UNIT_WORD = new RegExp("^(?:" + UNIT_WORDS + ")$");
  // An identifier: anything with a digit, one or two letters, a letter range
  // ("a-c"), a number word or a Roman numeral of two letters or more.
  var NUMBER_WORDS = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    eleven: "11", twelve: "12", first: "1", second: "2", third: "3", fourth: "4", fifth: "5" };
  var ROMAN = { ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9", xi: "11", xii: "12" };
  var UNIT_ID = /^(?=[a-z0-9-]*\d)[a-z0-9-]+$|^[a-z]{1,2}$|^[a-z]-[a-z]$|^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|ii|iii|iv|vi|vii|viii|ix|xi|xii)$/;
  // One spelling per identifier, so "Building One" is "Building 1" and
  // "Phase II" is "Phase 2".
  function unitId(id) {
    var w = String(id || "");
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, w)) return NUMBER_WORDS[w];
    if (Object.prototype.hasOwnProperty.call(ROMAN, w)) return ROMAN[w];
    return w.replace(/^(\d+)(?:st|nd|rd|th)$/, "$1");
  }
  // A whole comma part that is a unit and not a city: "#5", "Suite 200",
  // "Suite #200", "Building B", "Units 1-3".
  var UNIT_PART = new RegExp("^(?:#\\s*([a-z0-9-]+)|(?:" + UNIT_WORDS + ")\\s*#?\\s*([a-z0-9-]+))$");
  // Every dash a page sets a range with, read as the hyphen a keyboard types.
  function plainDashes(text) { return String(text == null ? "" : text).replace(/[‐-―−]/g, "-"); }
  function unitOfPart(part) {
    var t = plainDashes(part).toLowerCase().replace(/[^\w\s#-]/g, " ").replace(/\s+/g, " ").trim();
    // "2nd Floor", "Third Floor": the identifier comes first.
    var fl = t.match(/^([a-z0-9]+)\s+(?:floor|fl)$/);
    if (fl && UNIT_ID.test(fl[1])) return unitId(fl[1]);
    var m = t.match(UNIT_PART);
    if (!m) return "";
    return m[1] ? unitId(m[1]) : (UNIT_ID.test(m[2]) ? unitId(m[2]) : "");
  }
  function foldWord(w) { return Object.prototype.hasOwnProperty.call(STREET_FOLD, w) ? STREET_FOLD[w] : w; }
  function streetKey(address) {
    return String((plainDashes(address).split(",")[0]) || "")
      .toLowerCase().replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean).map(foldWord).join(" ");
  }
  // An address typed with no comma between the street and the city
  // ("1200 W Industrial Blvd Dallas, TX 75207"): the city is the words after
  // the last street suffix that are not a directional. { line, city } with
  // city "" whenever there is a comma to go by or no such words.
  function citylessSplit(address) {
    var head = plainDashes(placeOf(address).head);
    if (head.indexOf(",") >= 0) return { line: head.split(",")[0], city: "" };
    var raw = head.trim().split(/\s+/);
    var at = -1;
    for (var i = 2; i < raw.length - 1; i++) {
      if (STREET_SUFFIX[foldWord(raw[i].toLowerCase().replace(/[^\w]/g, ""))] === 1) at = i;
    }
    if (at < 0) return { line: head, city: "" };
    var rest = raw.slice(at + 1);
    var tail = rest.map(function (w) { return foldWord(w.toLowerCase().replace(/[^\w]/g, "")); });
    if (tail.every(function (w) { return STREET_DIR[w] === 1 || w === ""; })) return { line: head, city: "" };
    // A unit after the suffix ("Suite 200") is the line's, not a city.
    if (UNIT_WORD.test(tail[0]) || /^#/.test(rest[0])) return { line: head, city: "" };
    var lead = 0;
    while (lead < tail.length && STREET_DIR[tail[lead]] === 1) lead++;
    return { line: raw.slice(0, at + 1 + lead).join(" "), city: rest.slice(lead).join(" ") };
  }
  // { lo, hi, name, dir, suffix, unit } or null when the line does not start
  // with a street number. "23126-23170 Valencia Blvd" is a range. A unit is
  // kept apart wherever it is written: a word and an identifier on the line
  // ("Suite 101"), a "#", the comma part after the street, or a letter on the
  // number itself ("2020B" is not "2020A", and neither is "2020").
  function streetParts(address) {
    var line = String(citylessSplit(address).line || "").toLowerCase();
    var num = line.match(/^\s*(\d+)(?:\s*-\s*(\d+))?([a-z])?(?=\s|$)/);
    if (!num) return null;
    var lo = Number(num[1]), hi = num[2] ? Number(num[2]) : lo;
    // A pair that runs DOWN is not a range, it is one hyphenated house number
    // (Queens, New York: "37-18 Northern Blvd" is the 18th lot past 37th
    // Street). Read as the range 18 to 37 it would name every building on
    // the block. It is kept as the one number sites that drop the hyphen
    // write ("3718").
    if (hi < lo) { lo = Number(num[1] + num[2]); hi = lo; }
    var units = num[3] ? [num[3]] : [];
    line = line.slice(num[0].length);
    var hash = line.match(/#\s*([a-z0-9-]+)/);
    if (hash) { units.push(unitId(hash[1])); line = line.replace(hash[0], " "); }
    var toks = line.replace(/[^\w\s-]/g, " ").trim().split(/\s+/).filter(Boolean);
    // "Suite #200": the "#" took the identifier and left the word behind.
    if (hash && toks.length > 1 && UNIT_WORD.test(toks[toks.length - 1])) toks.pop();
    // Never the first word (a street line needs a name ahead of its unit),
    // and only with an identifier behind it.
    for (var i = 1; i + 1 < toks.length; i++) {
      if (UNIT_WORD.test(toks[i]) && UNIT_ID.test(toks[i + 1])) { units.push(unitId(toks[i + 1])); toks = toks.slice(0, i); break; }
    }
    // Every comma part between the street and the state that names a unit or
    // one building of several ("100 Main St, Building One, Dallas, TX"), not
    // only the first: a city never reads as one.
    plainDashes(placeOf(address).head).split(",").slice(1).forEach(function (p) {
      var u = unitOfPart(p);
      if (u) units.push(u);
    });
    var words = [];
    toks.forEach(function (t) { t.split("-").forEach(function (w) { if (w) words.push(foldWord(w)); }); });
    var dirs = words.filter(function (w) { return STREET_DIR[w] === 1; });
    // The suffix is the last word that is not a directional, so "Dr E" and
    // "Ave NW" keep theirs.
    var core = words.filter(function (w) { return STREET_DIR[w] !== 1; });
    var suffix = core.length > 1 && STREET_SUFFIX[core[core.length - 1]] === 1 ? core[core.length - 1] : "";
    var name = (suffix ? core.slice(0, -1) : core).join(" ");
    if (!name) name = words.join(" ");
    return { lo: lo, hi: hi, name: name, dir: dirs.join(" "), suffix: suffix, unit: units.join(" ") };
  }
  // The city as written (the comma part that is not a unit), folded; "" when
  // the address names none.
  function cityKey(address) {
    var bare = citylessSplit(address).city;
    var parts = (bare ? [bare] : plainDashes(placeOf(address).head).split(",").slice(1))
      .filter(function (p) { return unitOfPart(p) === ""; })
      .map(function (p) { return p.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim(); })
      .filter(Boolean);
    if (!parts.length) return "";
    return parts[0].replace(/\bsaint\b/g, "st").replace(/\bfort\b/g, "ft").replace(/\bmount\b/g, "mt").trim();
  }
  // One street line names the other's building: the same name, a number that
  // is the same or inside the other's range, and no directional or suffix
  // that CONTRADICTS (one side leaving either out is not a contradiction).
  // Two RANGES have to be the same range: "37-52 82nd St" and "37-60 82nd St"
  // are two Queens house numbers that happen to run upward, and read as
  // overlapping ranges they would be one building. And one number against a
  // range that runs even to even (or odd to odd) has to be on that side of
  // the street: the odd numbers inside it are the buildings opposite. Units
  // are not compared here.
  function sameStreetLine(pa, pb) {
    if (!pa || !pb || !pa.name || pa.name !== pb.name) return false;
    var ra = pa.hi !== pa.lo, rb = pb.hi !== pb.lo;
    if (ra && rb) {
      if (pa.lo !== pb.lo || pa.hi !== pb.hi) return false;
    } else if (pa.hi < pb.lo || pb.hi < pa.lo) {
      return false;
    } else if (ra !== rb) {
      var range = ra ? pa : pb, one = ra ? pb : pa;
      if (range.lo % 2 === range.hi % 2 && one.lo % 2 !== range.lo % 2) return false;
    }
    if (pa.dir && pb.dir && pa.dir !== pb.dir) return false;
    if (pa.suffix && pb.suffix && pa.suffix !== pb.suffix) return false;
    return true;
  }
  // The same place. A shared ZIP settles it (a postal city and a locality are
  // two names for one building: "Fleming Island" and "Orange Park"). Two
  // different states never are. Otherwise the same city, or one side naming
  // none.
  // Two DIFFERENT ZIPs are two places for the purpose of LEANING on a sale,
  // even under one city's name: a city can hold a "100 N Main St" and a
  // "100 S Main St", written without the directional they differ only by
  // ZIP, and a wrong sale leaned on is the costliest mistake here.
  // `loose` drops that one test, for the callers that only take a building's
  // own sale OUT of its comps (ownSaleFrom, the prompt's corpus rows, the
  // radius blend): two searches wrote one Caldwell warehouse with two ZIPs,
  // and leaving a building among its own comps is the worse error there.
  function samePlace(a, b, loose) {
    var pa = placeOf(a), pb = placeOf(b);
    if (pa.zip && pb.zip && pa.zip === pb.zip) return true;
    if (pa.state && pb.state && pa.state !== pb.state) return false;
    if (pa.zip && pb.zip && loose !== true) return false;
    var ca = cityKey(a), cb = cityKey(b);
    return ca === "" || cb === "" || ca === cb;
  }
  // Two addresses name one building, units and all. "100 Main St Unit 5" is
  // not "100 Main St": a unit is not the building.
  function sameBuilding(a, b, loose) {
    var pa = streetParts(a), pb = streetParts(b);
    return sameStreetLine(pa, pb) && pa.unit === pb.unit && samePlace(a, b, loose === true);
  }

  // How good the sale's SOURCE is: { ok, half } with a `why` for the page.
  // `subjectAddress` only says which state's rules apply.
  function ownSaleSource(lastSale, subjectAddress) {
    var type = String((lastSale && lastSale.source_type) || "").toLowerCase();
    if (!specificPage(lastSale && lastSale.source_url)) return { ok: false, why: "no_source" };
    if (type === "estimate") return { ok: false, why: "estimate_source" };
    if (type === "listing" || isListingHost(lastSale.source_url)) return { ok: true, half: "listing_page" };
    // The search did not say what kind of page this is (or said a word the
    // server could not place). Trusted in full, a sale the model failed to
    // classify outranked one it classified honestly as a listing.
    if (type !== "news" && type !== "public_record") return { ok: true, half: "unclassified" };
    if (NON_DISCLOSURE[stateOf(subjectAddress)] === 1 && type !== "news") return { ok: true, half: "non_disclosure" };
    return { ok: true, half: null };
  }

  // The subject's own sale as an anchor: null when the report carries none,
  // { ok: false, reason } when it carries one we will not lean on, else
  // { ok: true, price, dateMs, ageYears, trend, value, weight, spread, half }.
  // `opts`: { asOf, trendPct, propertyType, currency, yearBuilt, asking,
  //           subjectAddresses, subjectSize, off } — the report date, the
  // market's trend, the type and currency, what the same report says about
  // the subject that can show the "sale" is something else (or that the
  // building is), every way the report names the subject, the size being
  // valued, and the member's own switch.
  function ownSaleAnchor(lastSale, opts) {
    var o = opts || {};
    if (!lastSale || typeof lastSale !== "object") return null;
    var hasPrice = String(lastSale.price == null ? "" : lastSale.price).trim() !== "";
    var hasDate = String(lastSale.date == null ? "" : lastSale.date).trim() !== "";
    if (!hasPrice && !hasDate) return null;
    var price = moneyOf(lastSale.price);
    var known = price >= OWN_SALE_MIN_PRICE ? price : null;
    var age = null;
    var no = function (reason, extra) {
      var out = { ok: false, reason: reason, price: known, ageYears: age };
      if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
      return out;
    };
    if (known == null) return no("no_price");
    var ms = saleDateMs(lastSale.date);
    var asOf = Number(o.asOf);
    if (isNaN(ms) || !Number.isFinite(asOf)) return no("no_date");
    var years = (asOf - ms) / YEAR_MS;
    if (years < -OWN_SALE_FUTURE_SLACK_YEARS) return no("future");
    age = Math.max(0, years);
    // Old first: past the window nothing else about the sale matters, and the
    // page shows it as the line of history it has always been.
    var half = null;
    var weight = ownSaleWeight(age);
    if (weight < OWN_SALE_MIN_WEIGHT) return no("old");
    if (!Object.prototype.hasOwnProperty.call(OWN_SALE_TYPES, String(o.propertyType))) return no("type");
    if (o.currency && String(o.currency).toUpperCase() !== "USD") return no("currency");
    if (lastSale.settled !== 1 && lastSale.settled !== true) return no("unsettled");
    if (o.off) return no("off");
    if (lastSale.unusable) return no("unusable", { why: String(lastSale.unusable) });
    var basis = ownSaleBasis(lastSale.basis);
    // `from_comp` is the server's own mark (settleOwnSale; a model's is
    // dropped): this sale was read off a comp row, and a comp is never asked
    // what kind of sale it was. Where its notes named a kind, the server
    // wrote it as the basis and it is judged like any other. Where they said
    // nothing, it is not a clean bill and not a refusal either: half.
    var silentComp = basis === "unstated" && lastSale.from_comp === true;
    if (!silentComp && basis !== "arms_length" && OWN_SALE_HALF_BASES[basis] !== true) return no("basis", { why: basis });
    if (OWN_SALE_HALF_BASES[basis] === true) half = basis;
    if (silentComp) half = "from_comp";
    var names = [].concat(o.subjectAddresses || []).filter(function (a) { return typeof a === "string" && a.trim() !== ""; });
    var saleAddr = String(lastSale.address == null ? "" : lastSale.address).trim();
    // Which state's rule the source is held to: the sale's own address says
    // where the property is, else whichever of the subject's names carries a
    // state. Never simply the FIRST name: the page and a bulk row list the
    // subject's names in different orders, and read that way one report was
    // worth $1,950,000 on one screen and $1,725,000 on the other.
    var where = [saleAddr].concat(names).filter(function (a) { return stateOf(a) !== ""; })[0] || names[0] || "";
    var src = ownSaleSource(lastSale, where);
    if (!src.ok) return no(src.why === "estimate_source" ? "no_source" : src.why, { why: src.why });
    half = half || src.half;
    // Recorded for this building, the whole of it. With a stated address the
    // street line has to match one of the subject's names; a unit on either
    // side that the other does not share is one unit of the building.
    // No stated address is not a clean bill either: the search is asked for
    // it on every sale, and without it nothing can tell this building from
    // the one next door.
    if (!saleAddr || !names.length) return no("no_address");
    var sp = streetParts(saleAddr);
    var hits = [];
    names.forEach(function (n) {
      var np = streetParts(n);
      if (sameStreetLine(sp, np) && samePlace(saleAddr, n)) hits.push(np);
    });
    if (!hits.length) return no("other_address", { saleAddress: saleAddr });
    // EVERY name that matches has to agree with the sale about the unit, not
    // the first one found: a subject typed as "Suite 200" is one suite however
    // the search rewrote its address, and listed in the other order the same
    // report leaned on the whole building's sale.
    // `unitSide`: which side names the unit, for the page's sentence ("sale"
    // when the sale was of one unit, "subject" when the report values one
    // unit and the sale was the whole, "both" for two different units).
    var odd = hits.filter(function (h) { return h.unit !== sp.unit; });
    if (odd.length) {
      var side = sp.unit && odd[0].unit ? "both" : sp.unit ? "sale" : "subject";
      return no("unit", { saleAddress: saleAddr, unitSide: side });
    }
    var size = Number(o.subjectSize);
    var saleSize = numericValue(lastSale.size_sqft);
    if (size > 0 && saleSize > 0 && Math.abs(saleSize / size - 1) > OWN_SALE_SCOPE_TOL) {
      return no("scope", { saleSize: saleSize, subjectSize: size });
    }
    if (size > 0 && (known / size < OWN_SALE_PSF_MIN || known / size > OWN_SALE_PSF_MAX)) return no("implausible");
    // Built after it "sold": that price bought the land, or the building
    // that stood there before.
    // The sale's year is read off the date AS WRITTEN: getFullYear() on an
    // ISO date (which is UTC midnight) answers the year before in any zone
    // west of Greenwich, so a January 2026 sale of a 2026 building was
    // refused on a server in Oregon and leaned on in a browser in London.
    var built = yearOf(o.yearBuilt);
    var soldYear = Number((String(lastSale.date).match(/(?:19|20)\d{2}/) || [])[0]);
    if (built != null && soldYear > 0 && built > soldYear) return no("predates_building");
    // `asking` is the LISTING the search found (see the header). Under the
    // floor it is a misread ("$1.05M" read as 1.05), not an ask.
    var ask = Number(o.asking);
    if (!(ask >= OWN_SALE_MIN_PRICE)) ask = 0;
    if (ask > 0 && Math.abs(known / ask - 1) <= OWN_SALE_ASK_MATCH) return no("matches_asking");
    var trend = ownSaleIndex(lastSale.date, asOf, o.trendPct);
    var value = known * trend;
    // Listed today over a quarter away from what it sold for at today's
    // prices (the 25% rule askFit and unexplainedGain use): work done since,
    // income grown or lost, or a hopeful ask. Nothing here can see which, so
    // the sale counts for half.
    var askPct = ask > 0 ? Math.round((ask / value - 1) * 100) : 0;
    if (ask > 0 && Math.abs(ask / value - 1) > OUTLIER_PCT) half = half || "ask_far";
    if (half) weight = Math.min(OWN_SALE_HALF, weight / 2);
    if (weight < OWN_SALE_MIN_WEIGHT) return no("old");
    return {
      ok: true, price: known, dateMs: ms, ageYears: age, trend: trend, value: value,
      weight: weight, spread: ownSaleSpread(age), half: half, askPct: askPct,
    };
  }

  // The estimate once the building's own sale is weighed in.
  //
  // `comp` is what the comps alone say, in DOLLARS ({ low, mid, high }, any
  // basis: $/SF times the size, per unit times the units, per acre times the
  // acres), or null when they cannot produce a dollar figure (no size, no
  // priced sale). The answer always carries both figures so a caller can show
  // them side by side:
  //   { low, mid, high,          the estimate: blended when anchored, else the comps'
  //     anchored, weight,        whether and how far it leans on the own sale
  //     ownSale,                 ownSaleAnchor's answer (null when none was reported)
  //     comp,                    the comps' own figures, untouched
  //     ratio,                   own sale indexed / comps' Likely, when both exist
  //     held,                    true when the comps were held to 1.5x of the sale
  //     refused }                why it did not anchor, or null
  // The comps' middle figure may be named `mid` (valueFromComps) or `likely`
  // (the page's lastValuation): read as "no comps", the second spelling would
  // hand the whole headline to the sale without a word.
  function valueWithOwnSale(comp, lastSale, opts) {
    var cm = comp ? Number(comp.mid != null ? comp.mid : comp.likely) : NaN;
    var c = cm > 0 ? { low: Number(comp.low), mid: cm, high: Number(comp.high) } : null;
    var a = ownSaleAnchor(lastSale, opts);
    var out = {
      low: c ? c.low : null, mid: c ? c.mid : null, high: c ? c.high : null,
      anchored: false, weight: 0, ownSale: a, comp: c, ratio: null, held: false, refused: null,
    };
    if (!a) return out;
    if (a.ok && c) out.ratio = a.value / c.mid;
    if (!a.ok) { out.refused = a.reason; return out; }
    if (c && (out.ratio > OWN_SALE_DISAGREE || out.ratio < 1 / OWN_SALE_DISAGREE)) {
      out.refused = "disagree";
      return out;
    }
    // No comps' figure in dollars does not always mean no comps. When priced
    // sales came back (one sale, or several and no size to multiply), their
    // $/SF (opts.compPsf) is still the check: the sale's own $/SF, over the
    // subject's size or the size the sale states, is held to the same 3x.
    // With neither size there is nothing to compare, and a sale nothing
    // checked must not carry the headline while comps sit in the table
    // ("unchecked"). Alone means no priced comps at all.
    if (!c) {
      var cp = Number(opts && opts.compPsf);
      if (cp > 0) {
        var ss = Number(opts && opts.subjectSize) > 0 ? Number(opts.subjectSize) : numericValue(lastSale && lastSale.size_sqft);
        if (!(ss > 0)) { out.refused = "unchecked"; return out; }
        out.ratio = (a.value / ss) / cp;
        if (out.ratio > OWN_SALE_DISAGREE || out.ratio < 1 / OWN_SALE_DISAGREE) { out.refused = "disagree"; return out; }
      }
    }
    // Alone, nothing checks it: only a clean sale inside its first year.
    if (!c && (a.half || a.ageYears > OWN_SALE_FULL_YEARS)) { out.refused = "alone_weak"; return out; }
    var w = c ? a.weight : 1;
    // The comps, held to within 1.5x of the sale before they pull on it.
    var k = 1;
    if (c) {
      var heldMid = Math.max(a.value / OWN_SALE_COMPS_PULL, Math.min(a.value * OWN_SALE_COMPS_PULL, c.mid));
      // In full while the sale leads, fading with its weight below that.
      var fade = Math.min(1, w / OWN_SALE_LEADS_AT);
      k = 1 + (heldMid / c.mid - 1) * fade;
      out.held = Math.abs(k - 1) > 1e-9;
    }
    var mid = w * a.value + (1 - w) * (c ? c.mid * k : 0);
    var low = w * a.value * (1 - a.spread) + (1 - w) * (c ? c.low * k : 0);
    var high = w * a.value * (1 + a.spread) + (1 - w) * (c ? c.high * k : 0);
    // While the sale leads: Likely stays inside the sale's own allowance (the
    // comps check it, they do not carry it off), and the range holds the sale,
    // both the price paid and what it comes to today.
    if (w >= OWN_SALE_LEADS_AT) {
      mid = Math.max(a.value * (1 - a.spread), Math.min(a.value * (1 + a.spread), mid));
      low = Math.min(low, a.value, a.price);
      high = Math.max(high, a.value, a.price);
    }
    out.anchored = true;
    out.weight = w;
    out.mid = heroRound(mid);
    out.low = Math.min(heroRound(low), out.mid);
    out.high = Math.max(heroRound(high), out.mid);
    // Rounding to the display step can carry Low up past the price paid, or
    // High down below it, by half a step. While the sale leads the range is
    // promised to hold both the price and what it comes to today, so those
    // two ends are rounded OUTWARD when they have to be.
    if (w >= OWN_SALE_LEADS_AT) {
      var floorAt = Math.min(a.value, a.price), ceilAt = Math.max(a.value, a.price);
      if (out.low > floorAt) out.low = Math.floor(floorAt / heroStep(floorAt)) * heroStep(floorAt);
      if (out.high < ceilAt) out.high = Math.ceil(ceilAt / heroStep(ceilAt)) * heroStep(ceilAt);
    }
    return out;
  }

  // Words that say a row's price is an ASK, whatever its date says. Our own
  // corpus holds 135 sale rows whose notes say so ("list price used as proxy
  // for closed price") under a closed-sale date.
  var ASKING_WORDS = /\b(?:asking|list(?:ed)? price|listed|for sale|active|pending|under contract|not closed|proxy)\b/i;

  // The sale a report holds of the SUBJECT ITSELF, and its comps without it.
  //
  // The prompt forbids the subject's own sale among its comps, and it turns
  // up there anyway (11 of 47 audited reports), because it is the
  // best-documented deal at that address. Counted as a comp it would be
  // weighed once there and again as the anchor; and a report whose
  // `subject_last_sale` came back without a price (the article said "terms
  // undisclosed") can hold that price one row down.
  //
  // `addresses` is every way this report names the subject: what was typed,
  // and the corrected address when the search moved it. Returns
  //   { sale,     the sale to weigh: subject_last_sale, or a same-building
  //               CLOSED sale comp when that is priced and the reported one is
  //               not, or is newer than it. A row is promoted only when its
  //               own source is a news page or a public record and its notes
  //               say nothing of an asking price: a listing-sourced row is
  //               how an ask becomes "what it sold for". Shaped like
  //               subject_last_sale, with `from_comp: true`, and with the
  //               reported sale's `basis` when it is the same closing.
  //     row,      the comp `sale` was read from, or null (the server reads its
  //               notes for a price caveat, comp-fit.js priceBasisOf)
  //     listing,  a same-building row that is ON the market (the subject's own
  //               asking price, entered as a comp), or null
  //     comps,    the comps that are not the subject (leases at its address
  //               stay: a suite lease in the building is a real lease comp)
  //     own }     the rows that came out, in order
  function ownSaleFrom(report, addresses) {
    var r = report || {};
    var all = Array.isArray(r.comps) ? r.comps : [];
    var names = [].concat(addresses || [], r.subject_address_corrected || [])
      .filter(function (a) { return typeof a === "string" && a.trim() !== ""; });
    var isSale = function (c) { return !String(c.transaction || "").toLowerCase().startsWith("lease"); };
    var own = [], comps = [];
    all.forEach(function (c) {
      var same = c && typeof c === "object" && isSale(c)
        && names.some(function (a) { return sameBuilding(c.address, a, true); });
      (same ? own : comps).push(c);
    });
    var reported = r.subject_last_sale && typeof r.subject_last_sale === "object" ? r.subject_last_sale : null;
    var listing = null, best = null, bestMs = NaN;
    own.forEach(function (c) {
      // Taken out of the comps on the LOOSE match (one building under two
      // ZIPs is still not its own comp), but only a row that matches the way
      // the anchor itself matches may be READ as the building's sale or its
      // listing: otherwise another ZIP's row displaced the sale recorded for
      // this exact address and was then refused, and another ZIP's asking
      // price halved the real sale's weight.
      if (!names.some(function (a) { return sameBuilding(c.address, a); })) return;
      if (isOnMarket(c)) { if (!listing) listing = c; return; }
      var tier = String(c.source_type || "").toLowerCase();
      if (tier !== "news" && tier !== "public_record") return;
      if (ASKING_WORDS.test(String(c.notes || ""))) return;
      var price = moneyOf(c.price_or_rate);
      var ms = saleDateMs(c.date);
      if (!(price >= OWN_SALE_MIN_PRICE) || isNaN(ms)) return;
      if (!best || ms > bestMs) { best = c; bestMs = ms; }
    });
    var sale = reported, row = null;
    if (best) {
      var repPrice = reported ? moneyOf(reported.price) : NaN;
      var repMs = reported ? saleDateMs(reported.date) : NaN;
      // A month of slack: "Mar 2026" on one line and "2026-03-27" on the
      // other are one closing, and the reported line is the one the search
      // was asked for.
      var newer = !isNaN(repMs) && bestMs - repMs > 31 * 24 * 3600 * 1000;
      if (!reported || !(repPrice >= OWN_SALE_MIN_PRICE) || isNaN(repMs) || newer) {
        sale = {
          date: String(best.date), price: String(best.price_or_rate), source_url: String(best.source_url || ""),
          source_type: String(best.source_type || ""), address: String(best.address || ""),
          size_sqft: best.size_sqft == null ? "" : String(best.size_sqft), from_comp: true,
        };
        // The same closing (the reported line had no price, or no date to
        // tell them apart): the basis the search gave it is still the basis.
        // A sale it called a leaseback, a portfolio or a related-party deal
        // must not come back clean one row down. A NEWER row is another
        // closing and carries nothing.
        if (reported && !newer && ownSaleBasis(reported.basis) !== "unstated") sale.basis = String(reported.basis);
        row = best;
      }
    }
    return { sale: sale, row: row, listing: listing, comps: comps, own: own };
  }

  return {
    moneyOf, saleDateMs, ownSaleWeight, ownSaleSpread, ownSaleIndex, ownSaleBasis, ownSaleNoteBasis, ownSaleSource, specificPage,
    isListingHost, stateOf, zipOf, placeOf, cityKey, unitOfPart, streetParts, sameStreetLine, samePlace,
    ownSaleAnchor, valueWithOwnSale, ownSaleFrom, streetKey, sameBuilding,
    OWN_SALE_MAX_YEARS, OWN_SALE_FULL_YEARS, OWN_SALE_WEIGHT_NEW, OWN_SALE_HALF, OWN_SALE_MIN_WEIGHT,
    OWN_SALE_DISAGREE, OWN_SALE_COMPS_PULL, OWN_SALE_MIN_PRICE,
    OWN_SALE_SPREAD_BASE, OWN_SALE_SPREAD_PER_YEAR, OWN_SALE_TREND_CAP, OWN_SALE_INDEX_CAP,
    OWN_SALE_SCOPE_TOL, OWN_SALE_PSF_MIN, OWN_SALE_PSF_MAX,
    OWN_SALE_BASIS_WORDS, OWN_SALE_HALF_BASES, OWN_SALE_LEADS_AT, OWN_SALE_ASK_MATCH, OWN_SALE_TYPES, NON_DISCLOSURE, LISTING_HOSTS,
    isNetLease, NET_LEASE_TYPES, NET_LEASE_CENTER_TYPE,
    capRateOf, capRateBand, netLeaseValue, impliedCapRate,
    CAP_RATE_MIN, CAP_RATE_MAX, CAP_BAND_MIN_COMPS,
    numericValue, salePsfOf, robustPpsfRange, BAND_LOW_PCT, BAND_HIGH_PCT, heroRound,
    TIER_WEIGHT, tierOf, compDateMs, isOnMarket, compAgeYears, yearOf, distanceMiles, distanceHalfLifeMiles,
    defaultFreePassMiles, constructionMismatch, CONSTRUCTION_MISMATCH,
    parseRadiusMiles, radiusClaimContradicted, RADIUS_CLAIM_SLACK,
    priceTierFactor, PRICE_TIER_RATIO,
    compWeight, trendFactor,
    sizeRestateFactor, SIZE_ELASTICITY, SIZE_RESTATE_MAX_RATIO, countedPsf,
    valueFromComps, outlierOf, OUTLIER_PCT, subjectSizeFit, askFit,
    conditionSpread, unexplainedGain, conditionFit, CONDITION_RANK,
  };
});

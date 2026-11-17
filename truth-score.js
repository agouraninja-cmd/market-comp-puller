// ---------------------------------------------------------------------------
// The truth test: how far a REAL report lands from a REAL closed price.
//
// The three accuracy instruments before this one each hold something fixed:
//
//   backtest.js / scripts/accuracy-lab.js   the MATH, over comps already in
//                                           the corpus. No search runs, and
//                                           most of its answer key is asking
//                                           prices (corpus.md says so).
//   run-eval.js / eval-score.js             the SEARCH, scored on proxies
//                                           (comp count, provenance, window).
//                                           It has no answer key at all.
//
// Neither can say the one thing an owner asks: "this building sold for
// $5,250,000; what did CompNinja say it was worth?" This does. A truth set
// (truth-set.json) lists buildings with a known CLOSED price, the runner
// (scripts/truth-test.js) puts each address through a real /api/comps search,
// and this module values the report with the hero's own arithmetic and
// measures the miss.
//
// PURE, like eval-score.js and backtest.js: no I/O, no fetch, no clock reads
// (the caller passes `ranAt`). The runner owns every side effect.
//
// FOUR RULES THAT MAKE THE NUMBER HONEST
//
//   1. The number scored is the number a customer sees. The value comes from
//      BULK.valueFromReport, which is renderOwnerHero reduced to its
//      arithmetic over valuation.js. Nothing here re-derives a band.
//   2. The building never prices itself. A comp that IS the subject (same
//      street line, or the same price beside the same size or date) is
//      removed before valuing and counted (`leakedComps`), because a report
//      that quotes the subject's own sale back is not an estimate.
//   3. Peeking is measured, not assumed away. The search looks up the
//      subject's own last sale on purpose (`subject_last_sale`), so for a
//      sale already on the web the model usually KNOWS the answer even though
//      the math never reads it. Every row records whether it did
//      (`knewPrice`), and the summary splits the miss on it. The clean group
//      is a sale the web does not hold: a private closed deal, or a
//      prediction made BEFORE the closing (`prospective`).
//   4. The truth price never leaves this module's caller. The runner sends an
//      address and a type, exactly as a search does. A price in the request
//      would be the answer in the prompt.
//
// The vocabulary is the appraisal industry's for automated valuations, and
// the same names backtest.js and the lab already print: median absolute
// error, share within 10% and 20%, bias (the median SIGNED error), hit rate
// (could it value the building at all), and how often the real price landed
// between Low and High.
// ---------------------------------------------------------------------------

"use strict";

const VALUATION = require("./valuation");
const BULK = require("./bulk");
const BACKTEST = require("./backtest");

const TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];

// The window a search of each type runs with when nobody changes it.
// ⚠ MIRRORS index.html RECOMMENDED_LOOKBACK, entry for entry: the truth test
// has to ask for the report a customer gets, and a customer gets this window.
// test/truth-score.test.js reads index.html and compares the two.
const LOOKBACK_MONTHS = { Industrial: 24, Office: 24, Retail: 12, Multifamily: 6, Land: 24, Residential: 6 };

// Below this many scored buildings the headline is printed with a warning:
// a median over a handful swings too far to tune against. backtest.js's floor.
const MIN_SCORED = 20;

// A sale older than this is still scored, but today's report is then being
// compared with an old price, and the "as of the sale" figures are the fair
// ones. The runner says so in its plan.
const STALE_MONTHS = 18;

const SQFT_PER_ACRE = 43560;

const num = VALUATION.numericValue;

// ---- reading a truth entry -------------------------------------------------

// "$12,450,000", 12450000, "12.45M", "$1.2 million". Null when it names no
// positive amount. numericValue alone reads "$1.2M" as 1.2, which is the
// shorthand hazard valuation.js warns about; a truth file is hand-keyed and a
// model writes subject_last_sale.price, so both spellings arrive here.
function moneyOf(v) {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const t = String(v == null ? "" : v).replace(/[$,\s]/g, "").toLowerCase();
  const m = t.match(/^(\d+(?:\.\d+)?)(k|thousand|mm|m|million|b|billion)?$/);
  if (!m) return null;
  const mult = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[m[2]] || 1;
  const n = Number(m[1]) * mult;
  return n > 0 ? n : null;
}

// "2026-03" or "2026-03-14". Returns { y, m, d|null }, or null.
function parseSaleDate(s) {
  const m = String(s == null ? "" : s).trim().match(/^((?:19|20)\d{2})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = m[3] ? Number(m[3]) : null;
  if (mo < 1 || mo > 12) return null;
  if (d != null && (d < 1 || d > 31)) return null;
  return { y, m: mo, d };
}

// The instant the sale is valued "as of": the closing day, or mid-month when
// only the month is known (under two weeks of error against a two-year
// recency half-life, backtest.js's own reading).
function saleMs(date) {
  return Date.UTC(date.y, date.m - 1, date.d || 15);
}

// The last moment a comp may be dated and still count as "known before the
// sale": the end of the sale's month, plus a day and a half. parseDealDate
// and compDateMs both read "Mar 2026" at month granularity, so a comp in the
// sale's own month is known history, not a look-ahead (backtest.js's rule);
// the slack covers compDateMs reading a month in LOCAL time.
function saleCutoffMs(date) {
  return Date.UTC(date.y, date.m, 1) + 36 * 3600 * 1000;
}

// "1200 W Industrial Blvd, Dallas, TX 75207" -> "Dallas, TX". "" when the
// address does not end "City, ST".
function marketOf(address) {
  const parts = String(address || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const state = (parts[parts.length - 1].match(/^([A-Za-z]{2})\b/) || [])[1];
  return state ? parts[parts.length - 2] + ", " + state.toUpperCase() : "";
}

// One truth entry, checked and put in one shape. Returns { entry } or
// { error }. An entry with no sale_price is OPEN: a building that has not
// closed yet. It is still searched, and its prediction is stored, so that
// filling the price in later scores a figure the model could not have peeked
// at (see `prospective`).
function normalizeTruth(raw, opts) {
  const r = raw || {};
  const id = String(r.id || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) {
    return { error: "id must be 2-40 characters of a-z, 0-9 and dashes (got " + JSON.stringify(r.id) + ")" };
  }
  const bad = (msg) => ({ error: id + ": " + msg });
  const address = String(r.address || "").trim().replace(/\s+/g, " ");
  if (!/^\d/.test(address)) return bad("address must start with a street number");
  if (!marketOf(address)) return bad('address must end "City, ST" or "City, ST 12345"');
  if (TYPES.indexOf(r.type) < 0) return bad("type must be one of " + TYPES.join(", "));

  const hasPrice = !(r.sale_price == null || r.sale_price === "");
  const price = hasPrice ? moneyOf(r.sale_price) : null;
  if (hasPrice && !(price > 0)) return bad("sale_price is not an amount: " + JSON.stringify(r.sale_price));
  const hasDate = !(r.sale_date == null || r.sale_date === "");
  const date = hasDate ? parseSaleDate(r.sale_date) : null;
  if (hasDate && !date) return bad('sale_date must be "YYYY-MM" or "YYYY-MM-DD"');
  if (price && !date) return bad("a sale_price needs its sale_date (the closing month)");
  if (date && !price) return bad("a sale_date needs its sale_price; leave both out for a sale that has not closed");

  const positive = (v, name) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : num(v);
    if (!(n > 0)) throw new Error(name + " is not a positive number: " + JSON.stringify(v));
    return n;
  };
  let size, units, acres, months;
  try {
    size = positive(r.size_sqft, "size_sqft");
    units = positive(r.units, "units");
    acres = positive(r.lot_acres, "lot_acres");
    months = positive(r.months, "months");
  } catch (e) { return bad(e.message); }
  // A land parcel's size IS its lot, so either spelling fills the other.
  if (r.type === "Land") {
    if (!size && acres) size = Math.round(acres * SQFT_PER_ACRE);
    if (!acres && size) acres = Math.round((size / SQFT_PER_ACRE) * 100) / 100;
  }

  return {
    entry: {
      id, address, type: r.type,
      market: marketOf(address),
      sale_price: price, sale_date: date ? String(r.sale_date).trim() : null,
      size_sqft: size, units, lot_acres: acres,
      months: months ? Math.min(120, Math.round(months)) : LOOKBACK_MONTHS[r.type],
      source: String(r.source || "").trim(),
      checked: r.checked === true,
      private: Boolean(opts && opts.private),
      note: String(r.note || "").trim(),
    },
  };
}

// A whole set. Problems are returned, never thrown: the runner prints every
// one and refuses to spend while any stand, because a typo in the answer key
// is a wrong score that looks like a right one.
function normalizeSet(rawEntries, opts) {
  const entries = [], problems = [];
  const ids = new Set(), streets = new Map();
  (Array.isArray(rawEntries) ? rawEntries : []).forEach((raw, i) => {
    const r = normalizeTruth(raw, opts);
    if (r.error) { problems.push("entry " + (i + 1) + ": " + r.error); return; }
    const e = r.entry;
    if (ids.has(e.id)) { problems.push(e.id + ": this id is used twice"); return; }
    ids.add(e.id);
    // One building, one row: scoring it twice would count one search's luck
    // twice (backtest.js's duplicateAddress rule, for the same reason).
    const street = BACKTEST.normAddress(e.address) + "|" + e.market.toLowerCase();
    if (streets.has(street)) {
      problems.push(e.id + ": same building as " + streets.get(street) + " (" + e.address + ")");
      return;
    }
    streets.set(street, e.id);
    entries.push(e);
  });
  return { entries, problems };
}

// ---- the building must not price itself ------------------------------------

function isLease(c) {
  return String((c && c.transaction) || "").toLowerCase().startsWith("lease");
}

// Is this comp the subject's own sale?
//
// By address: backtest.js's street-line key (suffixes and directionals folded,
// the ZIP out of reach), also matching when one key extends the other at a
// word boundary, so "500 W Madison St Suite 200" is still 500 W Madison St.
//
// By deal: the same price to within half a percent, beside the same size
// (within 5%) or the same closing month (within about two months). That is
// the comp a model writes under a building NAME or a re-spelled street, and
// backtest.js's isSameProperty makes the same argument: a real second
// building essentially never shares both figures. Price alone is not enough;
// two pads in one market do both sell for $2,000,000.
function isSubjectComp(comp, truth) {
  if (!comp || !truth) return false;
  const a = BACKTEST.normAddress(comp.address), b = BACKTEST.normAddress(truth.address);
  if (a && b && (a === b || a.startsWith(b + " ") || b.startsWith(a + " "))) return true;

  const price = truth.sale_price;
  if (!(price > 0) || isLease(comp)) return false;
  const p = moneyOf(comp.price_or_rate);
  if (!(p > 0) || Math.abs(p - price) / price > 0.005) return false;
  const cs = num(comp.size_sqft);
  if (cs > 0 && truth.size_sqft > 0) return Math.abs(cs - truth.size_sqft) / truth.size_sqft <= 0.05;
  const date = parseSaleDate(truth.sale_date);
  const cd = VALUATION.compDateMs(comp.date);
  if (date && Number.isFinite(cd)) return Math.abs(cd - saleMs(date)) <= 62 * 24 * 3600 * 1000;
  return false;
}

// ---- valuing a report the way the page does --------------------------------

// Land, per acre. ⚠ MIRRORS index.html altBasisRange + the `leadWithAlt`
// branch of renderOwnerHero, reduced to arithmetic: every sale comp carrying
// a price per acre, three or more of them, through valuation.js's own
// composition with `readValue`, size-neutral, times the acreage. The hero
// leads with this for Land whenever the acreage is known (typed, or the lot
// size over 43,560), and $/SF would be the wrong test of it: salePsfOf
// refuses a figure under $1/SF, which is most raw land. bulk.js has no such
// branch (a bulk row quotes land per SF), which is why it lives here.
function landPerAcre(report, comps, acres, asOf) {
  if (!(acres > 0)) return null;
  const carriers = comps.filter((c) => c && !isLease(c) && num(c.price_per_acre) > 0);
  if (carriers.length < 3) return null;
  const val = VALUATION.valueFromComps(carriers, {
    subjectSF: 0, asOf,
    trendPct: report.annual_price_trend_pct,
    subjectYear: VALUATION.yearOf(report.subject_year_built),
    propertyType: "Land",
    readValue: (c) => num(c.price_per_acre),
  });
  if (!val) return null;
  return {
    basis: "acre", sized: true,
    low: VALUATION.heroRound(val.psfLow * acres),
    likely: VALUATION.heroRound(val.psfMid * acres),
    high: VALUATION.heroRound(val.psfHigh * acres),
    per_low: val.psfLow, per_mid: val.psfMid, per_high: val.psfHigh,
    sale_comps: val.n, trimmed: val.trimmed === true,
  };
}

// One valuation of one report. `o.comps` is the comp list to value from (the
// subject's own sale already removed), `o.sizeSqft` a size to TYPE in place of
// the report's own lookup (the truth's, for the "true size" reading), `o.asOf`
// the valuation instant, `o.acres` the truth's acreage for land.
//
// Null when the page would show no dollar range at all: fewer than two priced
// sale comps (renderOwnerHero's `sfUsable` bar, and eval-score.js's
// valuationPossible). `sized: false` when there is a $/SF band but no size
// to multiply it by, which is a different, fixable answer (bulk.js says why).
function valueReport(report, truth, o) {
  const opts = o || {};
  const rep = Object.assign({}, report || {}, { comps: opts.comps || [] });
  const typed = opts.sizeSqft > 0 ? opts.sizeSqft : null;
  const found = num(rep.subject_size_sqft);
  const size = typed || (found > 0 ? found : 0);

  if (truth.type === "Land") {
    // The hero's acresFromLot: the lot size over 43,560, to two places.
    const acres = opts.acres > 0 ? opts.acres : (size > 0 ? Math.round((size / SQFT_PER_ACRE) * 100) / 100 : 0);
    const land = landPerAcre(rep, rep.comps, acres, opts.asOf);
    if (land) {
      return Object.assign(land, {
        size_sqft: size || null,
        size_source: typed ? "typed" : (size > 0 ? (rep.subject_size_source || "estimate") : null),
      });
    }
  }

  const v = BULK.valueFromReport(rep, {
    subjectSizeSqft: typed, asOf: opts.asOf, propertyType: truth.type, note: "",
  });
  if (!v || v.sale_comps < 2) return null;
  return {
    basis: "sf", sized: v.sized,
    low: v.value_low, likely: v.value_likely, high: v.value_high,
    per_low: v.psf_low, per_mid: v.psf_mid, per_high: v.psf_high,
    size_sqft: v.size_sqft,
    size_source: typed ? "typed" : v.size_source,
    sale_comps: v.sale_comps, trimmed: v.trimmed,
  };
}

// A dollar valuation against the price it should have named.
function missOf(v, price) {
  if (!v || !v.sized || !(v.likely > 0) || !(price > 0)) return null;
  const error = (v.likely - price) / price;
  return {
    low: v.low, likely: v.likely, high: v.high,
    error, absError: Math.abs(error),
    inRange: price >= v.low && price <= v.high,
    rangeWidth: (v.high - v.low) / v.likely,
    sale_comps: v.sale_comps, trimmed: v.trimmed, basis: v.basis,
  };
}

// ---- one building ----------------------------------------------------------

// `report` is the /api/comps body for this truth entry; `opts.ranAt` (epoch
// ms) is when the search ran, and is the valuation's "today". `opts.typedSize`
// says the runner sent the truth's size with the request (--typed-size), so
// the report was a "the owner knows their square footage" report.
//
// status:
//   scored    a dollar range, and a closed price to hold it against
//   open      a dollar range, and no closed price yet (a stored prediction)
//   unsized   a $/SF band, but no building size found: no dollar figure
//   no_value  fewer than two priced sale comps: the page shows dashes
function scoreTarget(report, truth, opts) {
  const o = opts || {};
  const rep = report || {};
  const ranAt = Number(o.ranAt);
  const all = Array.isArray(rep.comps) ? rep.comps.filter(Boolean) : [];
  const leaked = all.filter((c) => isSubjectComp(c, truth));
  const comps = all.filter((c) => !isSubjectComp(c, truth));
  const price = truth.sale_price;
  const date = parseSaleDate(truth.sale_date);

  // 1. As served: the report's own size lookup (or the typed size, when the
  //    run sent one), every comp but the subject, valued "today".
  const served = valueReport(rep, truth, {
    comps, asOf: ranAt,
    sizeSqft: o.typedSize ? truth.size_sqft : null,
    acres: o.typedSize ? truth.lot_acres : null,
  });

  // 2. The true size typed in. Takes the size LOOKUP out of the miss, leaving
  //    the comps and the math: the hero multiplies the size, so a wrong one
  //    is the whole error and says nothing about the comps under it.
  const trueSize = truth.size_sqft > 0
    ? valueReport(rep, truth, { comps, asOf: ranAt, sizeSqft: truth.size_sqft, acres: truth.lot_acres })
    : null;

  // 3. As of the sale: only comps dated on or before the closing month,
  //    valued at the closing date. No look-ahead, the backtest's rule. Null
  //    unless at least three sale comps survive the cut.
  let asOfSale = null, asOfComps = 0;
  if (date) {
    const cutoff = saleCutoffMs(date);
    const before = comps.filter((c) => {
      const d = VALUATION.compDateMs(c.date);
      return Number.isFinite(d) && d <= cutoff;
    });
    asOfComps = before.filter((c) => !isLease(c)).length;
    if (asOfComps >= 3) {
      asOfSale = valueReport(rep, truth, {
        comps: before, asOf: saleMs(date),
        sizeSqft: truth.size_sqft || null, acres: truth.lot_acres,
      });
    }
  }

  // The size lookup itself, when both sides have one.
  const foundSize = num(rep.subject_size_sqft);
  const size = {
    truth: truth.size_sqft || null,
    found: foundSize > 0 ? foundSize : null,
    error: truth.size_sqft > 0 && foundSize > 0 ? (foundSize - truth.size_sqft) / truth.size_sqft : null,
  };

  // Did the report find the subject's own sale? `matches` is null when it
  // named a sale with no price, false when it named a different (earlier)
  // sale: only a price within 2% of the truth counts as knowing the answer.
  const ls = rep.subject_last_sale && typeof rep.subject_last_sale === "object" ? rep.subject_last_sale : null;
  const lsPrice = ls ? moneyOf(ls.price) : null;
  const ownSale = {
    found: Boolean(ls && (ls.date || ls.price)),
    price: lsPrice,
    matches: lsPrice && price ? Math.abs(lsPrice - price) / price <= 0.02 : null,
  };
  const knewPrice = ownSale.matches === true || leaked.length > 0;

  let status;
  if (!served) status = "no_value";
  else if (!served.sized) status = "unsized";
  else status = price > 0 ? "scored" : "open";

  const row = {
    id: truth.id, type: truth.type, market: truth.market, address: truth.address,
    private: truth.private === true, checked: truth.checked === true,
    status,
    ranAt: Number.isFinite(ranAt) ? ranAt : null,
    truth: { price: price || null, date: truth.sale_date || null, size_sqft: truth.size_sqft || null },
    // The prediction itself, kept even when there is nothing to score it
    // against yet. This is what an open entry is run FOR.
    served: served && served.sized
      ? { low: served.low, likely: served.likely, high: served.high, basis: served.basis,
          size_sqft: served.size_sqft, size_source: served.size_source,
          sale_comps: served.sale_comps, trimmed: served.trimmed }
      : null,
    miss: missOf(served, price),
    trueSize: missOf(trueSize, price),
    asOfSale: missOf(asOfSale, price),
    asOfComps,
    size,
    ownSale,
    askFound: Boolean(rep.subject_asking && rep.subject_asking.price),
    leakedComps: leaked.length,
    knewPrice,
    comps: all.length,
    saleComps: comps.filter((c) => !isLease(c)).length,
    typedSize: Boolean(o.typedSize),
    // A prediction made before the closing date cannot have peeked: the
    // price did not exist yet. Month-only sale dates count from mid-month.
    prospective: Boolean(date && Number.isFinite(ranAt) && ranAt < saleMs(date)),
    monthsSinceSale: date && Number.isFinite(ranAt)
      ? Math.round(((ranAt - saleMs(date)) / (30.44 * 24 * 3600 * 1000)) * 10) / 10
      : null,
  };
  return row;
}

// ---- a set of buildings ----------------------------------------------------

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);

// Deterministic, so two readings of one run print the same interval
// (scripts/accuracy-lab.js's generator, for its reason).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A 90% interval for a statistic of `items`, by resampling the items. Each
// building is its own search, so the building is the unit; the lab resamples
// whole markets instead because its subjects share one pool of peers.
function bootstrap(items, stat, draws) {
  if (items.length < 2) return null;
  const rand = mulberry32(20261117);
  const out = [];
  for (let d = 0; d < (draws || 2000); d++) {
    const sample = [];
    for (let i = 0; i < items.length; i++) sample.push(items[Math.floor(rand() * items.length)]);
    const v = stat(sample);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  if (!out.length) return null;
  out.sort((a, b) => a - b);
  return { lo: out[Math.floor(out.length * 0.05)], hi: out[Math.min(out.length - 1, Math.floor(out.length * 0.95))] };
}

// The standard reading of a list of misses.
function reading(misses) {
  const abs = misses.map((m) => m.absError);
  return {
    n: misses.length,
    medianAbsError: median(abs),
    interval: bootstrap(abs, median),
    within10: share(abs, (a) => a <= 0.10),
    within20: share(abs, (a) => a <= 0.20),
    // Signed: above zero the tool runs HIGH, below zero it runs low.
    bias: median(misses.map((m) => m.error)),
    rangeCoverage: share(misses, (m) => m.inRange),
    medianRangeWidth: median(misses.map((m) => m.rangeWidth)),
  };
}

function summarize(rows, opts) {
  const o = opts || {};
  const minScored = o.minScored == null ? MIN_SCORED : o.minScored;
  const all = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const failed = all.filter((r) => r.status === "failed");
  const ran = all.filter((r) => r.status !== "failed");
  const scored = ran.filter((r) => r.status === "scored" && r.miss);
  // Hit rate is over buildings a search finished on: could the report put a
  // dollar range on it? An open entry counts (it got a range); a failed
  // search does not (it says nothing about the building, rerun it).
  const valued = ran.filter((r) => r.status === "scored" || r.status === "open");
  const pick = (key) => ran.filter((r) => r[key]).map((r) => r[key]);
  const of = (rs) => reading(rs.map((r) => r.miss));

  const sizePairs = ran.filter((r) => r.size && r.size.error != null && !r.typedSize);
  const sizeWanted = ran.filter((r) => r.size && r.size.truth && !r.typedSize);

  const types = Array.from(new Set(scored.map((r) => r.type))).sort();
  const knew = scored.filter((r) => r.knewPrice);
  const blind = scored.filter((r) => !r.knewPrice);

  return {
    targets: all.length,
    failed: failed.length,
    scored: scored.length,
    open: ran.filter((r) => r.status === "open").length,
    unsized: ran.filter((r) => r.status === "unsized").length,
    noValue: ran.filter((r) => r.status === "no_value").length,
    hitRate: ran.length ? valued.length / ran.length : null,
    minScored,
    belowFloor: scored.length < minScored,
    unchecked: ran.filter((r) => !r.checked).length,

    // As a customer sees it.
    headline: of(scored),
    // Where the miss comes from.
    trueSize: reading(pick("trueSize")),
    asOfSale: reading(pick("asOfSale")),
    sizeLookup: {
      n: sizePairs.length,
      medianAbsError: median(sizePairs.map((r) => Math.abs(r.size.error))),
      within10: share(sizePairs, (r) => Math.abs(r.size.error) <= 0.10),
      missing: sizeWanted.filter((r) => !r.size.found).length,
      wanted: sizeWanted.length,
    },
    // Did it peek.
    peek: {
      ownSaleFound: ran.filter((r) => r.ownSale && r.ownSale.found).length,
      ownSaleMatched: ran.filter((r) => r.ownSale && r.ownSale.matches === true).length,
      leakedComps: ran.reduce((s, r) => s + (r.leakedComps || 0), 0),
      targetsWithLeak: ran.filter((r) => r.leakedComps > 0).length,
      knewPrice: of(knew),
      didNotKnow: of(blind),
      prospective: of(scored.filter((r) => r.prospective)),
    },
    byType: types.map((t) => Object.assign({ type: t }, of(scored.filter((r) => r.type === t)))),
    worst: scored.slice().sort((a, b) => b.miss.absError - a.miss.absError).slice(0, 5)
      .map((r) => ({ id: r.id, type: r.type, error: r.miss.error })),
  };
}

// Two runs over the same buildings, pair for pair: did the change make the
// tool more right? Only buildings scored in BOTH count, so a run that simply
// failed on its hard targets cannot win by leaving them out. Negative
// `change` is better. The interval resamples the pairs; one that straddles
// zero is a coin flip (the lab's first rule).
function compare(baseRows, candRows) {
  const base = new Map((baseRows || []).filter((r) => r && r.miss).map((r) => [r.id, r]));
  const pairs = [];
  (candRows || []).forEach((r) => {
    const b = r && r.miss ? base.get(r.id) : null;
    if (b) pairs.push({ id: r.id, type: r.type, base: b.miss.absError, cand: r.miss.absError });
  });
  const stat = (ps) => (ps.length ? median(ps.map((p) => p.cand)) - median(ps.map((p) => p.base)) : null);
  const moved = pairs.filter((p) => p.cand !== p.base);
  return {
    pairs: pairs.length,
    baseMedian: median(pairs.map((p) => p.base)),
    candMedian: median(pairs.map((p) => p.cand)),
    change: stat(pairs),
    interval: bootstrap(pairs, stat),
    better: moved.filter((p) => p.cand < p.base).length,
    worse: moved.filter((p) => p.cand > p.base).length,
    onlyInBase: (baseRows || []).filter((r) => r && r.miss && !pairs.some((p) => p.id === r.id)).length,
    onlyInCand: (candRows || []).filter((r) => r && r.miss && !base.has(r.id)).length,
  };
}

// What may be committed about one row. A PRIVATE entry is somebody's closed
// deal that is not public record (Idaho is a non-disclosure state), so its
// row keeps the percentages and loses everything that could name the building
// or its price: the address, the market, the price, and every dollar figure,
// since a dollar estimate beside its percentage error IS the price.
function publicRow(row) {
  if (!row) return row;
  if (!row.private) return row;
  const pct = (m) => (m ? {
    error: m.error, absError: m.absError, inRange: m.inRange, rangeWidth: m.rangeWidth,
    sale_comps: m.sale_comps, trimmed: m.trimmed, basis: m.basis,
  } : null);
  return {
    id: row.id, type: row.type, private: true, checked: row.checked, status: row.status,
    ranAt: row.ranAt,
    miss: pct(row.miss), trueSize: pct(row.trueSize), asOfSale: pct(row.asOfSale),
    asOfComps: row.asOfComps,
    size: row.size ? { error: row.size.error, found: row.size.found != null, truth: row.size.truth != null } : null,
    ownSale: row.ownSale ? { found: row.ownSale.found, matches: row.ownSale.matches } : null,
    askFound: row.askFound, leakedComps: row.leakedComps, knewPrice: row.knewPrice,
    comps: row.comps, saleComps: row.saleComps, typedSize: row.typedSize,
    prospective: row.prospective, monthsSinceSale: row.monthsSinceSale,
    ...(row.error ? { error: row.error } : {}),
  };
}

module.exports = {
  TYPES, LOOKBACK_MONTHS, MIN_SCORED, STALE_MONTHS,
  moneyOf, parseSaleDate, saleMs, saleCutoffMs, marketOf,
  normalizeTruth, normalizeSet,
  isSubjectComp, valueReport, missOf, scoreTarget,
  median, bootstrap, reading, summarize, compare, publicRow,
};

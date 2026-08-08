// ---------------------------------------------------------------------------
// The gut check: a broker's private numbers against the public market layer.
//
// Spec: docs/superpowers/specs/2026-08-08-gut-check-design.md
//
// PURE, and dual-exported exactly like valuation.js: Node gets a CommonJS
// module (so npm test exercises the whole decision table), the browser gets
// the global GUTCHECK (so /vault runs the SAME copy — a second copy of these
// rules is how a tested number and a rendered number quietly diverge).
//
// Direction of data: public benchmarks in, verdicts out. Nothing in this file
// ever sees the database, and the vault comps it reads stay in the caller.
//
// Honesty is part of the contract, not the UI's problem alone: verdicts carry
// counts, dates and both benchmark halves so the panel CAN label every number
// with its provenance. A divergence is a flashlight, never a grade — the
// broker's private comps may well be the better data.
// ---------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GUTCHECK = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The corpus half of a band needs the same coverage corpusIsStrong() trusts;
  // a cap-rate median under 3 values is an anecdote; one cap comp is not a
  // practice pattern; and 25% is wide on purpose — an outlier flag should be
  // explainable ("40% above the market band"), not a statistical test.
  const MIN_CORPUS_PPSF = 4;
  const MIN_CORPUS_CAP = 3;
  const MIN_BROKER_CAP = 2;
  const OUTLIER_PCT = 0.25;

  // Corpus provenance too weak to benchmark against: an estimate is a guess
  // and a news figure is unverified — same exclusion retrieval and the
  // backtest already apply.
  const BAD_PROVENANCE = { estimate: true, news: true };

  function toNum(v) {
    if (v == null || v === "") return null;
    const m = String(v).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return isFinite(n) ? n : null;
  }

  function median(xs) {
    if (!xs.length) return null;
    const s = xs.slice().sort(function (a, b) { return a - b; });
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }

  function pct(sorted, p) {
    const n = sorted.length;
    if (!n) return null;
    const r = (p / 100) * (n - 1);
    const lo = Math.floor(r), hi = Math.ceil(r);
    return lo === hi ? sorted[lo] : sorted[lo] + (r - lo) * (sorted[hi] - sorted[lo]);
  }

  function isSale(t) {
    return !String(t == null ? "" : t).toLowerCase().startsWith("lease");
  }

  function round2(v) { return v == null ? null : Math.round(v * 100) / 100; }

  // Raw corpus rows -> the `corpus` benchmark block. Server-side use (the
  // endpoint calls this), but it lives here so the aggregation is tested with
  // everything else. parseDealDate is INJECTED — same rule as corpus-audit.js:
  // this module must never disagree with server.js about what a date means.
  function corpusStats(rows, opts) {
    const parseDealDate = (opts && opts.parseDealDate) || function () { return null; };
    const usable = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && !BAD_PROVENANCE[String(r.source_type || "").toLowerCase()] &&
        isSale(r.transaction);
    });
    const priced = usable
      .map(function (r) { return { psf: toNum(r.price_per_sqft), deal_date: r.deal_date }; })
      .filter(function (r) { return r.psf != null && r.psf > 0; });
    const ppsf = priced.map(function (r) { return r.psf; }).sort(function (a, b) { return a - b; });
    // Cap rates parse defensively out of a text column; a rate outside (0, 25)
    // is a typo or a different unit, not a market signal.
    const caps = usable
      .map(function (r) { return toNum(r.cap_rate); })
      .filter(function (v) { return v != null && v > 0 && v < 25; });
    if (!ppsf.length && !caps.length) return null;

    let newest = null, newestKey = -Infinity;
    priced.forEach(function (r) {
      const k = parseDealDate(r.deal_date);
      if (k != null && k > newestKey) { newestKey = k; newest = String(r.deal_date); }
    });

    return {
      count: ppsf.length,
      median_ppsf: round2(pct(ppsf, 50)),
      q1_ppsf: round2(pct(ppsf, 25)),
      q3_ppsf: round2(pct(ppsf, 75)),
      newest_deal_date: newest,
      cap_rate_median: caps.length >= MIN_CORPUS_CAP ? round2(median(caps)) : null,
      cap_rate_count: caps.length,
    };
  }

  function bucketKeyOf(market, type) {
    return String(market == null ? "" : market) + "|" + String(type == null ? "" : type);
  }

  // The market band the verdict runs against: the union of every half that
  // clears its floor. Union, not intersection — two honest sources that
  // disagree should widen what "in line" means, never narrow it.
  function bandOf(corpus, snapshot) {
    const lows = [], highs = [];
    if (corpus && Number(corpus.count) >= MIN_CORPUS_PPSF &&
        toNum(corpus.q1_ppsf) != null && toNum(corpus.q3_ppsf) != null) {
      lows.push(toNum(corpus.q1_ppsf)); highs.push(toNum(corpus.q3_ppsf));
    }
    const sp = snapshot && snapshot.ppsf;
    if (sp && toNum(sp.low) != null && toNum(sp.high) != null) {
      lows.push(toNum(sp.low)); highs.push(toNum(sp.high));
    }
    if (!lows.length) return null;
    return { low: Math.min.apply(null, lows), high: Math.max.apply(null, highs) };
  }

  // Delta is % from the NEAREST band edge, signed: +25 means 25% above the
  // top of the band, -25 means 25% below the bottom.
  function verdictFor(value, band) {
    if (value == null || !band || !(band.high >= band.low)) {
      return { verdict: "no_data", delta_pct: null };
    }
    if (value > band.high) {
      return { verdict: "above", delta_pct: Math.round(((value - band.high) / band.high) * 100) };
    }
    if (value < band.low) {
      return { verdict: "below", delta_pct: -Math.round(((band.low - value) / band.low) * 100) };
    }
    return { verdict: "in_line", delta_pct: null };
  }

  // Vault comps + benchmark buckets -> per-bucket verdicts and outlier flags.
  // Browser-side use. Reads the STORED price_per_sqft only (sales-only by
  // construction — the vault leaves it null on leases) and never derives one.
  function gutCheck(comps, benchBuckets) {
    const bench = {};
    (Array.isArray(benchBuckets) ? benchBuckets : []).forEach(function (b) {
      if (b) bench[bucketKeyOf(b.market, b.type)] = b;
    });
    const by = {}, order = [];
    (Array.isArray(comps) ? comps : []).forEach(function (c) {
      if (!c || typeof c !== "object") return;
      const k = bucketKeyOf(c.market, c.property_type);
      if (!by[k]) { by[k] = []; order.push(k); }
      by[k].push(c);
    });

    const buckets = [], outliers = {};
    order.forEach(function (k) {
      const list = by[k];
      const sales = list.filter(function (c) {
        const p = toNum(c.price_per_sqft);
        return isSale(c.transaction) && p != null && p > 0;
      });
      if (!sales.length) return;   // nothing to check in this bucket

      const b = bench[k] || {};
      const corpus = b.corpus || null;
      const snapshot = b.snapshot || null;
      const band = bandOf(corpus, snapshot);
      const med = round2(median(sales.map(function (c) { return toNum(c.price_per_sqft); })));
      const v = verdictFor(med, band);

      // Cap rates: a verdict needs a RANGE, and only the snapshot has one —
      // the corpus median is a point and rides along as a supporting figure.
      const capVals = list.map(function (c) { return toNum(c.cap_rate); })
        .filter(function (x) { return x != null && x > 0 && x < 25; });
      let cap = null;
      const capLow = snapshot ? toNum(snapshot.cap_rate_low) : null;
      const capHigh = snapshot ? toNum(snapshot.cap_rate_high) : null;
      if (capVals.length >= MIN_BROKER_CAP && capLow != null && capHigh != null && capHigh >= capLow) {
        const cm = round2(median(capVals));
        const cv = verdictFor(cm, { low: capLow, high: capHigh });
        cap = { verdict: cv.verdict, delta_pct: cv.delta_pct, median: cm,
          count: capVals.length, low: capLow, high: capHigh,
          corpus_median: corpus ? corpus.cap_rate_median : null };
      }

      // Outliers only fire when the bucket verdict has real data behind it:
      // no benchmark, no flags.
      const outlierIds = [];
      if (v.verdict !== "no_data") {
        sales.forEach(function (c) {
          const p = toNum(c.price_per_sqft);
          if (p > band.high * (1 + OUTLIER_PCT)) {
            outlierIds.push(c.id);
            outliers[c.id] = { dir: "above", pct: Math.round(((p - band.high) / band.high) * 100) };
          } else if (p < band.low * (1 - OUTLIER_PCT)) {
            outlierIds.push(c.id);
            outliers[c.id] = { dir: "below", pct: Math.round(((band.low - p) / band.low) * 100) };
          }
        });
      }

      buckets.push({
        market: String(list[0].market || ""), type: String(list[0].property_type || ""),
        broker: { count: list.length, pricedSales: sales.length,
          median_ppsf: med, cap_count: capVals.length },
        corpus: corpus, snapshot: snapshot, band: band,
        verdict: v.verdict, delta_pct: v.delta_pct, cap: cap,
        outlierIds: outlierIds,
      });
    });

    buckets.sort(function (a, b) { return b.broker.pricedSales - a.broker.pricedSales; });
    return { buckets: buckets, outliers: outliers };
  }

  return { corpusStats, gutCheck, bucketKeyOf,
    MIN_CORPUS_PPSF, MIN_CORPUS_CAP, MIN_BROKER_CAP, OUTLIER_PCT };
});

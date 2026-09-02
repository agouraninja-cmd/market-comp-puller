#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Resolve every market to its FRED series, ONCE, for every metric in
// scripts/fred-metrics.js — so that nothing ever resolves one at runtime.
//
//   node scripts/resolve-fred-series.js                    # every market, every metric
//   node scripts/resolve-fred-series.js --limit 5          # a sample
//   node scripts/resolve-fred-series.js --metric "Job growth (total nonfarm, YoY)"
//   node scripts/resolve-fred-series.js --write            # save fred-series.json
//
// WHY THIS EXISTS, and why its output must be READ rather than trusted:
//
// A FRED series id cannot be derived from a CBSA code. That was TESTED on
// 2026-09-02 rather than assumed: the BLS "SMS" id format embeds a state FIPS
// and an area code, and building ids that way found exactly one of 32 probed
// series. The area code is not reliably the CBSA code and the industry and
// datatype suffixes vary. So ids have to be searched for.
//
// The danger is that a WRONG id does not fail. FRED answers it with real,
// well-formed monthly employment for whichever metro owns it. Both are 200 OK,
// both parse, both produce a plausible ranking, and no test of the arithmetic
// downstream can tell them apart. Only a person reading the series TITLE
// against the market can.
//
// Hence: this script proposes, a human confirms, the answer is committed, and
// runtime reads only the committed file.
//
// Three refusals it has learned:
//   * a DISCONTINUED series. Los Angeles first resolved to LOSA106NA — "Los
//     Angeles-Long Beach-Santa Ana, CA (DISCONTINUED)", dead, under a retired
//     delineation name. It does not error; it returns real employment that
//     simply stopped, so LA would have frozen at its last observation forever.
//   * a series whose newest observation is stale, because FRED does not always
//     label a dormant one.
//   * a match on the full CBSA string. Names drift between delineation
//     vintages — Chicago lost WI, Atlanta swapped Alpharetta for Roswell — and
//     matching the whole string made the three largest markets in the country
//     resolve to nothing. Matching is on the leading city plus the first state
//     code plus a literal "(MSA)".
//
// Reads FRED_API_KEY from the environment or .env. READ-ONLY against FRED.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TIERS = path.join(ROOT, "market-tiers.json");
const OUT = path.join(ROOT, "fred-series.json");
const METRICS = require("./fred-metrics.js");

function loadKey() {
  if (process.env.FRED_API_KEY) return process.env.FRED_API_KEY.trim();
  try {
    const m = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/^FRED_API_KEY=(.*)$/m);
    if (m) return m[1].trim();
  } catch (e) { /* no .env is a normal state */ }
  return "";
}

const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const value = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

// 550ms is ~1.8 requests a second, inside FRED's documented 120-a-minute
// limit. This was 210ms and the cost was invisible: a throttled request comes
// back in a shape the resolver read as "no such series", so coverage sat at
// 42-92% and looked like genuine gaps in what BLS publishes for smaller
// metros. Slowing down took building permits from 42% to 93% with no other
// change. A rate limit that returns data rather than an error is the same
// class of failure as a wrong series id - plausible, wrong, and silent.
const PAUSE_MS = Number(value("pause", 550));
const STALE_DAYS = Number(value("stale", 400));   // quarterly and annual series need slack
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Flatten the catalog into [block, assetClass|null, metricName, spec].
const CATALOG = [];
for (const [k, spec] of Object.entries(METRICS.macro)) CATALOG.push(["macro", null, k, spec]);
for (const [cls, block] of Object.entries(METRICS.class_specific))
  for (const [k, spec] of Object.entries(block)) CATALOG.push(["class", cls, k, spec]);

// A derived id is looked up directly rather than searched. This is SAFE where
// search is not, and the difference is worth naming: the CBSA code is embedded
// in the id, so ATNHPIUS14260Q cannot possibly return another city's data. The
// only failure mode is that the series does not exist, which is loud. Search's
// failure mode is returning the wrong city's real data, which is silent.
// See refresh-macro.js: Node's fetch has no default timeout and one hung
// request stalls an entire run with no error and no output.
const REQUEST_TIMEOUT_MS = Number(value("request-timeout", 20000));

async function fredSeries(key, id) {
  const url = "https://api.stlouisfed.org/fred/series?series_id=" + encodeURIComponent(id)
    + "&api_key=" + encodeURIComponent(key) + "&file_type=json";
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) return null;
  const body = await res.json();
  return (body.seriess || [])[0] || null;
}

async function fredSearch(key, text) {
  const url = "https://api.stlouisfed.org/fred/series/search?search_text=" + encodeURIComponent(text)
    + "&api_key=" + encodeURIComponent(key) + "&file_type=json&limit=40&order_by=search_rank";
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return (await res.json()).seriess || [];
}

// See the header: the anchor is the leading city and the first state code, not
// the whole CBSA name, because the whole name drifts between vintages.
function anchorOf(cbsaName) {
  const s = String(cbsaName || "");
  const comma = s.lastIndexOf(",");
  const cities = comma >= 0 ? s.slice(0, comma) : s;
  const states = comma >= 0 ? s.slice(comma + 1) : "";
  return { city: norm(cities.split("-")[0]), state: norm(states.split("-")[0]) };
}

const BLS_SHORTHAND = /^[A-Z]{4}\d{3}[A-Z]*$/;

function pick(candidates, cbsaName, spec) {
  const a = anchorOf(cbsaName);
  const now = Date.now();
  const hits = candidates.filter((s) => {
    if (spec.adjustment === "SA" && s.seasonal_adjustment_short !== "SA") return false;
    if (s.frequency_short !== spec.frequency) return false;
    if (!spec.title.test(s.title || "")) return false;
    if (!/\(MSA\)/.test(s.title || "")) return false;
    if (/discontinued/i.test(s.title || "")) return false;
    const end = Date.parse(String(s.observation_end || "") + "T00:00:00Z");
    if (!Number.isFinite(end) || (now - end) / 86400000 > STALE_DAYS) return false;
    const t = norm(s.title);
    return t.includes(a.city) && t.includes(a.state);
  });
  // One consistent family where there is a choice: the BLS shorthand ids
  // (CHIC917NA, ATLA013NA) rather than raw SMS ids or Fed-constructed series.
  // They are not more correct, they are the same source across every market,
  // and mixing families would make a cross-market comparison quietly
  // incomparable on revision behaviour.
  const preferred = hits.filter((s) => BLS_SHORTHAND.test(s.id));
  const best = preferred[0] || hits[0] || null;
  return { best, alternates: hits.filter((s) => s !== best).slice(0, 2) };
}

(async function main() {
  const key = loadKey();
  if (!key) { console.error("No FRED_API_KEY. Put it in .env or the environment."); process.exit(1); }

  const tiers = JSON.parse(fs.readFileSync(TIERS, "utf8"));
  let markets = tiers.markets;
  const limit = Number(value("limit", 0));
  if (limit > 0) markets = markets.slice(0, limit);
  const onlyMetric = value("metric", "");
  const catalog = onlyMetric ? CATALOG.filter((c) => c[2] === onlyMetric) : CATALOG;

  console.log("Resolving " + markets.length + " markets x " + catalog.length + " metrics = "
    + (markets.length * catalog.length) + " lookups.");
  console.log("Read the titles. A wrong series returns real data for the wrong city.\n");

  // MERGE rather than replace. Re-running one metric with --metric must not
  // discard the other thirteen: a partial run that silently emptied the file
  // would look exactly like a successful one until the next refresh returned
  // almost nothing.
  const series = {};             // cbsa -> metric -> record
  const resolvedThisRun = new Set();
  if (flag("merge") || onlyMetric) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT, "utf8")).series || {};
      for (const [code, block] of Object.entries(prev)) series[code] = Object.assign({}, block);
      console.log("Merging into " + Object.keys(series).length + " markets already resolved.");
    } catch (e) { /* no previous file is a normal first run */ }
  }
  const byMetric = {};           // metric -> counts
  let done = 0;

  for (const m of markets) {
    for (const [block, cls, metric, spec] of catalog) {
      byMetric[metric] = byMetric[metric] || { ok: 0, miss: 0 };
      // One metric name can serve several asset classes - building permits is
      // weighted in multifamily, land and residential - and it is the same
      // series each time. Resolve it once per market.
      // Skip work already done — one metric name can serve several asset
      // classes (permits is weighted in multifamily, land and residential) and
      // it is the same series each time. But a run TARGETING a metric must
      // redo it: --metric exists precisely to replace what is there, and the
      // merge above had already put the old entry back.
      if (!onlyMetric && series[m.cbsa.code] && series[m.cbsa.code][metric]) continue;
      if (onlyMetric && resolvedThisRun.has(m.cbsa.code + "|" + metric)) continue;
      resolvedThisRun.add(m.cbsa.code + "|" + metric);
      try {
        let best = null;
        if (spec.deriveFrom) {
          // Take the metro prefix off a sibling series already resolved for
          // this market: BOIS216NA -> BOIS216 -> BOIS216BPPRIVSA.
          const sib = series[m.cbsa.code] && series[m.cbsa.code][spec.deriveFrom];
          const pfx = sib && String(sib.series_id).match(/^([A-Z]{4}\d{3})/);
          if (pfx) {
            const cand = await fredSeries(key, pfx[1] + spec.deriveSuffix);
            if (cand && spec.title.test(cand.title || "") && !/discontinued/i.test(cand.title || "")
                && cand.frequency_short === spec.frequency
                && (spec.adjustment !== "SA" || cand.seasonal_adjustment_short === "SA")) {
              const end = Date.parse(String(cand.observation_end || "") + "T00:00:00Z");
              if (Number.isFinite(end) && (Date.now() - end) / 86400000 <= STALE_DAYS) best = cand;
            }
          }
          // Fall through to search when the sibling is not in the shorthand
          // family, which is how the ~30 markets on raw SMS ids still resolve.
          if (!best && spec.search) {
            const found = await fredSearch(key, spec.search + " " + m.cbsa.name);
            best = pick(found, m.cbsa.name, spec).best;
          }
        } else if (spec.derive) {
          const cand = await fredSeries(key, spec.derive(m.cbsa.code));
          // Still verified, even though the id encodes the geography: a
          // discontinued or dormant series is the other silent failure.
          if (cand && spec.title.test(cand.title || "") && !/discontinued/i.test(cand.title || "")) {
            const end = Date.parse(String(cand.observation_end || "") + "T00:00:00Z");
            if (Number.isFinite(end) && (Date.now() - end) / 86400000 <= STALE_DAYS) best = cand;
          }
        } else {
          const found = await fredSearch(key, spec.search + " " + m.cbsa.name);
          best = pick(found, m.cbsa.name, spec).best;
        }
        const r = { best };
        if (r.best) {
          series[m.cbsa.code] = series[m.cbsa.code] || {};
          series[m.cbsa.code][metric] = {
            market: m.market, cbsa_name: m.cbsa.name, block, asset_class: cls,
            series_id: r.best.id, title: r.best.title,
            units: r.best.units_short, seasonal: r.best.seasonal_adjustment_short,
            frequency: r.best.frequency_short, transform: spec.transform,
            observation_start: r.best.observation_start, last_updated: r.best.last_updated,
            confirmed: false,
          };
          byMetric[metric].ok++;
        } else byMetric[metric].miss++;
      } catch (err) {
        byMetric[metric].miss++;
      }
      done++;
      if (done % 200 === 0) console.log("  ... " + done + " lookups");
      await sleep(PAUSE_MS);
    }
  }

  console.log("\nPer metric, of " + markets.length + " markets:");
  for (const k of Object.keys(byMetric)) {
    const b = byMetric[k];
    const pct = Math.round((b.ok / markets.length) * 100);
    console.log("  " + String(b.ok).padStart(4) + "  (" + String(pct).padStart(3) + "%)  " + k);
  }

  if (flag("write")) {
    // A metric renamed in the catalog leaves its old entry behind on a merge.
    // Anything not in the current catalog is dropped, so the file always
    // describes the catalog rather than every catalog it has ever had.
    const live = new Set(CATALOG.map((c) => c[2]));
    for (const code of Object.keys(series))
      for (const k of Object.keys(series[code]))
        if (!live.has(k)) delete series[code][k];

    fs.writeFileSync(OUT, JSON.stringify({
      _comment: "FRED series per CBSA per metric, resolved by scripts/resolve-fred-series.js. "
        + "Metric keys match market-weights.json verbatim. `confirmed` is set BY HAND after a "
        + "person reads the title against the market — a wrong series returns real data for the "
        + "wrong city and nothing downstream can detect it. Employment series are seasonally "
        + "adjusted without exception; the quarterly and annual series relax that only because "
        + "no adjusted version is published. Runtime must never resolve a series itself.",
      generated: new Date().toISOString().slice(0, 10),
      markets: markets.length,
      metrics: catalog.map((c) => c[2]),
      series,
    }, null, 2) + "\n", "utf8");
    console.log("\nWrote fred-series.json — " + Object.keys(series).length + " markets, confirmed:false throughout.");
  } else {
    console.log("\nNothing written. Re-run with --write.");
  }
})();

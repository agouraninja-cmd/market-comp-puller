#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Pull the public macro indicators for every market, monthly.
//
//   node scripts/refresh-macro.js                 # fetch and report
//   node scripts/refresh-macro.js --write         # save macro-readings.json
//   node scripts/refresh-macro.js --limit 20      # a sample, while developing
//
// Reads fred-series.json (resolved once, by hand-checked search) and
// market-tiers.json (generated from Census). Writes macro-readings.json, and
// the same rows to Supabase when it is configured — file first so the pipeline
// works on a laptop with no database, exactly as search-cache and comp-corpus
// already do.
//
// ---------------------------------------------------------------------------
// FOUR RULES, each one earned.
//
// 1. NEVER RESOLVE A SERIES HERE. Ids come from fred-series.json and nowhere
//    else. A wrong id does not error — FRED answers it with real, well-formed
//    employment for whichever city owns it — so resolution is a separate,
//    reviewed step and this script only consumes its output.
//
// 2. THE OBSERVATION DATE IS THE KEY, not the fetch date. BLS revises: monthly
//    figures move the following month and again at the annual benchmark. A
//    revision must arrive as a new row so a ranking computed in March stays
//    reproducible in September.
//
// 3. PARTIAL SUCCESS IS SUCCESS. One market's series 404ing must not abandon
//    the other 194. Everything that resolved is written; everything that did
//    not is reported by name.
//
// 4. A STALE SERIES IS AN ALARM. If a series' newest observation is months old
//    the metric is reported as stale rather than scored, because a number that
//    stopped moving looks exactly like a flat market.
// ---------------------------------------------------------------------------
//
// READ-ONLY against FRED and Census. Writes only local files unless Supabase
// is configured.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "macro-readings.json");
const CENSUS_VINTAGE = 2023;          // ACS5; the prior year is fetched too, for growth

const args = process.argv.slice(2);
const has = (f) => args.includes("--" + f);
const val = (f, d) => { const i = args.indexOf("--" + f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

function envVal(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const m = fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(new RegExp("^" + name + "=(.*)$", "m"));
    if (m) return m[1].trim();
  } catch (e) { /* no .env is normal */ }
  return "";
}

const PAUSE_MS = Number(val("pause", 260));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STALE_DAYS = 120;

// Metric names are the ones in market-weights.json, verbatim, so a reading
// joins to its weight by string with no translation table in between.
const M_JOBS = "Job growth (total nonfarm, YoY)";
const M_POP = "Population growth (YoY)";

// --------------------------------------------------------------------- FRED

async function fredObservations(key, seriesId, since) {
  const url = "https://api.stlouisfed.org/fred/series/observations"
    + "?series_id=" + encodeURIComponent(seriesId)
    + "&api_key=" + encodeURIComponent(key)
    + "&file_type=json&sort_order=asc&observation_start=" + since;
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const body = await res.json();
  return (body.observations || []).filter((o) => o.value !== ".");
}

// Same month a year apart, never "the observation 12 rows back" — a series with
// a gap would silently compare the wrong two months, and a gap is exactly what
// a suppressed small-metro figure looks like.
function yoyFrom(obs) {
  if (obs.length < 2) return null;
  const last = obs[obs.length - 1];
  const wantKey = (Number(last.date.slice(0, 4)) - 1) + last.date.slice(4, 7);
  const prior = obs.find((o) => o.date.slice(0, 7) === wantKey);
  if (!prior) return null;
  const a = Number(prior.value), b = Number(last.value);
  if (!isFinite(a) || !isFinite(b) || a === 0) return null;
  return { as_of: last.date, value: b, prior: a, yoy_pct: ((b - a) / a) * 100 };
}

// ------------------------------------------------------------------- Census

// One call returns every CBSA, so population growth costs two requests total
// rather than two per market.
async function censusPopulation(key, year) {
  const geo = "metropolitan statistical area/micropolitan statistical area";
  const url = "https://api.census.gov/data/" + year + "/acs/acs5"
    + "?get=NAME,B01003_001E&for=" + encodeURIComponent(geo) + ":*&key=" + encodeURIComponent(key);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Census HTTP " + res.status);
  const rows = (await res.json()).slice(1);
  const out = new Map();
  for (const r of rows) out.set(r[2], Number(r[1]));
  return out;
}

// --------------------------------------------------------------------- main

(async function main() {
  const fredKey = envVal("FRED_API_KEY");
  const censusKey = envVal("CENSUS_API_KEY");
  if (!fredKey) { console.error("No FRED_API_KEY."); process.exit(1); }

  const series = JSON.parse(fs.readFileSync(path.join(ROOT, "fred-series.json"), "utf8")).series;
  const tiers = JSON.parse(fs.readFileSync(path.join(ROOT, "market-tiers.json"), "utf8"));
  let markets = tiers.markets;
  const limit = Number(val("limit", 0));
  if (limit > 0) markets = markets.slice(0, limit);

  const fetchedAt = new Date().toISOString();
  const readings = [];
  const problems = [];

  // ---- population, two calls for the whole country ------------------------
  let popNow = new Map(), popPrior = new Map();
  if (censusKey) {
    try {
      popNow = await censusPopulation(censusKey, CENSUS_VINTAGE);
      popPrior = await censusPopulation(censusKey, CENSUS_VINTAGE - 1);
      console.log("Census: " + popNow.size + " CBSAs at " + CENSUS_VINTAGE
        + ", " + popPrior.size + " at " + (CENSUS_VINTAGE - 1) + ".");
    } catch (err) {
      problems.push({ metric: M_POP, reason: err.message });
      console.log("Census unavailable: " + err.message);
    }
  } else {
    console.log("No CENSUS_API_KEY — population growth will be absent, and the macro block");
    console.log("will report lower coverage rather than scoring it as zero.");
  }

  for (const m of markets) {
    const code = m.cbsa.code;
    const a = popNow.get(code), b = popPrior.get(code);
    if (isFinite(a) && isFinite(b) && b > 0) {
      readings.push({
        cbsa_code: code, metric: M_POP, as_of: CENSUS_VINTAGE + "-12-31",
        value: a, yoy_pct: ((a - b) / b) * 100,
        source: "census", series_id: "B01003_001E", fetched_at: fetchedAt,
      });
    }
  }

  // ---- employment, one call per market ------------------------------------
  const since = new Date(Date.now() - 500 * 86400000).toISOString().slice(0, 10);
  let ok = 0, stale = 0;
  console.log("\nFRED: " + markets.length + " markets, seasonally adjusted total nonfarm.\n");

  for (const m of markets) {
    const s = series[m.cbsa.code];
    if (!s) { problems.push({ market: m.market, reason: "no resolved series" }); continue; }

    try {
      const obs = await fredObservations(fredKey, s.series_id, since);
      const y = yoyFrom(obs);
      if (!y) { problems.push({ market: m.market, reason: "no same-month pair in window" }); await sleep(PAUSE_MS); continue; }

      const ageDays = (Date.now() - Date.parse(y.as_of + "T00:00:00Z")) / 86400000;
      if (ageDays > STALE_DAYS) {
        stale++;
        problems.push({ market: m.market, reason: "newest observation is " + Math.round(ageDays) + " days old" });
        await sleep(PAUSE_MS); continue;
      }

      readings.push({
        cbsa_code: m.cbsa.code, metric: M_JOBS, as_of: y.as_of,
        value: y.value, yoy_pct: y.yoy_pct,
        source: "fred", series_id: s.series_id, fetched_at: fetchedAt,
      });
      ok++;
      if (ok <= 6 || ok % 40 === 0) {
        console.log("  " + String(ok).padStart(3) + "  " + m.market.padEnd(22)
          + y.as_of + "  " + String(y.value).padStart(9) + "k jobs  "
          + (y.yoy_pct >= 0 ? "+" : "") + y.yoy_pct.toFixed(2) + "% YoY");
      }
    } catch (err) {
      problems.push({ market: m.market, reason: err.message });
    }
    await sleep(PAUSE_MS);
  }

  const byMetric = readings.reduce((a, r) => { a[r.metric] = (a[r.metric] || 0) + 1; return a; }, {});
  console.log("\nReadings: " + readings.length);
  for (const k of Object.keys(byMetric)) console.log("  " + byMetric[k] + "  " + k);
  console.log("Problems: " + problems.length + (stale ? " (" + stale + " stale)" : ""));
  for (const p of problems.slice(0, 12)) console.log("  " + (p.market || p.metric) + " — " + p.reason);
  if (problems.length > 12) console.log("  ...and " + (problems.length - 12) + " more");

  if (has("write")) {
    fs.writeFileSync(OUT, JSON.stringify({
      _comment: "Public macro readings per CBSA. Keyed on the OBSERVATION date, not the fetch "
        + "date: BLS and Census both revise, and a revision must arrive as a new row so a "
        + "ranking computed months ago stays reproducible. Generated by scripts/refresh-macro.js; "
        + "the durable copy is the macro_readings table (migration 045) where Supabase is configured.",
      generated: fetchedAt.slice(0, 10),
      fetched_at: fetchedAt,
      readings,
      problems,
    }, null, 2) + "\n", "utf8");
    console.log("\nWrote " + path.relative(ROOT, OUT) + ".");
  } else {
    console.log("\nNothing written. Re-run with --write.");
  }
})();

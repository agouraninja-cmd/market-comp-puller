#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Pull every public indicator for every market. Monthly.
//
//   node scripts/refresh-macro.js                 # fetch and report
//   node scripts/refresh-macro.js --write         # save macro-readings.json
//   node scripts/refresh-macro.js --limit 20      # a sample, while developing
//
// FOUR SOURCES, each doing what it is best at:
//
//   FRED    employment by supersector, labour force, wages, permits, house
//           prices, unemployment. Monthly, two months' lag. MOMENTUM.
//   HUD     fair market rents and median family income, published for 2026 —
//           the most current numbers in the whole system.
//   BEA     the implicit regional price deflator, which turns nominal wage
//           growth into real wage growth. Local inflation varies enough
//           between metros that nominal growth alone rewards the expensive
//           ones for being expensive.
//   Census  population, for sizing markets rather than scoring them (see
//           market-tiers.json).
//
// ---------------------------------------------------------------------------
// FOUR RULES, each earned.
//
// 1. NEVER RESOLVE A SERIES HERE. Ids come from fred-series.json and nowhere
//    else. A wrong id does not error — FRED answers it with real, well-formed
//    data for whichever metro owns it.
//
// 2. THE OBSERVATION DATE IS THE KEY, not the fetch date. BLS and Census both
//    revise; a revision must arrive as a new row so a ranking computed in
//    March is still reproducible in September.
//
// 3. PARTIAL SUCCESS IS SUCCESS. One market's series failing must not abandon
//    the rest. Everything that resolved is written; the rest is reported.
//
// 4. A STALE SERIES IS AN ALARM. A number that stopped moving looks exactly
//    like a flat market, so anything past its staleness window is dropped and
//    named rather than scored.
// ---------------------------------------------------------------------------
//
// READ-ONLY against every source. Writes only local files.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "macro-readings.json");
const METRICS = require("./fred-metrics.js");

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

// PER SERVICE, because a rate limit belongs to the service that set it.
//
// FRED allows about 120 requests a minute and a throttled request comes back
// looking like missing data rather than an error, so its pace is deliberately
// conservative. HUD and BEA are different companies with their own allowances;
// pausing 550ms after a HUD call to respect FRED's limit is pure idle, and over
// 196 markets it was costing about five minutes for nothing.
const PAUSE = Number(val("pause", 550));       // FRED
const PAUSE_OTHER = Number(val("pause-other", 120));   // HUD, BEA
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STALE_DAYS = { M: 120, Q: 270, A: 800 };

const M_WAGE = "Average hourly earnings growth (YoY)";
const ACS_VINTAGE = 2023;   // and the year before it, for the growth metrics
const M_REAL_WAGE = "Real wage growth (YoY)";
const M_RENT = "Fair market rent growth (YoY)";

// --------------------------------------------------------------------- ACS
//
// STRUCTURE, not momentum. ACS lags about two and a half years, which is why
// nothing here scores a MOVEMENT that FRED could measure instead: labour force
// growth replaced ACS population for exactly that reason. What ACS is good for
// is composition — how many households, what share rent, how many hold a
// degree — and composition does not swing year to year, so the lag costs
// almost nothing.
//
// Three calls for the whole country: the detail table for two vintages, and
// the subject table once. Every CBSA comes back in each response, so adding a
// market later costs no extra request.
const ACS_VARS = {
  households: "B11001_001E",
  medianIncome: "B19013_001E",
  medianRent: "B25064_001E",
  renterOccupied: "B25003_003E",
  totalOccupied: "B25003_001E",
};

async function acsTable(key, year, vars, subject) {
  const geo = "metropolitan statistical area/micropolitan statistical area";
  const url = "https://api.census.gov/data/" + year + "/acs/acs5" + (subject ? "/subject" : "")
    + "?get=NAME," + vars.join(",") + "&for=" + encodeURIComponent(geo) + ":*"
    + "&key=" + encodeURIComponent(key);
  // 90s: this returns all 935 CBSAs at once, which is the whole point of doing
  // it in three calls rather than three per market.
  const rows = await getJson(url, null, ACS_TIMEOUT_MS);
  const head = rows[0];
  const out = new Map();
  for (const r of rows.slice(1)) {
    const rec = {};
    head.forEach((h, i) => { rec[h] = r[i]; });
    out.set(r[r.length - 1], rec);   // last column is the CBSA code
  }
  return out;
}

// A suppressed or unavailable ACS cell comes back as a large negative sentinel
// (-666666666 and friends), not as null. Casting one of those would produce a
// confident, absurd number rather than an absence.
function acsNum(v) {
  const n = Number(v);
  return isFinite(n) && n > -1e6 ? n : null;
}

// ------------------------------------------------------------------ helpers

// EVERY REQUEST GETS A DEADLINE. Node's fetch has no default timeout, so one
// unresponsive endpoint blocks the whole run forever — observed 2026-09-02,
// when this stalled at market 100 of 196 and sat there for ninety minutes with
// the process alive, the log silent and nothing to indicate anything was wrong.
//
// A timeout throws, the caller's try/catch records it as a problem for that one
// metric, and the run continues. That is the "partial success is success" rule
// this file already claims in its header, applied to the failure mode most
// likely to actually happen: not an error, but an answer that never comes.
const REQUEST_TIMEOUT_MS = Number(val("request-timeout", 20000));
const ACS_TIMEOUT_MS = Number(val("acs-timeout", 90000));

// The deadline is PER CALL, not blanket. A per-market request returns a few
// hundred bytes and 20s is generous; the three ACS calls each return every CBSA
// in the country and legitimately take longer. A single blanket 20s killed the
// ACS load on the first run after the timeout was added — the run continued,
// reported "ACS unavailable", and quietly produced markets with no structural
// metrics at all. A timeout that is too short does not look like a bug; it
// looks like a source that is down.
async function getJson(url, headers, timeoutMs) {
  const res = await fetch(url, {
    headers: headers || undefined,
    signal: AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// Same month a year apart, never "twelve observations back" — a series with a
// gap would silently compare the wrong two periods, and a gap is exactly what
// a suppressed small-metro figure looks like.
function yoyFrom(obs, freq) {
  if (obs.length < 2) return null;
  const last = obs[obs.length - 1];
  const y = Number(last.date.slice(0, 4)), rest = last.date.slice(4);
  const prior = obs.find((o) => o.date === (y - 1) + rest);
  if (!prior) return null;
  const a = Number(prior.value), b = Number(last.value);
  if (!isFinite(a) || !isFinite(b) || a === 0) return null;
  return { as_of: last.date, value: b, yoy_pct: ((b - a) / a) * 100 };
}

function levelFrom(obs) {
  if (!obs.length) return null;
  const last = obs[obs.length - 1];
  const v = Number(last.value);
  return isFinite(v) ? { as_of: last.date, value: v, yoy_pct: null } : null;
}

function tooOld(asOf, freq) {
  const t = Date.parse(asOf + "T00:00:00Z");
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) / 86400000 > (STALE_DAYS[freq] || 400);
}

// --------------------------------------------------------------------- main

(async function main() {
  const fredKey = envVal("FRED_API_KEY");
  const hudTok = envVal("HUD_API_TOKEN");
  const beaKey = envVal("BEA_API_KEY");
  if (!fredKey) { console.error("No FRED_API_KEY."); process.exit(1); }

  const resolved = JSON.parse(fs.readFileSync(path.join(ROOT, "fred-series.json"), "utf8")).series;
  const tiers = JSON.parse(fs.readFileSync(path.join(ROOT, "market-tiers.json"), "utf8"));
  let markets = tiers.markets;
  const limit = Number(val("limit", 0));
  if (limit > 0) markets = markets.slice(0, limit);

  // Metric name -> spec, so a reading knows how to be transformed.
  const SPEC = {};
  for (const [k, s] of Object.entries(METRICS.macro)) SPEC[k] = s;
  for (const block of Object.values(METRICS.class_specific))
    for (const [k, s] of Object.entries(block)) SPEC[k] = s;

  const fetchedAt = new Date().toISOString();
  const readings = [];
  const problems = [];
  const nominalWage = new Map();     // cbsa -> yoy_pct, for the real-wage step

  // ---- HUD metro code map, one call ---------------------------------------
  const hudCode = new Map();
  if (hudTok) {
    try {
      const list = await getJson("https://www.huduser.gov/hudapi/public/fmr/listMetroAreas",
        { Authorization: "Bearer " + hudTok });
      // HUD's code embeds the CBSA twice for a whole metro — METRO40140M40140 —
      // and differently for the HUD Metro FMR Areas that SUBDIVIDE one:
      // METRO35620MM0875 is "Bergen-Passaic, NJ", a corner of the New York MSA.
      //
      // Only the whole-metro form is accepted. Taking the first match per CBSA
      // would have reported Bergen County's rents as New York's — a number that
      // is real, current, well-formed, and about somewhere else. Where only
      // sub-areas exist the market simply has no rent reading, which the score
      // reports as coverage rather than inventing a metro figure from one
      // corner of it.
      for (const a of list) {
        const code = String(a.cbsa_code || "");
        const m = code.match(/^METRO(\d{5})M(\d{5})$/);
        if (m && m[1] === m[2]) hudCode.set(m[1], code);
      }
      console.log("HUD: " + hudCode.size + " metro areas mapped.");
    } catch (err) { console.log("HUD metro list unavailable: " + err.message); }
  }

  // ---- ACS, three calls covering every market -----------------------------
  // Each response carries every CBSA in the country, so adding a market later
  // costs no extra request. Two vintages for the growth metrics, one subject
  // table for educational attainment.
  let acsNow = new Map(), acsPrior = new Map(), acsEdu = new Map(), acsFailed = false;
  const censusKey = envVal("CENSUS_API_KEY");
  if (censusKey) {
    const vars = Object.values(ACS_VARS);
    try {
      acsNow = await acsTable(censusKey, ACS_VINTAGE, vars, false);
      acsPrior = await acsTable(censusKey, ACS_VINTAGE - 1, vars, false);
      acsEdu = await acsTable(censusKey, ACS_VINTAGE, ["S1501_C02_015E"], true);
      console.log("ACS " + ACS_VINTAGE + ": " + acsNow.size + " CBSAs, "
        + acsPrior.size + " prior, " + acsEdu.size + " with attainment.");
    } catch (err) {
      // Absent ACS is not a small degradation: multifamily, land and residential
      // draw their ENTIRE class block from it, and retail and office draw half.
      // A run that continues past this produces a ranking that looks complete
      // and is missing three asset classes, so it says so loudly and the caller
      // can decide.
      console.log("");
      console.log("!! ACS UNAVAILABLE: " + err.message);
      console.log("!! Multifamily, land and residential have NO class metrics without it,");
      console.log("!! and office and retail lose half of theirs. Fix this before trusting the run.");
      console.log("");
      acsFailed = true;
    }
  }

  console.log("Markets: " + markets.length + "\n");
  let n = 0;

  for (const m of markets) {
    n++;
    const code = m.cbsa.code;
    const mine = resolved[code] || {};

    // ---- FRED, every resolved metric for this market ----------------------
    for (const [metric, rec] of Object.entries(mine)) {
      const spec = SPEC[metric];
      if (!spec) continue;
      try {
        const since = new Date(Date.now() - 900 * 86400000).toISOString().slice(0, 10);
        const j = await getJson("https://api.stlouisfed.org/fred/series/observations?series_id="
          + encodeURIComponent(rec.series_id) + "&api_key=" + encodeURIComponent(fredKey)
          + "&file_type=json&sort_order=asc&observation_start=" + since);
        const obs = (j.observations || []).filter((o) => o.value !== ".");
        const r = spec.transform === "level" ? levelFrom(obs) : yoyFrom(obs, spec.frequency);
        if (!r) { problems.push({ market: m.market, metric, reason: "no usable pair" }); }
        else if (tooOld(r.as_of, spec.frequency)) {
          problems.push({ market: m.market, metric, reason: "stale, newest " + r.as_of });
        } else {
          readings.push({ cbsa_code: code, metric, as_of: r.as_of, value: r.value,
            yoy_pct: r.yoy_pct, source: "fred", series_id: rec.series_id, fetched_at: fetchedAt });
          if (metric === M_WAGE && r.yoy_pct !== null) nominalWage.set(code, r.yoy_pct);
        }
      } catch (err) { problems.push({ market: m.market, metric, reason: err.message }); }
      await sleep(PAUSE);
    }

    // ---- HUD fair market rent, two years for a growth rate ----------------
    if (hudTok && hudCode.has(code)) {
      try {
        const id = hudCode.get(code);
        const yr = new Date().getFullYear();
        const a = await getJson("https://www.huduser.gov/hudapi/public/fmr/data/" + id + "?year=" + yr,
          { Authorization: "Bearer " + hudTok });
        await sleep(PAUSE);
        await sleep(PAUSE_OTHER);
        const b = await getJson("https://www.huduser.gov/hudapi/public/fmr/data/" + id + "?year=" + (yr - 1),
          { Authorization: "Bearer " + hudTok });
        // basicdata is an OBJECT for an ordinary metro and an ARRAY for a
        // small-area-FMR one, where the first row is labelled "MSA level" and
        // the rest are per-ZIP. Take the MSA row; never the first ZIP, which
        // would be one neighbourhood standing in for a metro.
        const twoBed = (res) => {
          const d = res && res.data && res.data.basicdata;
          if (!d) return NaN;
          if (Array.isArray(d)) {
            const msa = d.find((r) => String(r.zip_code || "").toLowerCase() === "msa level");
            return msa ? Number(msa["Two-Bedroom"]) : NaN;
          }
          return Number(d["Two-Bedroom"]);
        };
        const now = twoBed(a);
        const was = twoBed(b);
        if (isFinite(now) && isFinite(was) && was > 0) {
          readings.push({ cbsa_code: code, metric: M_RENT, as_of: yr + "-01-01",
            value: now, yoy_pct: ((now - was) / was) * 100,
            source: "hud", series_id: id + " 2BR FMR", fetched_at: fetchedAt });
        }
      } catch (err) { problems.push({ market: m.market, metric: M_RENT, reason: err.message }); }
      await sleep(PAUSE_OTHER);
    }

    // ---- BEA deflator, and the real wage it makes possible ----------------
    //
    // Nominal wage growth alone rewards an expensive metro for being
    // expensive. Deflating by the LOCAL price change is the difference between
    // "wages rose 5%" and "people can buy 1% more than last year".
    //
    // The deflator is annual and lags roughly eighteen months, so this applies
    // last year's local inflation to this year's nominal growth. That is an
    // approximation and it is stated here rather than hidden: it is still far
    // better than treating a 6%-inflation metro and a 2%-inflation metro as
    // though their identical nominal wage growth meant the same thing.
    if (beaKey && nominalWage.has(code)) {
      try {
        const j = await getJson("https://apps.bea.gov/api/data?UserID=" + encodeURIComponent(beaKey)
          + "&method=GetData&datasetname=Regional&TableName=MAIRPD&GeoFips=" + code
          + "&LineCode=1&Year=LAST5&ResultFormat=JSON");
        const rows = (j.BEAAPI && j.BEAAPI.Results && j.BEAAPI.Results.Data) || [];
        const vals = rows.map((r) => ({ y: Number(r.TimePeriod), v: Number(String(r.DataValue).replace(/,/g, "")) }))
          .filter((r) => isFinite(r.y) && isFinite(r.v)).sort((a, b) => a.y - b.y);
        if (vals.length >= 2) {
          const last = vals[vals.length - 1], prev = vals[vals.length - 2];
          const inflation = ((last.v - prev.v) / prev.v) * 100;
          readings.push({ cbsa_code: code, metric: M_REAL_WAGE, as_of: last.y + "-12-31",
            value: nominalWage.get(code), yoy_pct: nominalWage.get(code) - inflation,
            source: "bea+fred", series_id: "MAIRPD " + last.y + " deflating " + M_WAGE,
            fetched_at: fetchedAt });
        }
      } catch (err) { problems.push({ market: m.market, metric: M_REAL_WAGE, reason: err.message }); }
      await sleep(PAUSE_OTHER);
    }

    // ---- ACS structural metrics for this market ---------------------------
    const A = acsNow.get(code), B = acsPrior.get(code), E = acsEdu.get(code);
    const asOfACS = ACS_VINTAGE + "-12-31";
    const growth = (a, b) => (a !== null && b !== null && b > 0) ? ((a - b) / b) * 100 : null;
    if (A && B) {
      const pairs = [
        ["Household count growth (YoY)", ACS_VARS.households],
        ["Median household income growth (YoY)", ACS_VARS.medianIncome],
        ["Median gross rent growth (YoY)", ACS_VARS.medianRent],
      ];
      for (const [metric, v] of pairs) {
        const now = acsNum(A[v]), was = acsNum(B[v]);
        const g = growth(now, was);
        if (g !== null) {
          readings.push({ cbsa_code: code, metric, as_of: asOfACS, value: now, yoy_pct: g,
            source: "census", series_id: v, fetched_at: fetchedAt });
        }
      }
      const rent = acsNum(A[ACS_VARS.renterOccupied]), occ = acsNum(A[ACS_VARS.totalOccupied]);
      if (rent !== null && occ !== null && occ > 0) {
        // A LEVEL, so yoy_pct carries the level: market-score.js normalises
        // whichever field the threshold's unit describes, and this threshold is
        // written against a share rather than a change.
        readings.push({ cbsa_code: code, metric: "Renter-occupied share", as_of: asOfACS,
          value: (rent / occ) * 100, yoy_pct: (rent / occ) * 100,
          source: "census", series_id: "B25003", fetched_at: fetchedAt });
      }
    }
    if (E) {
      const pct = acsNum(E["S1501_C02_015E"]);
      if (pct !== null) {
        readings.push({ cbsa_code: code, metric: "Educational attainment (bachelor's or higher)",
          as_of: asOfACS, value: pct, yoy_pct: pct,
          source: "census", series_id: "S1501_C02_015E", fetched_at: fetchedAt });
      }
    }

    const got = readings.filter((r) => r.cbsa_code === code).length;
    console.log("  " + String(n).padStart(3) + "/" + markets.length + "  "
      + m.market.padEnd(22) + got + " readings");
  }

  const byMetric = readings.reduce((a, r) => { a[r.metric] = (a[r.metric] || 0) + 1; return a; }, {});
  console.log("\nReadings: " + readings.length + " across " + markets.length + " markets");
  for (const k of Object.keys(byMetric).sort((a, b) => byMetric[b] - byMetric[a])) {
    console.log("  " + String(byMetric[k]).padStart(4) + "  (" + String(Math.round(byMetric[k] / markets.length * 100)).padStart(3) + "%)  " + k);
  }
  if (acsFailed) {
    console.log("");
    console.log("!! This run has NO Census structural data. Three asset classes cannot score.");
  }
  console.log("Problems: " + problems.length);
  const grouped = problems.reduce((a, p) => { a[p.reason.slice(0, 40)] = (a[p.reason.slice(0, 40)] || 0) + 1; return a; }, {});
  for (const k of Object.keys(grouped).slice(0, 8)) console.log("  " + String(grouped[k]).padStart(4) + "  " + k);

  if (has("write")) {
    fs.writeFileSync(OUT, JSON.stringify({
      _comment: "Public readings per CBSA. Keyed on the OBSERVATION date, not the fetch date: "
        + "sources revise, and a revision must arrive as a new row so a ranking computed months "
        + "ago stays reproducible. Generated by scripts/refresh-macro.js; the durable copy is the "
        + "macro_readings table (migration 045) where Supabase is configured.",
      generated: fetchedAt.slice(0, 10),
      fetched_at: fetchedAt,
      sources: { fred: "BLS/FHFA/Census via FRED", hud: "Fair Market Rents", bea: "MAIRPD implicit regional price deflator" },
      readings, problems,
    }, null, 2) + "\n", "utf8");
    console.log("\nWrote " + path.relative(ROOT, OUT) + ".");
  } else {
    console.log("\nNothing written. Re-run with --write.");
  }
})();

#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Resolve each market in market-tiers.json to its FRED employment series, once,
// so that nothing ever resolves one at runtime.
//
//   node scripts/resolve-fred-series.js                 # every market
//   node scripts/resolve-fred-series.js --tier primary  # one tier
//   node scripts/resolve-fred-series.js --limit 10      # a sample
//   node scripts/resolve-fred-series.js --write         # save fred-series.json
//
// WHY THIS EXISTS, and why its output must be READ rather than trusted:
//
// A FRED series id cannot be derived from a CBSA code. Riverside-San
// Bernardino-Ontario is CBSA 40140 and its employment series is RIVE106NA —
// there is no rule connecting those two strings, and no amount of care at the
// call site can invent one. So the id has to be looked up.
//
// The danger is that a WRONG id does not fail. FRED answers RIVE106NA with
// real, well-formed, monthly employment for Riverside; it answers some other
// city's id with real, well-formed, monthly employment for that other city.
// Both are 200 OK, both parse, both produce a plausible ranking, and no test of
// the arithmetic downstream can tell them apart. The only thing that can is a
// person reading the series TITLE against the market it is supposed to be.
//
// Hence: this script proposes, a human confirms, the answer is committed, and
// runtime reads only the committed file. test/market-ranking-config.test.js
// fails if any market-tiers.json entry is marked verified, because THIS is the
// script that is allowed to set that flag and only after somebody looked.
//
// SEASONALLY ADJUSTED ONLY (owner's rule, 2026-09-02). BLS publishes SA metro
// employment for larger metros and NSA for many smaller ones, so some tertiary
// markets will have no SA series at all. That is reported, never silently
// substituted: an NSA series quietly standing in for an SA one would make a
// small market's month-to-month swings look like signal.
//
// Reads FRED_API_KEY from the environment or .env. Writes nothing unless
// --write is passed. READ-ONLY against FRED.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TIERS = path.join(ROOT, "market-tiers.json");
const OUT = path.join(ROOT, "fred-series.json");

// Same .env reader shape server.js uses: no dependency, and the key never
// reaches a log line or an error message from here.
function loadKey() {
  if (process.env.FRED_API_KEY) return process.env.FRED_API_KEY.trim();
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^FRED_API_KEY=(.*)$/m);
    if (m) return m[1].trim();
  } catch (e) { /* no .env is a normal state */ }
  return "";
}

const args = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const value = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

// FRED is rate limited. A pause between calls costs a minute over 175 markets
// and is the difference between a clean run and a throttled half-run that
// looks like missing data.
const PAUSE_MS = Number(value("pause", 350));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fredSearch(key, text) {
  const url = "https://api.stlouisfed.org/fred/series/search"
    + "?search_text=" + encodeURIComponent(text)
    + "&api_key=" + encodeURIComponent(key)
    + "&file_type=json&limit=40&order_by=search_rank";
  const res = await fetch(url);
  if (!res.ok) throw new Error("FRED search failed: HTTP " + res.status);
  const body = await res.json();
  return Array.isArray(body.seriess) ? body.seriess : [];
}

// The CBSA name as FRED writes it in a title, minus the parenthetical.
// "Riverside-San Bernardino-Ontario, CA" must appear inside
// "All Employees: Total Nonfarm in Riverside-San Bernardino-Ontario, CA (MSA)".
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// CBSA NAMES DRIFT BETWEEN DELINEATION VINTAGES, and matching on the full
// string is how that drift turns into "no data" for the largest markets in the
// country. Observed on the first run, 2026-09-02:
//
//   ours (2020 vintage)                    FRED (2023 vintage)
//   Chicago-Naperville-Elgin, IL-IN-WI  -> Chicago-Naperville-Elgin, IL-IN
//   Atlanta-Sandy Springs-Alpharetta, GA-> Atlanta-Sandy Springs-Roswell, GA
//   New York-Newark-Jersey City, NY-NJ-PA->New York-Newark-Jersey City, NY-NJ
//
// New York, Chicago and Atlanta all resolved to nothing, which would have read
// as three unresolved markets rather than as three stale strings in a file we
// wrote. So the match is on the ANCHOR — the first city name and the first
// state code — plus a literal "(MSA)". That survives a renamed third city and
// a dropped state while still refusing a neighbouring metro, because no other
// MSA starts with "Atlanta" in GA.
function anchorOf(cbsaName) {
  const s = String(cbsaName || "");
  const comma = s.lastIndexOf(",");
  const cities = comma >= 0 ? s.slice(0, comma) : s;
  const states = comma >= 0 ? s.slice(comma + 1) : "";
  return {
    city: norm(cities.split("-")[0]),
    state: norm(states.split("-")[0]),
  };
}

// One consistent source. Every correct answer on the first run was the same
// four-letter-plus-three-digit BLS shorthand (CHIC917NA, ATLA013NA, NEWY636NA);
// the alternates were raw SMS ids and, for Houston, a Dallas Fed construction.
// They are not wrong, they are just a different series family with different
// revision behaviour, and mixing families across 175 markets would make a
// cross-market comparison quietly incomparable.
const BLS_SHORTHAND = /^[A-Z]{4}\d{3}NA$/;

function pick(candidates, cbsaName) {
  const a = anchorOf(cbsaName);
  // A DISCONTINUED series is the worst possible match and the easiest to miss.
  // Los Angeles resolved to LOSA106NA on the first run — "Los Angeles-Long
  // Beach-Santa Ana, CA (MSA) (DISCONTINUED)", a dead series under a
  // delineation name retired years ago. It does not error. It returns real,
  // well-formed monthly employment that simply stopped, so LA would have
  // frozen at its final observation and gone on scoring from it forever.
  //
  // Two guards, because the label alone is not enough: FRED does not always
  // mark a dormant series, so the last observation must also be recent.
  const STALE_AFTER_DAYS = 200;   // monthly data, revised: ~6 months of slack
  const now = Date.now();

  const hits = candidates.filter((s) => {
    if (s.seasonal_adjustment_short !== "SA") return false;
    if (s.frequency_short !== "M") return false;
    if (!/total nonfarm/i.test(s.title || "")) return false;
    if (!/\(MSA\)/.test(s.title || "")) return false;      // never a division or a city proper
    if (/discontinued/i.test(s.title || "")) return false;
    const end = Date.parse(String(s.observation_end || "") + "T00:00:00Z");
    if (!Number.isFinite(end)) return false;
    if ((now - end) / 86400000 > STALE_AFTER_DAYS) return false;
    const t = norm(s.title);
    return t.includes(a.city) && t.includes(a.state);
  });

  const preferred = hits.filter((s) => BLS_SHORTHAND.test(s.id));
  const best = preferred[0] || hits[0] || null;
  return {
    best,
    alternates: hits.filter((s) => s !== best).slice(0, 3),
    family: best ? (BLS_SHORTHAND.test(best.id) ? "bls-shorthand" : "other") : null,
    anyCount: candidates.length,
    nsaOnly: hits.length === 0 && candidates.some((s) =>
      s.seasonal_adjustment_short === "NSA" && /total nonfarm/i.test(s.title || "")
        && norm(s.title).includes(a.city)),
  };
}

(async function main() {
  const key = loadKey();
  if (!key) {
    console.error("No FRED_API_KEY. Put it in .env or the environment.");
    process.exit(1);
  }

  const tiers = JSON.parse(fs.readFileSync(TIERS, "utf8"));
  let markets = tiers.markets;
  const tier = value("tier", "");
  if (tier) markets = markets.filter((m) => m.tier === tier);
  const limit = Number(value("limit", 0));
  if (limit > 0) markets = markets.slice(0, limit);

  console.log("Resolving " + markets.length + " markets. Seasonally adjusted, monthly, total nonfarm.");
  console.log("Read the titles. A wrong series returns real data for the wrong city.\n");

  const resolved = {}, review = [], missing = [];

  for (const m of markets) {
    let r;
    try {
      const found = await fredSearch(key, "Total Nonfarm " + m.cbsa.name);
      r = pick(found, m.cbsa.name);
    } catch (err) {
      console.log("  !! " + m.market + " — " + err.message);
      missing.push({ market: m.market, cbsa: m.cbsa.code, reason: err.message });
      await sleep(PAUSE_MS);
      continue;
    }

    if (r.best) {
      resolved[m.cbsa.code] = {
        market: m.market,
        cbsa_name: m.cbsa.name,
        series_id: r.best.id,
        title: r.best.title,
        units: r.best.units_short,
        seasonal: r.best.seasonal_adjustment_short,
        frequency: r.best.frequency_short,
        observation_start: r.best.observation_start,
        last_updated: r.best.last_updated,
        confirmed: false,          // a person sets this, not this script
      };
      console.log("  OK  " + m.cbsa.code + "  " + r.best.id.padEnd(12) + r.best.title);
      if (r.alternates.length) {
        review.push({ market: m.market, chose: r.best.id, others: r.alternates.map((a) => a.id) });
      }
    } else if (r.nsaOnly) {
      console.log("  NSA " + m.cbsa.code + "  " + m.market + " — only a NOT seasonally adjusted series exists");
      missing.push({ market: m.market, cbsa: m.cbsa.code, reason: "no SA series; NSA exists" });
    } else {
      console.log("  --  " + m.cbsa.code + "  " + m.market + " — no match (" + r.anyCount + " results searched)");
      missing.push({ market: m.market, cbsa: m.cbsa.code, reason: "no SA total-nonfarm match" });
    }
    await sleep(PAUSE_MS);
  }

  const found = Object.keys(resolved).length;
  console.log("\n" + found + " resolved, " + missing.length + " unresolved, of " + markets.length + ".");

  if (review.length) {
    console.log("\nMore than one exact title match — worth a look:");
    for (const r of review) console.log("  " + r.market + ": chose " + r.chose + ", also " + r.others.join(", "));
  }
  if (missing.length) {
    console.log("\nUnresolved:");
    for (const m of missing) console.log("  " + m.market + " (" + m.cbsa + ") — " + m.reason);
    console.log("\nAn unresolved market is not a broken market. It scores on the inputs it\n" +
                "does have and reports lower coverage, which is market-score.js's whole design.");
  }

  if (flag("write")) {
    const payload = {
      _comment: "FRED series per CBSA, resolved by scripts/resolve-fred-series.js. " +
        "Seasonally adjusted, monthly, total nonfarm. `confirmed` is set BY HAND after a " +
        "person has read the title against the market — a wrong series returns real data " +
        "for the wrong city and nothing downstream can detect it. Runtime must skip any " +
        "entry where confirmed is false.",
      generated: new Date().toISOString().slice(0, 10),
      series: resolved,
      unresolved: missing,
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
    console.log("\nWrote " + path.relative(ROOT, OUT) + " with confirmed:false on every entry.");
  } else {
    console.log("\nNothing written. Re-run with --write to save fred-series.json.");
  }
})();

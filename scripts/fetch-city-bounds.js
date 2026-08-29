// Fetch real municipal boundary polygons for the /markets momentum map, from
// OSM Nominatim (administrative boundaries), simplified server-side via
// polygon_threshold. Output: city-bounds.json at the repo root, keyed by
// market-hero's cityKey, COMMITTED like the market-heroes JPEGs and for the
// same reason — Render erases its disk on every deploy, and a market page
// surface must never wait on a network call at render time.
//
//   node scripts/fetch-city-bounds.js                 # every market's city — the
//                                                     # committed seed, the local dynamic
//                                                     # fallback file, AND the Supabase
//                                                     # market_pages table when .env (or
//                                                     # the workflow) supplies the pair,
//                                                     # because Explorer-published cities
//                                                     # are exactly the ones nobody added
//                                                     # by hand (auto-market-heroes' rule)
//   node scripts/fetch-city-bounds.js --city "Casper, WY"   # add one city
//   node scripts/fetch-city-bounds.js --force         # refetch cities already stored
//
// Three rules:
//   - MERGE, never clobber: a city already in the file is kept (and skipped)
//     unless --force, so adding one Explorer-published city cannot lose the
//     other sixteen to a transient Nominatim error.
//   - One request per city, 1.1s apart, identified UA — Nominatim's usage
//     policy. This script is run deliberately, never by the server.
//   - Only a Polygon/MultiPolygon answer is stored. A city Nominatim cannot
//     carve simply stays a pin at every zoom — the map's built-in fallback —
//     so a miss here costs nothing and is safe to retry later.
//
// Every stored coordinate is trimmed to COORD_DP decimal places, and the
// server-side simplification is asked for at POLYGON_THRESHOLD. Both are about
// the file the browser downloads, and neither is visible on screen: the carved
// layer draws between zoom 7 and city-fills-the-screen, where 4 decimals is
// ~11m — well under a pixel until roughly zoom 17. Measured together on the
// first 17 cities, they take the file from 196KB to about 120KB. Do not chase
// this much further: at 0.008 the tolerance starts rounding off real
// coastline and annexation fingers for a few more KB.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const MH = require(path.join(__dirname, "..", "market-hero.js"));

const OUT = path.join(__dirname, "..", "city-bounds.json");
const POLYGON_THRESHOLD = "0.004";
const COORD_DP = 4;
const args = process.argv.slice(2);
const force = args.includes("--force");

// Trim every number in the geometry to COORD_DP places. JSON.stringify's
// replacer sees each coordinate as it is written, so this needs no knowledge
// of Polygon vs MultiPolygon nesting.
function trimPrecision(geometry) {
  return JSON.parse(JSON.stringify(geometry, (k, v) =>
    (typeof v === "number" ? Number(v.toFixed(COORD_DP)) : v)));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

function loadEnv() {
  // server.js's own tiny loader, minus the server (auto-market-heroes.js
  // carries the identical one for the identical reason). Only SUPABASE_*
  // matter here, and only for reading the published Explorer markets.
  try {
    for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch (e) { /* no .env is fine — the local files still list markets */ }
}

async function targetCities() {
  const cities = new Map();
  const cityArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--city" && args[i + 1]) cityArgs.push(args[++i]);
  }
  if (cityArgs.length) {
    for (const arg of cityArgs) {
      const m = String(arg).match(/^(.+),\s*([A-Za-z]{2})$/);
      if (!m) { console.error(`--city wants "City, ST", got "${arg}"`); process.exit(1); }
      cities.set(MH.cityKey(m[1].trim(), m[2].toUpperCase()), { city: m[1].trim(), state: m[2].toUpperCase() });
    }
    return cities;
  }
  // Every market page that exists anywhere, auto-market-heroes.js's rule:
  // the committed seed, the local dynamic fallback file, and the Supabase
  // market_pages table — the last being where the Explorer-published cities
  // that most need a boundary actually live. Missing credentials degrade to
  // the local files with a loud line, never silently.
  loadEnv();
  const pages = {
    ...readJson(path.join(__dirname, "..", "market-seed.json"), {}),
    ...readJson(path.join(__dirname, "..", "market-pages-dynamic.json"), {}),
  };
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/market_pages?select=slug,payload&limit=1000`, {
        headers: { apikey: key, authorization: "Bearer " + key },
      });
      if (r.ok) {
        for (const row of await r.json()) {
          if (row && row.slug && row.payload) pages[row.slug] = row.payload;
        }
      } else {
        console.error(`  ! Supabase market_pages read failed (${r.status}) — local files only`);
      }
    } catch (err) {
      console.error("  ! Supabase market_pages read failed — local files only:", err.message);
    }
  } else {
    console.error("  ! No SUPABASE_URL/SUPABASE_SERVICE_KEY — published Explorer markets not seen");
  }
  for (const p of Object.values(pages)) {
    if (!p || !p.city || !p.state) continue;
    const k = MH.cityKey(p.city, p.state);
    if (!cities.has(k)) cities.set(k, { city: String(p.city).trim(), state: String(p.state).trim().toUpperCase() });
  }
  return cities;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let out = {};
  try { out = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) {}
  const had = Object.keys(out).length;
  for (const [key, c] of await targetCities()) {
    if (out[key] && !force) { console.log(key, "already stored — skipping (use --force to refetch)"); continue; }
    const q = new URLSearchParams({
      city: c.city, state: c.state, country: "USA",
      format: "jsonv2", polygon_geojson: "1", polygon_threshold: POLYGON_THRESHOLD, limit: "3",
    });
    let rows = [];
    try {
      const res = await fetch("https://nominatim.openstreetmap.org/search?" + q, {
        headers: { "user-agent": "CompNinja/1.0 (city boundary fetch for compninja.co market map; one-time)" },
      });
      rows = await res.json();
    } catch (e) {
      console.error(key, "FETCH FAILED:", e.message);
    }
    const hit = (Array.isArray(rows) ? rows : []).find((r) =>
      r.geojson && (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon"));
    if (hit) {
      const geometry = trimPrecision(hit.geojson);
      out[key] = { city: c.city, state: c.state, name: hit.display_name, geometry };
      console.log(key, "ok:", geometry.type, JSON.stringify(geometry).length, "bytes");
    } else {
      console.log(key, "NO POLYGON — stays a pin at every zoom");
    }
    await sleep(1100);
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("wrote", OUT, fs.statSync(OUT).size, "bytes,", Object.keys(out).length, "cities (had", had + ")");
})();

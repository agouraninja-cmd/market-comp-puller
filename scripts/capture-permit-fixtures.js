#!/usr/bin/env node
// scripts/capture-permit-fixtures.js — run the permit portal clients against
// the LIVE city portals with a recording fetch, and write what came back as
// fixtures for test/permit-portals.test.js.
//
// The verify-gemini-stream.js precedent: the parsers in permit-portals.js
// were written against markup somebody saw on a given day, and the day a
// portal is redesigned the tests keep passing against stale fixtures while
// production reads nothing. Re-running this is how a redesign is DIAGNOSED
// — the recorded responses are the ground truth, and a test that fails on a
// fresh capture names the selector that moved.
//
//   node scripts/capture-permit-fixtures.js            # all three cities, 4-day window
//   node scripts/capture-permit-fixtures.js --city boise --days 7
//   node scripts/capture-permit-fixtures.js --dry-run  # print, write nothing
//
// Costs nothing (public portals, no API key) and is polite: one request at a
// time with a two-second pause, the tracker's own cadence. Not part of npm
// start or npm test; requiring it starts nothing.
//
// What is written, under test/fixtures/permit-portals/ (all but the manifest
// gzipped — see the write loop):
//   <city>.search.html.gz          the Accela search page (form fields; VIEWSTATE shortened)
//   <city>.<type>.results.html.gz  one date-search result page per permit type
//   <city>.detail.html.gz          the first record's detail page (companies, parcel)
//   nampa.search.json.gz           EnerGov's discovery answer, page 1
//   nampa.contacts.json.gz / nampa.permit.json.gz   one record's contacts and detail
//   ada.parcel.json.gz             the Ada County zoning answer for the first parcel
//   manifest.json                  window, counts, and what each parser produced
//
// Fixtures are trimmed, never rewritten: <script> bodies are dropped and the
// __VIEWSTATE value is shortened to a marker (harvestForm needs it present,
// not intact), which takes an Accela page from ~400KB to a few tens of KB
// with every selector the parsers read left exactly as served.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const PORTALS = require("../permit-portals");
const ZONING = require("../permit-zoning");
const FILINGS = require("../permit-filings");

const OUT = path.join(__dirname, "..", "test", "fixtures", "permit-portals");
const PAUSE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const dryRun = process.argv.includes("--dry-run");
// Every city by default, including one switched off for the sweep (Nampa):
// the capture is the diagnosis, and "still 403" is a result worth having.
const cities = arg("--city", "") ? [arg("--city", "")] : PORTALS.JURISDICTION_KEYS;
const days = Number(arg("--days", FILINGS.DEFAULT_LOOKBACK_DAYS));

function slimHtml(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/(name="__VIEWSTATE"[^>]*value=")[^"]*(")/i, "$1FIXTURE-VIEWSTATE$2")
    .replace(/(id="__VIEWSTATE"[^>]*value=")[^"]*(")/i, "$1FIXTURE-VIEWSTATE$2");
}

// A fetch that records every exchange in order. Bodies are read once here
// and handed back through a Response-shaped stub so the client under test
// sees exactly what a real fetch would have given it.
function recordingFetch(log) {
  return async (url, init) => {
    const method = (init && init.method) || "GET";
    const res = await fetch(url, init);
    const text = await res.text();
    log.push({ method, url: String(url), status: res.status, finalUrl: res.url, body: text });
    process.stderr.write(`  ${method} ${res.status} ${String(url).slice(0, 110)}\n`);
    return {
      ok: res.ok, status: res.status, url: res.url, headers: res.headers,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
}

async function main() {
  const now = Date.now();
  const window = FILINGS.sweepWindow(now, days);
  const manifest = { capturedAt: new Date(now).toISOString(), window, cities: {} };
  const files = {};

  for (const key of cities) {
    const j = PORTALS.getJurisdiction(key);
    if (!j) { console.error(`unknown city: ${key}`); process.exitCode = 1; continue; }
    console.error(`\n== ${j.label} (${j.platform}) ${window.from}..${window.to}`);
    const log = [];
    const deps = { fetch: recordingFetch(log), sleep: () => sleep(PAUSE_MS) };
    const entry = { platform: j.platform, requests: 0, rows: 0, truncated: false, enriched: null, errors: [] };

    try {
      const { rows, truncated } = await PORTALS.discoverFilings(key, window, deps);
      entry.rows = rows.length;
      entry.truncated = truncated;
      entry.sample = rows.slice(0, 3).map((r) => ({ ...r, ref: undefined }));

      if (j.platform === "accela") {
        // The search page is the first GET; each type's result page is the
        // POST that followed it. Name them by type label.
        const firstGet = log.find((l) => l.method === "GET" && /CapHome/.test(l.url));
        if (firstGet) files[`${key}.search.html`] = slimHtml(firstGet.body);
        const posts = log.filter((l) => l.method === "POST");
        j.discovery.types.forEach((t, i) => {
          if (posts[i]) {
            const slug = t.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            files[`${key}.${slug}.results.html`] = slimHtml(posts[i].body);
            (entry.results = entry.results || {})[slug] = { finalUrl: posts[i].finalUrl, status: posts[i].status };
          }
        });
        const first = rows.find((r) => r.ref && r.ref.detailUrl);
        if (first) {
          await sleep(PAUSE_MS);
          const before = log.length;
          entry.enriched = await PORTALS.enrichFiling(key, first.ref, deps);
          const detail = log.slice(before).find((l) => l.method === "GET");
          if (detail) files[`${key}.detail.html`] = slimHtml(detail.body);
          if (entry.enriched.parcel_number && j.county === "ada" && !files["ada.parcel.json"]) {
            await sleep(PAUSE_MS);
            const zb = log.length;
            entry.zoning = await ZONING.fetchZoningByParcel(entry.enriched.parcel_number, deps);
            const z = log.slice(zb).find((l) => l.method === "GET");
            if (z) files["ada.parcel.json"] = z.body;
          }
        }
      } else {
        const search = log.find((l) => l.method === "POST" && /search\/search$/.test(l.url));
        if (search) files[`${key}.search.json`] = search.body;
        const first = rows.find((r) => r.ref && r.ref.caseId);
        if (first) {
          await sleep(PAUSE_MS);
          const before = log.length;
          entry.enriched = await PORTALS.enrichFiling(key, first.ref, deps);
          for (const l of log.slice(before)) {
            if (/contacts\/search/.test(l.url)) files[`${key}.contacts.json`] = l.body;
            else if (/\/permits\//.test(l.url)) files[`${key}.permit.json`] = l.body;
          }
        }
      }
    } catch (err) {
      entry.errors.push(err.message);
      console.error(`  !! ${err.message}`);
      process.exitCode = 1;
    }
    entry.requests = log.length;
    manifest.cities[key] = entry;
  }

  console.error("\n" + JSON.stringify(manifest, null, 2));
  if (dryRun) return;
  fs.mkdirSync(OUT, { recursive: true });
  // Gzipped: an Accela page is ~100KB of markup that compresses ten to one,
  // and a dozen of them raw would be the largest text in the repo. The test
  // reads them back with zlib, which is built in.
  for (const [name, body] of Object.entries(files)) {
    const gz = zlib.gzipSync(Buffer.from(body), { level: 9 });
    fs.writeFileSync(path.join(OUT, name + ".gz"), gz);
    console.error(`wrote ${name}.gz (${(gz.length / 1024).toFixed(1)} KB)`);
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.error(`wrote manifest.json`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { slimHtml };

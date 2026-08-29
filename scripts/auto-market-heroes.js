#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Give every market page a picture of its own city.
//
// `scripts/fetch-market-heroes.js` encodes the CURATED table: a person chose
// each of those Commons files by hand. This script does the choosing too, for
// every market that has no photograph — the Explorer publishes market pages
// from real searches, so the set grows on its own and hand-curation has been
// behind it since the day it shipped.
//
// For each market city with no hero it:
//   1. geocodes the city with Zippopotam (keyless, and already the service
//      city-check.js trusts to say a city is real);
//   2. gathers candidates from Wikimedia — the English Wikipedia article's own
//      lead image, Commons city/aerial categories, Commons geosearch around
//      downtown, and finally Commons full-text search;
//   3. ranks them on metadata with market-hero-pick.js;
//   4. downloads the best, crops it to the 3840x800 header and its 1920w
//      sibling, and grades the encode with market-hero-quality.js;
//   5. shows the finished crop to Claude (market-hero-judge.js), which is the
//      only step that can tell a skyline from a car park, and takes the first
//      candidate it calls good;
//   6. writes market-heroes-auto.json, which market-hero.js reads.
//
// Nothing here runs on a page render or at boot. The JPEGs and the JSON are
// COMMITTED, because Render erases its disk on every deploy — the same reason
// the curated files are committed. A market published after the last run of
// this script is not left blank: the coordinates written here (and the
// Explorer's own) give it the Esri satellite aerial until somebody runs this
// again.
//
//   node scripts/auto-market-heroes.js                  # every city missing one
//   node scripts/auto-market-heroes.js --city "Casper, WY"
//   node scripts/auto-market-heroes.js --dry-run        # find and rank, encode nothing
//   node scripts/auto-market-heroes.js --force          # redo cities that already have one
//   node scripts/auto-market-heroes.js --limit 3        # stop after N cities
//   node scripts/auto-market-heroes.js --no-judge       # skip the model look (free, blinder)
//   node scripts/auto-market-heroes.js --thumbs         # only rebuild the /markets thumbnails
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CITYCHECK = require("../city-check");
const HERO = require("../market-hero");
const PICK = require("../market-hero-pick");
const JUDGE = require("../market-hero-judge");
const QUALITY = require("../market-hero-quality");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "market-heroes");
const AUTO_FILE = path.join(ROOT, "market-heroes-auto.json");
const SEED_FILE = path.join(ROOT, "market-seed.json");
const DYNAMIC_FILE = path.join(ROOT, "market-pages-dynamic.json");

// Wikimedia asks for a real user agent that says who is calling and how to
// reach them; fetch-market-heroes.js has sent this one since the curated
// files were made.
const UA = "CompNinjaMarketHero/1.0 (info@compninja.co)";

// A copy of server.js's STATE_NAMES. Not imported, because requiring
// server.js starts a server; not shared through a module, because these are
// the names of the United States and they do not drift.
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, D.C.",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, judge: true, limit: Infinity, city: "", verbose: false, thumbs: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--no-judge") opts.judge = false;
    else if (a === "--verbose") opts.verbose = true;
    else if (a === "--thumbs") opts.thumbs = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      opts.limit = Number.isFinite(n) && n >= 0 ? n : Infinity;
    }
    else if (a === "--city") opts.city = String(argv[++i] || "");
    else {
      console.error("Unknown flag: " + a);
      process.exit(1);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Which cities need one
// ---------------------------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function loadEnv() {
  // server.js's own tiny loader, minus the server. Only SUPABASE_* matter
  // here, and only for reading the published Explorer markets.
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch (_) { /* no .env is fine — the local files still list markets */ }
}

// Every market page that exists anywhere: the committed seed, the local
// dynamic fallback file, and the Supabase table the Explorer really publishes
// to. The last one is where the cities with no photographs actually live.
async function marketCities() {
  const pages = { ...readJson(SEED_FILE, {}), ...readJson(DYNAMIC_FILE, {}) };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
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

  const cities = new Map();
  for (const [slug, p] of Object.entries(pages)) {
    if (!p || !p.city || !p.state) continue;
    const key2 = HERO.cityKey(p.city, p.state);
    if (!cities.has(key2)) cities.set(key2, { key: key2, city: String(p.city).trim(), state: String(p.state).trim().toUpperCase(), slugs: [] });
    cities.get(key2).slugs.push(slug);
  }
  return [...cities.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Wikimedia
// ---------------------------------------------------------------------------

async function jget(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${url.slice(0, 90)}… → ${r.status}`);
  return r.json();
}

function commonsApi(params) {
  return "https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&" + params;
}

function wikiApi(params) {
  return "https://en.wikipedia.org/w/api.php?format=json&formatversion=2&" + params;
}

// city-check.js already sends these three name variants, for the reason its
// own header gives: measured GeoNames data is inconsistent about punctuation,
// and a false miss here costs the city its aerial.
function cityVariants(city) {
  const typed = String(city || "").trim();
  if (!typed) return [];
  const expand = (s) => s.replace(/\s+/g, " ")
    .replace(/^st /i, "Saint ").replace(/^ft /i, "Fort ").replace(/^mt /i, "Mount ").trim();
  const out = [typed];
  for (const v of [expand(typed.replace(/[.'\-]/g, " ")), expand(typed.replace(/[.'\-]/g, ""))]) {
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

// Wikipedia's own coordinates for the city article, which are the city's
// stated position rather than an average of postal centroids — and a redirect
// resolves the names ZIP data disagrees about. Tried first for both reasons.
async function wikipediaPoint(city, state) {
  const stateName = STATE_NAMES[state] || state;
  for (const t of [`${city}, ${stateName}`, city]) {
    try {
      const j = await jget(wikiApi("action=query&redirects=1&prop=coordinates&titles=" + encodeURIComponent(t)));
      const pt = CITYCHECK.wikiPointFrom(j);
      if (pt) return pt;
    } catch (_) { /* try the next title */ }
  }
  return null;
}

async function zippopotamPoint(city, state) {
  for (const variant of cityVariants(city)) {
    let j;
    try {
      const r = await fetch(
        `https://api.zippopotam.us/us/${encodeURIComponent(state)}/${encodeURIComponent(variant)}`,
        { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
      if (r.status === 404) continue;
      if (!r.ok) return null;
      j = await r.json();
    } catch (_) {
      return null;
    }
    const pt = CITYCHECK.cityPointFrom((j && j.places) || []);
    if (pt) return pt;
  }
  return null;
}

// This point is what the satellite aerial centres on and what the geosearch
// radius is drawn around, so a wrong one is a picture of somewhere else.
async function geocodeCity(city, state) {
  return (await wikipediaPoint(city, state)) || (await zippopotamPoint(city, state));
}

// Commons imageinfo for up to 50 file titles at once.
async function imageInfo(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    if (!chunk.length) continue;
    let j;
    try {
      j = await jget(commonsApi("action=query&prop=imageinfo&iiprop=url|size|mime|extmetadata"
        + "&titles=" + encodeURIComponent(chunk.join("|"))));
    } catch (err) {
      console.error("  ! imageinfo failed:", err.message);
      continue;
    }
    for (const page of (j.query && j.query.pages) || []) {
      const ii = page.imageinfo && page.imageinfo[0];
      if (!ii) continue;
      const em = ii.extmetadata || {};
      out.push({
        title: page.title,
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        license: (em.LicenseShortName && em.LicenseShortName.value) || "",
        artist: (em.Artist && em.Artist.value) || "",
      });
    }
  }
  return out;
}

// The article's own lead image. The highest-precision source there is: a
// person chose one picture to represent the city, and the article title is
// unambiguous in a way a search query is not.
async function wikipediaLead(city, state) {
  const stateName = STATE_NAMES[state] || state;
  const titles = [`${city}, ${stateName}`, city];
  for (const t of titles) {
    let j;
    try {
      j = await jget(wikiApi("action=query&redirects=1&prop=pageimages&piprop=original&titles=" + encodeURIComponent(t)));
    } catch (_) {
      continue;
    }
    const page = (j.query && j.query.pages && j.query.pages[0]) || {};
    const src = page.original && page.original.source;
    if (!src) continue;
    const file = decodeURIComponent(String(src).split("?")[0].split("/").pop() || "");
    if (file) return "File:" + file.replace(/_/g, " ");
  }
  return null;
}

// Every photograph the city's own article uses, not just the lead one. On a
// small town this is where the only real cityscape tends to live: Wikipedia
// editors illustrate the article with a downtown or a waterfront long before
// anybody files an "Aerial photographs of…" category.
async function wikipediaArticleImages(city, state) {
  const stateName = STATE_NAMES[state] || state;
  for (const t of [`${city}, ${stateName}`, city]) {
    let j;
    try {
      j = await jget(wikiApi("action=query&redirects=1&prop=images&imlimit=40&titles=" + encodeURIComponent(t)));
    } catch (_) {
      continue;
    }
    const page = (j.query && j.query.pages && j.query.pages[0]) || {};
    const imgs = (page.images || []).map((i) => i.title).filter(Boolean);
    if (imgs.length) return imgs;
  }
  return [];
}

async function categoryFiles(cat, limit = 60) {
  let j;
  try {
    j = await jget(commonsApi("action=query&generator=categorymembers&gcmtype=file&gcmlimit=" + limit
      + "&gcmtitle=" + encodeURIComponent(cat)));
  } catch (_) {
    return [];
  }
  return ((j.query && j.query.pages) || []).map((p) => p.title);
}

// The radius is deliberately tight. A wide one reaches the next town, and
// market-hero-pick.js then has to refuse most of what comes back — see its
// NEAR_CITY_M rule and the Malibu aerial that earned it.
async function geosearchFiles(coords, radiusM = 6000, limit = 60) {
  let j;
  try {
    j = await jget(commonsApi("action=query&list=geosearch&gsnamespace=6&gslimit=" + limit
      + "&gsradius=" + radiusM + "&gscoord=" + coords.lat + "%7C" + coords.lng));
  } catch (_) {
    return [];
  }
  return ((j.query && j.query.geosearch) || []).map((g) => ({ title: g.title, distanceM: g.dist }));
}

async function searchFiles(query, limit = 20) {
  let j;
  try {
    j = await jget(commonsApi("action=query&generator=search&gsrnamespace=6&gsrlimit=" + limit
      + "&gsrsearch=" + encodeURIComponent(query)));
  } catch (_) {
    return [];
  }
  return ((j.query && j.query.pages) || []).map((p) => p.title);
}

// Everything Wikimedia will offer for one city, tagged with where it came
// from — the tag is most of the score, because a category membership or a
// geotag proves the city in a way a search hit never does.
async function gatherCandidates(city, state, coords, verbose) {
  const stateName = STATE_NAMES[state] || state;
  const tagged = new Map(); // title -> {source, distanceM}

  const add = (title, source, distanceM) => {
    if (!title) return;
    const prev = tagged.get(title);
    // A file found twice keeps its strongest provenance.
    const rank = (s) => PICK.SOURCE_SCORE[s] || 0;
    if (!prev || rank(source) > rank(prev.source)) {
      tagged.set(title, { source, distanceM: distanceM != null ? distanceM : (prev && prev.distanceM) });
    } else if (distanceM != null && prev.distanceM == null) {
      prev.distanceM = distanceM;
    }
  };

  const lead = await wikipediaLead(city, state);
  if (lead) add(lead, "wikipedia");
  for (const t of await wikipediaArticleImages(city, state)) add(t, "wikipedia-article");

  const aerialCats = [
    `Category:Aerial photographs of ${city}, ${stateName}`,
    `Category:Aerial views of ${city}, ${stateName}`,
    `Category:Skylines of ${city}, ${stateName}`,
    `Category:Views of ${city}, ${stateName}`,
    `Category:Downtown ${city}, ${stateName}`,
  ];
  for (const cat of aerialCats) {
    for (const t of await categoryFiles(cat, 30)) add(t, "category-aerial");
  }
  for (const t of await categoryFiles(`Category:${city}, ${stateName}`, 60)) add(t, "category");

  if (coords) {
    for (const g of await geosearchFiles(coords)) add(g.title, "geosearch", g.distanceM);
  }

  for (const t of await searchFiles(`${city} ${stateName} skyline aerial downtown`, 20)) add(t, "search");

  const titles = [...tagged.keys()];
  if (verbose) console.log(`    gathered ${titles.length} candidate file(s)`);
  const info = await imageInfo(titles);
  return info.map((row) => ({ ...row, ...(tagged.get(row.title) || { source: "search" }) }));
}

// ---------------------------------------------------------------------------
// Download + encode
// ---------------------------------------------------------------------------

async function thumbUrl(title, width) {
  const j = await jget(commonsApi("action=query&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=" + width
    + "&titles=" + encodeURIComponent(title)));
  const page = (j.query && j.query.pages && j.query.pages[0]) || {};
  const ii = page.imageinfo && page.imageinfo[0];
  if (!ii) throw new Error("no thumbnail for " + title + " (" + JSON.stringify(j).slice(0, 160) + ")");
  return { url: String(ii.thumburl || ii.url).split("?")[0], thumbWidth: ii.thumbwidth || ii.width };
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "image/*,*/*" }, redirect: "follow" });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

function haveFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
}

// Two encoders on purpose. ffmpeg is what the curated files were made with and
// is the better resampler, but it is not installed everywhere this repo is
// worked on; sips ships with macOS and produces the same cover-crop. Neither
// is a dependency — this script is not part of npm start.
function encodeFfmpeg(src, dest, w, h, crop) {
  const y = crop === "bottom" ? "ih-oh" : crop === "top" ? "0" : "(ih-oh)/2";
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:(iw-ow)/2:${y}`;
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", vf, "-q:v", "2", dest], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg failed\n" + (r.stderr || r.stdout));
}

function sips(args) {
  const r = spawnSync("sips", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error("sips failed\n" + (r.stderr || r.stdout));
  return r;
}

function sipsSize(file) {
  const r = sips(["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const w = /pixelWidth:\s*(\d+)/.exec(r.stdout);
  const h = /pixelHeight:\s*(\d+)/.exec(r.stdout);
  return { width: w ? Number(w[1]) : 0, height: h ? Number(h[1]) : 0 };
}

function encodeSips(src, dest, w, h, crop) {
  fs.copyFileSync(src, dest);
  sips(["-s", "format", "jpeg", "-s", "formatOptions", "high", dest, "--out", dest]);
  const { width, height } = sipsSize(dest);
  if (!width || !height) throw new Error("sips could not read " + src);
  // Cover: scale on whichever edge is binding, then take the band out.
  if (width / height > w / h) sips(["--resampleHeight", String(h), dest, "--out", dest]);
  else sips(["--resampleWidth", String(w), dest, "--out", dest]);
  const scaled = sipsSize(dest);
  const args = ["--cropToHeightWidth", String(h), String(w)];
  if (crop === "bottom" || crop === "top") {
    // An offset flush with the far edge is REFUSED — and sips refuses it by
    // exiting 0 and writing the uncropped image, so the failure is silent and
    // arrives as a 3840x2880 "hero". Measured: on a 3840x2880 image, offset
    // 2079 crops and 2080 does not. Hence the extra pixel; the file grade
    // catches it either way, but a caught bug still costs the candidate.
    const offY = crop === "bottom" ? Math.max(0, scaled.height - h - 1) : 0;
    const offX = Math.max(0, Math.min(Math.round((scaled.width - w) / 2), scaled.width - w - 1));
    args.push("--cropOffset", String(offY), String(offX));
  }
  sips([...args, dest, "--out", dest]);
  // Trust nothing that failed quietly.
  const out = sipsSize(dest);
  if (out.width !== w || out.height !== h) {
    throw new Error(`sips produced ${out.width}x${out.height}, not ${w}x${h}`);
  }
}

function encode(src, dest, w, h, useFfmpeg, crop) {
  if (useFfmpeg) encodeFfmpeg(src, dest, w, h, crop);
  else encodeSips(src, dest, w, h, crop);
}

function readJpegHead(file) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    try {
      const n = Math.min(st.size, 65536);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, 0);
      return { bytes: st.size, dims: QUALITY.jpegDimensions(buf) };
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return { bytes: 0, dims: null };
  }
}

function gradeFiles(mainFile, sibFile) {
  const main = readJpegHead(mainFile);
  const sib = readJpegHead(sibFile);
  return QUALITY.gradeHero({
    width: main.dims && main.dims.width,
    height: main.dims && main.dims.height,
    bytes: main.bytes,
    siblingWidth: sib.dims && sib.dims.width,
    siblingHeight: sib.dims && sib.dims.height,
    siblingBytes: sib.bytes,
  });
}

// ---------------------------------------------------------------------------
// The model look
// ---------------------------------------------------------------------------

async function judgePhoto({ city, state, title, file, apiKey, model }) {
  const body = JUDGE.buildJudgeBody({
    city, state, title, model,
    imageBase64: fs.readFileSync(file).toString("base64"),
  });
  let res;
  try {
    res = await fetch(JUDGE.API_URL, {
      method: "POST",
      headers: JUDGE.judgeHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    return { verdict: "unknown", reason: "reviewer call failed: " + err.message };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { verdict: "unknown", reason: `reviewer call ${res.status}: ` + text.slice(0, 160) };
  }
  return JUDGE.parseJudgeResponse(await res.json());
}

// ---------------------------------------------------------------------------
// One city
// ---------------------------------------------------------------------------

function altFor(city, state, source) {
  const where = `${city}, ${state}`;
  return source === "category-aerial" ? `Aerial view of ${where}` : `${where} from above`;
}

async function doCity(entry, state0, opts, ctx) {
  const { city, state, key } = entry;
  console.log(`\n${city}, ${state}`);
  const coords = await geocodeCity(city, state);
  if (coords) console.log(`  coordinates ${coords.lat}, ${coords.lng}`);
  else console.log("  ! no coordinates — this city cannot even fall back to a satellite aerial");

  const record = { coords: coords || null, checkedAt: new Date().toISOString().slice(0, 10), hero: null, rejected: [] };

  const candidates = await gatherCandidates(city, state, coords, opts.verbose);
  const { kept, rejected } = PICK.rankCandidates(candidates, { city, state }, 6);
  console.log(`  ${kept.length} candidate(s) worth trying, ${rejected.length} refused on metadata`);
  if (opts.verbose) {
    for (const r of kept) console.log(`    + ${r.score} ${r.label} [${r.source}] ${r.reasons.join(", ")}`);
  }
  if (!kept.length) {
    record.rejected = rejected.slice(0, 8).map((r) => ({ title: r.title, reason: r.reasons[0] || "" }));
    return record;
  }
  if (opts.dryRun) {
    record.rejected = kept.map((r) => ({ title: r.label, reason: "dry run — not encoded" }));
    return record;
  }

  const file = PICK.heroFilename(city, state);
  const sibling = HERO.srcsetName(file);
  const thumb = HERO.thumbName(file);
  const tmp = path.join(OUT_DIR, ".tmp");
  fs.mkdirSync(tmp, { recursive: true });

  for (const cand of kept) {
    console.log(`  trying ${cand.label} [${cand.source}, ${cand.width}x${cand.height}]`);
    const raw = path.join(tmp, "source");
    const mainOut = path.join(tmp, file);
    const sibOut = path.join(tmp, sibling);
    const thumbOut = path.join(tmp, thumb);
    try {
      const thumb = await thumbUrl(cand.title, HERO.HERO_WIDTH);
      await download(thumb.url, raw);
    } catch (err) {
      console.log("    x download failed: " + err.message);
      record.rejected.push({ title: cand.label, reason: "download failed: " + err.message });
      continue;
    }

    // Two crops, and the second one is not a fallback for a bad photograph —
    // it is a fallback for a bad CROP. A skyline shot is mostly sky, so the
    // centred band through a 3000x1395 original can come out as mountains and
    // a sliver of buildings (measured on Salt Lake City's own lead image)
    // while the photograph itself is exactly right. Only a reviewer verdict
    // that complains about emptiness earns the retry, and only once.
    let verdict = null;
    let crop = "center";
    let accepted = false;
    for (const attempt of ["center", "bottom"]) {
      crop = attempt;
      try {
        encode(raw, mainOut, HERO.HERO_WIDTH, HERO.HERO_HEIGHT, ctx.ffmpeg, crop);
        encode(raw, sibOut, HERO.HERO_SRCSET_WIDTH, HERO.HERO_SRCSET_HEIGHT, ctx.ffmpeg, crop);
        encode(raw, thumbOut, HERO.HERO_THUMB_WIDTH, HERO.HERO_THUMB_HEIGHT, ctx.ffmpeg, crop);
      } catch (err) {
        console.log("    x encode failed: " + err.message);
        verdict = { verdict: "bad", reason: "encode failed: " + err.message };
        break;
      }
      const grade = gradeFiles(mainOut, sibOut);
      if (!grade.ok) {
        console.log("    x file grade: " + grade.reasons.join(" · "));
        verdict = { verdict: "bad", reason: grade.reasons.join(" · ") };
        break;
      }
      if (!opts.judge) {
        verdict = { verdict: "good", reason: "not reviewed (--no-judge)" };
        accepted = true;
        break;
      }
      verdict = await judgePhoto({
        city, state, title: cand.label, file: sibOut,
        apiKey: ctx.apiKey, model: ctx.model,
      });
      console.log(`    reviewer (${crop} crop): ${verdict.verdict} — ${verdict.reason}`);
      if (verdict.verdict === "good") { accepted = true; break; }
      if (attempt === "center" && /\bsky\b|empty|blank|sliver|mostly (sky|water|vegetation|field)/i.test(verdict.reason)) {
        console.log("    … the crop, not the photograph — trying it lower");
        continue;
      }
      break;
    }
    if (!accepted) {
      record.rejected.push({ title: cand.label, reason: (verdict && verdict.reason) || "refused" });
      continue;
    }

    fs.copyFileSync(mainOut, path.join(OUT_DIR, file));
    fs.copyFileSync(sibOut, path.join(OUT_DIR, sibling));
    fs.copyFileSync(thumbOut, path.join(OUT_DIR, thumb));
    const kb = Math.round(fs.statSync(path.join(OUT_DIR, file)).size / 1024);
    const kb1x = Math.round(fs.statSync(path.join(OUT_DIR, sibling)).size / 1024);
    console.log(`    ✓ ${file} ${kb} KB + ${kb1x} KB`);
    record.hero = {
      file,
      credit: PICK.cleanCredit(cand.artist) || "Wikimedia Commons",
      license: cand.license,
      // Verbatim, extension and all: it is the audit trail and the credit
      // link under the photograph (commonsFileUrl builds the File: page URL).
      commons: String(cand.title).replace(/^File:/, ""),
      alt: altFor(city, state, cand.source),
      source: cand.source,
      crop,
      judge: verdict,
    };
    break;
  }

  if (!record.hero) console.log("  → no photograph passed; this city keeps the satellite aerial");
  return record;
}

// Is the CURATED file for this city one the live page will actually use? The
// same grade the server applies, read off the same bytes.
function curatedFileIsGood(key) {
  const row = HERO.HEROES[key];
  if (!row) return false;
  return gradeFiles(path.join(OUT_DIR, row.file), path.join(OUT_DIR, HERO.srcsetName(row.file))).ok;
}

// The /markets directory draws every market at once, so it reads a third,
// small size. Thumbnails are made by downscaling the STORED 3840w hero rather
// than by going back to Wikimedia: the framing is already decided, the network
// is not involved, and a thumbnail can therefore never show a different crop
// from the page it links to.
function rebuildThumbs(ctx, force) {
  const heroes = [];
  for (const [key, row] of Object.entries(HERO.HEROES)) heroes.push([key, row.file]);
  for (const key of Object.keys(HERO.autoCities())) {
    const hero = HERO.autoHeroFor(key);
    if (hero) heroes.push([key, hero.file]);
  }
  let made = 0;
  let skipped = 0;
  for (const [key, file] of heroes) {
    const src = path.join(OUT_DIR, file);
    const dest = path.join(OUT_DIR, HERO.thumbName(file));
    if (!fs.existsSync(src)) {
      console.log(`  ! ${key}: ${file} is missing, no thumbnail made`);
      continue;
    }
    if (fs.existsSync(dest) && !force) { skipped++; continue; }
    try {
      encode(src, dest, HERO.HERO_THUMB_WIDTH, HERO.HERO_THUMB_HEIGHT, ctx.ffmpeg, "center");
      made++;
      console.log(`  ✓ ${HERO.thumbName(file)} ${Math.round(fs.statSync(dest).size / 1024)} KB`);
    } catch (err) {
      console.log(`  x ${key}: ${err.message}`);
    }
  }
  console.log(`\n${made} thumbnail(s) written, ${skipped} already there (--force to redo).`);
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  loadEnv();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ctx = {
    ffmpeg: haveFfmpeg(),
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.HERO_JUDGE_MODEL || JUDGE.DEFAULT_MODEL,
  };
  if (opts.judge && !ctx.apiKey && !opts.thumbs) {
    console.error("ANTHROPIC_API_KEY is not set — run with --no-judge to pick on metadata alone.");
    process.exit(1);
  }
  console.log(`Encoder: ${ctx.ffmpeg ? "ffmpeg" : "sips"}${opts.judge ? ` · reviewer: ${ctx.model}` : " · no reviewer"}`);

  const auto = readJson(AUTO_FILE, { version: 1, cities: {} });
  auto.cities = auto.cities || {};

  if (opts.thumbs) {
    rebuildThumbs(ctx, opts.force);
    return;
  }

  let cities = await marketCities();
  if (opts.city) {
    const want = opts.city.trim().toLowerCase();
    cities = cities.filter((c) => c.key === want || c.city.toLowerCase() === want);
    if (!cities.length) {
      console.error(`No market page covers "${opts.city}".`);
      process.exit(1);
    }
  }

  const todo = cities.filter((c) => {
    // A curated city is normally never generated for: heroFor resolves the
    // curated photo first, so anything found would be spend with no effect on
    // any page. The exception is a curated file that FAILS the quality grade —
    // Ontario, CA, whose stored JPEG is an upscale, so the live page shows a
    // satellite aerial and a generated photograph really would be an
    // improvement. That is a fact about the file on disk, so it is measured
    // here rather than configured.
    if (HERO.HEROES[c.key] && curatedFileIsGood(c.key)) return false;
    if (opts.force) return true;
    const row = auto.cities[c.key];
    return !(row && row.hero);
  });

  console.log(`${cities.length} market cities · ${todo.length} without a photograph`);
  let done = 0;
  for (const entry of todo) {
    if (done >= opts.limit) break;
    done++;
    try {
      auto.cities[entry.key] = await doCity(entry, entry.state, opts, ctx);
    } catch (err) {
      console.error(`  ! ${entry.key} failed:`, err.message);
    }
    if (!opts.dryRun) {
      auto.generatedAt = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(AUTO_FILE, JSON.stringify(auto, null, 2) + "\n");
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.rmSync(path.join(OUT_DIR, ".tmp"), { recursive: true, force: true });

  const withPhoto = Object.values(auto.cities).filter((c) => c && c.hero).length;
  const withCoords = Object.values(auto.cities).filter((c) => c && c.coords).length;
  console.log(`\nGenerated heroes: ${withPhoto} · cities with coordinates for the satellite fallback: ${withCoords}`);
  if (opts.dryRun) console.log("(dry run — nothing was written)");
  else console.log("Review them at /admin/heroes, then commit market-heroes/ and market-heroes-auto.json.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { parseArgs, cityVariants, geocodeCity, wikipediaPoint, zippopotamPoint, gatherCandidates, encode, rebuildThumbs, curatedFileIsGood, main };

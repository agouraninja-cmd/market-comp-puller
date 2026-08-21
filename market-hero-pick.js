// ---------------------------------------------------------------------------
// Which Wikimedia photograph should become a market page's city hero.
//
// `market-hero.js` holds the CURATED table — a person picked those, one city
// at a time, which does not scale past the seeded markets: every Explorer
// market a visitor generates arrives with no photograph at all, and there are
// already more of those than there are curated cities.
//
// This module is the machine half of that judgement. It scores candidates
// gathered from the sources the repo already trusts (the city's English
// Wikipedia lead image, Commons categories, Commons geosearch around the
// city's coordinates, Commons full-text search) and answers which ones are
// worth downloading. It decides on METADATA only — title, size, licence,
// where the candidate came from. It cannot see the picture, so it cannot know
// a skyline from a car park; `market-hero-judge.js` asks a model to look, and
// `market-hero-quality.js` grades the encoded file. All three have to pass.
//
// The rule inherited from market-hero.js still governs: a missing picture is
// better than the wrong city's. Every hard reject here ends in the Esri
// satellite aerial of the market's own coordinates, which is always right
// about WHERE it is even when it is dull.
//
// Pure, no I/O, so npm test can pin every verdict with no network.
// ---------------------------------------------------------------------------

"use strict";

// Source width needed before an encode is worth attempting. The hero slot is
// 3840x800; below MIN_SOURCE_WIDTH the 1920w sibling itself is an upscale and
// market-hero-quality would grade the result soft anyway. Between the two, the
// file is usable but penalised — a slightly soft real photograph of the city
// still beats a satellite tile.
const MIN_SOURCE_WIDTH = 2000;
const PREFERRED_WIDTH = 3840;

// A hero is a 4.8:1 band. A portrait original has to lose ~80% of its height
// to make one, which is how a photograph of a whole building becomes a
// photograph of three windows. Beyond MAX_ASPECT the original is a stitched
// strip and crops to a smear.
const MAX_ASPECT = 12;

// How close an unnamed geotagged photograph has to be before it counts as a
// photograph OF this city rather than one near it.
const NEAR_CITY_M = 4000;

const OK_MIME = new Set(["image/jpeg", "image/png", "image/tiff", "image/webp"]);

// Titles that are certainly not a photograph of a place. Commons is full of
// these for exactly the cities we search for: every US city has a seal, a
// flag, a locator map and a census chart, and they rank well because their
// titles name the city and nothing else.
const JUNK_TITLE_RE = new RegExp([
  "\\b(",
  [
    "map", "maps", "locator", "atlas", "seal", "flag", "coat of arms", "crest",
    "logo", "wordmark", "collage", "montage", "diagram", "chart", "graph",
    "histogram", "census", "poster", "leaflet", "brochure", "scan",
    "screenshot", "ticket", "stamp", "coin", "banknote", "postcard", "envelope",
    "portrait", "headshot", "gravestone", "tombstone", "plaque", "marker",
    "signage", "billboard", "schematic", "blueprint", "floor plan", "timetable",
    "infobox", "icon", "template", "chart", "sheet music",
  ].join("|"),
  ")\\b",
].join(""), "i");

// Interiors and single objects. A photograph OF something in the city is not a
// photograph of the city — the first automatic pass on Nampa, ID offered a
// department store shopfront, which is a fine picture and a terrible header.
const SUBJECT_TITLE_RE = new RegExp([
  "\\b(",
  [
    "interior", "inside", "lobby", "hallway", "staircase", "bedroom",
    "restaurant", "cafe", "shopfront", "storefront", "shop", "store",
    "statue", "monument", "mural", "sculpture", "fountain", "memorial",
    "gravesite", "cemetery", "headstone", "locomotive", "train", "railcar",
    "bus", "tram", "truck", "aircraft", "airplane", "helicopter", "boat",
    "flower", "bird", "insect", "butterfly", "dog", "cat", "squirrel",
    "mushroom", "tree", "leaf", "menu", "uniform", "jersey", "scoreboard",
  ].join("|"),
  ")\\b",
].join(""), "i");

// What a good hero usually calls itself.
const GOOD_TITLE_RE = /\b(aerial|aerials|skyline|skylines|cityscape|downtown|uptown|panorama|pano|overlook|overlooking|bird'?s[- ]?eye|from above|waterfront|riverfront|harbor|harbour|main street|city center|city centre|drone)\b/i;

// Softer signals. Night and winter are not disqualifying — the header lays a
// dark scrim over the photograph anyway — but between two otherwise equal
// candidates the daylight one is the better page.
const NIGHT_TITLE_RE = /\b(night|nighttime|dusk|evening|sunset|sunrise|dawn|fireworks)\b/i;
const WINTER_TITLE_RE = /\b(snow|snowy|snowfall|blizzard|winter|ice storm|flood|flooding|wildfire|smoke|fog|foggy)\b/i;
const HISTORIC_TITLE_RE = /\b(1[6-9]\d{2}|19[0-5]\d|historic photograph|old photo|postcard|lithograph|engraving|daguerreotype)\b/i;

// Bulk stock imports, titled "<City>, United States (Unsplash <id>)". They
// name the city and carry a city geotag, so every filter above passes them —
// and measured on Salt Lake City they were a desk flat-lay, a portrait and a
// field with horses. Sunk rather than refused: one of them really might be
// the skyline, and the reviewer is the thing that can tell. Sinking them
// means the reviewer is spent on the described photographs first.
const STOCK_IMPORT_RE = /\(unsplash\s+[a-z0-9_-]{4,}\)/i;

// Where a candidate came from, worth more than anything its title says. The
// English Wikipedia article's own lead image is a human's pick of the one
// picture that represents the city, which is the same judgement being
// automated here; a Commons category of aerials is the same judgement made by
// whoever filed the photograph.
const SOURCE_SCORE = {
  wikipedia: 60,
  "category-aerial": 45,
  category: 22,
  geosearch: 18,
  search: 6,
};

// Sources that already prove the city by construction: an article's lead
// image, a city category, a photograph geotagged inside the city. Only
// full-text search has to prove it in the title, because Commons search
// happily answers "Casper Wyoming skyline" with Skyline Drive, Virginia.
const CITY_PROVEN_BY_SOURCE = new Set(["wikipedia", "category-aerial", "category", "geosearch"]);

const FREE_LICENSE_RE = /^(cc|public domain|pd|no restrictions|attribution)/i;
const NONFREE_LICENSE_RE = /(fair use|non-?free|all rights reserved|copyright|©)/i;

function baseTitle(title) {
  return String(title || "")
    .replace(/^File:/i, "")
    .replace(/\.(jpe?g|png|tiff?|webp|gif|svg|pdf)$/i, "")
    .replace(/_/g, " ")
    .trim();
}

function words(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

// "Coeur D'Alene" has to match "Coeur d'Alene"; "Las Vegas" must not match a
// title that merely contains "vegas" as part of another word. Token-sequence
// matching does both, and is the same shape city-check.js already uses for
// name variants.
function titleNamesCity(title, city) {
  const hay = words(baseTitle(title));
  const needle = words(city);
  if (!needle.length || hay.length < needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

function licenseOk(license) {
  const s = String(license || "").trim();
  if (!s) return false;
  if (NONFREE_LICENSE_RE.test(s)) return false;
  return FREE_LICENSE_RE.test(s);
}

// One candidate in, a verdict out. `ok: false` means never download it;
// `score` orders the ones worth trying, best first.
function gradeCandidate(cand, ctx) {
  const c = cand || {};
  const city = (ctx && ctx.city) || "";
  const title = baseTitle(c.title);
  const width = Number(c.width);
  const height = Number(c.height);
  const source = String(c.source || "search");
  const reasons = [];

  if (!title) return { ok: false, score: 0, reasons: ["no title"], title: "" };
  if (!OK_MIME.has(String(c.mime || "").toLowerCase())) {
    return { ok: false, score: 0, reasons: ["not a raster photograph (" + (c.mime || "no mime") + ")"], title };
  }
  if (!licenseOk(c.license)) {
    return { ok: false, score: 0, reasons: ["licence is not clearly free (" + (c.license || "none stated") + ")"], title };
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, score: 0, reasons: ["no usable dimensions"], title };
  }
  if (width < MIN_SOURCE_WIDTH) {
    return { ok: false, score: 0, reasons: [width + "px wide is too small for the header"], title };
  }
  if (height > width) {
    return { ok: false, score: 0, reasons: ["portrait originals cannot make a 4.8:1 band"], title };
  }
  if (width / height > MAX_ASPECT) {
    return { ok: false, score: 0, reasons: ["a " + Math.round(width / height) + ":1 strip crops to a smear"], title };
  }
  if (JUNK_TITLE_RE.test(title)) {
    return { ok: false, score: 0, reasons: ["title says it is not a photograph of a place"], title };
  }
  if (SUBJECT_TITLE_RE.test(title)) {
    return { ok: false, score: 0, reasons: ["a photograph of one thing in the city, not of the city"], title };
  }
  if (!CITY_PROVEN_BY_SOURCE.has(source) && !titleNamesCity(title, city)) {
    return { ok: false, score: 0, reasons: ["a search hit that never names " + city], title };
  }
  // Geosearch proves a location, not a CITY, and a radius drawn around a
  // suburb reaches its neighbours: the first run offered Agoura Hills a Library
  // of Congress aerial of the Malibu coastline, geotagged inside the radius and
  // titled "in Los Angeles". A photograph that neither names this city nor was
  // taken in the middle of it is not evidence about this city.
  const far = Number(c.distanceM);
  if (source === "geosearch" && !titleNamesCity(title, city) && Number.isFinite(far) && far > NEAR_CITY_M) {
    return {
      ok: false,
      score: 0,
      reasons: [Math.round(far / 100) / 10 + " km out and never names " + city],
      title,
    };
  }

  let score = SOURCE_SCORE[source] || 0;
  if (GOOD_TITLE_RE.test(title)) { score += 30; reasons.push("titled as a view of the city"); }
  if (titleNamesCity(title, city)) { score += 20; reasons.push("names the city"); }
  if (width >= PREFERRED_WIDTH) { score += 15; reasons.push("wide enough for the retina file"); }
  else { score -= 10; reasons.push(width + "px will upscale into the 3840w slot"); }

  const aspect = width / height;
  if (aspect >= 1.3 && aspect <= 6) { score += 10; reasons.push("already a landscape band"); }

  if (NIGHT_TITLE_RE.test(title)) { score -= 8; reasons.push("looks like a night shot"); }
  if (WINTER_TITLE_RE.test(title)) { score -= 6; reasons.push("looks like weather, not the city"); }
  if (HISTORIC_TITLE_RE.test(title)) { score -= 25; reasons.push("looks like a historic image"); }
  if (STOCK_IMPORT_RE.test(title)) { score -= 40; reasons.push("an undescribed stock import"); }

  // Geosearch hands us metres from the city's downtown point. Close is the
  // whole signal there — it is the only source that proves the location
  // without anybody having typed the city's name.
  const dist = Number(c.distanceM);
  if (Number.isFinite(dist)) {
    if (dist <= 1500) { score += 12; reasons.push("taken downtown"); }
    else if (dist <= 4000) { score += 6; }
    else if (dist > 12000) { score -= 10; reasons.push(Math.round(dist / 1000) + " km out of town"); }
  }

  return { ok: true, score, reasons, title };
}

// Every candidate graded, deduped by file title, best first. `limit` caps how
// many survive — each survivor costs a download, an encode and a model look,
// so this is a spend ceiling as much as a shortlist.
//
// The graded row keeps the candidate's own `title` — the full "File:….jpg"
// that every later Wikimedia call and the credit link are keyed on — and
// carries the readable form separately as `label`. Spreading the grade over
// the candidate replaced one with the other on the first run, and every
// download asked the API for an article named "Cumberland Aerial 2022" that
// does not exist.
function rankCandidates(candidates, ctx, limit = 6) {
  const best = new Map();
  for (const cand of candidates || []) {
    const g = gradeCandidate(cand, ctx);
    const key = g.title.toLowerCase();
    if (!key) continue;
    const row = { ...cand, label: g.title, ok: g.ok, score: g.score, reasons: g.reasons };
    // One file can arrive from several sources — a category member that is
    // also the article's lead image, say. Keep the strongest reading of it,
    // never whichever source happened to be gathered first.
    const prev = best.get(key);
    if (!prev || row.score > prev.score) best.set(key, row);
  }
  const rows = [...best.values()];
  const kept = rows.filter((r) => r.ok).sort((a, b) => b.score - a.score);
  return { kept: kept.slice(0, limit), rejected: rows.filter((r) => !r.ok) };
}

// The filename a city's hero is stored under. Same shape the curated files
// already use, and it has to satisfy market-hero.js's FILE_RE — that regex is
// what stops a crafted city name reaching the static file handler as a path.
function heroFilename(city, state) {
  const slug = (String(city || "") + "-" + String(state || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? slug + ".jpg" : "";
}

// Commons states the author as an HTML fragment ("<a href=…>Name</a>"), and
// the credit renders as text over the photograph. Strip the markup rather
// than escape it — a credit line is a name, never a link somebody else wrote.
function cleanCredit(artist) {
  const text = String(artist || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 60 ? text.slice(0, 57).trimEnd() + "…" : text;
}

module.exports = {
  MIN_SOURCE_WIDTH,
  NEAR_CITY_M,
  STOCK_IMPORT_RE,
  PREFERRED_WIDTH,
  MAX_ASPECT,
  OK_MIME,
  SOURCE_SCORE,
  baseTitle,
  titleNamesCity,
  licenseOk,
  gradeCandidate,
  rankCandidates,
  heroFilename,
  cleanCredit,
};

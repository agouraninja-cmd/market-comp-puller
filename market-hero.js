// City hero photos for /market/<slug> page headers.
//
// Curated Wikimedia Commons aerials / skylines, keyed by "city, st" so every
// property type in the same city shares one photograph. Explorer-generated
// markets that are not in the table fall through to an Esri World Imagery
// aerial of downtown when we have coordinates, and to no photo otherwise —
// a missing picture must not invent a skyline of the wrong city (Ontario, CA
// is not Ontario, Canada).
//
// Photos are downloaded, cropped, and served from /market-heroes/ rather than
// hotlinked: Wikimedia asks not to be used as a CDN. Credits render on the
// photograph. Pure, no I/O, so npm test can pin the lookup.
//
// Since 2026-08-21 the curated table is no longer the only photo layer.
// `market-heroes-auto.json` holds the same shape for cities nobody curated by
// hand — found, graded, looked at by a model and encoded by
// `node scripts/auto-market-heroes.js`, then committed like any other hero.
// It exists because the Explorer publishes market pages faster than a person
// can pick photographs for them: on the day it shipped, 21 cities were
// curated and 13 live Explorer markets had no picture at all.
//
// The resolution order is curated photo, then automatic photo, then a
// satellite aerial of the city's own coordinates, then nothing. Curated wins
// on purpose — a person looked at those — and the auto file also carries
// COORDINATES for every market city it has ever seen, which is what turns the
// last-resort satellite branch from a hardcoded list of 22 cities into
// something every market page can reach.

"use strict";

// Downtown / most photogenic point, used only for the Esri fallback.
const CITY_COORDS = {
  "atlanta, ga": { lat: 33.7550, lng: -84.3900 },
  "austin, tx": { lat: 30.2672, lng: -97.7431 },
  "boise, id": { lat: 43.6150, lng: -116.2023 },
  "charlotte, nc": { lat: 35.2271, lng: -80.8431 },
  "columbus, oh": { lat: 39.9612, lng: -82.9988 },
  "dallas, tx": { lat: 32.7787, lng: -96.7970 },
  "denver, co": { lat: 39.7392, lng: -104.9903 },
  "fontana, ca": { lat: 34.0922, lng: -117.4350 },
  "houston, tx": { lat: 29.7604, lng: -95.3698 },
  "indianapolis, in": { lat: 39.7684, lng: -86.1581 },
  "las vegas, nv": { lat: 36.1147, lng: -115.1728 },
  "memphis, tn": { lat: 35.1495, lng: -90.0490 },
  "nashville, tn": { lat: 36.1627, lng: -86.7816 },
  "ontario, ca": { lat: 34.0560, lng: -117.6012 },
  "orlando, fl": { lat: 28.5383, lng: -81.3792 },
  "phoenix, az": { lat: 33.4484, lng: -112.0740 },
  "riverside, ca": { lat: 33.9806, lng: -117.3755 },
  "sacramento, ca": { lat: 38.5816, lng: -121.4944 },
  "san antonio, tx": { lat: 29.4241, lng: -98.4936 },
  "san diego, ca": { lat: 32.7157, lng: -117.1611 },
  "savannah, ga": { lat: 32.0809, lng: -81.0912 },
  "tampa, fl": { lat: 27.9506, lng: -82.4572 },
};

// Display size: full-bleed ~340px tall. A 1920 CSS-px desktop at 2× DPR
// needs ~3840 device pixels of width; 1600px upscaled into that slot is
// why the first ship looked soft. Adding a city means downloading the
// 3840px thumb, cropping to HERO_WIDTH×HERO_HEIGHT, writing the 1920w
// sibling, and dropping both JPEGs next to the others. Some Commons
// originals are smaller than 3840 (Ontario, CA) — those stay relatively
// soft; do not invent pixels from a different city. The live header skips
// a file that fails the quality grade and uses Esri of this city's coords.
const HERO_WIDTH = 3840;
const HERO_HEIGHT = 800;
const HERO_SRCSET_WIDTH = 1920;
const HERO_SRCSET_HEIGHT = 400;

// Commons file titles (unprefixed) are the audit trail; `file` is the
// 3840w JPEG we serve. The 1920w sibling is `srcsetName(file)`.
const HEROES = {
  "atlanta, ga": {
    file: "atlanta-ga.jpg",
    credit: "Ron Reiring",
    license: "CC BY 2.0",
    commons: "Aerial of Downtown Atlanta, GA.jpg",
    alt: "Aerial view of downtown Atlanta",
  },
  "austin, tx": {
    file: "austin-tx.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Skyline of Austin, Texas (cropped).jpg",
    alt: "Austin skyline",
  },
  "charlotte, nc": {
    file: "charlotte-nc.jpg",
    credit: "Precisionviews",
    license: "CC BY-SA 4.0",
    commons: "Uptown Charlotte 2018 taking by DJI Phantom 4 pro.jpg",
    alt: "Drone view of uptown Charlotte",
  },
  "columbus, oh": {
    file: "columbus-oh.jpg",
    credit: "Pi.1415926535",
    license: "CC BY-SA 3.0",
    commons: "Aerial view of Columbus, Ohio, September 2015.JPG",
    alt: "Aerial view of Columbus",
  },
  "dallas, tx": {
    file: "dallas-tx.jpg",
    credit: "IcedCowboyCoffee",
    license: "CC0",
    commons: "Dallas Texas skyline from Reunion Tower September 2025 (cropped).png",
    alt: "Dallas skyline",
  },
  "denver, co": {
    file: "denver-co.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Denver, Colorado skyline (cropped 3x5).jpg",
    alt: "Denver skyline",
  },
  "fontana, ca": {
    file: "fontana-ca.jpg",
    credit: "Doc Searls",
    license: "CC BY-SA 2.0",
    commons: "California Speedway, aerial view.jpg",
    alt: "Aerial view of Fontana",
  },
  "houston, tx": {
    file: "houston-tx.jpg",
    credit: "Carol M. Highsmith",
    license: "Public domain",
    commons: "Aerial views of the Houston, Texas, skyline in 2014 LCCN2014632199.tif",
    alt: "Aerial view of the Houston skyline",
  },
  "indianapolis, in": {
    file: "indianapolis-in.jpg",
    credit: "Carol M. Highsmith",
    license: "Public domain",
    commons: "Aerial view of Indianapolis, Indiana, with a focus on Lucas Oil Stadium, highsm.40934.jpg",
    alt: "Aerial view of Indianapolis",
  },
  "las vegas, nv": {
    file: "las-vegas-nv.jpg",
    credit: "Mike McBey",
    license: "CC BY 2.0",
    commons: "Las Vegas from above (40064746644).jpg",
    alt: "Aerial view of the Las Vegas Strip",
  },
  "memphis, tn": {
    file: "memphis-tn.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Skyline of Memphis, TN.jpg",
    alt: "Memphis skyline",
  },
  "nashville, tn": {
    file: "nashville-tn.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Nashville, TN skyline.jpg",
    alt: "Nashville skyline",
  },
  "ontario, ca": {
    file: "ontario-ca.jpg",
    credit: "skinnylawyer",
    license: "CC BY-SA 2.0",
    commons: "Ontario Airport from United 793 - Flickr - skinnylawyer.jpg",
    alt: "Aerial view of Ontario, California",
  },
  "orlando, fl": {
    file: "orlando-fl.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Orlando, Florida (cropped).jpg",
    alt: "Orlando skyline",
  },
  "phoenix, az": {
    file: "phoenix-az.jpg",
    credit: "DPPed",
    license: "CC BY-SA 3.0",
    commons: "Downtown Phoenix Aerial Looking Northeast.jpg",
    alt: "Aerial view of downtown Phoenix",
  },
  "riverside, ca": {
    file: "riverside-ca.jpg",
    credit: "Famartin",
    license: "CC BY-SA 4.0",
    commons: "2021-10-05 14 11 03 View south across western Riverside County, California from an airplane heading for Los Angeles International Airport.jpg",
    alt: "Aerial view of Riverside, California",
    crop: "bottom",
  },
  "sacramento, ca": {
    file: "sacramento-ca.jpg",
    credit: "Quintin Soloviev",
    license: "CC BY 4.0",
    commons: "Sacramento, CA skyline (cropped).jpg",
    alt: "Sacramento skyline",
  },
  "san antonio, tx": {
    file: "san-antonio-tx.jpg",
    credit: "Jouaienttoi",
    license: "CC BY-SA 4.0",
    commons: "San Antonio Botanical Garden Overlook View.jpg",
    alt: "San Antonio from above",
  },
  "san diego, ca": {
    file: "san-diego-ca.jpg",
    credit: "JDrewes",
    license: "CC BY-SA 3.0",
    commons: "San Diego Skyline Day JD111107.jpg",
    alt: "San Diego skyline",
  },
  "savannah, ga": {
    file: "savannah-ga.jpg",
    credit: "Bigdaverhuberg",
    license: "CC BY-SA 4.0",
    commons: "Savannah.tif",
    alt: "Savannah from above",
  },
  "tampa, fl": {
    file: "tampa-fl.jpg",
    credit: "Clément Bardot",
    license: "CC BY-SA 4.0",
    commons: "Downtown Tampa, Florida.jpg",
    alt: "Tampa skyline",
  },
};

const FILE_RE = /^[a-z0-9-]+\.jpg$/;

// The generated companion table. A static require of committed JSON, the same
// deterministic read market-seed.json gets, so this module stays testable with
// no network and no filesystem of its own — but it is GENERATED, so nothing
// here may assume it is well formed. A missing or unreadable file must leave
// the curated markets exactly as they were rather than take the server down at
// boot.
let AUTO_FILE;
try {
  AUTO_FILE = require("./market-heroes-auto.json");
} catch (_) {
  AUTO_FILE = null;
}

function autoCities(table) {
  const src = table === undefined ? AUTO_FILE : table;
  return (src && typeof src === "object" && src.cities && typeof src.cities === "object")
    ? src.cities
    : {};
}

// One generated entry, checked before it is believed. The file name is the
// part that matters: it becomes a URL under /market-heroes/, so it goes
// through the same FILE_RE the curated files do — a generated path is still a
// path, and this is the one place a bad one could enter.
function autoHeroFor(key, table) {
  const row = autoCities(table)[key];
  const hero = row && row.hero;
  if (!hero || !isHeroFilename(hero.file)) return null;
  if (!hero.credit || !hero.commons) return null;
  return hero;
}

function autoCoordsFor(key, table) {
  const row = autoCities(table)[key];
  const ll = row && row.coords;
  if (!ll || !Number.isFinite(Number(ll.lat)) || !Number.isFinite(Number(ll.lng))) return null;
  return { lat: Number(ll.lat), lng: Number(ll.lng) };
}

function cityKey(city, state) {
  return `${String(city || "").trim().toLowerCase()}, ${String(state || "").trim().toLowerCase()}`;
}

function commonsFileUrl(commons) {
  // MediaWiki File: titles keep spaces; the wiki page encodes them as _.
  return "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(commons).replace(/%20/g, "_");
}

function srcsetName(file) {
  return String(file || "").replace(/\.jpg$/, "-" + HERO_SRCSET_WIDTH + ".jpg");
}

function photoSrcset(file) {
  return "/market-heroes/" + srcsetName(file) + " " + HERO_SRCSET_WIDTH + "w, "
    + "/market-heroes/" + file + " " + HERO_WIDTH + "w";
}

function esriAerialUrl(lat, lng, w = HERO_WIDTH, h = HERO_HEIGHT) {
  const latRad = Number(lat) * Math.PI / 180;
  const widthM = 9000;
  const heightM = widthM * (h / w);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  const dLat = (heightM / 2) / mPerDegLat;
  const dLng = (widthM / 2) / mPerDegLng;
  const bbox = [
    Number(lng) - dLng,
    Number(lat) - dLat,
    Number(lng) + dLng,
    Number(lat) + dLat,
  ].map((n) => n.toFixed(5)).join(",");
  return "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"
    + `?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${w},${h}&format=jpg&f=image`;
}

function skippedKey(skipKeys, key) {
  if (!skipKeys) return false;
  if (typeof skipKeys.has === "function") return skipKeys.has(key);
  if (Array.isArray(skipKeys)) return skipKeys.indexOf(key) !== -1;
  return false;
}

function satelliteHero(city, state, ll) {
  const src = esriAerialUrl(ll.lat, ll.lng);
  const src1x = esriAerialUrl(ll.lat, ll.lng, HERO_SRCSET_WIDTH, HERO_SRCSET_HEIGHT);
  return {
    src,
    srcset: src1x + " " + HERO_SRCSET_WIDTH + "w, " + src + " " + HERO_WIDTH + "w",
    alt: `Aerial view of ${String(city || "").trim()}, ${String(state || "").trim()}`.trim(),
    credit: "Esri, Maxar",
    license: "",
    commonsUrl: "",
    kind: "satellite",
  };
}

function photoHero(row, kind) {
  return {
    src: "/market-heroes/" + row.file,
    srcset: photoSrcset(row.file),
    alt: row.alt,
    credit: row.credit,
    license: row.license,
    commonsUrl: commonsFileUrl(row.commons),
    kind,
  };
}

// opts:
//   skipKeys  — cities whose stored JPEG failed the quality grade
//   coords    — {lat,lng} the caller already knows (a market page payload),
//               used only after the two committed coordinate sources
//   auto      — the generated table, injected by tests
function heroFor(city, state, opts) {
  const key = cityKey(city, state);
  const skipped = skippedKey(opts && opts.skipKeys, key);
  const auto = opts && opts.auto;
  const curated = HEROES[key];
  // skipKeys is the quality grade: a curated file that is the wrong size or
  // too small to be sharp must not head the live page. Fall through to Esri
  // of THIS city's coordinates — Ontario, CA is still not Ontario, Canada.
  if (curated && !skipped) return photoHero(curated, "photo");

  // The automatic layer sits below the curated one and above the satellite:
  // a real photograph a model looked at beats an aerial tile, and a person's
  // pick beats both. Same skip rule, so a soft generated file drops through
  // exactly as a soft curated one does.
  const generated = autoHeroFor(key, auto);
  if (generated && !skipped) return photoHero(generated, "photo");

  // Coordinates, in order of how much they have been checked: the curated
  // downtown points, then the geocoded ones the generator stored, then
  // whatever the caller was handed. A city with none still gets nothing —
  // the whole point of this file is that a wrong skyline is worse than none.
  const ll = CITY_COORDS[key] || autoCoordsFor(key, auto) || (opts && opts.coords);
  if (ll && Number.isFinite(Number(ll.lat)) && Number.isFinite(Number(ll.lng))) {
    return satelliteHero(city, state, { lat: Number(ll.lat), lng: Number(ll.lng) });
  }
  return null;
}

function isHeroFilename(name) {
  return FILE_RE.test(String(name || ""));
}

module.exports = {
  HEROES,
  CITY_COORDS,
  autoCities,
  autoHeroFor,
  autoCoordsFor,
  FILE_RE,
  HERO_WIDTH,
  HERO_HEIGHT,
  HERO_SRCSET_WIDTH,
  HERO_SRCSET_HEIGHT,
  cityKey,
  heroFor,
  srcsetName,
  photoSrcset,
  esriAerialUrl,
  commonsFileUrl,
  isHeroFilename,
};

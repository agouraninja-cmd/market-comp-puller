// building-photo.js — a street-level photo of the building, or the aerial
// (2026-10-09, the owner: "show the actual pictures of buildings instead of
// the birds eye view version ... make sure they are actual good pictures").
//
// Home's lists and map cards and The Board's deal cards showed every place as
// a satellite crop. They now show the building as a person standing on the
// street would see it, through the same GET /api/streetview the report map's
// pin popups use, wherever that photo is provably of THIS building and good.
// Where it is not, the aerial stays, so no card ever goes blank and no card
// ever shows the wrong building.
//
// Two questions, both answered before Google is ever asked for an image:
//
//   1. WHICH BUILDING? A geocoder puts the point on the street centerline, so
//      a camera aimed at the point photographs the road. snap() asks
//      OpenStreetMap (one batched Overpass query, by coordinates only) for
//      the building footprints near each point, and pick() takes the one that
//      CARRIES THE ADDRESS: its addr:housenumber and addr:street. Strict on
//      purpose, and stricter than the report map's snap, which may fall back
//      to "the main building near the pin" where no footprint nearby carries a
//      number: that fallback leans on the report's own check that the
//      geocoder matched the typed address (geoLabelMatches), and the points
//      here come from stored coordinates with no such label to check. So: the
//      footprint proves the address, or there is no street photo.
//      An address that names one unit of a site (Apt 3B, Trailer 51) or has
//      no street number never qualifies (eligible()): the report map's rule,
//      for the report map's reasons (maps.md).
//   2. IS IT A GOOD PHOTO? The server decides (streetview-aim.js judgePano:
//      Google's own camera, captured within ten years, 4-35 m from the
//      building, aimed and framed) and answers 404 otherwise. This file only
//      remembers the answer per building (photoState / notePhoto), so a
//      building with no good photo is not asked again on every redraw.
//
// PRIVACY (CLAUDE.md never-break rule 7): no address leaves the browser here.
// Overpass receives coordinates, the same coordinates the aerial's tile URLs
// already disclose to Esri and the report map's snap already sends; the
// house number and street are compared in this browser. The photo URL
// carries the building's coordinates to our own server, which asks Google.
//
// ⚠ houseNumberOf, osmNumberMatches, streetLooksSame and unitDesignatorOf are
// COPIES of index.html's (its "Proving a footprint is actually the searched
// address" block), because /vault cannot load index.html's script. Change
// both together; test/building-photo.test.js runs both copies over the same
// addresses and fails the build when they disagree.
//
// Pure rules and dual-exported (Node for npm test, the browser global
// BLDGPHOTO for index.html and /vault), like home-map.js, and served with
// the same maxAge: 0 rule. The browser half (snap, the caches, overlay) is
// at the bottom and touches nothing under Node.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BLDGPHOTO = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  // How far from the point a footprint may sit and still be asked about, and
  // still count. The query radius is the report snap's; a footprint's middle
  // can sit a little past it on a big building.
  const NEAR_M = 90;
  const MATCH_M = 120;
  // Points per Overpass query. A query is one HTTP request with one clause per
  // point; past ~30 the public instances start timing it out.
  const BATCH = 25;
  // A building with no good photo is asked about again after this long, in
  // case Google drives the street. A good one is kept; the image itself is in
  // the browser's cache for 30 days (the route's Cache-Control).
  const FAIL_MS = 7 * 864e5;
  const SNAP_KEY = "bldgPhoto.v1";
  const STATE_KEY = "bldgPhotoState.v1";
  const CACHE_MAX = 400;

  // ---- ⚠ index.html's address-proving helpers, copied (see the header) ----
  function houseNumberOf(address) {
    const m = /^\s*(\d+)/.exec(String(address || ""));
    return m ? m[1] : null;
  }
  // OSM writes house numbers as "1500", "1500-1510", "1500A", "1500;1502".
  function osmNumberMatches(tagNum, want) {
    if (!tagNum || !want) return false;
    return String(tagNum).split(/[;,]/).some((part) => {
      const s = part.trim();
      const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s);
      if (range) {
        const a = Number(range[1]), b = Number(range[2]), w = Number(want);
        return w >= Math.min(a, b) && w <= Math.max(a, b);
      }
      const lead = /^(\d+)/.exec(s);
      return !!lead && lead[1] === want;
    });
  }
  const STREET_STOPWORDS = new Set(["north","south","east","west","northeast","northwest",
    "southeast","southwest","street","road","avenue","boulevard","drive","lane","way",
    "court","place","parkway","highway","circle","terrace","trail","loop","suite","unit"]);
  function streetLooksSame(osmStreet, address) {
    if (!osmStreet) return true;
    const toks = String(osmStreet).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
      .filter((t) => t.length >= 3 && !STREET_STOPWORDS.has(t));
    if (!toks.length) return true;
    const hay = String(address).toLowerCase();
    return toks.some((t) => hay.indexOf(t) >= 0);
  }
  const UNIT_KEYWORDS = "apt|apartment|unit|ste|suite|spc|space|lot|trlr|trailer" +
    "|bldg|building|rm|room|fl|floor|penthouse|ph";
  const UNIT_DESIGNATOR_RE = new RegExp(
    "(?:^|[\\s,])(?:#\\s*[a-z0-9-]+|(?:" + UNIT_KEYWORDS + ")\\.?" +
    "(?:\\s*[a-z0-9-]*\\d[a-z0-9-]*|\\s+[a-z]{1,2}))(?=$|[\\s,])", "i");
  const ADDRESS_TAIL_RE = /,?\s*(?:[a-z]{2}\s+)?\d{5}(?:-\d{4})?\s*$/i;
  function unitDesignatorOf(address) {
    const cleaned = String(address || "").replace(ADDRESS_TAIL_RE, "");
    const m = UNIT_DESIGNATOR_RE.exec(cleaned);
    return m ? m[0].trim() : null;
  }

  // ---- pure ---------------------------------------------------------------------

  function finiteLL(ll) {
    return !!ll && isFinite(ll.lat) && isFinite(ll.lng) && ll.lat !== null && ll.lng !== null
      && Math.abs(ll.lat) <= 90 && Math.abs(ll.lng) <= 180;
  }

  // Can this address have a street photo at all? A street number that names a
  // whole property: no number is a district or a road, and a unit is one of
  // many on a site whose footprints all share the number.
  function eligible(address) {
    if (!/^\s*\d+\s+\S/.test(String(address || ""))) return false;
    return !unitDesignatorOf(address);
  }

  // The cache key: ~11 m buckets plus the address, the report snap's bldgKey
  // shape, because the answer depends on both.
  function keyFor(ll, address) {
    return Number(ll.lat).toFixed(4) + "," + Number(ll.lng).toFixed(4) + "|" + String(address || "").trim().toLowerCase();
  }

  // One Overpass query for many points: the building ways within NEAR_M of
  // each, with their tags and bounding boxes.
  function queryFor(points) {
    return "[out:json][timeout:15];(" + points.map((p) =>
      "way(around:" + NEAR_M + "," + Number(p.lat).toFixed(6) + "," + Number(p.lng).toFixed(6) + ")[\"building\"];"
    ).join("") + ");out tags bb;";
  }

  // The building for one point and address, out of an Overpass answer's
  // elements, or null. Only a footprint carrying the house number (and, where
  // it names one, the street) counts. Among several that do (one building
  // mapped in parts) the main mass near the point wins: a photo of the wrong
  // wing is still a photo of the right building.
  function pick(ll, address, elements) {
    if (!finiteLL(ll) || !eligible(address)) return null;
    const want = houseNumberOf(address);
    const cosLat = Math.cos(ll.lat * Math.PI / 180);
    let best = null, bestScore = 0;
    for (const e of elements || []) {
      const b = e && e.bounds;
      if (!b || !isFinite(b.minlat) || !isFinite(b.maxlat) || !isFinite(b.minlon) || !isFinite(b.maxlon)) continue;
      const tags = e.tags || {};
      if (!osmNumberMatches(tags["addr:housenumber"], want)) continue;
      if (!streetLooksSame(tags["addr:street"], address)) continue;
      const c = { lat: (b.minlat + b.maxlat) / 2, lng: (b.minlon + b.maxlon) / 2 };
      const dist = Math.hypot((c.lat - ll.lat) * 111320, (c.lng - ll.lng) * 111320 * cosLat);
      if (dist > MATCH_M) continue;
      const area = Math.max(((b.maxlat - b.minlat) * 111320) * ((b.maxlon - b.minlon) * 111320 * cosLat), 100);
      const score = area / (dist + 25);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // The photo's address on our own server: the building's middle, never the
  // street address.
  function photoSrc(b) {
    return "/api/streetview?lat=" + Number(b.lat).toFixed(6) + "&lng=" + Number(b.lng).toFixed(6);
  }
  function stateKey(b) {
    return Number(b.lat).toFixed(5) + "," + Number(b.lng).toFixed(5);
  }

  // ---- the browser half -----------------------------------------------------------

  // Reading localStorage itself can throw (a sandboxed frame, blocked site
  // data), and this runs at load, so the read is guarded too.
  let store = null;
  try { store = root && root.localStorage ? root.localStorage : null; } catch (_) { store = null; }
  function load(key) {
    try { return (store && JSON.parse(store.getItem(key))) || {}; } catch (_) { return {}; }
  }
  function save(key, obj) {
    try {
      const keys = Object.keys(obj);
      if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach((k) => delete obj[k]);
      if (store) store.setItem(key, JSON.stringify(obj));
    } catch (_) { /* private mode: the caches are a nicety */ }
  }
  let snaps = null, states = null;
  const snapsNow = () => snaps || (snaps = load(SNAP_KEY));
  const statesNow = () => states || (states = load(STATE_KEY));

  // undefined = not asked yet; null = asked, no footprint carries the address
  // (or the address cannot have a photo); { lat, lng } = the building.
  function building(ll, address) {
    if (!finiteLL(ll) || !eligible(address)) return null;
    const hit = snapsNow()[keyFor(ll, address)];
    if (hit === undefined) return undefined;
    return hit && isFinite(hit.lat) ? { lat: hit.lat, lng: hit.lng } : null;
  }

  // "ok" (a good photo came back), "fail" (the server refused, recently) or
  // undefined (never tried, or tried long enough ago to try again).
  function photoState(b) {
    if (!b) return undefined;
    const s = statesNow()[stateKey(b)];
    if (!s) return undefined;
    if (s.ok) return "ok";
    return Date.now() - Number(s.at || 0) < FAIL_MS ? "fail" : undefined;
  }
  function notePhoto(b, ok) {
    if (!b) return;
    const all = statesNow();
    const k = stateKey(b);
    delete all[k];   // re-insert at the end, so the trim drops the oldest
    all[k] = ok ? { ok: 1 } : { at: Date.now() };
    save(STATE_KEY, all);
  }

  // Two public Overpass instances, tried in order (the main one 504s under
  // load), index.html's OVERPASS_ENDPOINTS.
  const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  async function overpass(body) {
    for (const url of ENDPOINTS) {
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(body), signal: AbortSignal.timeout(15000) });
        if (r.ok) return await r.json();
      } catch (_) { /* the next mirror */ }
    }
    return null;
  }

  // Finds the building for each { ll, address } not already known, BATCH
  // points per query, one query at a time. An outage is NOT remembered (the
  // next visit asks again); a real answer is, found or not. Resolves once
  // every asked point is settled, with how many buildings it found.
  const inFlight = new Set();
  async function snap(items) {
    const todo = [];
    const seen = new Set();
    for (const it of items || []) {
      if (!it || !finiteLL(it.ll) || !eligible(it.address)) continue;
      const k = keyFor(it.ll, it.address);
      if (seen.has(k) || inFlight.has(k) || snapsNow()[k] !== undefined) continue;
      seen.add(k);
      todo.push({ k, ll: it.ll, address: it.address });
    }
    let found = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      part.forEach((p) => inFlight.add(p.k));
      try {
        const j = await overpass(queryFor(part.map((p) => p.ll)));
        if (!j) continue;
        const all = snapsNow();
        for (const p of part) {
          const b = pick(p.ll, p.address, j.elements);
          all[p.k] = b ? { lat: b.lat, lng: b.lng } : 0;
          if (b) found++;
        }
        save(SNAP_KEY, all);
      } finally {
        part.forEach((p) => inFlight.delete(p.k));
      }
    }
    return found;
  }

  // Lays the street photo over `box` (an element already holding the aerial,
  // or nothing when `known` says the photo is good). The image fades in over
  // the aerial on its first load and is simply there from then on. On an
  // error (the server found no good photo, a rate limit) it removes itself
  // and the aerial stays; `onFail` repaints the aerial when the box was left
  // empty for a known-good photo. `onLoad` lets a page swap its credit line.
  // A Land deal, a parcel with no building on it, never gets this far: no
  // footprint carries its number, so pick() refused, and its aerial is the
  // right picture of it.
  function overlay(box, b, opts) {
    const o = opts || {};
    if (!box || !b || !root || !root.document) return null;
    const img = root.document.createElement("img");
    img.alt = o.alt || "";
    img.decoding = "async";
    if (o.lazy) img.loading = "lazy";
    img.setAttribute("data-street", "1");
    img.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;object-fit:cover;"
      + (o.known ? "" : "opacity:0;transition:opacity .25s ease");
    img.addEventListener("load", () => {
      notePhoto(b, true);
      img.style.opacity = "1";
      if (typeof o.onLoad === "function") o.onLoad(img);
    });
    img.addEventListener("error", () => {
      notePhoto(b, false);
      img.remove();
      if (typeof o.onFail === "function") o.onFail();
    });
    img.src = photoSrc(b);
    // `before`: a child that must stay painted above the photo (a credit
    // line, a stamp) when the page gives it no z-index of its own.
    if (o.before && o.before.parentNode === box) box.insertBefore(img, o.before);
    else box.appendChild(img);
    return img;
  }

  return {
    NEAR_M, MATCH_M, BATCH, FAIL_MS, SNAP_KEY, STATE_KEY,
    houseNumberOf, osmNumberMatches, streetLooksSame, unitDesignatorOf,
    eligible, keyFor, queryFor, pick, photoSrc,
    building, photoState, notePhoto, snap, overlay,
  };
});

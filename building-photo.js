// building-photo.js — a street photo of the building, or the aerial.
//
// 2026-10-09, twice. The owner first: "show the actual pictures of buildings
// instead of the birds eye view version ... make sure they are actual good
// pictures". That shipped finding the building from OpenStreetMap footprints,
// and Home stayed almost all aerial: most US footprints carry no house
// number, so almost nothing could be proven. Then, shown it: "it has to be a
// professional picture of the building". So photos are now looked up BY
// ADDRESS: the page posts the address to our own POST /api/building-photo,
// the server asks Google (which places the address on its parcel and turns
// its nearest camera toward it), and judges the answer (Google's own camera,
// captured in the last ten years, near our own geocode; streetview-aim.js
// judgeAddressPano). The owner's call the same day, for every property, deal
// and private comp; CLAUDE.md rule 7 names the route.
//
// What the page gets back is an image URL with the address SEALED in it
// (photo-token.js), so no address is ever in a URL, plus null for "no good
// photo". This file remembers both per address in the browser, asks about
// a batch at a time, and lays the photo over the aerial the page already
// drew. Where the answer is no (a parcel with no building, no camera near,
// only an old or a user's photo) the aerial stays: no card goes blank.
//
// An address qualifies only with a street number (no number is a road or a
// district, not a building) that names a whole property, not one unit of a
// site (Trailer 51, Apt 3B): the report map's rule, for its reasons
// (maps.md). ⚠ houseNumberOf and unitDesignatorOf are COPIES of index.html's
// (its "Proving a footprint is actually the searched address" block),
// because /vault cannot load index.html's script; test/building-photo.test.js
// runs both copies over the same addresses.
//
// Pure rules and dual-exported (Node for npm test, the browser global
// BLDGPHOTO for index.html and /vault), like home-map.js, and served with the
// same maxAge: 0 rule. The browser half is at the bottom and does nothing
// under Node.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BLDGPHOTO = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  // Places per POST, the route's own ceiling.
  const BATCH = 25;
  // An address with no good photo, or whose photo would not load, is asked
  // about again after this long, in case Google drives the street. A good one
  // is kept; the image is in the browser's cache for 30 days.
  const MISS_MS = 7 * 864e5;
  const STORE_KEY = "bldgPhoto.v2";
  const CACHE_MAX = 600;

  // ---- ⚠ index.html's helpers, copied (see the header) ---------------------
  function houseNumberOf(address) {
    const m = /^\s*(\d+)/.exec(String(address || ""));
    return m ? m[1] : null;
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

  // Can this address have a street photo at all?
  function eligible(address) {
    if (!/^\s*\d+\s+\S/.test(String(address || ""))) return false;
    return !unitDesignatorOf(address);
  }
  // One spelling per address (photo-token.js normalizeAddress's rule, so the
  // browser's memory and the server's agree on what "the same address" is).
  function keyFor(address) {
    return String(address || "").replace(/\s+/g, " ").trim().replace(/[\s,]+$/, "").toLowerCase().slice(0, 300);
  }
  // Only our own route's URLs are ever laid into a page.
  function isPhotoSrc(src) {
    return typeof src === "string" && /^\/api\/streetview\?t=[A-Za-z0-9_-]+$/.test(src);
  }
  function finiteLL(ll) {
    return !!ll && ll.lat !== null && ll.lng !== null && isFinite(ll.lat) && isFinite(ll.lng);
  }

  // ---- the browser half -----------------------------------------------------------

  // Reading localStorage itself can throw (a sandboxed frame, blocked site
  // data), and this runs at load, so the read is guarded too.
  let store = null;
  try { store = root && root.localStorage ? root.localStorage : null; } catch (_) { store = null; }
  // The first build of this file kept footprints under these keys; they mean
  // nothing now.
  try { if (store) { store.removeItem("bldgPhoto.v1"); store.removeItem("bldgPhotoState.v1"); } } catch (_) { /* nicety */ }
  let memo = null;
  function all() {
    if (memo) return memo;
    try { memo = (store && JSON.parse(store.getItem(STORE_KEY))) || {}; } catch (_) { memo = {}; }
    return memo;
  }
  function put(key, val) {
    const m = all();
    delete m[key];   // re-insert at the end, so the trim drops the oldest
    m[key] = val;
    try {
      const keys = Object.keys(m);
      if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach((k) => delete m[k]);
      if (store) store.setItem(STORE_KEY, JSON.stringify(m));
    } catch (_) { /* private mode: the memory is a nicety */ }
  }

  // undefined = not asked yet (or asked long enough ago to ask again);
  // null = no photo (or the address cannot have one); a src = the photo.
  function photo(address) {
    if (!eligible(address)) return null;
    const hit = all()[keyFor(address)];
    if (!hit) return undefined;
    if (isPhotoSrc(hit.s)) return hit.s;
    return Date.now() - Number(hit.at || 0) < MISS_MS ? null : undefined;
  }
  // Has this address's photo loaded before? Then the page can skip the aerial.
  function known(address) {
    const hit = all()[keyFor(address)];
    return !!(hit && hit.ok && isPhotoSrc(hit.s));
  }
  function noteLoaded(address, src) {
    if (isPhotoSrc(src)) put(keyFor(address), { s: src, ok: 1 });
  }
  function noteFailed(address) {
    put(keyFor(address), { at: Date.now() });
  }

  // Asks our own route about every { address, lat?, lng? } not already known,
  // BATCH at a time, one call at a time. A refusal of the whole call (signed
  // out, a rate limit, no key on this server) and a "0" (Google could not be
  // asked) are NOT remembered: the next visit asks again. Resolves when every
  // asked address is settled.
  const inFlight = new Set();
  async function lookup(items) {
    const todo = [];
    const seen = new Set();
    for (const it of items || []) {
      if (!it || !eligible(it.address)) continue;
      const k = keyFor(it.address);
      if (seen.has(k) || inFlight.has(k) || photo(it.address) !== undefined) continue;
      seen.add(k);
      todo.push({ k, address: it.address, ll: finiteLL(it.ll) ? it.ll : null });
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      part.forEach((p) => inFlight.add(p.k));
      try {
        const r = await fetch("/api/building-photo", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ places: part.map((p) => (p.ll
            ? { address: p.address, lat: p.ll.lat, lng: p.ll.lng } : { address: p.address })) }),
        });
        if (!r.ok) return;
        const j = await r.json();
        const photos = Array.isArray(j && j.photos) ? j.photos : [];
        part.forEach((p, n) => {
          const a = photos[n];
          if (isPhotoSrc(a)) put(p.k, { s: a });
          else if (a === null) put(p.k, { at: Date.now() });
        });
      } catch (_) {
        return;
      } finally {
        part.forEach((p) => inFlight.delete(p.k));
      }
    }
  }

  // Lays the photo over `box` (an element already holding the aerial, or
  // nothing when `known` says it has loaded before). It fades in over the
  // aerial on its first load and is simply there from then on. On an error
  // it removes itself, the address is remembered as having no photo for a
  // while, the aerial stays, and `onFail` repaints the aerial when the box
  // was left empty for a known photo. `onLoad` lets a page swap its credit
  // line. `before`: a child that must stay painted above the photo.
  function overlay(box, address, src, opts) {
    const o = opts || {};
    if (!box || !isPhotoSrc(src) || !root || !root.document) return null;
    const img = root.document.createElement("img");
    img.alt = o.alt || "";
    img.decoding = "async";
    if (o.lazy) img.loading = "lazy";
    img.setAttribute("data-street", "1");
    img.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;max-width:none;object-fit:cover;"
      + (o.known ? "" : "opacity:0;transition:opacity .25s ease");
    img.addEventListener("load", () => {
      noteLoaded(address, src);
      img.style.opacity = "1";
      if (typeof o.onLoad === "function") o.onLoad(img);
    });
    img.addEventListener("error", () => {
      noteFailed(address);
      img.remove();
      if (typeof o.onFail === "function") o.onFail();
    });
    img.src = src;
    if (o.before && o.before.parentNode === box) box.insertBefore(img, o.before);
    else box.appendChild(img);
    return img;
  }

  return {
    BATCH, MISS_MS, STORE_KEY,
    houseNumberOf, unitDesignatorOf, eligible, keyFor, isPhotoSrc,
    photo, known, noteLoaded, noteFailed, lookup, overlay,
  };
});

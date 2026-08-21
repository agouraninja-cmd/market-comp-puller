// city-check.js — the Market Explorer's real-city check.
//
// A typo'd city used to spend a billed search and could publish a permanently
// misspelled /market/ page. This module decides whether a (city, state) pair
// names a real US city, using Zippopotam's keyless city endpoint — the same
// service the Address Explorer already trusts client-side for zip resolve.
//
// Pure on purpose: no I/O of its own (the caller injects fetch), which is
// what lets npm test cover every verdict with no network. server.js owns the
// real fetch, the timeout, the verdict memo, and the rate limit.
//
// Spec: docs/superpowers/specs/2026-08-09-explore-market-city-validation-design.md

// Ordered, deduped list of names to try: as typed, then a punctuation-to-space
// variant, then a punctuation-stripped variant (each with whitespace
// collapsed and a leading "St "/"Ft "/"Mt " expanded to "Saint "/"Fort "/
// "Mount " — GeoNames spells all three out, live-verified on Ft. Worth and
// Mt. Vernon, both refused before the expansion existed), deduped
// case-insensitively against what's already in the list. Up to three
// requests total. Two variants exist because measured GeoNames/Zippopotam
// behavior is inconsistent about what happens to punctuation in a place
// name: it usually becomes a space ("Coeur D Alene", "O Fallon", "Winston
// Salem" all answer 200) but sometimes strips to nothing instead ("Lees
// Summit" answers 200). A false 404 on either variant of a real city would
// refuse a legitimate market — worse than the typo pages this module exists
// to stop.
function cityVariants(city) {
  const typed = String(city || "").trim();
  if (!typed) return [];
  const expand = (s) => s.replace(/\s+/g, " ")
    .replace(/^st /i, "Saint ")
    .replace(/^ft /i, "Fort ")
    .replace(/^mt /i, "Mount ")
    .trim();
  const spaced = expand(typed.replace(/[.'\-]/g, " "));
  const stripped = expand(typed.replace(/[.'\-]/g, ""));
  const out = [typed];
  for (const v of [spaced, stripped]) {
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

// "ok" | "unknown" | "unavailable". Three outbound requests maximum.
// 200 = the city exists. 404 = this name doesn't; try the next variant.
// Anything else — 5xx, a weird status, a thrown timeout/network error —
// is "unavailable", INCLUDING a throw after a 404: the truth is unknown,
// and fail-open must never refuse a legitimate market.
async function checkCity(fetchFn, city, state) {
  for (const variant of cityVariants(city)) {
    let res;
    try {
      res = await fetchFn(
        `https://api.zippopotam.us/us/${encodeURIComponent(state)}/${encodeURIComponent(variant)}`
      );
    } catch (_) {
      return "unavailable";
    }
    if (res.status === 200) return "ok";
    if (res.status !== 404) return "unavailable";
  }
  return "unknown";
}

// WHERE the city is, from the same answer that says it exists.
//
// Zippopotam returns one entry per ZIP, and averaging them is wrong: a
// PO-box-only ZIP carries a placeholder coordinate for the whole county, the
// same point repeated across every such ZIP. Measured on real answers,
// averaging put Agoura Hills 15 km away in the Santa Monica Mountains and
// Woodland Hills 40 km away in the harbour. Both would have rendered a
// satellite aerial of somewhere else, which is the one thing market-hero.js
// exists to prevent.
//
// So: drop exactly-repeated points (the placeholder's signature — two real
// ZIP centroids are not identical to four decimals), then keep only the ones
// near the median and average those. Pure, so npm test can pin it against the
// real answers that produced those two misses.
const NEAR_LAT = 0.2;    // ~22 km
const NEAR_LNG = 0.25;   // ~22 km at 40°N

function cityPointFrom(places) {
  const seen = new Set();
  const pts = [];
  for (const p of places || []) {
    const lat = Number(p && (p.latitude !== undefined ? p.latitude : p.lat));
    const lng = Number(p && (p.longitude !== undefined ? p.longitude : p.lng));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = lat.toFixed(4) + "," + lng.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push({ lat, lng });
  }
  if (!pts.length) return null;
  if (pts.length === 1) return round(pts[0]);
  const mid = (nums) => {
    const s = [...nums].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const mLat = mid(pts.map((p) => p.lat));
  const mLng = mid(pts.map((p) => p.lng));
  const near = pts.filter((p) => Math.abs(p.lat - mLat) <= NEAR_LAT && Math.abs(p.lng - mLng) <= NEAR_LNG);
  const use = near.length ? near : pts;
  return round({
    lat: use.reduce((a, p) => a + p.lat, 0) / use.length,
    lng: use.reduce((a, p) => a + p.lng, 0) / use.length,
  });
}

function round(p) {
  return { lat: Number(p.lat.toFixed(4)), lng: Number(p.lng.toFixed(4)) };
}

// The coordinates an English Wikipedia article states for itself, which beat
// any average of ZIP centroids: the article IS the city, and a redirect
// resolves the names ZIPs disagree about ("Woodland Hills, California" is
// "Woodland Hills, Los Angeles"). Parsing only — the caller fetches.
function wikiPointFrom(json) {
  const page = (json && json.query && json.query.pages && json.query.pages[0]) || {};
  const c = (page.coordinates && page.coordinates[0]) || null;
  if (!c || !Number.isFinite(Number(c.lat)) || !Number.isFinite(Number(c.lon))) return null;
  return round({ lat: Number(c.lat), lng: Number(c.lon) });
}

module.exports = { cityVariants, checkCity, cityPointFrom, wikiPointFrom, NEAR_LAT, NEAR_LNG };

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

// Ordered, deduped list of names to try: as typed, then ONE normalized
// variant (periods and apostrophes stripped, whitespace collapsed, a leading
// "St " expanded to "Saint "). The retry exists because a false 404 on a
// punctuation variant of a real city would refuse a legitimate market —
// worse than the typo pages this module exists to stop.
function cityVariants(city) {
  const typed = String(city || "").trim();
  const normalized = typed
    .replace(/[.']/g, "")
    .replace(/\s+/g, " ")
    .replace(/^st /i, "Saint ")
    .trim();
  if (!normalized || normalized.toLowerCase() === typed.toLowerCase()) return [typed];
  return [typed, normalized];
}

// "ok" | "unknown" | "unavailable". Two outbound requests maximum.
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

module.exports = { cityVariants, checkCity };

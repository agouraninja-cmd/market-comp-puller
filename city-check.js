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

module.exports = { cityVariants, checkCity };

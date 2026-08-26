"use strict";
// The /markets momentum map's one non-obvious rule: which single claim a
// CITY's carved map area may make, when one city shape can hold several
// markets (Phoenix industrial, retail and multifamily are three markets and
// one polygon).
//
// The answer is decided by AGREEMENT, and it only ever weakens:
//   - every market with a current read pointing one way  -> that word
//   - readings that disagree                             -> "mixed" (no
//     single color would be honest about a city where industrial expands
//     while multifamily contracts)
//   - no current readings at all                         -> "none" (drawn as
//     an outline making no color claim — the hollow-pin rule, area-shaped)
//
// A market with NO read never argues: a city with one expanding market and
// two unread ones is expanding, not mixed — absence of data is not a
// disagreement. And an unrecognized direction word is treated as unread,
// never as its own state: the same fail-toward-less-claim rule
// report-access.js applies to an unrecognized visibility.
//
// Pure on purpose (no I/O, no clock): npm test exercises the whole table.
// server.js computes each area's momentum at render time and the browser
// only ever styles what it is handed, so this file is the single home of
// the rule.

const AREA_DIRS = new Set(["expanding", "flat", "contracting"]);

// markets: [{ dir?: string }] — the markets read in one city.
// Returns "expanding" | "flat" | "contracting" | "mixed" | "none".
function cityAreaState(markets) {
  const seen = new Set();
  for (const m of Array.isArray(markets) ? markets : []) {
    const d = m && m.dir;
    if (AREA_DIRS.has(d)) seen.add(d);
  }
  if (seen.size === 0) return "none";
  if (seen.size === 1) return seen.values().next().value;
  return "mixed";
}

module.exports = { AREA_DIRS, cityAreaState };

"use strict";
// ---------------------------------------------------------------------------
// Sample addresses — the "e.g." buildings the comp-report box offers (the
// greyed list Tab fills on /bulk, and the rotating example in the report
// form's address field).
//
// THE RULE (owner's, 2026-11-18): a sample is a real building IN THE MEMBER'S
// AREA that NOBODY HAS LOOKED UP YET. The opposite of a cache-friendly demo:
// every sample somebody runs is a fresh search, and a fresh search is new
// comps harvested into the corpus. A sample that is already cached would
// teach us nothing.
//
// PURE: no I/O, no clock. The route in server.js owns the reads (the member's
// recent searches, properties and Board markets; the comp corpus; the search
// cache) and hands them in. Randomness is injected so tests are exact.
//
//   areaMarkets()      which "City, ST" markets count as the member's area
//   sampleCandidates() clean, de-duplicated, shuffled street addresses
//   pickUnsearched()   the first N candidates nobody has searched
//
// Only the PUBLIC comp corpus feeds this, never a vault table (broker_comps,
// org_comps): CLAUDE.md's privacy wall. The member's own rows decide WHERE to
// look and are never returned.
// ---------------------------------------------------------------------------

const { marketOf, marketForLog, siblingMarkets } = require("./market");
const { streetKey } = require("./explore-addresses");

const DEFAULT_COUNT = 3;
const MAX_COUNT = 8;
const MAX_AREA_MARKETS = 3;

// The Address Explorer's street-number rule: a leading number that is not a
// quantity, so "10000 SF" and "12 units" never become a building.
const STREET_OK = /^\d+\s+(?!(sf|sq|sqft|acres?|units?)\b)/i;
// A house-number RANGE ("1200-1250 Main St") is a portfolio or a parcel
// description, not one building somebody would type.
const RANGE_RE = /^\d+\s*[-–]\s*\d+/;

function isMultiBuilding(address) {
  const street = String(address || "").split(",")[0];
  return /&|\band\b|\bportion\b|\bparcels?\b/i.test(street) || RANGE_RE.test(street.trim());
}

// A market key we can show and search on: "City, ST" and nothing looser.
function areaKey(value) {
  return marketForLog(marketOf(value));
}

// Which markets are this member's area, most telling first.
//
// Weights: a property they own or are buying (3) says more than a market they
// follow on The Board (2), which says more than an address they once searched
// (1). Ties keep first appearance, which is newest-first for every input. The
// top MAX_AREA_MARKETS keep their place, then each one's metro siblings
// (market.js's reviewed groups) are added after them, so a Meridian member
// also draws on Boise's buildings without Boise outranking Meridian.
function areaMarkets({ portfolio, watchlist, recents } = {}) {
  const score = new Map();
  const add = (key, w) => {
    if (!key) return;
    score.set(key, (score.get(key) || 0) + w);
  };
  for (const p of portfolio || []) add(areaKey(p && p.address), 3);
  for (const w of watchlist || []) add(areaKey(w && w.market), 2);
  for (const r of recents || []) add(areaKey(r && r.address), 1);
  const ranked = [...score.entries()]
    .map(([key, s], i) => ({ key, s, i }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .slice(0, MAX_AREA_MARKETS)
    .map((x) => x.key);
  const out = [...ranked];
  for (const key of ranked) {
    for (const sib of siblingMarkets(key)) if (!out.includes(sib)) out.push(sib);
  }
  return out;
}

// Fisher-Yates with an injected random() in [0, 1).
function shuffle(list, random) {
  const a = list.slice();
  const rnd = typeof random === "function" ? random : Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rnd() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Corpus rows -> [{ address, type }], each a single street-numbered building
// with a "City, ST" a search can run on, one per building, in random order.
// `type` filters to one property type; without it every typed row counts.
function sampleCandidates(rows, opts) {
  const o = opts || {};
  const typeFilter = o.type ? String(o.type) : "";
  const isAggregate = typeof o.isAggregateAddress === "function" ? o.isAggregateAddress : () => false;
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const type = String((r && (r.property_type || r.type)) || "");
    if (!type || (typeFilter && type !== typeFilter)) continue;
    let address = String((r && r.address) || "").trim().replace(/\s+/g, " ");
    if (!STREET_OK.test(address) || isAggregate(address) || isMultiBuilding(address)) continue;
    // A comma-less corpus address borrows its row's market so the search has
    // a city to run in; one that still names no city is not a sample.
    if (!address.includes(",")) {
      const m = areaKey(r && r.market);
      if (!m) continue;
      address = `${address}, ${m}`;
    }
    const market = areaKey(address);
    if (!market) continue;
    if (address.length > 120) continue;
    const key = `${streetKey(address)}|${market}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address, type, market });
  }
  return shuffle(out, o.random);
}

// The first `count` candidates whose address key is not in `searched`.
// `addressKey` is server.js's cacheAddressKey, injected so the search cache's
// normalization exists in one place.
function pickUnsearched(candidates, { searched, addressKey, count } = {}) {
  const n = clampCount(count);
  const keyOf = typeof addressKey === "function" ? addressKey : (s) => String(s || "").toLowerCase();
  const done = searched instanceof Set ? searched : new Set();
  const out = [];
  for (const c of candidates || []) {
    if (done.has(keyOf(c.address))) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

function clampCount(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_COUNT;
  return Math.min(n, MAX_COUNT);
}

module.exports = {
  areaMarkets, sampleCandidates, pickUnsearched, clampCount, isMultiBuilding, shuffle,
  DEFAULT_COUNT, MAX_COUNT, MAX_AREA_MARKETS,
};

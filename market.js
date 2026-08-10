"use strict";
// ---------------------------------------------------------------------------
// Market keys — PURE. No I/O, no clock reads, no requires, same contract as
// entitlements.js and comp-gate.js, which is what lets `npm test` pin the
// parse with no database. Extracted from server.js 2026-08-08.
//
// marketOf() is load-bearing, not just a label: harvestComps() files each comp
// under marketOf(comp.address) while corpus-first retrieval looks rows up under
// marketOf(subject.address), and corpusRowsForMarket() matches it with an exact
// (case-sensitive) eq. Any drift between the write and the read silently costs
// corpus hits, so the parse is canonicalized here — title-cased city, uppercase
// state — rather than left to whatever the source string happened to look like.
//
// Two things break the naive "last two comma segments" read, both common in
// model-supplied comp addresses:
//   - Parentheticals carry their own commas. "Ontario, CA (Orden acquisition,
//     257,000 SF industrial/office)" makes "257,000 SF industrial/office)" the
//     final segment, whose first two-letter run is "SF" — square feet silently
//     read as a state code.
//   - Trailing descriptors push the state out of the final segment entirely,
//     as in "Ontario, CA - Airport Area Submarket Warehouse".
// So: drop parentheticals, then walk backwards for the first segment that
// STARTS with a real state/province code, and take the segment before it as
// the city.
// ---------------------------------------------------------------------------

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

// Canadian provinces are recognized so "Toronto, ON, Canada" keys as
// "Toronto, ON" instead of collapsing to the literal fallback "Canada" —
// which would file every Canadian city in ONE corpus bucket the day non-USD
// reports are ever harvested (they are skipped today; see harvestComps).
// Deliberately internal: the Explorer and market-page validators stay
// US-only on purpose, so they keep their own US_STATES checks.
const CA_PROVINCES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

// Best-effort "City, ST" from a freeform address. Aggregate market interest
// only — never the street address.
function marketOf(address) {
  const cleaned = String(address || "")
    .replace(/\([^)]*\)/g, " ")                       // and the commas inside them
    .replace(/,\s*(?:USA|U\.S\.A\.|United States|Canada)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const st = (parts[i].match(/^([A-Za-z]{2})\b/) || [])[1];
    if (!st) continue;
    const code = st.toUpperCase();
    if (!US_STATES.has(code) && !CA_PROVINCES.has(code)) continue;
    // "Ontario/San Bernardino County" -> "Ontario": one city per key, so a
    // dual-named submarket doesn't fragment into its own bucket.
    const city = parts[i - 1].split("/")[0].trim();
    if (!city) continue;
    return `${city.toLowerCase().replace(/(^|[\s.'\-])[a-z]/g, (ch) => ch.toUpperCase())}, ${code}`;
  }
  // No recognizable state: fall back to the trailing segment rather than the
  // whole string, which keeps the leading street number out of the key. (A
  // comma-less input has no trailing segment to fall back to and still returns
  // as-is — same as the previous behavior.)
  return (parts[parts.length - 1] || "").slice(0, 60);
}

// An analytics market is "City, ST" or it is unknown — never free text.
//
// marketOf() ends with a fallback to the trailing comma-separated segment, and
// an address typed WITHOUT a comma has no trailing segment, so the whole thing
// comes back and lands in a column that is supposed to hold city + state. Found
// in production 2026-07-31: a real search for "1394 North 28th st washougal"
// was sitting in `market` verbatim. Every event kind that carries a market
// (search, lead, portfolio_add/refresh, comp, comp_review, share,
// type_autofill) reaches this one function, so guarding here covers all of
// them at once.
//
// Deliberately NOT fixed inside marketOf(): that function is also the comp
// corpus key — see the header note — so changing its fallback would silently
// re-key the corpus and pin the hit rate at zero.
//
// Dropping an unparseable market loses nothing real: it was never a market,
// and the event itself is still counted.
const MARKET_SHAPE = /^[^,]+,\s[A-Z]{2}$/;
function marketForLog(value) {
  const s = String(value == null ? "" : value).trim();
  return MARKET_SHAPE.test(s) ? s : "";
}

// ---------------------------------------------------------------------------
// Metro groups. Corpus-first retrieval uses these to offer a thin market the
// comps we already hold in its immediate neighbors: a Meridian search sees
// Boise's rows rather than starting cold ten miles away.
//
// THE RULE FOR ADDING A GROUP: adjacent suburbs that genuinely share one CRE
// submarket, never a whole census statistical area. A group that is too wide
// hands a search comps from thirty miles away, which is worse than no corpus
// help at all. Every key and member must be exactly what marketOf() produces
// (title-cased city, uppercase state); a test pins that, because an exact
// string match that never matches is invisible.
//
// Deliberately short. Grow it when traffic shows a market that needs it, one
// reviewed group at a time.
// ---------------------------------------------------------------------------
const METRO_GROUPS = {
  // The owner's home market: small adjacent cities that trade as one.
  "Boise, ID": ["Boise, ID", "Meridian, ID", "Nampa, ID", "Caldwell, ID",
    "Eagle, ID", "Garden City, ID", "Star, ID", "Kuna, ID"],
  // Inland Empire warehouse corridor: one industrial market in practice, and
  // the site's deepest seeded coverage. Riverside is deliberately NOT here;
  // it is its own submarket and has its own seeded page.
  "Ontario, CA": ["Ontario, CA", "Rancho Cucamonga, CA", "Fontana, CA",
    "Rialto, CA", "Jurupa Valley, CA", "Eastvale, CA", "Mira Loma, CA"],
  // The Valley. The widest group here and so the first one to trim if
  // marketMatchRate drops after this ships.
  "Phoenix, AZ": ["Phoenix, AZ", "Tempe, AZ", "Mesa, AZ", "Chandler, AZ",
    "Glendale, AZ", "Tolleson, AZ", "Goodyear, AZ", "Avondale, AZ"],
};

// Reverse index, built once: "Meridian, ID" -> "Boise, ID".
const METRO_OF = {};
for (const [metro, members] of Object.entries(METRO_GROUPS)) {
  for (const m of members) METRO_OF[m] = metro;
}

// Normalizes through marketOf so a caller's casing or spacing cannot miss.
function metroOf(marketKey) {
  const key = marketOf(marketKey);
  return METRO_OF[key] || null;
}

// The other members of this market's metro. Empty for an ungrouped market,
// which is what keeps the caller's behavior identical to today.
function siblingMarkets(marketKey) {
  const key = marketOf(marketKey);
  const metro = METRO_OF[key];
  if (!metro) return [];
  return METRO_GROUPS[metro].filter((m) => m !== key);
}

module.exports = { marketOf, marketForLog, US_STATES, METRO_GROUPS, metroOf, siblingMarkets };

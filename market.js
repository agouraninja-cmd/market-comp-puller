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

// Spelled-out state names, so "Boise, Idaho" keys as "Boise, ID" (2026-09-03).
// A person typing their own building writes the state the way they say it;
// only model output and geocoders reliably write the code. Kept to the states
// (no province names): the corpus never holds a Canadian row today, and the
// key for one is the code either way.
const STATE_NAME_TO_CODE = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
// Longest first, so "West Virginia" is tried before "Virginia".
const STATE_NAME_ALT = Object.keys(STATE_NAME_TO_CODE)
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/ /g, "\\s+"))
  .join("|");
// A segment (or a comma-less tail) that begins with a state — code or name —
// optionally followed by a zip. Returns the code, or null.
const SEG_STATE_RE = new RegExp(`^(?:([A-Za-z]{2})|(${STATE_NAME_ALT}))\\b`, "i");
function stateCodeAtStart(segment) {
  const m = segment.match(SEG_STATE_RE);
  if (!m) return null;
  if (m[1]) {
    const code = m[1].toUpperCase();
    return US_STATES.has(code) || CA_PROVINCES.has(code) ? code : null;
  }
  return STATE_NAME_TO_CODE[m[2].toLowerCase().replace(/\s+/g, " ")] || null;
}

// The comma-less shape: "1210 N 17th st Boise Idaho 83702". Without commas
// nothing says where the street ends and the city begins, so the city is
// read ONLY when a street suffix or a unit designator delimits it — after the
// last such token, the remaining words before the state are the city. An
// address with no delimiter ("100 Broadway Boise ID") is left unparsed, the
// vault's miss-rather-than-guess rule: a building filed under "Broadway
// Boise, ID" is worse than one refused with the shape named.
//
// Deliberately NOT in the list: words that sit INSIDE city names ("Circle"
// in Circle Pines, "Point", "Park", "City"). A delimiter that ends a city
// name ("Federal Way", "Mountlake Terrace") is harmless — it leaves an empty
// tail, and the scan keeps walking back to the previous one.
const STREET_SUFFIX = new Set([
  "st", "street", "ave", "avenue", "av", "rd", "road", "blvd", "boulevard",
  "dr", "drive", "ln", "lane", "ct", "court", "pl", "place", "pkwy", "parkway",
  "hwy", "highway", "cir", "ter", "terrace", "trl", "trail", "way", "plz",
  "plaza", "expy", "expressway", "fwy", "freeway", "tpke", "turnpike",
]);
// A unit designator takes the token after it ("Ste 200", "Apt 3B", "# 12").
const UNIT_WORD = new Set([
  "suite", "ste", "unit", "apt", "apartment", "bldg", "building", "fl",
  "floor", "rm", "room", "spc", "space", "lot", "trailer",
]);
const POST_DIRECTIONAL = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
const TAIL_STATE_RE = new RegExp(
  `\\s+(?:([A-Za-z]{2})|(${STATE_NAME_ALT}))(?:\\s+\\d{5}(?:-\\d{4})?)?$`, "i");
function commalessMarket(cleaned) {
  const m = cleaned.match(TAIL_STATE_RE);
  if (!m) return null;
  const code = m[1]
    ? (US_STATES.has(m[1].toUpperCase()) || CA_PROVINCES.has(m[1].toUpperCase())
      ? m[1].toUpperCase() : null)
    : STATE_NAME_TO_CODE[m[2].toLowerCase().replace(/\s+/g, " ")];
  if (!code) return null;
  const words = cleaned.slice(0, m.index).split(" ").filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i].toLowerCase().replace(/\.$/, "");
    let after;
    if (STREET_SUFFIX.has(w)) after = i + 1;
    else if (UNIT_WORD.has(w) || /^#/.test(w)) after = /^#\S/.test(w) ? i + 1 : i + 2;
    else continue;
    let city = words.slice(after);
    if (city.length > 1 && POST_DIRECTIONAL.has(city[0].toLowerCase())) city = city.slice(1);
    if (!city.length || city.length > 4) continue;
    if (!city.every((c) => /^[A-Za-z][A-Za-z.'\-]*$/.test(c))) continue;
    return { city: city.join(" "), code };
  }
  return null;
}

function canonicalKey(city, code) {
  return `${city.toLowerCase().replace(/(^|[\s.'\-])[a-z]/g, (ch) => ch.toUpperCase())}, ${code}`;
}

// Best-effort "City, ST" from a freeform address. Aggregate market interest
// only — never the street address.
function marketOf(address) {
  const cleaned = String(address || "")
    .replace(/\([^)]*\)/g, " ")                       // and the commas inside them
    .replace(/,?\s*(?:USA|U\.S\.A\.|United States|Canada)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const code = stateCodeAtStart(parts[i]);
    if (!code) continue;
    // "Ontario/San Bernardino County" -> "Ontario": one city per key, so a
    // dual-named submarket doesn't fragment into its own bucket.
    const city = parts[i - 1].split("/")[0].trim();
    if (!city) continue;
    return canonicalKey(city, code);
  }
  // No comma carried a state. A comma-less address may still name one at
  // its tail; see commalessMarket for what it will and will not read.
  if (parts.length === 1) {
    const hit = commalessMarket(parts[0]);
    if (hit) return canonicalKey(hit.city, hit.code);
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
  // A Phoenix group was removed here on final review: this table's own
  // header rule is adjacent suburbs that genuinely share one CRE submarket,
  // never a whole statistical area, and a Mesa-to-Goodyear span is the
  // latter, applied to every property type. Removing it reverts Phoenix
  // searches to exact matching, which is today's shipped behavior, so it
  // costs nothing. Re-add it, if ever, as one or more narrower groups.
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

// ---------------------------------------------------------------------------
// The Market Explorer's example query, and the order it rotates through.
//
// The box on the desk says "e.g. industrial Ontario, CA", and since Tab types
// that example in, the placeholder is a WORKING QUERY rather than decoration.
// That is the whole constraint on this function: every string it returns must
// name a market with a standing page, because a market without one turns the
// dropdown's top row into "Explore this market, build the … page →" — so
// Tab then Enter would spend a billed search and 30-60 seconds on a build
// nobody asked for. Feed it MARKET_PAGES (the committed seed, resolvable with
// no database read), never the merged store: a page the Explorer published
// once can age out, and a database read can come back empty.
//
// Round-robin ACROSS types rather than straight down the file, so three
// refreshes do not show three industrials. The seed is 8 industrial / 8
// office / 5 retail / 6 multifamily, which grouped would mean eight loads
// before an office appears.
//
// Deterministic given the same map: the caller's counter is what advances, so
// a fresh process always serves entry 0 and two runs of scripts/shot.js
// produce byte-identical PNGs. Do not reach for Math.random() here.
function exampleMarketOrder(pages) {
  const byType = new Map(); // insertion order = first appearance in the map
  for (const key of Object.keys(pages || {})) {
    const p = pages[key];
    if (!p || !p.type || !p.city || !p.state) continue;
    // Lower-cased type, matching the copy the box has always used. The
    // Explorer's parser lower-cases anyway, and strips the comma.
    const label = `${String(p.type).toLowerCase()} ${p.city}, ${p.state}`;
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type).push(label);
  }
  const lanes = [...byType.values()];
  const out = [];
  for (let i = 0; lanes.some((l) => i < l.length); i++) {
    for (const lane of lanes) if (i < lane.length) out.push(lane[i]);
  }
  return out;
}

module.exports = { marketOf, marketForLog, US_STATES, METRO_GROUPS, metroOf, siblingMarkets,
  exampleMarketOrder };

// explore-query.js — what someone types into the Market Explorer, parsed.
//
// The Explorer used to accept exactly one shape, "<type> <city> <ST>", so a
// full state name, a zip code, a synonym ("warehouse") or an ordinary filler
// word ("industrial market in Boise ID") all dead-ended in a hint row at the
// very top of the funnel.
//
// Pure and dual-exported (Node for npm test, a browser global for
// index.html), like valuation.js and gut-check.js — and served with the same
// maxAge: 0 rule, because a stale copy against a newer index.html is the
// failure nobody detects. NO I/O lives here: a zip is returned as an intent
// for index.html to resolve, which is what keeps every table testable with
// no network.
//
// Spec: docs/superpowers/specs/2026-08-10-explore-query-parsing-design.md
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EXPLOREQ = api;
})(typeof self !== "undefined" ? self : this, function () {

  // The four types the market-page format is proven on. Canonical
  // capitalization: this is what gets posted to /api/explore-market.
  const EXPLORE_TYPES = ["Industrial", "Office", "Retail", "Multifamily"];
  // Valid report types the Explorer deliberately refuses.
  const NON_EXPLORE_TYPES = ["land", "residential"];

  const STATE_ABBRS = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA " +
    "ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX " +
    "UT VT VA WA WV WI WY").split(" ");

  // Full names to abbreviations. Deliberately 50 entries: "district of
  // columbia" is three words, which the one- and two-token lookups below
  // cannot reach, and "Washington DC" already works through STATE_ABBRS.
  const STATE_NAMES = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
    colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
    kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
    missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
    oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
    wyoming: "WY",
  };

  // How people describe these property types when they aren't reading our
  // dropdown. Two-word entries are matched against adjacent token pairs.
  const TYPE_SYNONYMS = {
    warehouse: "Industrial", warehouses: "Industrial", distribution: "Industrial",
    "industrial park": "Industrial",
    apartment: "Multifamily", apartments: "Multifamily", apts: "Multifamily",
    "multi-family": "Multifamily",
    offices: "Office", "office building": "Office",
    shops: "Retail", "shopping center": "Retail", "strip mall": "Retail",
    "retail center": "Retail",
  };

  // Words that are never part of a city name here. "the" and "a" are
  // deliberately absent: The Dalles OR is a real market.
  //
  // Accepted casualties, all sub-3k-population places that could never meet
  // the publish bar: New Market (VA/MD/AL/TN/IA) parses as "New", and Sale
  // City GA / Sale Creek TN lose their first word. The mis-parse is visible
  // on the button before anything runs and city-check.js refuses it
  // server-side, so it costs a friendly error rather than a billed search.
  // There is no cheap fix: stripping only a leading run rescues "New Market"
  // but breaks a trailing "comps", which is the commoner shape.
  const FILLERS = ["market", "markets", "comps", "comp", "properties",
    "property", "for", "sale", "in", "near"];

  // Match server.js's own city casing, which upper-cases after spaces,
  // periods, apostrophes and hyphens — so "coeur d'alene" becomes
  // "Coeur D'Alene", the spelling city-check.js then validates.
  function titleCase(s) {
    return s.replace(/(^|[\s.'\-])[a-z]/g, (ch) => ch.toUpperCase());
  }

  function parseExploreQuery(raw) {
    let tokens = String(raw || "").toLowerCase().replace(/,/g, " ")
      .split(/\s+/).filter(Boolean);
    if (!tokens.length) return { reason: "no-city" };
    if (tokens.some((t) => NON_EXPLORE_TYPES.includes(t))) return { reason: "unsupported-type" };

    // Type. Two-word synonyms FIRST: "office building" must not match the
    // bare "office" and leave "building" glued to the city.
    let type = null;
    for (let i = 0; i < tokens.length - 1 && !type; i++) {
      const pair = tokens[i] + " " + tokens[i + 1];
      if (TYPE_SYNONYMS[pair]) {
        type = TYPE_SYNONYMS[pair];
        tokens.splice(i, 2);
      }
    }
    if (!type) {
      const exact = tokens.find((t) => EXPLORE_TYPES.some((e) => e.toLowerCase() === t));
      if (exact) {
        type = EXPLORE_TYPES.find((e) => e.toLowerCase() === exact);
        tokens = tokens.filter((t) => t !== exact);
      }
    }
    if (!type) {
      const syn = tokens.find((t) => TYPE_SYNONYMS[t]);
      if (syn) {
        type = TYPE_SYNONYMS[syn];
        tokens = tokens.filter((t) => t !== syn);
      }
    }

    // Zip, after the type so the intent can carry one ("warehouse 83301").
    const zip = tokens.find((t) => /^\d{5}$/.test(t));
    if (zip) return { reason: "zip", zip, type };

    // State BEFORE fillers are stripped. IN, OR, OK, ME, HI, DE, LA and PA
    // are abbreviations AND English words; stripping fillers first would eat
    // the "IN" in "warehouse in Gary IN" and lose Indiana.
    let state = null;
    const pair = tokens.slice(-2).join(" ");
    if (tokens.length >= 2 && STATE_NAMES[pair]) {
      state = STATE_NAMES[pair];
      tokens = tokens.slice(0, -2);
    } else {
      const last = tokens[tokens.length - 1] || "";
      if (STATE_NAMES[last]) {
        state = STATE_NAMES[last];
        tokens = tokens.slice(0, -1);
      } else if (STATE_ABBRS.indexOf(last.toUpperCase()) !== -1) {
        state = last.toUpperCase();
        tokens = tokens.slice(0, -1);
      }
    }

    tokens = tokens.filter((t) => FILLERS.indexOf(t) === -1);
    const city = tokens.map(titleCase).join(" ");

    // Empty-city guard: a state name that consumed everything ("office New
    // York") must ask for a city, never offer to build a page for "".
    if (!city) return { reason: "no-city" };
    if (!state) return { reason: "no-state" };
    if (!type) return { reason: "no-type", city, state };
    return { type, city, state };
  }

  return { parseExploreQuery, EXPLORE_TYPES, NON_EXPLORE_TYPES, STATE_NAMES, TYPE_SYNONYMS, FILLERS };
});

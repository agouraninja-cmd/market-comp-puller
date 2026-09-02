// The FRED-resolvable metrics, and what a valid series for each looks like.
//
// Keys are the metric names in market-weights.json, VERBATIM, so a resolved
// series joins to its weight by string with no translation table in between —
// the same contract broker_comps.market keeps with marketOf(). A key that
// drifts from the weights file silently loses its weight, and
// test/market-ranking-config.test.js holds the two lists against each other.
//
// ---------------------------------------------------------------------------
// ON THE SEASONAL-ADJUSTMENT RULE.
//
// The owner's standing rule is seasonally adjusted data (2026-09-02), and every
// EMPLOYMENT series here requires it: `adjustment: "SA"`. Employment swings
// hard with the calendar — retail hiring in November, construction in spring —
// and an unadjusted series would report Christmas as expansion.
//
// Four series relax it to "any", and the reason is that no seasonally adjusted
// version is PUBLISHED, not that the rule is inconvenient:
//
//   * FHFA's house price index is quarterly and issued unadjusted.
//   * Metro unemployment and labour force from LAUS are published unadjusted.
//   * Average hourly earnings is issued unadjusted; a year-over-year comparison
//     of the same month removes the season anyway.
//   * Building permits are issued unadjusted at metro level.
//
// Where a series has no seasonal pattern to remove, "not seasonally adjusted"
// and "seasonally adjusted" are the same number. Where it does — employment —
// the rule holds without exception.
// ---------------------------------------------------------------------------

module.exports = {
  macro: {
    "Job growth (total nonfarm, YoY)": {
      search: "All Employees Total Nonfarm",
      title: /total nonfarm/i,
      adjustment: "SA", frequency: "M", transform: "yoy_pct",
    },
    "Labor force growth (YoY)": {
      search: "Civilian Labor Force",
      title: /civilian labor force/i,
      adjustment: "any", frequency: "M", transform: "yoy_pct",
    },
    "Average hourly earnings growth (YoY)": {
      search: "Average Hourly Earnings of All Employees Total Private",
      title: /average hourly earnings/i,
      adjustment: "any", frequency: "M", transform: "yoy_pct",
    },
    "House price index change (YoY)": {
      // DERIVED, not searched. FHFA ids embed the CBSA code, so
      // ATNHPIUS<code>Q cannot point at another city - the geography is in the
      // id. Searching for it failed on the largest metros, which publish at
      // Metropolitan DIVISION level: New York's search returns division 35614,
      // not MSA 35620.
      derive: (code) => "ATNHPIUS" + code + "Q",
      title: /house price index/i,
      adjustment: "any", frequency: "Q", transform: "yoy_pct",
    },
    "Unemployment rate (level and direction)": {
      search: "Unemployment Rate",
      title: /unemployment rate/i,
      adjustment: "any", frequency: "M", transform: "level",
    },
  },

  // Employment by NAICS supersector. This is the block that finally makes a
  // market score differently per asset class: Boise's warehouses and Boise's
  // apartments answer to different demand drivers, and until these are wired
  // every asset class reads the same macro number.
  //
  // Only three classes appear here. Multifamily, land and residential draw
  // their class metrics entirely from Census ACS — households, income, rent,
  // renter share — which scripts/refresh-macro.js fetches directly rather than
  // through this catalog, because one ACS call returns every market at once
  // while FRED needs one per market per metric.
  class_specific: {
    industrial: {
      "Mining, logging & construction employment growth": {
        search: "All Employees Mining Logging and Construction",
        title: /mining,? logging,? and construction/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
      "Trade, transport & utilities employment growth": {
        search: "All Employees Trade Transportation and Utilities",
        title: /trade,? transportation,? and utilities/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
      "Manufacturing employment growth": {
        search: "All Employees Manufacturing",
        title: /manufacturing/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
    },
    office: {
      "Professional & business services employment growth": {
        search: "All Employees Professional and Business Services",
        title: /professional and business services/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
      "Information sector employment growth": {
        search: "All Employees Information",
        title: /information/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
      "Financial activities employment growth": {
        search: "All Employees Financial Activities",
        title: /financial activities/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
    },
    retail: {
      "Retail trade employment growth": {
        search: "All Employees Retail Trade",
        title: /retail trade/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
      "Leisure & hospitality employment growth": {
        search: "All Employees Leisure and Hospitality",
        title: /leisure and hospitality/i,
        adjustment: "SA", frequency: "M", transform: "yoy_pct",
      },
    },
  },
};

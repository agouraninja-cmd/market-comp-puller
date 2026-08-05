// Corpus audit — the structural integrity rules for the comp corpus.
//
// Run: npm test
//
// Every case here is drawn from a real corpus row or a real false positive
// found while designing the feature. Nothing touches a database or a network.

const test = require("node:test");
const assert = require("node:assert");

const { enforcedSourceType, isAggregateAddress, urlIdentifiesProperty } = require("../corpus-audit");

test("enforcedSourceType coerces unknown values onto the enum", () => {
  assert.equal(enforcedSourceType("costar flyer", "100 Main St, Dallas, TX"), "listing");
  assert.equal(enforcedSourceType("county assessor", "100 Main St, Dallas, TX"), "public_record");
  assert.equal(enforcedSourceType("press release", "100 Main St, Dallas, TX"), "news");
  assert.equal(enforcedSourceType("who knows", "100 Main St, Dallas, TX"), "estimate");
});

test("enforcedSourceType keeps an exact enum value", () => {
  assert.equal(enforcedSourceType("listing", "100 Main St, Dallas, TX"), "listing");
});

test("enforcedSourceType forces estimate when the address has no street number", () => {
  assert.equal(enforcedSourceType("listing", "Pocatello, ID (43,000 SF warehouse)"), "estimate");
});

test("enforcedSourceType forces estimate on an aggregate address", () => {
  assert.equal(enforcedSourceType("public_record", "100 Main St Market Median"), "estimate");
});

test("enforcedSourceType under-claims a hyphenated address range (known, recorded)", () => {
  // "7657-7695 S 5th Ave" is a genuine address range, but the street-number
  // test requires digits followed by whitespace. Under-claiming is the safe
  // direction, so this is pinned as current behavior, not fixed here.
  assert.equal(enforcedSourceType("listing", "7657-7695 S 5th Ave, Pocatello, ID"), "estimate");
});

test("isAggregateAddress catches statistic vocabulary, not bare street names", () => {
  assert.equal(isAggregateAddress("Market Median, Dallas, TX"), true);
  assert.equal(isAggregateAddress("123 Market St, Dallas, TX"), false);
});

// --- Citation specificity: does the source link name THIS property? ---------

test("a listing id of five or more digits identifies the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "322 Griffith St, Pocatello, ID", source_url: "https://realmo.com/listing/12172862", source_type: "listing" }), true);
});

test("a search-results page does not identify the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "322 Griffith St, Pocatello, ID",
      source_url: "https://realmo.com/warehouses/for-lease/id/pocatello/", source_type: "listing" }), false);
});

test("a LoopNet market search page does not identify the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "Pocatello, ID (43,000 SF warehouse, built 1980)",
      source_url: "https://loopnet.com/idaho/pocatello_warehouses-for-lease", source_type: "listing" }), false);
});

test("street number plus a street-name token identifies the property", () => {
  assert.equal(urlIdentifiesProperty(
    { address: "4502 Airport Dr, Ontario, CA",
      source_url: "https://example.com/listings/4502-airport-dr", source_type: "listing" }), true);
});

test("a four-digit year in the path is not a street-number match on its own", () => {
  // The Ontario flyer PDF sits under /2025-05/ and would otherwise "match"
  // the street number of an address like 2025 Main St.
  assert.equal(urlIdentifiesProperty(
    { address: "2025 Main St, Ontario, CA",
      source_url: "https://content.ontarioca.gov/sites/default/files/2025-05/For%20Lease.pdf",
      source_type: "listing" }), false);
});

test("a news article naming the market identifies its subject (looser rule)", () => {
  // Found as a false positive while designing: a legitimate article names the
  // deal without carrying the street number.
  assert.equal(urlIdentifiesProperty(
    { address: "1800 River Park Way, Pocatello, ID 83201",
      source_url: "https://rebusinessonline.com/cbre-arranges-sale-of-59-7-acre-industrial-site-in-pocatello-ida/",
      source_type: "news" }), true);
});

test("a missing or malformed url never throws and never counts as specific", () => {
  assert.equal(urlIdentifiesProperty({ address: "100 Main St", source_url: "" }), false);
  assert.equal(urlIdentifiesProperty({ address: "100 Main St", source_url: "not a url" }), false);
  assert.equal(urlIdentifiesProperty({}), false);
});

// --- The assembled report ---------------------------------------------------

const { auditCorpus } = require("../corpus-audit");

// Stand-in for server.js's parseDealDate: a year, or null. Injected so the
// audit and retrieval can never disagree about what counts as a usable date.
const parseDealDate = (s) => (/^(19|20)\d{2}$/.test(String(s || "").trim()) ? Number(s) : null);
const OPTS = { now: Date.parse("2026-08-05T00:00:00Z"), parseDealDate };

const goodRow = {
  address: "4502 Airport Dr, Ontario, CA", market: "Ontario, CA", property_type: "Industrial",
  source_url: "https://example.com/listings/4502-airport-dr", source_type: "listing",
  deal_date: "2025", price_or_rate: "$4,000,000", price_per_sqft: "$120",
};

test("a clean corpus scores 1", () => {
  const out = auditCorpus([goodRow], OPTS);
  assert.equal(out.total, 1);
  assert.equal(out.clean, 1);
  assert.equal(out.score, 1);
  assert.equal(out.worst.length, 0);
});

test("an empty corpus scores cleanly instead of dividing by zero", () => {
  const out = auditCorpus([], OPTS);
  assert.equal(out.total, 0);
  assert.equal(out.score, 1);
  assert.deepEqual(out.worst, []);
});

test("badge_drift fires on a pre-enforcement unnumbered listing row", () => {
  const out = auditCorpus([{ ...goodRow, address: "Pocatello, ID (43,000 SF warehouse)" }], OPTS);
  assert.equal(out.findings.badge_drift, 1);
  assert.equal(out.worst[0].findings.includes("badge_drift"), true);
});

test("badge_drift does not fire when the stored badge is already estimate", () => {
  const out = auditCorpus([{ ...goodRow, address: "Pocatello, ID (warehouse)", source_type: "estimate" }], OPTS);
  assert.equal(out.findings.badge_drift, 0);
});

test("shared_citation fires when two distinct addresses cite one url", () => {
  const url = "https://loopnet.com/idaho/pocatello_warehouses-for-lease";
  const out = auditCorpus([
    { ...goodRow, address: "100 A St, Pocatello, ID", source_url: url },
    { ...goodRow, address: "200 B St, Pocatello, ID", source_url: url },
  ], OPTS);
  assert.equal(out.findings.shared_citation, 2);
});

test("shared_citation ignores one address repeated with different formatting", () => {
  const url = "https://example.com/listings/100-a-st";
  const out = auditCorpus([
    { ...goodRow, address: "100 A St, Pocatello, ID", source_url: url },
    { ...goodRow, address: "100 a st,  Pocatello,  ID", source_url: url },
  ], OPTS);
  assert.equal(out.findings.shared_citation, 0);
});

test("unparseable_date uses the injected parser", () => {
  const out = auditCorpus([{ ...goodRow, deal_date: "sometime last spring" }], OPTS);
  assert.equal(out.findings.unparseable_date, 1);
});

test("no_price fires only when neither price field carries a number", () => {
  const out = auditCorpus([{ ...goodRow, price_or_rate: "undisclosed", price_per_sqft: "" }], OPTS);
  assert.equal(out.findings.no_price, 1);
});

test("host classes are reported and never affect the score", () => {
  const out = auditCorpus([
    { ...goodRow, source_url: "https://www.loopnet.com/listings/98765432" },
    goodRow,
  ], OPTS);
  assert.equal(out.hosts.blocked, 1);
  assert.equal(out.hosts.fetchable, 1);
  assert.equal(out.score, 1, "a blocked host is context, not a finding");
});

test("worst is capped at 15 and ordered by finding count", () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ ...goodRow, address: "Nowhere " + i, source_url: "https://x.com/p", deal_date: "?" });
  }
  const out = auditCorpus(rows, OPTS);
  assert.equal(out.worst.length, 15);
  assert.ok(out.worst[0].findings.length >= out.worst[14].findings.length);
});

test("a malformed row yields findings instead of throwing", () => {
  const out = auditCorpus([null, {}, { address: 5, source_url: {} }], OPTS);
  assert.equal(out.total, 3);
  assert.ok(out.score < 1);
});

test("no_price does not fire on a quoted price RANGE", () => {
  // Found against the real corpus: stripping non-digits turns
  // "$7.00-$12.00/SF/yr NNN" into "7.0012.00", which parses as NaN.
  const out = auditCorpus([{ ...goodRow, price_or_rate: "$7.00-$12.00/SF/yr NNN (est.)", price_per_sqft: "" }], OPTS);
  assert.equal(out.findings.no_price, 0);
});

test("no_price still fires on genuinely priceless rows", () => {
  for (const v of ["Undisclosed", "Rate Upon Request", "Withheld", ""]) {
    const out = auditCorpus([{ ...goodRow, price_or_rate: v, price_per_sqft: "" }], OPTS);
    assert.equal(out.findings.no_price, 1, "expected no_price for " + JSON.stringify(v));
  }
});

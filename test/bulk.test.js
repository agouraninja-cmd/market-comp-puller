// bulk.js — the rules for turning a pasted or uploaded list of addresses into
// one portfolio of values.
//
// Everything here is money-shaped in one direction or the other: a parse that
// splits an address wrong spends a billed search on nothing, a total that
// counts a failure as zero understates a portfolio, and a valuation that
// drifts from valuation.js makes fifty rows disagree with the fifty reports
// behind them.

const test = require("node:test");
const assert = require("node:assert");
const BULK = require("../bulk.js");
const VALUATION = require("../valuation.js");

// ---------------------------------------------------------------------------
// Reading the list
// ---------------------------------------------------------------------------

test("a pasted line is ONE address, however many commas it holds", () => {
  // The failure this prevents is the expensive one: splitting on commas turns
  // "123 Main St, Boise, ID 83702" into a search for "123 Main St" in no
  // particular city, with "83702" quietly read as a square footage. A pasted
  // list is the common case and must never need quoting.
  const r = BULK.parseAddressList("123 Main St, Boise, ID 83702\n456 Oak Ave, Meridian, ID");
  assert.equal(r.header, false);
  assert.deepEqual(r.rows.map((x) => x.address),
    ["123 Main St, Boise, ID 83702", "456 Oak Ave, Meridian, ID"]);
  assert.equal(r.rows[0].size_sqft, null, "nothing may be read as a size from a bare line");
});

test("a CSV with an address header is read by column", () => {
  const r = BULK.parseAddressList(
    'Address,Size SqFt,Label\n"999 W Front St, Boise, ID","12,500 SF",HQ\n');
  assert.equal(r.header, true);
  assert.equal(r.rows[0].address, "999 W Front St, Boise, ID");
  assert.equal(r.rows[0].size_sqft, 12500, "parseNumber accepts what a broker's export holds");
  assert.equal(r.rows[0].label, "HQ");
});

test("header spellings survive normalizeHeader's underscores", () => {
  // VAULT.normalizeHeader turns spaces into underscores, so "Size SqFt" is
  // "size_sqft" and not "sizesqft". Getting that wrong costs the column
  // SILENTLY — the import works, every size is null, and nothing says so.
  for (const [head, key] of [
    ["Property Address", "address"], ["Site Address", "address"],
    ["Building Size", "size"], ["Square Feet", "size"], ["Sq Ft", "size"],
    ["Property Name", "label"],
  ]) {
    // Quoted, because the address really does contain commas — the very
    // reason a bare pasted line is never split on them.
    const csv = key === "address"
      ? `${head}\n"123 Main St, Boise, ID"\n`
      : `Address,${head}\n"123 Main St, Boise, ID",${key === "size" ? "5000" : "Tag"}\n`;
    const r = BULK.parseAddressList(csv);
    assert.equal(r.header, true, head);
    assert.equal(r.rows.length, 1, head);
    if (key === "size") assert.equal(r.rows[0].size_sqft, 5000, head);
    if (key === "label") assert.equal(r.rows[0].label, "Tag", head);
  }
});

test("a place is refused by name, not valued", () => {
  // The single-property flow catches this at the address-confirm dialog,
  // which fifty addresses have no room for. Spending a billed search on a
  // submarket and printing a dollar figure under it is the exact failure
  // isAggregateAddress exists to stop in the comp data.
  const r = BULK.parseAddressList("Downtown Boise\nFinancial District\n1 A St, Boise ID");
  assert.deepEqual(r.rows.map((x) => x.address), ["1 A St, Boise ID"]);
  assert.equal(r.skipped.length, 2);
  assert.equal(r.skipped[0].line, 1, "the line number is the one in their file");
  assert.match(r.skipped[0].reason, /street address/);
});

test("duplicates are dropped across punctuation drift, and counted", () => {
  const r = BULK.parseAddressList(
    "123 Main St, Boise ID\n123 Main St., Boise, ID\n123 MAIN ST BOISE ID\n");
  assert.equal(r.rows.length, 1, "one billed search, not three");
  assert.equal(r.duplicates, 2);
});

test("`#` note lines and blanks cost nothing and are not errors", () => {
  const r = BULK.parseAddressList("# my list\n\n1 A St, Boise ID\n\n# end\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.length, 0);
});

test("the cap truncates and SAYS SO rather than silently dropping", () => {
  const many = Array.from({ length: 8 }, (_, i) => `${i + 1}00 A St, Boise ID`).join("\n");
  const r = BULK.parseAddressList(many, { max: 5 });
  assert.equal(r.rows.length, 5);
  assert.equal(r.truncated, 3);
});

test("the entitlement cap can never widen past bulk.js's own ceiling", () => {
  const many = Array.from({ length: 60 }, (_, i) => `${i + 1} A St, Boise ID`).join("\n");
  const r = BULK.parseAddressList(many, { max: 5000 });
  assert.equal(r.rows.length, BULK.MAX_ADDRESSES);
});

test("an unparseable size is warned about, never silently ignored", () => {
  // The vault's column-mapper rule: a figure somebody typed and we dropped,
  // with nothing on screen saying so, is worse than a loud refusal. The row
  // still runs — we look the size up instead.
  const r = BULK.parseAddressList("Address,Size\n1 A St Boise ID,about 5k\n");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].size_sqft, null);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].line, 2);
  assert.match(r.warnings[0].reason, /isn't a number/);
});

test("an Excel BOM does not eat the first header", () => {
  const r = BULK.parseAddressList("﻿Address,Size\n1 A St Boise ID,5000\n");
  assert.equal(r.header, true, "a BOM-prefixed 'Address' must still be the address column");
  assert.equal(r.rows[0].size_sqft, 5000);
});

// ---------------------------------------------------------------------------
// Valuing one report
// ---------------------------------------------------------------------------

const SALE = (price, size, date, type) => ({
  address: `${price} A St`, transaction: "Sale", price_or_rate: `$${price}`,
  size_sqft: String(size), date, source_type: type || "public_record",
});
const REPORT = {
  subject_size_sqft: "10000", subject_size_source: "county records",
  annual_price_trend_pct: 3,
  comps: [
    SALE(1000000, 10000, "2026-01-15"),
    SALE(1200000, 10000, "2025-11-01", "listing"),
    { address: "L", transaction: "Lease", price_or_rate: "$12.00", size_sqft: "9000", date: "2026-02-01" },
    SALE(900000, 9500, "2025-08-01"),
    SALE(1400000, 11000, "2026-03-01"),
  ],
};
const ASOF = Date.parse("2026-08-21T00:00:00Z");

test("a bulk row is valuation.js's own answer, not a second one", () => {
  // The whole reason bulk.js requires valuation.js. If this ever diverges,
  // a portfolio's fifty rows disagree with the fifty reports behind them and
  // there is no way to see that from either screen.
  const got = BULK.valueFromReport(REPORT, { asOf: ASOF, propertyType: "Industrial" });
  const expected = VALUATION.valueFromComps(REPORT.comps, {
    subjectSF: 10000, asOf: ASOF, trendPct: 3,
    subjectYear: VALUATION.yearOf(REPORT.subject_year_built),
    propertyType: "Industrial", radiusMiles: VALUATION.parseRadiusMiles(""), subjectPsf: 0,
  });
  assert.equal(got.value_low, expected.low);
  assert.equal(got.value_likely, expected.mid);
  assert.equal(got.value_high, expected.high);
  assert.equal(got.psf_mid, expected.psfMid);
});

test("leases are excluded from the range and counted separately", () => {
  const got = BULK.valueFromReport(REPORT, { asOf: ASOF, propertyType: "Industrial" });
  assert.equal(got.sale_comps, 4, "the band comes from the sales");
  assert.equal(got.comp_count, 5);
  assert.equal(got.lease_comps, 1);
});

test("a supplied size beats the looked-up one", () => {
  // The form's own precedence: somebody who typed a square footage knows
  // their building better than a public record does.
  const got = BULK.valueFromReport(REPORT, { asOf: ASOF, subjectSizeSqft: 20000 });
  assert.equal(got.size_sqft, 20000);
  assert.equal(got.size_source, null, "a typed size has no source to cite");
  const found = BULK.valueFromReport(REPORT, { asOf: ASOF });
  assert.equal(found.size_source, "county records");
  assert.ok(got.value_likely > found.value_likely, "twice the building, more value");
});

test("no size is not the same answer as no comps", () => {
  // "We found the market but not your building" is fixable by typing a
  // number; "we found nothing" is not. Collapsing the two sends somebody
  // hunting for comps that are already there.
  const sizeless = { ...REPORT, subject_size_sqft: "" };
  const got = BULK.valueFromReport(sizeless, { asOf: ASOF });
  assert.equal(got.sized, false);
  assert.equal(got.value_likely, null, "no dollar figure without a size");
  assert.ok(got.psf_mid > 0, "but the $/SF band still stands");

  assert.equal(BULK.valueFromReport({ comps: [] }, { asOf: ASOF }), null);
  assert.equal(BULK.valueFromReport({ comps: [REPORT.comps[2]] }, { asOf: ASOF }), null,
    "a lease-only report can be valued by nothing");
});

test("`trimmed` reports which band a row is actually showing", () => {
  // Below four sale comps the band is the full observed spread rather than
  // the weighted interquartile one — a materially weaker number, and the page
  // has to be able to say which one it is looking at.
  const thin = { ...REPORT, comps: [REPORT.comps[0], REPORT.comps[1]] };
  assert.equal(BULK.valueFromReport(thin, { asOf: ASOF }).trimmed, false);
  assert.equal(BULK.valueFromReport(REPORT, { asOf: ASOF }).trimmed, true);
});

test("a market-note radius reaches the weighting", () => {
  // A typed "within 2.5 miles" is the neighborhood for this run, and it has
  // to change the comp weighting exactly as it does on a single report.
  const near = { comp: { distance_mi: 2.4 } };
  const withNote = VALUATION.compWeight(near.comp, ASOF, 0, null,
    { propertyType: "Residential", radiusMiles: VALUATION.parseRadiusMiles("within 2.5 miles") });
  const without = VALUATION.compWeight(near.comp, ASOF, 0, null, { propertyType: "Residential" });
  assert.ok(withNote > without, "the note widens the free pass — bulk must pass it through");
});

// ---------------------------------------------------------------------------
// The portfolio view
// ---------------------------------------------------------------------------

test("a total sums only what was actually valued, and says how many", () => {
  // A portfolio total that treated a failed lookup as $0 would read as a
  // cheap portfolio rather than an incomplete one.
  const sum = BULK.summarize([
    { status: "done", value_low: 100, value_likely: 120, value_high: 140 },
    { status: "done", value_low: 200, value_likely: 240, value_high: 280 },
    { status: "failed" },
    { status: "done" },          // valued the market, not the building
    { status: "queued" },
    { status: "running" },
  ]);
  assert.equal(sum.total, 6);
  assert.equal(sum.valued, 2);
  assert.equal(sum.likely, 360, "two rows, not six");
  assert.equal(sum.low, 300);
  assert.equal(sum.high, 420);
  assert.equal(sum.failed, 1);
  assert.equal(sum.unsized, 1);
  assert.equal(sum.pending, 2);
});

test("the CSV discloses what it is and what it covers", () => {
  const csv = BULK.exportCsv(
    { label: "Q3 review", property_type: "Industrial", months: 24 },
    [{ address: "1 A St, Boise, ID", status: "done", value_low: 100, value_likely: 120, value_high: 140 },
     { address: "2 B St", status: "failed", error: "No priced sale comps in this window." }]);
  const lines = csv.trim().split("\n");
  assert.match(lines[0], /automated estimates, not appraisals/,
    "the file outlives the screen that explained it");
  assert.match(lines[0], /1 of 2 valued/);
  assert.match(lines[1], /^address,label,property_type,status/);
  assert.match(csv, /No priced sale comps/, "a failure travels with its reason");
  assert.match(csv, /Total \(1 valued\)/, "the totals name the count they cover");
});

test("a formula-shaped address arrives as text", () => {
  // Every CSV this product emits is opened in a spreadsheet by design.
  const csv = BULK.exportCsv({}, [{ address: "=1+1 Main St", status: "done" }]);
  assert.match(csv, /'=1\+1 Main St/);
});

test("an address with commas survives the round trip", () => {
  const csv = BULK.exportCsv({}, [{ address: "1 A St, Boise, ID", status: "done" }]);
  assert.match(csv, /"1 A St, Boise, ID"/);
});

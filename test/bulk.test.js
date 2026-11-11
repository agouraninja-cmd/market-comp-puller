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

// Four ways a real spreadsheet was misread until 2026-11-10. Each one ran a
// billed search on the wrong address or valued the row on the wrong size.

test("a rate column is never read as the building's size", () => {
  // "$/SF" normalizes to bare "sf", which is a size name. A typed size wins
  // over the looked-up one, so this row was valued as a 68 SF building.
  const r = BULK.parseAddressList(
    'Address,Bldg SF,Sale Price,$/SF\n"6200 W Gowen Rd, Boise, ID",45000,3065000,68.11\n');
  assert.equal(r.rows[0].size_sqft, 45000, "the size column is the one that says Bldg SF");
  for (const head of ["$/SF", "$ / SF", "$/SqFt", "$/Sq Ft", "$ per Square Feet", "Price per SF", "Rent/SF"]) {
    const none = BULK.parseAddressList(`Address,${head}\n"6200 W Gowen Rd, Boise, ID",68.11\n`);
    assert.equal(none.rows.length, 1, head);
    assert.equal(none.rows[0].size_sqft, null, `${head} is a rate, so the size is looked up`);
  }
  // A plain size heading is still a size, the abbreviated ones included.
  for (const head of ["SF", "Sq Ft", "RBA", "Total SF", "Square Footage", "Bldg SF", "Building SqFt"]) {
    const sized = BULK.parseAddressList(`Address,${head}\n"6200 W Gowen Rd, Boise, ID",45000\n`);
    assert.equal(sized.rows[0].size_sqft, 45000, head);
  }
});

test("a size stated in acres is read as square feet", () => {
  const r = BULK.parseAddressList('Address,Size\n"100 Main St, Boise, ID",2.5 acres\n');
  assert.equal(r.rows[0].size_sqft, 108900, "2.5 acres is 108,900 SF, not 3 SF");
  assert.equal(r.warnings.length, 0);
});

test("a lone Address heading does not cut the addresses under it at the comma", () => {
  // One column copied out of Excel with its heading: the cells are unquoted.
  const r = BULK.parseAddressList(
    "Address\n6200 W Gowen Rd, Boise, ID 83705\n\n100 Main St, Boise, ID\n100 Main St, Meridian, ID\nDowntown\n");
  assert.deepEqual(r.rows.map((x) => x.address),
    ["6200 W Gowen Rd, Boise, ID 83705", "100 Main St, Boise, ID", "100 Main St, Meridian, ID"]);
  assert.equal(r.duplicates, 0, "one street in two cities is two properties");
  assert.equal(r.header, true);
  assert.deepEqual(r.skipped.map((s) => [s.line, s.address]), [[6, "Downtown"]],
    "the heading is not reported as a bad address, and line numbers are the file's");
  assert.equal(r.rows[1].line, 4);
  // A cell Excel did quote (a saved CSV, a workbook) is still read as a cell.
  const quoted = BULK.parseAddressList('Property Address\n"6200 W Gowen Rd, Boise, ID"\n');
  assert.deepEqual(quoted.rows.map((x) => x.address), ["6200 W Gowen Rd, Boise, ID"]);
});

test("City and State columns are joined onto the street", () => {
  const r = BULK.parseAddressList(
    "Address,City,State,Size\n6200 W Gowen Rd,Boise,ID,45000\n100 Main St,Boise,ID,1000\n100 Main St,Meridian,ID,2000\n");
  assert.deepEqual(r.rows.map((x) => x.address),
    ["6200 W Gowen Rd, Boise, ID", "100 Main St, Boise, ID", "100 Main St, Meridian, ID"]);
  assert.deepEqual(r.rows.map((x) => x.size_sqft), [45000, 1000, 2000]);
  assert.equal(r.duplicates, 0);
  // An address that already names them is left exactly as typed, ZIP and all.
  const full = BULK.parseAddressList('Address,City,State\n"123 Main St, Boise, ID 83702",Boise,ID\n');
  assert.equal(full.rows[0].address, "123 Main St, Boise, ID 83702");
  // Only what is missing is added.
  const half = BULK.parseAddressList('Street Address,State\n"123 Main St, Boise",ID\n');
  assert.equal(half.rows[0].address, "123 Main St, Boise, ID");
});

test("cells pasted from Excel are tab-separated and read as columns", () => {
  const r = BULK.parseAddressList(
    "Address\tSize\n6200 W Gowen Rd, Boise, ID\t45000\n500 W Franklin Rd, Meridian, ID\t32,000 SF\n");
  assert.equal(r.header, true);
  assert.deepEqual(r.rows.map((x) => x.address),
    ["6200 W Gowen Rd, Boise, ID", "500 W Franklin Rd, Meridian, ID"]);
  assert.deepEqual(r.rows.map((x) => x.size_sqft), [45000, 32000]);
  assert.equal(r.skipped.length, 0);
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

// The row's own inputs (051) ride the file too (2026-09-04 evening), APPENDED
// after the classic sixteen so nothing a positional reader knows has moved.
test("the CSV carries each row's asking price, NOI, cap rate, the type's details and the focus, after the classic columns", () => {
  const csv = BULK.exportCsv(
    { label: "Q3 review", property_type: "Industrial", months: 24, tx_focus: "sales" },
    // Comma-free addresses so a plain split reads the columns positionally.
    [{ address: "1 A St", status: "done", value_low: 100, value_likely: 120, value_high: 140,
       subject: { asking: 3125000, noi: 210000, capRate: 6.25, details: { clear_height: "32" } } },
     { address: "2 B St", status: "failed", error: "No priced sale comps in this window" }],
    { detailKeys: ["clear_height", "dock_doors"] });
  const lines = csv.trim().split("\n");
  // The classic prefix is byte-identical: the first sixteen columns have not moved.
  assert.equal(lines[1], BULK.EXPORT_COLUMNS.join(",") + ",asking_price,noi,cap_rate,clear_height,dock_doors,tx_focus");
  const row1 = lines[2].split(",");
  assert.equal(row1.length, BULK.EXPORT_COLUMNS.length + 6);
  assert.deepEqual(row1.slice(BULK.EXPORT_COLUMNS.length), ["3125000", "210000", "6.25", "32", "", "sales"]);
  // A row with no subject exports blanks, never "undefined", and the focus is
  // the JOB's on every row (a file read without its title row still says so).
  const row2 = lines[3].split(",");
  assert.deepEqual(row2.slice(BULK.EXPORT_COLUMNS.length), ["", "", "", "", "", "sales"]);
  assert.equal(csv.includes("undefined"), false);
  // The totals row still lands on the classic value columns (positions 4-6).
  const totals = lines[lines.length - 1].split(",");
  assert.match(totals[0], /Total \(1 valued\)/);
  assert.deepEqual(totals.slice(4, 7), ["100", "120", "140"]);
  // No focus set reads as "both", the default every pre-051 job ran with.
  const plain = BULK.exportCsv({ property_type: "Land" }, [{ address: "1 A St", status: "done" }]);
  assert.match(plain.trim().split("\n")[2], /,both$/);
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

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "036-bulk-valuations.sql"), "utf8");
// Comments stripped, so a rule stated in prose can never satisfy a test about
// what the file actually EXECUTES.
const LIVE_SQL = MIGRATION.split("\n").map((l) => l.split("--")[0]).join("\n");

test("EVERY TABLE 036 CREATES HAS ROW LEVEL SECURITY ENABLED", () => {
  // A table in the public schema without this is reachable through PostgREST
  // by the anon role. bulk_job_items holds a member's address list keyed by
  // user_id — an index of exactly which buildings somebody is valuing, which
  // is competitive intelligence about them — and without RLS it would be
  // readable by anyone while looking perfectly healthy.
  //
  // 013, 016 and 030 all enable it. 016 shipped WITHOUT it on
  // broker_properties, was caught by hand and had to be re-run; 036 shipped
  // without it too and was caught the same way, one step before it was run.
  // Twice is a pattern, so this now fails the build instead.
  const created = [...LIVE_SQL.matchAll(/create table (?:if not exists )?([a-z_]+)/gi)]
    .map((m) => m[1]);
  assert.ok(created.length >= 2, "expected 036 to create both bulk tables");
  for (const table of created) {
    assert.match(LIVE_SQL, new RegExp(`alter table\\s+${table}\\s+enable row level security`, "i"),
      `036 creates ${table} but never enables row level security on it — ` +
      "the anon role would be able to read it through PostgREST");
  }
});

test("036 is additive: it drops and renames nothing", () => {
  // There is no staging database to rehearse against, so a destructive
  // statement here is a decision somebody should have to make on purpose.
  const live = LIVE_SQL.toLowerCase();
  for (const forbidden of ["drop table", "drop column", "rename to", "rename column", "truncate", "delete from"]) {
    assert.equal(live.includes(forbidden), false,
      `036 contains "${forbidden}" outside a comment — it is meant to be purely additive`);
  }
});

test("036 re-runs cleanly", () => {
  // Unlike 017, which cannot: Postgres has no `add constraint if not exists`,
  // so that file aborts on a second run. Everything here is guarded, which is
  // what makes "just run it again" a safe answer to an interrupted run.
  for (const st of LIVE_SQL.split(";").map((x) => x.trim()).filter(Boolean)) {
    if (/^create table/i.test(st)) assert.match(st, /create table if not exists/i);
    if (/^create index/i.test(st)) assert.match(st, /create index if not exists/i);
  }
});

test("036 relies on no implicit string concatenation", () => {
  // Two string literals separated by a newline are concatenated by SQL. Valid
  // Postgres, and a paste hazard: a browser or editor that reflows the line
  // turns it into a syntax error, and the SQL editor aborts the WHOLE script
  // — so the migration silently does nothing and the tables never appear.
  // That is the likeliest reason 036's first run in the SQL editor landed
  // nothing (2026-08-21), which is why it is pinned rather than just fixed.
  assert.deepEqual(LIVE_SQL.match(/'\s*\n\s*'/g) || [], [],
    "036 has adjacent string literals across a newline — join them into one");
});

// ---------------------------------------------------------------------------
// The single form's inputs on a bulk run (2026-09-04, migration 051)
// ---------------------------------------------------------------------------

test("the focus is the form's three values, and a typo is refused, not defaulted", () => {
  assert.equal(BULK.normalizeTxFocus(""), "both", "empty is the default");
  assert.equal(BULK.normalizeTxFocus(undefined), "both");
  assert.equal(BULK.normalizeTxFocus(" Sales "), "sales");
  assert.equal(BULK.normalizeTxFocus("leases"), "leases");
  assert.equal(BULK.normalizeTxFocus("rentals"), null, "an unknown focus must be refused by the route, never run as both");
  assert.deepEqual(BULK.TX_FOCUSES, ["both", "sales", "leases"]);
});

test("a one-address run's subject is cleaned, whitelisted and never guessed", () => {
  const s = BULK.normalizeSubject({
    asking: "$3,125,000", noi: 210000, capRate: "6.25%",
    details: { clear_height: " 32 ", dock_doors: "6", units: "48", evil: "x" },
  }, ["clear_height", "dock_doors"]);
  assert.deepEqual(s, { asking: 3125000, noi: 210000, capRate: 6.25, details: { clear_height: "32", dock_doors: "6" } });
  // Nothing typed stores nothing, so an untouched form is not a row of nulls.
  assert.equal(BULK.normalizeSubject({ asking: "", noi: null, details: {} }, ["units"]), null);
  assert.equal(BULK.normalizeSubject(null, ["units"]), null);
  // A cap rate above 100 and an asking price of "call" are dropped, not stored.
  assert.equal(BULK.normalizeSubject({ capRate: 625, asking: "call broker" }, []), null);
  // Keys outside the type's own are never stored, whatever the client sent.
  assert.equal(BULK.normalizeSubject({ details: { user_id: "u-2" } }, ["units"]), null);
});

test("an upload's columns carry each row's asking price, NOI, cap rate and type details", () => {
  const csv = [
    "address,size_sqft,asking_price,noi,cap_rate,clear_height,dock_doors",
    "1201 W Idaho St, Boise, ID 83702|20000|$3,125,000|210000|6.25%|32|6",
    "900 N Cole Rd, Boise, ID|18000|call||abc|28|",
  ].map((l, i) => (i === 0 ? l : l.split("|").map((c) => (c.includes(",") ? `"${c}"` : c)).join(","))).join("\n");
  const out = BULK.parseAddressList(csv, { detailKeys: ["clear_height", "dock_doors"] });
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.rows[0].subject, { asking: 3125000, noi: 210000, capRate: 6.25, details: { clear_height: "32", dock_doors: "6" } });
  // Row 2: the unparseable asking price and cap rate are WARNED about and left
  // out; the row still runs with what did parse.
  assert.deepEqual(out.rows[1].subject, { details: { clear_height: "28" } });
  const reasons = out.warnings.filter((w) => w.line === 3).map((w) => w.reason);
  assert.equal(reasons.length, 2, JSON.stringify(out.warnings));
  assert.match(reasons.join(" "), /Asking price "call"/);
  assert.match(reasons.join(" "), /Cap rate "abc"/);
  // A pasted list has no columns and therefore no subject.
  const pasted = BULK.parseAddressList("1201 W Idaho St, Boise, ID 83702", { detailKeys: ["units"] });
  assert.equal(pasted.rows[0].subject, null);
  // Detail keys the caller did not name are not read, even when a column has them.
  const other = BULK.parseAddressList("address,units\n1201 W Idaho St, Boise, ID 83702,48".replace("Boise, ID", "\"Boise, ID\""), { detailKeys: ["clear_height"] });
  assert.equal(other.rows[0].subject, null);
});

test("051 is additive, re-runs cleanly and uses no implicit concatenation", () => {
  const sql051 = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "migrations", "051-bulk-job-options.sql"), "utf8");
  const live = sql051.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
  for (const forbidden of ["drop table", "drop column", "rename to", "rename column", "truncate", "delete from"]) {
    assert.equal(live.includes(forbidden), false, `051 contains "${forbidden}"`);
  }
  assert.match(live, /alter table bulk_jobs\s+add column if not exists tx_focus text not null default 'both'/);
  assert.match(live, /alter table bulk_job_items\s+add column if not exists subject jsonb/);
  assert.deepEqual(live.match(/'\s*\n\s*'/g) || [], []);
});

// The same off-by-N as the vault's, from the same cause: parseCsv drops blank
// rows, so the array index counts surviving rows rather than file lines. The
// number is surfaced in skipped[] and warnings[] to the person who pasted the
// list, under a comment promising "the number they see in the file".
test("a blank row in a pasted CSV does not shift the reported line numbers", () => {
  const csv = [
    "address,size",
    "1 Main St Boise ID,1000",   // line 2
    "",
    "2 Oak Ave Boise ID,2000",   // line 4
    "Downtown,3000",             // line 5 — refused
  ].join("\n");
  const out = BULK.parseAddressList(csv, { max: 50 });
  assert.deepEqual(out.rows.map((r) => r.line), [2, 4]);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].line, 5,
    "the refused address is on line 5; line 3 is the blank one");
  assert.equal(out.skipped[0].address, "Downtown");
});

test("the no-header branch is unchanged — it splits the text itself", () => {
  // It never went through parseCsv, so it was always right, and must stay so.
  const out = BULK.parseAddressList("1 Main St Boise ID\n\n2 Oak Ave Boise ID\n", { max: 50 });
  assert.deepEqual(out.rows.map((r) => r.line), [1, 3]);
});

// ---------------------------------------------------------------------------
// How long a run has left (2026-11-10)
// ---------------------------------------------------------------------------

test("the pace is measured, leans long, and never trusts one search", () => {
  const first = BULK.TYPICAL_SEARCH_MS + BULK.ROW_OVERHEAD_MS;
  assert.equal(BULK.typicalSearchMs([]), first, "with nothing timed, the default");
  assert.equal(BULK.typicalSearchMs(null), first);
  assert.equal(BULK.typicalSearchMs(["x", -4, 0, NaN]), first, "junk is not a measurement");
  // One quick search does not rewrite the estimate: until five are in, the
  // default still counts as one of them.
  const one = BULK.typicalSearchMs([10000]);
  assert.ok(one > 10000 + BULK.ROW_OVERHEAD_MS && one < first, "one sample moves it part of the way: " + one);
  // Enough of them and the default is gone. The 75th percentile, so most runs
  // finish inside the bar rather than half of them overrunning it.
  const many = BULK.typicalSearchMs([10000, 11000, 12000, 9000, 30000, 10500]);
  assert.ok(many >= 11000 + BULK.ROW_OVERHEAD_MS && many < 20000, "p75 of the samples, plus the row's own overhead: " + many);
  const sorted = [9000, 10000, 10500, 11000, 12000, 30000];
  assert.ok(many > sorted[2] + BULK.ROW_OVERHEAD_MS, "above the median");
  // Only the most recent ones count, so a provider change shows up.
  const old = Array.from({ length: 40 }, () => 60000);
  const recent = Array.from({ length: BULK.PACE_SAMPLES }, () => 12000);
  assert.equal(BULK.typicalSearchMs([...old, ...recent]), 12000 + BULK.ROW_OVERHEAD_MS);
  // Bounded both ways: an outage afternoon is not a four-hour promise, and a
  // run of instant corpus answers is not "a few seconds" for a cold address.
  assert.equal(BULK.typicalSearchMs(Array.from({ length: 10 }, () => 3600000)), 240000 + BULK.ROW_OVERHEAD_MS);
  assert.equal(BULK.typicalSearchMs(Array.from({ length: 10 }, () => 200)), 8000 + BULK.ROW_OVERHEAD_MS);
});

test("a run's time left is the worker's own arithmetic", () => {
  const T = 40000;
  const q = (id) => ({ id, status: "queued" });
  const r = (id) => ({ id, status: "running" });
  const d = (id) => ({ id, status: "done" });
  const base = { now: 1000000, startedAt: 1000000, typicalMs: T, concurrency: 3 };

  // Fifty queued addresses, three at a time: seventeen rounds. This is the
  // sum the page's cost line does before the button (ceil(n / lanes) x the
  // usual time), so the two cannot open on different numbers.
  const fifty = BULK.runProgress({ ...base, items: Array.from({ length: 50 }, (_, i) => q("i" + i)) });
  assert.deepEqual(fifty, { elapsed_ms: 0, left_ms: Math.ceil(50 / 3) * T, late: false });

  // One address, ten seconds in.
  const one = BULK.runProgress({ ...base, now: 1010000, items: [r("a")], runningSince: { a: 1000000 } });
  assert.deepEqual(one, { elapsed_ms: 10000, left_ms: 30000, late: false });

  // Two in flight at different points and one waiting: the waiting row goes
  // to the lane that frees first, and the answer is when the LAST lane ends.
  const mixed = BULK.runProgress({
    ...base, now: 1030000, items: [d("x"), r("a"), r("b"), q("c")],
    runningSince: { a: 1000000, b: 1020000 },
  });
  // a has 10s left, b has 30s, the third lane is idle and takes c for 40s.
  assert.equal(mixed.left_ms, 40000);
  assert.equal(mixed.elapsed_ms, 30000);

  // Fewer rows than lanes never invents lanes.
  assert.equal(BULK.runProgress({ ...base, items: [q("a"), q("b")] }).left_ms, T);

  // A row with no recorded start is assumed to have just begun, which errs long.
  assert.equal(BULK.runProgress({ ...base, now: 1030000, items: [r("a")] }).left_ms, T);

  // Finished rows cost nothing, so a cache hit only ever moves the bar on.
  assert.equal(BULK.runProgress({ ...base, items: [d("a"), d("b")] }).left_ms, 0);
});

test("a search past its time is called late, not promised again", () => {
  const T = 40000;
  const base = { startedAt: 1000000, typicalMs: T, concurrency: 3 };
  const late = BULK.runProgress({
    ...base, now: 1000000 + 90000,
    items: [{ id: "a", status: "running" }], runningSince: { a: 1000000 },
  });
  assert.equal(late.late, true);
  assert.ok(late.left_ms > 0 && late.left_ms <= T * 0.15, "a short stretch more, never zero: " + late.left_ms);
  // With rows still waiting there IS a figure worth quoting, so not late.
  const more = BULK.runProgress({
    ...base, now: 1000000 + 90000,
    items: [{ id: "a", status: "running" }, { id: "b", status: "queued" }],
    runningSince: { a: 1000000 },
  });
  assert.equal(more.late, false);
  assert.equal(more.left_ms, T, "the waiting row on the idle lane decides it");
});

test("a cancelled run counts only what is in flight, and an unknown clock is no answer", () => {
  const T = 40000;
  const items = [{ id: "a", status: "running" }, ...Array.from({ length: 20 }, (_, i) => ({ id: "q" + i, status: "queued" }))];
  const c = BULK.runProgress({
    now: 1005000, startedAt: 1000000, typicalMs: T, concurrency: 3,
    items, runningSince: { a: 1000000 }, cancelled: true,
  });
  assert.equal(c.left_ms, 35000, "the queued rows will never start");
  // No worker clock: a job this process is not working. The page shows its
  // count and claims no time.
  assert.equal(BULK.runProgress({ now: 1005000, items, typicalMs: T, concurrency: 3 }), null);
  assert.equal(BULK.runProgress({ now: 1005000, startedAt: null, items }), null);
  assert.equal(BULK.runProgress(null), null);
});

// The report a bulk row links to weights its comps by the asking price the
// member put on THAT ROW (index.html askingRangeFrom: the saved subject's own
// price first, a listing the model found second). Until 2026-11-10 the row
// itself only ever read the model's listing, so a row with an Asking column
// and the report under it printed different values for the same comps.
test("a row's own asking price weights its comps, as the report it links to does", () => {
  const month = (n) => new Date(Date.UTC(2026, 9 - n, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const comp = (psf, n) => ({
    address: n + " Elm St, Boise, ID", transaction: "Sale", date: month(n % 6),
    size_sqft: 2750, price_or_rate: "$" + (psf * 2750).toLocaleString("en-US"), price_per_sqft: "$" + psf,
  });
  // A dear pocket and a cheap one, and no listing found by the model.
  const report = { comps: [445, 450, 455, 460].map(comp).concat([255, 260, 262, 265, 268, 270, 272, 275].map((p, i) => comp(p, i + 10))) };
  const opts = { subjectSizeSqft: 2750, asOf: Date.UTC(2026, 9, 15), propertyType: "Residential", note: "" };

  const plain = BULK.valueFromReport(report, opts);
  const asked = BULK.valueFromReport(report, { ...opts, askingPrice: 1250000 });
  assert.ok(plain && asked);
  assert.ok(asked.value_likely > plain.value_likely,
    "an asking price near the dear comps pulls the likely value toward them: " + plain.value_likely + " -> " + asked.value_likely);

  // It is the same figure a listing found by the model would have given.
  const listed = BULK.valueFromReport({ ...report, subject_asking: { price: 1250000 } }, opts);
  assert.equal(asked.value_likely, listed.value_likely);
  // And the row's own price wins over the model's listing, the report's order.
  const both = BULK.valueFromReport({ ...report, subject_asking: { price: 700000 } }, { ...opts, askingPrice: 1250000 });
  assert.equal(both.value_likely, asked.value_likely);
  // No price, a blank or a nonsense one changes nothing.
  for (const none of [null, undefined, "", 0, "n/a"]) {
    assert.equal(BULK.valueFromReport(report, { ...opts, askingPrice: none }).value_likely, plain.value_likely);
  }
});

test("how long a late search is given is one rule, shared by both countdowns", () => {
  // A short stretch more, never zero, and never less than three seconds.
  assert.equal(BULK.lateLeftMs(40000), 6000);
  assert.equal(BULK.lateLeftMs(10000), 3000);
  // runProgress judges a bulk row by it, and server.js tells the single
  // report's loading card the moment it runs out (typical - lateLeftMs), so
  // the two surfaces turn "late" at the same instant for the same search.
  for (const T of [10000, 22000, 47000, 242000]) {
    const turn = T - BULK.lateLeftMs(T);
    const row = (spent) => BULK.runProgress({
      now: 5000000 + spent, startedAt: 5000000, typicalMs: T, concurrency: 3,
      items: [{ id: "a", status: "running" }], runningSince: { a: 5000000 },
    });
    assert.equal(row(turn - 500).late, false, T + "ms: on time just before");
    assert.equal(row(turn + 500).late, true, T + "ms: late just after");
    assert.equal(row(turn + 500).left_ms, Math.round(BULK.lateLeftMs(T)));
  }
});

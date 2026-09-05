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

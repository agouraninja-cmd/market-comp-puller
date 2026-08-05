// Broker vault import — reading a broker's spreadsheet.
//
// Run: npm test   (node --test, no dependencies, no database, no server)
//
// Everything here is a shape a real spreadsheet arrives in. The bar for this
// module is higher than "does it parse": a misread column becomes a wrong
// number in a paying broker's own records, and they will check the first one.
// So the cases that matter most are the REFUSALS — the values we could guess
// at but should not.

const test = require("node:test");
const assert = require("node:assert");

const {
  parseCsv, normalizeHeader, parseMoney, parseNumber, parsePercent, parseDate,
  parseTransaction, parsePropertyType, addressKey, normalizeRow, parseUpload,
  templateCsv, TEMPLATE_COLUMNS, MAX_ROWS_PER_UPLOAD,
} = require("../broker-vault");

// --- CSV reading -----------------------------------------------------------

test("a quoted field keeps its commas", () => {
  // The whole reason this is not text.split(","): almost every address has one.
  const rows = parseCsv('address,price\n"1234 W Mission Blvd, Ontario, CA",12500000\n');
  assert.deepEqual(rows[1], ["1234 W Mission Blvd, Ontario, CA", "12500000"]);
});

test("doubled quotes mean one literal quote", () => {
  const rows = parseCsv('a\n"He said ""yes"""\n');
  assert.equal(rows[1][0], 'He said "yes"');
});

test("a newline inside a quoted field does not end the row", () => {
  const rows = parseCsv('address,notes\n"1 Main St","line one\nline two"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "line one\nline two");
});

test("CRLF and a missing trailing newline both read correctly", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("Excel's BOM does not become part of the first header", () => {
  // "Save as CSV" writes one. Left in place, `address` never matches and the
  // whole file reads as the wrong template.
  const rows = parseCsv("﻿address,price\n1 Main St,100\n");
  assert.equal(rows[0][0], "address");
});

test("blank and spacer lines are dropped, not treated as bad rows", () => {
  const rows = parseCsv("a,b\n\n1,2\n,\n");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});

test("empty input yields no rows rather than throwing", () => {
  for (const v of ["", null, undefined]) assert.deepEqual(parseCsv(v), []);
});

test("headers match on case, spaces and hyphens only", () => {
  for (const h of ["Property Type", "property-type", "PROPERTY_TYPE", " Property   Type "]) {
    assert.equal(normalizeHeader(h), "property_type");
  }
});

// --- money: the refusals matter more than the successes --------------------

test("money reads the shapes a spreadsheet actually contains", () => {
  assert.equal(parseMoney("$1,250,000").value, 1250000);
  assert.equal(parseMoney("1250000").value, 1250000);
  assert.equal(parseMoney("1,250,000.50").value, 1250000.5);
  assert.equal(parseMoney("USD 1,250,000").value, 1250000);
  assert.equal(parseMoney("").value, null, "blank is absent, not invalid");
});

test("money REFUSES shorthand instead of guessing", () => {
  // The failure this prevents: "1.2M" quietly becoming 1.2. Nobody notices a
  // price of $1.20 in row 340 until it has skewed a median.
  for (const v of ["1.2M", "450k", "1.2 million", "$3.4M"]) {
    const r = parseMoney(v);
    assert.equal(r.ok, false, `${v} must be refused`);
    assert.match(r.error, /not a plain number/);
  }
});

test("money refuses negatives in both notations", () => {
  assert.equal(parseMoney("(1,000)").ok, false, "accounting negative");
  assert.equal(parseMoney("-1000").ok, false);
});

test("money refuses text", () => {
  for (const v of ["TBD", "call for price", "n/a", "--"]) {
    assert.equal(parseMoney(v).ok, false, `${v} must be refused`);
  }
});

// --- numbers, percentages, dates -------------------------------------------

test("size accepts a trailing unit and drops it", () => {
  assert.equal(parseNumber("45,000").value, 45000);
  assert.equal(parseNumber("45,000 SF").value, 45000);
  assert.equal(parseNumber("45000 sq ft").value, 45000);
  assert.equal(parseNumber("2.4 acres").value, 2.4);
});

test("cap rate accepts a percent sign and rejects impossible values", () => {
  assert.equal(parsePercent("6.25%").value, 6.25);
  assert.equal(parsePercent("6.25").value, 6.25);
  assert.equal(parsePercent("").value, null);
  assert.equal(parsePercent("625").ok, false, "over 100 is not a cap rate");
  assert.equal(parsePercent("-1").ok, false);
});

test("dates read ISO and US slash order", () => {
  assert.equal(parseDate("2025-03-14").value, "2025-03-14");
  assert.equal(parseDate("3/14/2025").value, "2025-03-14");
  assert.equal(parseDate("03/14/25").value, "2025-03-14");
  assert.equal(parseDate("3/14/98").value, "1998-03-14", "two-digit years split at 69");
});

test("a bare number is REFUSED as a date", () => {
  // Excel exports a date it thinks is a serial as 45000. Guessing would
  // silently invent a deal date.
  const r = parseDate("45000");
  assert.equal(r.ok, false);
  assert.match(r.error, /YYYY-MM-DD/);
});

test("a day-first date is refused rather than misread", () => {
  // 14/03/2025 is unambiguous but not our order; 03/04/2025 is ambiguous and
  // is read US-style. Refusing the first is what makes the second defensible.
  const r = parseDate("14/03/2025");
  assert.equal(r.ok, false);
  assert.match(r.error, /day-first/);
  assert.equal(parseDate("03/04/2025").value, "2025-03-04", "documented US order");
});

test("impossible dates are refused before Postgres sees them", () => {
  for (const v of ["2025-02-30", "2025-13-01", "2025-00-10", "2/29/2025"]) {
    assert.equal(parseDate(v).ok, false, `${v} must be refused`);
  }
  assert.equal(parseDate("2/29/2024").value, "2024-02-29", "but a real leap day is fine");
});

test("month names are refused — they usually mean a month with no day", () => {
  assert.equal(parseDate("March 2025").ok, false);
});

// --- enums -----------------------------------------------------------------

test("transaction is generous about wording and strict about the result", () => {
  for (const v of ["sale", "Sold", "PURCHASE"]) assert.equal(parseTransaction(v).value, "sale");
  for (const v of ["lease", "Leased", "rental"]) assert.equal(parseTransaction(v).value, "lease");
  assert.equal(parseTransaction("refinance").ok, false);
  assert.equal(parseTransaction("").ok, false, "required");
});

test("property type must be one of the six the site knows", () => {
  assert.equal(parsePropertyType("industrial").value, "Industrial");
  assert.equal(parsePropertyType("MULTIFAMILY").value, "Multifamily");
  assert.equal(parsePropertyType("Warehouse").ok, false);
  assert.equal(parsePropertyType("").ok, false);
});

test("the address key collapses punctuation but does not expand abbreviations", () => {
  assert.equal(addressKey("1234 W. Mission Blvd."), addressKey("1234 W Mission Blvd"));
  assert.equal(addressKey("1234  Main   St"), "1234 main st");
  // Deliberately NOT equal: merging two genuinely different properties is
  // worse than leaving one duplicate the broker can delete.
  assert.notEqual(addressKey("1234 Main St"), addressKey("1234 Main Street"));
});

// --- a whole row -----------------------------------------------------------

const goodRow = (over = {}) => ({
  address: "1234 W Mission Blvd, Ontario, CA",
  property_type: "Industrial",
  transaction: "sale",
  deal_date: "2025-03-14",
  price: "$12,500,000",
  size_sqft: "84,000",
  ...over,
});

test("a good row normalizes into storable values", () => {
  const r = normalizeRow(goodRow());
  assert.equal(r.ok, true);
  assert.equal(r.row.property_type, "Industrial");
  assert.equal(r.row.transaction, "sale");
  assert.equal(r.row.deal_date, "2025-03-14");
  assert.equal(r.row.price, 12500000);
  assert.equal(r.row.size_sqft, 84000);
  assert.equal(typeof r.row.price, "number", "stored as a number, not text");
});

test("$/SF is computed, not imported", () => {
  // A broker's own $/SF column would be a fourth number free to disagree with
  // the other three. This one is exact by construction.
  const r = normalizeRow(goodRow());
  assert.equal(r.row.price_per_sqft, 148.81);
});

test("$/SF is never computed for a lease", () => {
  // Annual rent / size is $/SF/YR — a different metric. Putting it in the same
  // column would corrupt every median that reads it.
  const r = normalizeRow(goodRow({ transaction: "lease", price: "1200000" }));
  assert.equal(r.row.price_per_sqft, null);
});

test("a row reports ALL its problems at once", () => {
  // One complete list beats discovering the next error on re-upload.
  const r = normalizeRow({ address: "", property_type: "Warehouse", transaction: "refi", deal_date: "nope" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 4, `expected several errors, got ${JSON.stringify(r.errors)}`);
});

test("an address with no street number is refused", () => {
  // The public corpus tolerates area estimates by downgrading their
  // provenance; a broker's own vault should not, because they typed it.
  const r = normalizeRow(goodRow({ address: "Inland Empire West submarket" }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /street number/);
});

test("deal_date is required", () => {
  const r = normalizeRow(goodRow({ deal_date: "" }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /deal_date is required/);
});

test("an unpriced comp is still a valid comp", () => {
  // Brokers track deals whose price was never disclosed. Refusing them would
  // reject real data.
  const r = normalizeRow(goodRow({ price: "" }));
  assert.equal(r.ok, true);
  assert.equal(r.row.price, null);
  assert.equal(r.row.price_per_sqft, null);
});

test("the dedupe key survives a null price", () => {
  // The whole reason it is a string column and not a multi-column unique
  // constraint: Postgres compares NULLs as distinct, so an unpriced comp would
  // re-import forever. Two unpriced imports of the same deal must collide.
  const a = normalizeRow(goodRow({ price: "" })).row;
  const b = normalizeRow(goodRow({ price: "" })).row;
  assert.equal(a.dedupe_key, b.dedupe_key);
  assert.ok(a.dedupe_key.endsWith("|"), "a null price is an empty segment");
  // And a priced version of the same deal is a different row, not a collision.
  assert.notEqual(a.dedupe_key, normalizeRow(goodRow()).row.dedupe_key);
});

test("the dedupe key ignores punctuation the way the address key does", () => {
  const a = normalizeRow(goodRow({ address: "1234 W. Mission Blvd., Ontario, CA" })).row;
  const b = normalizeRow(goodRow()).row;
  assert.equal(a.dedupe_key, b.dedupe_key);
});

test("optional spec columns come through, absent ones are null not undefined", () => {
  const r = normalizeRow(goodRow({ clear_height: "32 ft", dock_doors: "6 dock-high" }));
  assert.equal(r.row.clear_height, "32 ft");
  assert.equal(r.row.building_class, null, "null stores cleanly; undefined does not");
});

test("garbage input does not throw", () => {
  for (const v of [null, undefined, "a string", 42, []]) {
    assert.doesNotThrow(() => normalizeRow(v));
    assert.equal(normalizeRow(v).ok, false);
  }
});

// --- a whole file ----------------------------------------------------------

const FILE = [
  "address,property_type,transaction,deal_date,price,size_sqft",
  '"1234 W Mission Blvd, Ontario, CA",Industrial,sale,2025-03-14,12500000,84000',
  '"555 S Vine Ave, Ontario, CA",Industrial,sale,2025-01-09,8100000,52000',
].join("\n");

test("a clean file imports every row", () => {
  const out = parseUpload(FILE);
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 2);
  assert.equal(out.total, 2);
  assert.equal(out.skipped, 0);
  assert.equal(out.errors.length, 0);
});

test("bad rows are skipped and reported by spreadsheet line number", () => {
  // One typo in row 400 must not reject 399 good comps.
  const out = parseUpload(FILE + "\n1 Bad St,Warehouse,sale,2025-03-14,100,100");
  assert.equal(out.rows.length, 2, "the good rows still import");
  assert.equal(out.skipped, 1);
  assert.match(out.errors[0], /^Line 4:/, "line 4 = what Excel shows, header counted");
});

test("duplicate rows within one file collapse", () => {
  const out = parseUpload(FILE + "\n" + FILE.split("\n")[1]);
  assert.equal(out.rows.length, 2);
  assert.equal(out.duplicates, 1);
});

test("a file without an address column is a wrong-file error, not 400 row errors", () => {
  const out = parseUpload("name,phone\nBob,555-1234");
  assert.equal(out.ok, false);
  assert.equal(out.rows.length, 0);
  assert.match(out.errors[0], /no `address` column/);
});

test("an empty file says so", () => {
  const out = parseUpload("");
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /empty/);
});

test("a file over the row cap is refused whole", () => {
  const header = "address,property_type,transaction,deal_date,price,size_sqft\n";
  const line = "1 Main St,Industrial,sale,2025-03-14,100,100\n";
  const out = parseUpload(header + line.repeat(MAX_ROWS_PER_UPLOAD + 1));
  assert.equal(out.ok, false);
  assert.match(out.errors[0], /limit is 5000/);
});

test("error reporting is capped so one broken file cannot produce a huge response", () => {
  const header = "address,property_type,transaction,deal_date\n";
  const bad = "no-number St,Warehouse,refi,nope\n";
  const out = parseUpload(header + bad.repeat(300), { maxErrors: 10 });
  assert.ok(out.errors.length <= 11, "10 errors plus the summary line");
  assert.match(out.errors[out.errors.length - 1], /Showing the first 10/);
  assert.equal(out.skipped, 300, "but the count is still honest");
});

test("a file whose rows are all bad reports ok:false", () => {
  const out = parseUpload("address,property_type,transaction,deal_date\n1 Main St,Warehouse,refi,nope");
  assert.equal(out.ok, false);
  assert.equal(out.rows.length, 0);
  assert.equal(out.skipped, 1);
});

test("the template parses cleanly through our own importer", () => {
  // If the example row we hand a broker cannot be re-imported, the first thing
  // they ever do fails.
  const out = parseUpload(templateCsv());
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.rows.length, 1);
  assert.equal(out.skipped, 0);
});

test("the template's headers are exactly the columns we document", () => {
  assert.deepEqual(parseCsv(templateCsv())[0], TEMPLATE_COLUMNS);
});

test("parseUpload never throws on garbage", () => {
  for (const v of [null, undefined, 42, " ", "]]]"]) {
    assert.doesNotThrow(() => parseUpload(v));
  }
});

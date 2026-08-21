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
  templateCsv, TEMPLATE_COLUMNS, OPTIONAL_SPEC_COLUMNS, PROPERTY_TYPES,
  isCommentRow, MAX_ROWS_PER_UPLOAD,
  canPublish, creditName, licenseOf, canPublishAs, validateIdentity, submissionRowFrom,
  matchOffered, enforceVerifiedFlags,
  suggestMapping, HEADER_ALIASES, MAPPABLE_TARGETS,
  validateMapping, applyHeaderMapping,
  inspectCsv, normalizedHeaderRow,
  validateEdit, EDITABLE_FIELDS, isUuid,
  exportColumns, exportCsv, exportRowsWithCoords,
  guardFormula, csvCell,
  sniffExtractMedia, checkExtractFile, parseExtractJson, classifyExtractRows,
  uploadPayloadToCsv,
  MAX_EXTRACT_BYTES, EXTRACT_MEDIA_TYPES, VAULT_FIELD_KEYS, EXTRACT_KEYS,
  extractVendorError, extractWasTruncated,
} = require("../broker-vault");

// Shared with vault-api.test.js: parses the columns a table actually has out
// of the migration files, so this check fails the build on a real schema
// drift instead of trusting a second hand-written column list.
const { migrationColumns } = require("./helpers/migration-columns");

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
  // "n/a" and "--" used to sit in this list. They moved to the no-value set
  // on 2026-08-11 (see NO_VALUE_TOKENS): they name the ABSENCE of a number,
  // so reading them as an empty cell guesses nothing — where "TBD" and
  // "call for price" describe a price that exists and is pending, which is
  // information a blank would destroy. The first real broker file lost a
  // whole row to "Undisclosed" while the template promised undisclosed
  // deals still count.
  for (const v of ["TBD", "call for price", "pending", "see notes"]) {
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

// --- editing a stored row ---------------------------------------------------
//
// validateEdit is deliberately NOT a second validator: it merges the patch
// over the existing row's template-shaped fields and runs it back through
// normalizeRow, the same function every imported row goes through. These
// tests exist to prove that wiring, not to re-test normalizeRow's parsing
// rules -- those are covered above.

test("validateEdit merges a patch over the existing comp", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1000000,
    size_sqft: 10000, notes: "keep me",
  };
  const r = validateEdit(existing, { price: "$1,250,000" });
  assert.equal(r.ok, true);
  assert.equal(r.row.price, 1250000);
  assert.equal(r.row.notes, "keep me", "unpatched fields survive");
  assert.equal(r.row.price_per_sqft, 125, "$/SF recomputed from the new price");
});

test("validateEdit refuses shorthand exactly as the importer does", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14",
  };
  const r = validateEdit(existing, { price: "1.2M" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.join(" ").includes("price"), "the error names the field");
});

test("validateEdit recomputes the dedupe key when the price changes", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1000000,
  };
  const before = normalizeRow(existing).row.dedupe_key;
  const after = validateEdit(existing, { price: 1250000 }).row.dedupe_key;
  assert.notEqual(after, before);
  assert.equal(after, normalizeRow({ ...existing, price: 1250000 }).row.dedupe_key,
    "the edit path must produce the same key the import path would");
});

test("validateEdit leaves price_per_sqft null when a sale becomes a lease", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Office",
    transaction: "sale", deal_date: "2025-03-14", price: 500000, size_sqft: 5000,
  };
  const r = validateEdit(existing, { transaction: "lease" });
  assert.equal(r.ok, true);
  assert.equal(r.row.price_per_sqft, null,
    "an annual rent over size is $/SF/yr and must never enter that column");
});

test("validateEdit ignores keys that are not template fields", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14",
  };
  const r = validateEdit(existing, { user_id: "someone-else", published: true });
  assert.equal(r.ok, true);
  assert.equal(r.row.user_id, undefined, "a patch may never set user_id");
  assert.equal(r.row.published, undefined, "a patch may never set published");
});

// The test above proves a patch cannot set user_id/published, but it cannot
// tell "properly allowlisted" apart from "no allowlist at all, saved only by
// normalizeRow's explicit field-by-field construction (which never spreads
// its input)". Swap validateEdit's merge for `{ ...existing, ...patch }` --
// no EDITABLE_FIELDS restriction whatsoever -- and the test above still
// passes, because normalizeRow drops the unknown keys either way. So pin the
// allowlist ITSELF: widening it, or deleting the filtering, must fail here
// even if every row-shape assertion elsewhere in this file stays green.
test("EDITABLE_FIELDS is exactly the two column constants, and excludes the fields a patch must never touch", () => {
  assert.deepEqual(EDITABLE_FIELDS, [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS]);
  // A patch that could set user_id would be an account-takeover primitive
  // (it retargets the row to another broker's account); one that could set
  // published (or the columns that go with it) would put a row in the public
  // corpus without the submission that credits it.
  const forbidden = [
    "user_id", "published", "published_at", "published_submission_id",
    "id", "upload_id", "market", "dedupe_key", "address_key",
  ];
  for (const f of forbidden) {
    assert.ok(!EDITABLE_FIELDS.includes(f), `EDITABLE_FIELDS must not include "${f}"`);
  }
});

// The two tests above still do not prove validateEdit's MERGE actually
// consults EDITABLE_FIELDS -- pinning the constant's value catches someone
// widening it, but not someone who leaves it untouched and swaps the merge
// itself for `{ ...existing, ...patch }`. normalizeRow would still drop the
// forbidden keys from its RESULT (it builds `row` field by field and never
// spreads `src`), so that regression is invisible to every test above it.
// The allowlist's only observable behavior, once the result can't tell the
// difference, is that it never even READS a key outside the list. Trap the
// read with a getter: the allowlist loop iterates EDITABLE_FIELDS and so
// never names these keys, while a spread reads every enumerable own property
// on the patch and trips them immediately.
test("validateEdit never reads a patch field outside the allowlist", () => {
  const existing = {
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1000000,
  };
  const touched = [];
  const patch = { price: 1250000 };
  for (const k of ["user_id", "published", "published_submission_id", "id", "upload_id"]) {
    Object.defineProperty(patch, k, {
      enumerable: true, configurable: true,
      get() { touched.push(k); return "tampered"; },
    });
  }
  const r = validateEdit(existing, patch);
  assert.equal(r.ok, true);
  assert.equal(r.row.price, 1250000, "the allowlisted field still applies");
  assert.deepEqual(touched, [],
    "a patch key outside EDITABLE_FIELDS must never be read: one that could set " +
    "user_id is an account-takeover primitive, and one that could set published " +
    "would put a row in the public corpus without the submission that credits it");
});

// --- the comp-id shape check -------------------------------------------------
//
// broker_comps.id is a uuid column (migration 013), so a malformed `?id=`
// makes PostgREST reject the query and throw, rather than simply finding no
// row. The PATCH/DELETE routes use isUuid to answer the SAME 404 an
// unknown-but-well-formed id gets, before ever asking the database -- a
// malformed id and someone else's id must look identical to the caller. This
// can only be unit-tested here: the bare-environment route suite has no
// session, so both routes answer 401 before the id is ever inspected, and
// cannot observe this check from the outside.
test("isUuid accepts a real uuid", () => {
  assert.equal(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6"), true);
  assert.equal(isUuid("3FA85F64-5717-4562-B3FC-2C963F66AFA6"), true, "case-insensitive");
});

test("isUuid rejects what a broken client or a prober might send", () => {
  assert.equal(isUuid("banana"), false);
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6'"), false, "trailing quote");
  assert.equal(isUuid("1=1; DROP TABLE broker_comps;--"), false, "SQL-ish string");
  assert.equal(isUuid("3fa85f64-5717-4562-b3fc-2c963f66afa6%00"), false, "embedded null byte");
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

// --- comment rows ------------------------------------------------------------
//
// The template's own rules ride in the file as `#` lines, so they survive the
// broker's first edit instead of dying with the example row that used to carry
// them in its `notes` cell.

test("a row whose first cell starts with # is not data", () => {
  const out = parseUpload([
    "address,property_type,transaction,deal_date",
    "# Required: address, property_type, transaction, deal_date.",
    "1 Main St,Industrial,sale,2025-03-14",
  ].join("\n"));
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.rows.length, 1);
  assert.equal(out.commented, 1);
  assert.equal(out.skipped, 0, "a comment is not a rejected row");
  assert.deepEqual(out.errors, []);
});

test("comment rows are excluded from the total the broker compares against", () => {
  // "Imported 1 of 3" on a one-comp file reads as data loss.
  const out = parseUpload([
    "address,property_type,transaction,deal_date",
    "# a note",
    "# another note",
    "1 Main St,Industrial,sale,2025-03-14",
  ].join("\n"));
  assert.equal(out.total, 1);
  assert.equal(out.commented, 2);
});

test("only the FIRST cell decides, so a comment may carry values", () => {
  // This is what lets an example row sit fully populated under its correct
  // headers and still be inert.
  assert.equal(isCommentRow(["#", "Industrial", "sale"]), true);
  assert.equal(isCommentRow(["  # spaced", "x"]), true);
  assert.equal(isCommentRow(["1 Main St", "#", "sale"]), false);
  assert.equal(isCommentRow([]), false);
  assert.equal(isCommentRow(null), false);
});

test("a comment row does not shift the line numbers below it", () => {
  // Errors are quoted in the numbering Excel shows, so a skipped comment must
  // still consume its line.
  const out = parseUpload([
    "address,property_type,transaction,deal_date",   // line 1
    "# a note",                                      // line 2
    "1 Main St,Warehouse,sale,2025-03-14",           // line 3
  ].join("\n"));
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /^Line 3:/);
});

test("a file that is nothing but comments says so", () => {
  // The untouched template. Without this the route falls through to its
  // generic "nothing could be imported", which does not tell the broker that
  // the # lines are ours and where their own rows go.
  const out = parseUpload(templateCsv());
  assert.equal(out.ok, false);
  assert.equal(out.rows.length, 0);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0], /starts with #/);
  assert.match(out.errors[0], /example rows/);
});

test("the template's example rows import cleanly once activated", () => {
  // Replaces the old "the template parses cleanly through our own importer"
  // test and keeps its point: the first thing a broker does must not fail.
  // Typing an address over the `#` is the only edit an example row needs.
  let n = 0;
  const activated = templateCsv()
    .split("\n")
    // Quoted, the way Excel writes a cell containing commas — an address
    // pasted in bare would shift every column right and prove nothing.
    .map((line) => (line.startsWith("#,") ? `"${++n} Example St, Ontario, CA"${line.slice(1)}` : line))
    .join("\n");
  assert.ok(n >= 3, `expected 3+ example rows to activate, found ${n}`);

  const out = parseUpload(activated);
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.rows.length, n);
  assert.equal(out.skipped, 0, JSON.stringify(out.errors));

  // The three examples exist to show the cases the first-run copy promises are
  // welcome, so pin them: a priced sale, a lease, and an undisclosed price.
  assert.ok(out.rows.some((r) => r.transaction === "sale" && r.price > 0), "no priced sale example");
  assert.ok(out.rows.some((r) => r.transaction === "lease"), "no lease example");
  assert.ok(out.rows.some((r) => r.price == null), "no undisclosed-price example");
});

test("the template's headers are exactly the columns we document", () => {
  assert.deepEqual(parseCsv(templateCsv())[0], TEMPLATE_COLUMNS);
});

test("the template's guidance names every type and every optional column", () => {
  // The test that keeps the file from going stale. Adding a per-type field
  // through the add-comp-field skill now fails the build until the template
  // tells brokers they may bring it.
  const csv = templateCsv();
  for (const t of PROPERTY_TYPES) {
    assert.ok(csv.includes(t), `the template never names the ${t} property type`);
  }
  for (const c of OPTIONAL_SPEC_COLUMNS) {
    assert.ok(csv.includes(c), `the template never names the optional ${c} column`);
  }
});

test("the template does not repeat the cleanup the importer already does", () => {
  // It used to say "no $ signs", which is false: parseMoney strips $ and
  // commas, parseNumber accepts "45,000 SF", parsePercent accepts "6.25%".
  // Telling a broker to strip them is asking for work we do not need.
  assert.equal(parseMoney("$1,250,000").value, 1250000);
  assert.equal(parseNumber("45,000 SF").value, 45000);
  assert.equal(parsePercent("6.25%").value, 6.25);
  assert.ok(!/no \$ signs/i.test(templateCsv()));
});

test("parseUpload never throws on garbage", () => {
  for (const v of [null, undefined, 42, " ", "]]]"]) {
    assert.doesNotThrow(() => parseUpload(v));
  }
});

// --- export ------------------------------------------------------------
//
// exportColumns/exportCsv are the reverse of the importer: a broker's own
// stored comps, turned back into the CSV shape parseUpload reads. The rule
// they exist to enforce is TEMPLATE_COLUMNS-alone-is-not-the-answer: the
// optional per-type columns (clear_height, units, lot_acres and nine more)
// are real, imported, stored data, and an export that dropped them would
// hand a broker a book missing the very fields they typed in.

test("an export with no per-type data is exactly the template columns", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1250000, size_sqft: 10000,
  }];
  assert.deepEqual(exportColumns(rows), TEMPLATE_COLUMNS);
});

test("an export carries the per-type columns that hold data, and only those", () => {
  const rows = [
    { address: "1 A St, Boise, ID", property_type: "Industrial",
      transaction: "sale", deal_date: "2025-01-02", clear_height: "32'" },
    { address: "2 B St, Boise, ID", property_type: "Industrial",
      transaction: "sale", deal_date: "2025-01-03", dock_doors: null },
  ];
  const cols = exportColumns(rows);
  assert.ok(cols.includes("clear_height"), "a populated per-type column must survive the round trip");
  assert.ok(!cols.includes("dock_doors"), "an empty per-type column must not add a dead column");
  assert.deepEqual(cols.slice(0, TEMPLATE_COLUMNS.length), TEMPLATE_COLUMNS,
    "the template columns lead, in their own order");
});

test("the export round-trips back through the importer", () => {
  // Coordinates are the case that matters most: if lat/lng do not survive
  // this trip, a re-import strips a private address's coordinates and the
  // next report sends that address out to a third-party geocoder.
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Industrial",
    transaction: "sale", deal_date: "2025-03-14", price: 1250000,
    size_sqft: 10000, cap_rate: 5.75, tenancy: "Single tenant",
    year_built: "1998", notes: "Sold, fully leased", clear_height: "32'",
    lat: 43.6150, lng: -116.2023,
  }];
  const parsed = parseUpload(exportCsv(rows));
  assert.equal(parsed.rows.length, 1, parsed.errors && parsed.errors.join("; "));
  const r = parsed.rows[0];
  assert.equal(r.address, "100 Main St, Boise, ID");
  assert.equal(r.price, 1250000);
  assert.equal(r.size_sqft, 10000);
  assert.equal(r.clear_height, "32'");
  assert.equal(r._lat, 43.6150, "coordinates must survive, or a re-import sends the address to a geocoder");
  assert.equal(r._lng, -116.2023);
});

test("a note containing a comma survives the export", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Retail",
    transaction: "sale", deal_date: "2025-03-14", notes: 'Sold "as is", quickly',
  }];
  const parsed = parseUpload(exportCsv(rows));
  assert.equal(parsed.rows[0].notes, 'Sold "as is", quickly');
});

test("the export emits no comment lines", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Retail",
    transaction: "sale", deal_date: "2025-03-14",
  }];
  assert.ok(!exportCsv(rows).split("\n").some((l) => l.startsWith("#")),
    "the template teaches; an export carries data");
});

// --- formula injection -----------------------------------------------------
//
// A cell starting with = + - @ is a FORMULA to Excel/Sheets/LibreOffice, and
// quoting does not defuse it — the quotes are gone by the time the cell is
// interpreted. Every CSV this module writes is opened in a spreadsheet by
// design (the export by the broker, the admin downloads by the owner), so a
// hostile note must never leave here executable.

test("a cell starting with a formula character is neutralized", () => {
  assert.equal(guardFormula("=HYPERLINK(\"http://evil\")"), "'=HYPERLINK(\"http://evil\")");
  assert.equal(guardFormula("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(guardFormula("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
  assert.equal(guardFormula("- great location"), "'- great location");
});

test("a plain number is never guarded — every longitude starts with a minus", () => {
  // An apostrophe on "-116.2023" would fail parseCoord on re-import and
  // strip the building's stored location.
  assert.equal(guardFormula("-116.2023"), "-116.2023");
  assert.equal(csvCell(-116.2023), "-116.2023");
  assert.equal(guardFormula("5.75"), "5.75");
});

test("digit-after-minus is not enough — the number exception matches the whole cell", () => {
  // "-2+cmd|..." starts like a number and is still a live payload.
  assert.equal(guardFormula("-2+cmd|' /C calc'!A0"), "'-2+cmd|' /C calc'!A0");
});

test("a hostile note leaves exportCsv neutralized, and the trade is the apostrophe surviving re-import", () => {
  const rows = [{
    address: "100 Main St, Boise, ID", property_type: "Retail",
    transaction: "sale", deal_date: "2025-03-14", notes: "=cmd|' /C calc'!A0",
  }];
  const out = exportCsv(rows);
  assert.ok(out.includes("'=cmd"), "the note must carry the guard in the file");
  // The accepted trade (see guardFormula's header): the apostrophe is stored
  // on re-import rather than the formula coming back to life on the next
  // export. If this assertion ever changes, the export must still never
  // round-trip back to a bare leading "=".
  assert.equal(parseUpload(out).rows[0].notes, "'=cmd|' /C calc'!A0");
});

// --- exportRowsWithCoords: the property-coordinate join --------------------
//
// The regression this guards against: Number(null) === 0 and
// Number.isFinite(0) === true, so coercing an unlocated property's lat/lng
// BEFORE checking for null reads it as a real coordinate at 0,0 — Null
// Island — which normalizeRow then refuses on re-import. A property with a
// real lat but a missing lng has the opposite failure: the missing side
// coerces to 0 and the pair re-imports cleanly as a wrong coordinate,
// silently, in the Atlantic.

test("a property with no location on file exports blank coordinates, not zero", () => {
  const comps = [{ id: "c1", property_id: "p1", address: "1 A St" }];
  const coords = new Map([["p1", { lat: null, lng: null }]]);
  const rows = exportRowsWithCoords(comps, coords);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lat, undefined);
  assert.equal(rows[0].lng, undefined);
});

test("a real coordinate pair survives the join", () => {
  const comps = [{ id: "c1", property_id: "p1", address: "1 A St" }];
  const coords = new Map([["p1", { lat: 43.6, lng: -116.2 }]]);
  const rows = exportRowsWithCoords(comps, coords);
  assert.equal(rows[0].lat, 43.6);
  assert.equal(rows[0].lng, -116.2);
});

test("a comp with no property_id exports blank coordinates", () => {
  const comps = [{ id: "c1", property_id: null, address: "1 A St" }];
  const rows = exportRowsWithCoords(comps, new Map());
  assert.equal(rows[0].lat, undefined);
  assert.equal(rows[0].lng, undefined);
});

test("the null-coordinate case round-trips cleanly back through the importer", () => {
  const comps = [{
    id: "c1", property_id: "p1", address: "100 Main St, Boise, ID",
    property_type: "Industrial", transaction: "sale", deal_date: "2025-03-14",
  }];
  const coords = new Map([["p1", { lat: null, lng: null }]]);
  const rows = exportRowsWithCoords(comps, coords);
  const parsed = parseUpload(exportCsv(rows));
  assert.equal(parsed.ok, true, parsed.errors && parsed.errors.join("; "));
  assert.equal(parsed.rows.length, 1, parsed.errors && parsed.errors.join("; "));
  assert.equal(parsed.rows[0]._lat, undefined);
});

// --- publishing ------------------------------------------------------------
//
// The one door through the privacy wall. A mistake here is either a broker's
// private comp made public, or a published comp that never actually reaches a
// report — and both fail silently.

const vaultComp = (over = {}) => ({
  address: "1234 W Mission Blvd, Ontario, CA",
  property_type: "Industrial",
  transaction: "sale",
  deal_date: "2025-03-14",
  price: 12500000,
  size_sqft: 84000,
  cap_rate: 5.75,
  notes: "Sold to an owner-user.",
  ...over,
});

test("a good comp may be published", () => {
  assert.equal(canPublish(vaultComp()).ok, true);
});

test("an unpriced comp may be KEPT but not published", () => {
  // Deliberately asymmetric. Brokers track deals whose price was never
  // disclosed, so the vault accepts them. Crediting a broker publicly for a
  // row that cannot support anyone's valuation is a different question.
  const r = canPublish(vaultComp({ price: null }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /needs a price/);
});

test("a comp with no size cannot be published", () => {
  const r = canPublish(vaultComp({ size_sqft: null }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /needs a size/);
});

test("an area estimate cannot be published as a property", () => {
  const r = canPublish(vaultComp({ address: "Inland Empire West submarket" }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /street number/);
});

test("canPublish never throws on garbage", () => {
  for (const v of [null, undefined, {}, 42, "x"]) {
    assert.doesNotThrow(() => canPublish(v));
    assert.equal(canPublish(v).ok, false);
  }
});

test("credit prefers the firm name, then a stated personal name", () => {
  assert.equal(creditName({ company: "Adler Industrial", display_name: "O K" }), "Adler Industrial");
  assert.equal(creditName({ display_name: "O Kleene" }), "O Kleene");
  assert.equal(creditName(null), "", "no name at all is empty, not a crash");
});

test("an unstated identity credits NOBODY, rather than the account's signup name", () => {
  // This used to answer "Owen" from the user row, and that fallback was the
  // bug: the publish confirm promises "credited to your firm by name", a
  // vault-first broker has no profile, so their comps were credited to
  // whatever they typed at signup — and submissionRowFrom copies that string
  // into broker_company, publishing a personal name as a firm. Nobody chose
  // it, so nobody could correct it. Empty now means the publish route
  // refuses with needs_credit_name and the vault asks once.
  assert.equal(creditName({}), "");
  assert.equal(creditName({ company: "   ", display_name: "" }), "",
    "whitespace is not a stated identity");
  // The old second argument is gone. Passing one must not resurrect it.
  assert.equal(creditName({}, { name: "Owen" }), "",
    "the account name must not reach the credit by any route");
});

// --- the stated identity itself ---------------------------------------------

test("an identity needs at least one of firm or name", () => {
  assert.equal(validateIdentity({}).ok, false);
  assert.equal(validateIdentity({ company: "  ", display_name: "\t" }).ok, false);
  assert.equal(validateIdentity(null).ok, false);
  assert.match(validateIdentity({}).error, /firm/i);
});

test("either field alone is enough, and both are kept separate", () => {
  // license_number joined the shape in 034 and is always present, always a
  // string, and empty unless given -- it is optional to SAVE and required to
  // PUBLISH, which canPublishAs answers rather than this.
  assert.deepEqual(validateIdentity({ company: "Hawkins Ridge CRE" }).identity,
    { display_name: "", company: "Hawkins Ridge CRE", license_number: "" });
  assert.deepEqual(validateIdentity({ display_name: "Chuck Hawkins" }).identity,
    { display_name: "Chuck Hawkins", company: "", license_number: "" });
  // Separate all the way down: broker-directory.js lists them independently,
  // and a firm is not a person.
  assert.deepEqual(validateIdentity({ company: "Hawkins Ridge CRE", display_name: "Chuck Hawkins" }).identity,
    { display_name: "Chuck Hawkins", company: "Hawkins Ridge CRE", license_number: "" });
});

test("identity text is trimmed, collapsed, capped and stripped of control characters", () => {
  const r = validateIdentity({ company: "  Hawkins   Ridge\tCRE  " });
  assert.equal(r.identity.company, "Hawkins Ridge CRE");
  assert.equal(validateIdentity({ company: "A".repeat(200) }).identity.company.length, 60);
  // These strings reach a public page and an admin CSV.
  const ctrl = validateIdentity({ company: "Hawkins\u0000Ridge\u001FCRE" });
  assert.equal(ctrl.identity.company, "Hawkins Ridge CRE");
});

test("a formula-shaped firm name keeps its name", () => {
  // guardFormula handles this at csvCell, the one place it can do harm. A
  // firm really called "+Plus Realty" must not be refused here.
  assert.equal(validateIdentity({ company: "+Plus Realty" }).identity.company, "+Plus Realty");
});

test("publishing capitalises the transaction, or the comp is never offered", () => {
  // fetchVerifiedComps filters `transaction=eq.Sale` / `eq.Lease`. The vault
  // stores lowercase. Copied verbatim, a sales-focused search would silently
  // never see the comp — no error, it simply never appears.
  const cred = { creditName: "X", email: "a@b.c" };
  assert.equal(submissionRowFrom(vaultComp(), cred).transaction, "Sale");
  assert.equal(submissionRowFrom(vaultComp({ transaction: "lease" }), cred).transaction, "Lease");
  assert.equal(submissionRowFrom(vaultComp({ transaction: "weird" }), cred).transaction, null);
});

test("publishing stringifies the numbers comp_submissions stores as text", () => {
  const row = submissionRowFrom(vaultComp(), { creditName: "Adler Industrial", email: "b@c.com" });
  assert.equal(typeof row.price_or_rate, "string");
  assert.equal(typeof row.size_sqft, "string");
  assert.equal(typeof row.cap_rate, "string");
  assert.equal(row.price_or_rate, "12500000");
  assert.equal(row.size_sqft, "84000");
});

test("a published row lands approved, credited, and lower-cased by email", () => {
  const row = submissionRowFrom(vaultComp(), { creditName: "Adler Industrial", email: "  Broker@Firm.COM " });
  assert.equal(row.status, "approved", "the owner chose immediate publication");
  assert.equal(row.broker_company, "Adler Industrial");
  assert.equal(row.broker_name, "Adler Industrial");
  // attachVerifiedAttribution looks a profile up by lowercased email; a stray
  // capital would silently cost the broker the link on their badge.
  assert.equal(row.broker_email, "broker@firm.com");
});

test("a published row carries no vault-only fields", () => {
  // comp_submissions is public-facing. Anything the vault knows that the
  // public form would not — the owning account, the import batch, the dedupe
  // key — must not ride along.
  const row = submissionRowFrom(
    { ...vaultComp(), user_id: "u_1", upload_id: "up_1", dedupe_key: "k", id: "c_1", published: true },
    { creditName: "X", email: "a@b.c" });
  for (const leak of ["user_id", "upload_id", "dedupe_key", "id", "published"]) {
    assert.equal(row[leak], undefined, leak + " must not reach comp_submissions");
  }
});

test("empty optional fields become null, not the string 'null'", () => {
  const row = submissionRowFrom(vaultComp({ cap_rate: null, notes: "" }), { creditName: "X", email: "a@b.c" });
  assert.equal(row.cap_rate, null);
  assert.equal(row.notes, null);
});

// --- who may wear the Verified badge ---------------------------------------
//
// The badge means a named broker vouched for the deal. It is the most trusted
// provenance a report shows, AND the entire currency the broker tier pays in.
// A badge that can appear without a broker is worth nothing to the broker who
// earned theirs — so these are the tests that protect the tier's economics,
// not just its data.

const offeredComp = (over = {}) => ({
  a: "1234 w mission blvd ontario ca", by: "Adler Industrial", id: 7, email: "b@f.com", ...over,
});

test("a comp matching an offered one keeps the badge and gains credit", () => {
  const comps = [{ address: "1234 W Mission Blvd, Ontario, CA", verified: true }];
  const r = enforceVerifiedFlags(comps, [offeredComp()]);
  assert.equal(comps[0].verified, true);
  assert.equal(comps[0].verified_by, "Adler Industrial");
  assert.equal(r.kept, 1);
  assert.equal(r.cleared, 0);
  assert.deepEqual(r.citedIds, [7]);
});

test("a badge the model invented is CLEARED", () => {
  // The actual bug: the model marks a web-search result verified despite the
  // prompt forbidding it, and it shipped to the corpus.
  const comps = [{ address: "999 Nobody Ever Submitted This St, Boise, ID", verified: true }];
  const r = enforceVerifiedFlags(comps, [offeredComp()]);
  assert.equal(comps[0].verified, false);
  assert.equal(r.cleared, 1);
});

test("badges are cleared even when NOTHING was offered", () => {
  // This is the hole. The old code returned early on an empty offered list, so
  // a search for a property type nobody has ever submitted for passed every
  // invented badge straight through. Every bad corpus row came through here.
  const comps = [
    { address: "437 E Cave, Boise, ID 83702", verified: true },
    { address: "Eagle, ID 83616 (built 1999, 1,173-5,333 SF)", verified: true },
  ];
  const r = enforceVerifiedFlags(comps, []);
  assert.equal(comps[0].verified, false);
  assert.equal(comps[1].verified, false);
  assert.equal(r.cleared, 2);
});

test("clearing a badge also strips any attribution beside it", () => {
  // A leftover verified_by would still render "via <firm>" next to a comp that
  // no longer claims to be verified — crediting a broker for someone else's row.
  const comps = [{ address: "999 Elsewhere Rd", verified: true,
                   verified_by: "Someone Else", verified_by_slug: "someone-else" }];
  enforceVerifiedFlags(comps, [offeredComp()]);
  assert.equal(comps[0].verified, false);
  assert.equal(comps[0].verified_by, undefined);
  assert.equal(comps[0].verified_by_slug, undefined);
});

test("verified is normalized to a real boolean, never left undefined", () => {
  // harvestComps writes Boolean(c.verified) into a NOT NULL-ish column; a
  // missing flag should read false, not undefined.
  const comps = [{ address: "1 A St" }, { address: "2 B St", verified: "yes" },
                 { address: "3 C St", verified: null }];
  enforceVerifiedFlags(comps, []);
  for (const c of comps) assert.equal(c.verified, false, c.address);
});

test("an offered comp with no credit name cannot confer a badge", () => {
  // attachVerifiedAttribution filters those out before calling; this pins the
  // behaviour so a future caller that forgets cannot mint anonymous badges.
  const comps = [{ address: "1234 W Mission Blvd, Ontario, CA", verified: true }];
  const r = enforceVerifiedFlags(comps, [{ a: "", by: "", id: null, email: "" }]);
  assert.equal(comps[0].verified, false);
  assert.equal(r.cleared, 1);
});

test("two returned comps matching one submission cite it once", () => {
  const comps = [
    { address: "1234 W Mission Blvd, Ontario, CA", verified: true },
    { address: "1234 W Mission Blvd, Ontario CA, Suite B", verified: true },
  ];
  const r = enforceVerifiedFlags(comps, [offeredComp()]);
  assert.deepEqual(r.citedIds, [7], "one submission, one citation");
});

test("matching is punctuation-insensitive but not promiscuous", () => {
  const offered = [offeredComp()];
  assert.ok(matchOffered("1234 W. Mission Blvd., Ontario, CA", offered));
  assert.equal(matchOffered("5678 Somewhere Else Rd, Ontario, CA", offered), null);
  // Short strings must not prefix-match their way into a badge.
  assert.equal(matchOffered("1 A", [{ a: "1 b", by: "X", id: 1, email: "" }]), null);
});

test("enforceVerifiedFlags never throws on garbage", () => {
  for (const v of [null, undefined, 42, "x", {}]) {
    assert.doesNotThrow(() => enforceVerifiedFlags(v, null));
  }
  assert.doesNotThrow(() => enforceVerifiedFlags([null, undefined, 5], [null]));
});

// --- column mapping: suggestions ------------------------------------------
//
// The module's standing rule is that we do not GUESS a broker's column names.
// Suggesting is different from guessing only because the broker confirms it
// against real sample values. The rule that keeps the difference real is the
// ambiguity rule: when two columns could be the same field, we suggest
// neither and make them choose.

test("an alias resolves to its template field", () => {
  const { mapping } = suggestMapping(["Property Address", "Sale Price", "SF"]);
  assert.equal(mapping.property_address, "address");
  assert.equal(mapping.sale_price, "price");
  assert.equal(mapping.sf, "size_sqft");
});

test("a literal template name maps to itself", () => {
  const { mapping } = suggestMapping(["address", "deal_date", "price"]);
  assert.equal(mapping.address, "address");
  assert.equal(mapping.deal_date, "deal_date");
  assert.equal(mapping.price, "price");
});

test("TWO columns claiming one field suggest NEITHER", () => {
  const { mapping, ambiguous } = suggestMapping(["Sale Price", "Purchase Price"]);
  assert.equal(mapping.sale_price, undefined);
  assert.equal(mapping.purchase_price, undefined);
  assert.ok(ambiguous.includes("price"),
    "the broker must be told which field was left for them to pick");
});

test("an exact template name beats an alias for the same field", () => {
  const { mapping, ambiguous } = suggestMapping(["price", "Sale Price"]);
  assert.equal(mapping.price, "price", "the literal column wins");
  assert.equal(mapping.sale_price, undefined);
  assert.equal(ambiguous.includes("price"), false,
    "an exact match resolves the tie rather than creating one");
});

test("an unrecognised header suggests nothing and is not an error", () => {
  const { mapping, ambiguous } = suggestMapping(["Broker Remarks 2", "address"]);
  assert.equal(mapping.broker_remarks_2, undefined);
  assert.deepEqual(ambiguous, []);
});

test("an empty header is ignored entirely", () => {
  const { mapping } = suggestMapping(["address", ""]);
  assert.equal(Object.keys(mapping).length, 1);
});

test("no alias is claimed by two different fields", () => {
  const seen = new Map();
  for (const [target, list] of Object.entries(HEADER_ALIASES)) {
    for (const a of list) {
      assert.equal(seen.has(a), false,
        `"${a}" is an alias for both ${seen.get(a)} and ${target}`);
      seen.set(a, target);
    }
  }
});

test("no alias collides with a literal field name", () => {
  for (const [target, list] of Object.entries(HEADER_ALIASES)) {
    for (const a of list) {
      assert.equal(MAPPABLE_TARGETS.includes(a), false,
        `"${a}" (alias for ${target}) is also a literal field name`);
    }
  }
});

test("suggestMapping(null) returns empty results rather than throwing", () => {
  const { mapping, ambiguous } = suggestMapping(null);
  assert.deepEqual(mapping, {});
  assert.deepEqual(ambiguous, []);
});

test("two headers normalizing to the same string mark that target ambiguous", () => {
  // Headers that normalize to "price": "price", "Price", "PRICE", "Sale Price" (if it were an alias)
  // Using two aliases that both map to price: one existing and one hypothetical
  // Actually, let's use headers that normalize to different targets to test collision.
  // Better: use two columns that normalize to the exact same string (e.g., with spaces and hyphens)
  const { mapping, ambiguous } = suggestMapping(["Sale Price", "sale-price"]);
  // Both normalize to "sale_price" which is an alias for "price"
  assert.equal(mapping.sale_price, undefined, "ambiguous alias should not be suggested");
  assert.ok(ambiguous.includes("price"), "price target should be marked ambiguous");
});

// --- column mapping: refusals ------------------------------------------------
//
// These are the cases where a mapping could put a real number in the wrong
// column. Every one refuses with a message naming the problem, in keeping with
// the module's stance everywhere else.

const HEADERS = ["Property Address", "Type", "Deal", "Closed", "Sale Price"];
const GOOD = {
  property_address: "address", type: "property_type",
  deal: "transaction", closed: "deal_date", sale_price: "price",
};

test("a complete mapping is accepted", () => {
  assert.deepEqual(validateMapping(GOOD, HEADERS), { ok: true, errors: [] });
});

test("a missing required field is refused and named", () => {
  const { property_address, ...rest } = GOOD;
  const r = validateMapping(rest, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /address/);
});

test("two columns claiming one field is refused", () => {
  const r = validateMapping({ ...GOOD, type: "price" }, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /price/);
});

test("an unknown target is refused, not ignored", () => {
  const r = validateMapping({ ...GOOD, sale_price: "profit" }, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /profit/);
});

test("a column that is not in the file is refused", () => {
  const r = validateMapping({ ...GOOD, ghost_column: "notes" }, HEADERS);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /ghost_column/);
});

test("a column mapped to nothing is normal, not an error", () => {
  const r = validateMapping(GOOD, [...HEADERS, "Listing Broker", "MLS ID"]);
  assert.equal(r.ok, true);
});

test("a non-object mapping is refused rather than treated as empty", () => {
  assert.equal(validateMapping(null, HEADERS).ok, false);
  assert.equal(validateMapping("address", HEADERS).ok, false);
});

// --- column mapping: applying it ------------------------------------------

test("mapped headers become template names and the rest are neutralised", () => {
  const out = applyHeaderMapping(
    ["property_address", "sale_price", "listing_broker"],
    { property_address: "address", sale_price: "price" }
  );
  assert.deepEqual(out, ["address", "price", "_ignored_2"]);
});

// The reason unmapped columns are RENAMED rather than left alone: a file can
// contain a literal `price` column that the broker deliberately did NOT map,
// having chosen a different one. Left as-is it would collide and the row
// builder would silently take whichever came last.
test("an unmapped column named like a field cannot shadow the mapped one", () => {
  const out = applyHeaderMapping(
    ["price", "sale_price"],
    { sale_price: "price" }
  );
  assert.deepEqual(out, ["_ignored_0", "price"]);
});

test("a mapped upload parses to the same rows as the template version", () => {
  // The address is quoted because it contains commas (like every other
  // multi-comma address literal elsewhere in this file) — an unquoted address
  // here would split into extra CSV cells and misalign every column.
  const mapped = parseUpload(
    "Property Address,Type,Deal,Closed,Sale Price\n" +
    "\"1234 W Main St, Boise, ID\",Industrial,Sale,2026-02-01,\"$2,450,000\"\n",
    { mapping: { property_address: "address", type: "property_type",
                 deal: "transaction", closed: "deal_date", sale_price: "price" } }
  );
  const template = parseUpload(
    "address,property_type,transaction,deal_date,price\n" +
    "\"1234 W Main St, Boise, ID\",Industrial,Sale,2026-02-01,\"$2,450,000\"\n"
  );
  assert.equal(mapped.ok, true, mapped.errors.join(" | "));
  assert.deepEqual(mapped.rows, template.rows);
});

test("no mapping means byte-identical behaviour to before", () => {
  const csv = "address,property_type,transaction,deal_date\n1 A St, Boise, ID,Land,Sale,2026-01-01\n";
  assert.deepEqual(parseUpload(csv, { mapping: null }), parseUpload(csv));
});

test("an invalid mapping refuses the whole upload and writes nothing", () => {
  const r = parseUpload("Foo,Bar\n1,2\n", { mapping: { foo: "price" } });
  assert.equal(r.ok, false);
  assert.equal(r.rows.length, 0);
});

// --- column mapping: inspection -------------------------------------------

// Addresses contain commas, so an unquoted one silently becomes multiple CSV
// columns and every field after it shifts. Quoted here (and below) so the
// fixture is not misleading to the next reader.
const REAL_EXPORT =
  "Property Address,Type,Deal,Closed,Sale Price,SF,Listing Broker\n" +
  "\"1234 W Main St, Boise, ID\",Industrial,Sale,2026-02-01,\"$2,450,000\",18400,Jane Doe\n" +
  "\"55 N 9th St, Boise, ID\",Industrial,Sale,2026-01-14,\"$1,100,000\",9000,\n";

test("inspection returns raw headers for display and normalised keys for mapping", () => {
  const r = inspectCsv(REAL_EXPORT);
  assert.equal(r.ok, true);
  assert.equal(r.headers[0], "Property Address");
  assert.equal(r.normalized[0], "property_address");
  assert.equal(r.rowCount, 2);
});

test("samples are real values, skipping blanks, capped at the limit", () => {
  const r = inspectCsv(REAL_EXPORT, { samples: 3 });
  assert.deepEqual(r.samples.sale_price, ["$2,450,000", "$1,100,000"]);
  assert.deepEqual(r.samples.listing_broker, ["Jane Doe"], "the blank second value is skipped");
});

test("a real export is not a clean template", () => {
  assert.equal(inspectCsv(REAL_EXPORT).cleanTemplate, false);
});

// This is the SILENT failure the mapping screen exists to catch: only four
// fields are required, so this file imports today with every size null and
// nothing saying so.
test("a file with an unrecognised column is not clean even though it would import", () => {
  const r = inspectCsv("address,property_type,transaction,deal_date,Sq Ft\n\"1 A St, Boise, ID\",Land,Sale,2026-01-01,900\n");
  assert.equal(r.cleanTemplate, false, "Sq Ft is unrecognised, so the broker must be asked");
});

test("our own template IS clean and skips the screen", () => {
  assert.equal(inspectCsv(templateCsv()).cleanTemplate, true);
});

test("the mapping screen never offers a comment line as a sample value", () => {
  // Otherwise the address column's samples read "# Required: address, ..." and
  // the row count is a dozen too high.
  const r = inspectCsv([
    "address,property_type,transaction,deal_date",
    "# Required: address, property_type, transaction, deal_date.",
    "1 Main St,Industrial,sale,2025-03-14",
  ].join("\n"));
  assert.deepEqual(r.samples.address, ["1 Main St"]);
  assert.equal(r.rowCount, 1);
});

test("a trailing empty header does not spoil cleanliness", () => {
  const r = inspectCsv("address,property_type,transaction,deal_date,\n\"1 A St, Boise, ID\",Land,Sale,2026-01-01,\n");
  assert.equal(r.cleanTemplate, true);
});

test("duplicate column names are refused, because a mapping keys on the name", () => {
  const r = inspectCsv("Price,Price\n1,2\n");
  assert.equal(r.ok, false);
  assert.match(r.error, /Price/);
});

test("an empty file is refused with a sentence", () => {
  assert.equal(inspectCsv("").ok, false);
});

// Excel writes a UTF-8 BOM on "Save as CSV". parseCsv already strips it, and
// this pins that the mapper inherits that rather than offering the broker a
// first column mysteriously named "﻿Property Address".
test("a BOM-led file inspects normally", () => {
  const r = inspectCsv("﻿Property Address,Type\n\"1 A St, Boise, ID\",Land\n");
  assert.equal(r.ok, true);
  assert.equal(r.normalized[0], "property_address");
  assert.equal(r.suggested.property_address, "address");
});

// A header with a comma in it only survives if it was quoted, and the mapping
// keys on the normalised name, so this pins that quoting is respected.
test("a quoted header carrying a comma is read as one column", () => {
  const r = inspectCsv('"Address, Full",Type\n"1 A St, Boise, ID",Land\n');
  assert.equal(r.headers.length, 2);
  assert.equal(r.normalized[0], "address_full");
});

// A header can have real content ("$") and still normalize away to nothing,
// since normalizeHeader strips every non-alphanumeric character. That used
// to make the column vanish entirely -- not shown, not mappable, not named
// in an "ignored" list -- which is exactly the silent-drop failure this
// feature exists to catch. It is not hypothetical: the comment above
// TEMPLATE_COLUMNS names "$" as a header brokers actually use for price.
test("a header that normalizes away entirely gets a synthetic, visible key rather than vanishing", () => {
  const r = inspectCsv("$,Type,Deal,Closed\n100,Land,Sale,2026-01-01\n");
  assert.equal(r.ok, true);
  assert.equal(r.headers[0], "$");
  assert.equal(r.normalized[0], "column_0");
  assert.deepEqual(r.samples.column_0, ["100"]);
});

test("a truly blank header is still excluded, and two trailing blanks do not collide", () => {
  const r = inspectCsv(
    "address,property_type,transaction,deal_date,,\n" +
    "\"1 A St, Boise, ID\",Land,Sale,2026-01-01,,\n"
  );
  assert.equal(r.ok, true);
  assert.equal(r.normalized[4], "");
  assert.equal(r.normalized[5], "");
  assert.equal(r.cleanTemplate, true, "the two blank trailing headers are not unrecognised columns");
});

test("cleanTemplate is false for a file containing a $ column", () => {
  const r = inspectCsv(
    "address,property_type,transaction,deal_date,$\n" +
    "\"1 A St, Boise, ID\",Land,Sale,2026-01-01,100\n"
  );
  assert.equal(r.cleanTemplate, false);
});

// The duplicate check must fire for a real collision INVOLVING a synthetic
// key too, not just between two ordinary header names: a "$" column's
// synthetic key is "column_0", so a file that also has a literal "column_0"
// header collides with it rather than silently importing both as one.
test("a synthetic key collides with a literal column of the same name, and is refused", () => {
  const r = inspectCsv("$,column_0\n100,200\n");
  assert.equal(r.ok, false);
  assert.match(r.error, /column_0/);
});

// --- column mapping: normalizedHeaderRow, the one shared vector ------------
//
// inspectCsv, validateMapping and parseUpload all route header normalization
// through this one function now, specifically so a mapping built against
// inspectCsv's synthetic `column_N` key is recognized end-to-end rather than
// only on the mapping screen.

test("normalizedHeaderRow: a header that normalizes to nothing gets column_<i>, a truly blank header stays empty, an ordinary header is untouched", () => {
  assert.deepEqual(
    normalizedHeaderRow(["$", "Address", "  ", "Sale Price"]),
    ["column_0", "address", "", "sale_price"]
  );
});

test("normalizedHeaderRow: two trailing blank headers do not collide with each other or with anything else", () => {
  assert.deepEqual(
    normalizedHeaderRow(["address", "property_type", "", ""]),
    ["address", "property_type", "", ""]
  );
});

// The full round trip: a broker maps a "$" column (shown on the inspection
// screen under its synthetic key) to price, and the file actually imports
// with the price landing in the right field. This is the case that was
// broken before validateMapping/parseUpload were routed through the same
// normalizedHeaderRow inspectCsv uses -- a mapping keyed on "column_0" used
// to be refused with 'The file has no column called "column_0".'
test("the full round trip: a $ column mapped through the mapping screen actually imports, price landing in price", () => {
  const rawHeaders = ["$", "Type", "Deal", "Closed", "Prop Address"];
  const csv =
    "$,Type,Deal,Closed,Prop Address\n" +
    // Quoted: the address contains commas.
    "100,Land,Sale,2026-01-01,\"1 A St, Boise, ID\"\n";
  const mapping = {
    column_0: "price",
    type: "property_type",
    deal: "transaction",
    closed: "deal_date",
    prop_address: "address",
  };

  const validated = validateMapping(mapping, rawHeaders);
  assert.equal(validated.ok, true, validated.errors.join(" | "));

  const result = parseUpload(csv, { mapping });
  assert.equal(result.ok, true, result.errors.join(" | "));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].price, 100);
  assert.equal(result.rows[0].address, "1 A St, Boise, ID");
});

// --- write payloads vs the real schema ---------------------------------------
//
// The one failure this repo has actually suffered here (CLAUDE.md, "Comp
// corpus"): PostgREST 400ing on an unknown column, silently, for weeks,
// because nothing checked the write shape against the live table. The edit
// (PATCH /api/vault/comp) and add (POST /api/vault/comp) routes in server.js
// both write `PROPS.stripCarriedKeys({ ...row })` plus a few server-set
// fields (user_id, market, and property_id on an address change) — this pins
// every key either payload can carry against broker_comps' real columns, so a
// field added here without a matching migration fails the build instead of
// 400ing a broker's edit at runtime.
//
// `lat`/`lng` (in EDITABLE_FIELDS, via TEMPLATE_COLUMNS) and `_lat`/`_lng`
// (in a fully-populated normalizeRow result) are excluded on purpose: they
// are not broker_comps columns by design (see the long comment above
// normalizeRow's coordinate handling) and are stripped by
// PROPS.stripCarriedKeys before either route ever writes the row. Excluding
// them here is not loosening the check — the route code that actually
// removes them is what makes it safe to exclude them, and vault-coordinates
// tests pin that removal directly.

function fullyPopulatedEditInput() {
  const row = {
    address: "100 Main St, Boise, ID",
    property_type: "Industrial",
    transaction: "sale",
    deal_date: "2026-03-14",
    price: "1,000,000",
    size_sqft: "10,000",
    cap_rate: "6.25%",
    tenancy: "Single",
    year_built: "1998",
    notes: "Solid building.",
    lat: "43.6",
    lng: "-116.2",
  };
  for (const key of OPTIONAL_SPEC_COLUMNS) row[key] = "x";
  return row;
}

test("every EDITABLE_FIELDS entry a route can actually write is a real broker_comps column", () => {
  const cols = migrationColumns("broker_comps");
  // lat/lng never reach the table: they ride the request as EDITABLE_FIELDS
  // entries but are lifted into _lat/_lng by normalizeRow and then stripped
  // by PROPS.stripCarriedKeys before the write. Every other EDITABLE_FIELDS
  // entry is written verbatim.
  const writable = EDITABLE_FIELDS.filter((f) => f !== "lat" && f !== "lng");
  const missing = writable.filter((f) => !cols.includes(f));
  assert.deepEqual(missing, [],
    `EDITABLE_FIELDS claims field(s) broker_comps does not have: ${missing.join(", ")}. ` +
    `A column here that the table does not have will 400 the whole write at runtime -- ` +
    `this test is the only thing standing between that and a silent production failure.`);
});

test("every key a fully-populated normalizeRow result carries is a real broker_comps column", () => {
  const cols = migrationColumns("broker_comps");
  const { ok, row, errors } = normalizeRow(fullyPopulatedEditInput());
  assert.equal(ok, true, (errors || []).join(" | "));
  // _lat/_lng are the carried, non-column keys PROPS.stripCarriedKeys removes
  // before either write route sends the row to PostgREST.
  const keys = Object.keys(row).filter((k) => k !== "_lat" && k !== "_lng");
  const missing = keys.filter((k) => !cols.includes(k));
  assert.deepEqual(missing, [],
    `normalizeRow produced field(s) broker_comps does not have: ${missing.join(", ")}. ` +
    `A column here that the table does not have will 400 the whole write at runtime -- ` +
    `this test is the only thing standing between that and a silent production failure.`);
});

test("the server-set fields the edit and add routes stamp onto every row are real broker_comps columns", () => {
  const cols = migrationColumns("broker_comps");
  // user_id and market are added by both routes; property_id is added (set to
  // null) by the edit route only, on an address change. All three are
  // assembled onto the row before the SAME write PROPS.stripCarriedKeys
  // guards, so they carry the identical risk as every EDITABLE_FIELDS column.
  const serverSet = ["user_id", "market", "property_id"];
  const missing = serverSet.filter((f) => !cols.includes(f));
  assert.deepEqual(missing, [],
    `The routes stamp field(s) broker_comps does not have: ${missing.join(", ")}. ` +
    `A column here that the table does not have will 400 the whole write at runtime -- ` +
    `this test is the only thing standing between that and a silent production failure.`);
});

// --- the first real broker file's suggestion gaps (2026-08-11) ---------------
//
// Every case here is a header the 2026-08-10 dry-run file actually carried.
// The one that matters most is "$/SF": it normalizes to bare "sf", which made
// it the SOLE claimant of the size alias, and the mapper confidently
// suggested importing $68.11 as a 68 sq ft building. A derived rate may
// claim nothing by alias.

const { isRateHeader } = require("../broker-vault");

test("rate-shaped headers are recognized on the raw string", () => {
  for (const h of ["$/SF", "$ / SF", "Price/SF", "Rent/SF/Yr", "$ per SF", "PSF", "p.s.f.", "Price per square foot"]) {
    assert.equal(isRateHeader(h), true, h + " should read as a rate");
  }
  for (const h of ["SF", "Bldg SF", "Sale Price", "Sq Ft", "RBA", ""]) {
    assert.equal(isRateHeader(h), false, h + " should not read as a rate");
  }
});

test("the dry-run file's headers now suggest correctly, and $/SF claims nothing", () => {
  const headers = ["Property Name", "Property Address", "Type", "Trans", "Close Date",
    "Sale Price", "Bldg SF", "$/SF", "Cap Rate (%)", "Yr Built", "Tenancy", "Comments"];
  const { mapping } = suggestMapping(headers);
  assert.equal(mapping.property_address, "address");
  assert.equal(mapping.type, "property_type");
  assert.equal(mapping.trans, "transaction", "Trans is a required field and must suggest");
  assert.equal(mapping.close_date, "deal_date");
  assert.equal(mapping.sale_price, "price");
  assert.equal(mapping.bldg_sf, "size_sqft", "Bldg SF is the common size header");
  assert.equal(mapping.cap_rate, "cap_rate", "the stripped (%) must not leave a stub that misses the exact match");
  assert.equal(mapping.yr_built, "year_built");
  assert.equal(mapping.comments, "notes");
  assert.equal(Object.values(mapping).includes("size_sqft") &&
    Object.entries(mapping).find(([, t]) => t === "size_sqft")[0], "bldg_sf",
    "size must come from Bldg SF, never from $/SF");
});

test("$/SF alone still suggests nothing for size", () => {
  const { mapping } = suggestMapping(["Property Address", "$/SF"]);
  assert.equal(Object.values(mapping).includes("size_sqft"), false);
});

test("a plain SF column still suggests size", () => {
  const { mapping } = suggestMapping(["Property Address", "SF"]);
  assert.equal(mapping.sf, "size_sqft");
});

test("a rate-shaped header that names our own column exactly still maps", () => {
  // "Price Per Unit" is rate-shaped AND the literal name of a real
  // multifamily column — the guard blocks alias claims only.
  const { mapping } = suggestMapping(["Price Per Unit"]);
  assert.equal(mapping.price_per_unit, "price_per_unit");
});

test("symbol suffixes normalize away without leaving underscore stubs", () => {
  assert.equal(normalizeHeader("Cap Rate (%)"), "cap_rate");
  assert.equal(normalizeHeader("Sale Price ($)"), "sale_price");
  assert.equal(normalizeHeader("Bldg  SF"), "bldg_sf");
  assert.equal(normalizeHeader("($)"), "", "a header that is ONLY symbols still vanishes to the positional key");
});

// --- no-value markers read as an empty cell ----------------------------------

test("an explicit no-value marker in a money cell reads as blank, not an error", () => {
  for (const v of ["Undisclosed", "not disclosed", "N/A", "na", "None", "Confidential", "Withheld", "-", "—"]) {
    const r = parseMoney(v);
    assert.equal(r.ok, true, v + " should read as no value");
    assert.equal(r.value, null);
  }
});

test("shorthand still gets the 1.2M advice; other text gets the undisclosed hint", () => {
  for (const v of ["1.2M", "450k", "1.5 million", "$2.3MM"]) {
    const r = parseMoney(v);
    assert.equal(r.ok, false, v + " must still be refused");
    assert.match(r.error, /1\.2M/, v + " should get the shorthand advice");
  }
  const other = parseMoney("Call broker");
  assert.equal(other.ok, false);
  assert.match(other.error, /leave the cell blank/,
    "text that is not shorthand should get the undisclosed hint, not the 1.2M advice");
});

test("no-value markers read as blank in plain numbers too", () => {
  assert.deepEqual(parseNumber("N/A"), { ok: true, value: null });
  assert.deepEqual(parseNumber("—"), { ok: true, value: null });
});

test("a sale row with an Undisclosed price imports as an unpriced deal", () => {
  const row = {
    address: "2455 E Lanark St, Meridian, ID 83642",
    property_type: "Industrial", transaction: "sale",
    deal_date: "2024-09-12", price: "Undisclosed", size_sqft: "41,000",
  };
  const r = normalizeRow(row);
  assert.equal(r.ok, true, JSON.stringify(r.errors || []));
  assert.equal(r.row.price, null);
  assert.equal(r.row.size_sqft, 41000);
});

// --- Document extract helpers ---------------------------------------------
//
// A PDF or a screenshot has to be READ, so a price can come out wrong. These
// helpers never store anything: they decide whether the bytes are a file we
// can send to the vendor, turn the model's text into an array, and classify
// each candidate through normalizeRow so the confirm table can tint a bad row
// without dropping the values the broker needs to edit.

const PDF_BYTES = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16),
]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(8),
]);
const HEIC_BYTES = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16),
]);

test("sniffExtractMedia reads the magic bytes of every accepted file", () => {
  assert.equal(sniffExtractMedia(PDF_BYTES), "application/pdf");
  assert.equal(sniffExtractMedia(PNG_BYTES), "image/png");
  assert.equal(sniffExtractMedia(JPEG_BYTES), "image/jpeg");
  assert.equal(sniffExtractMedia(WEBP_BYTES), "image/webp");
});

test("sniffExtractMedia refuses a renamed spreadsheet and anything too short", () => {
  assert.equal(sniffExtractMedia(Buffer.from("PK\x03\x04" + "x".repeat(20))), "",
    "xlsx zip magic must never reach the vendor as an image");
  assert.equal(sniffExtractMedia(Buffer.from("%PDF")), "",
    "four bytes is not a file; a truncated upload is not a PDF");
  assert.equal(sniffExtractMedia(Buffer.from("")), "");
  assert.equal(sniffExtractMedia(null), "");
});

test("sniffExtractMedia names HEIC so the refusal can, rather than calling it unknown", () => {
  // An iPhone photo is the likeliest unsupported file to arrive here, and
  // "that file isn't something we can read" would send a broker looking for a
  // fault in their comp sheet.
  assert.equal(sniffExtractMedia(HEIC_BYTES), "image/heic");
  assert.match(checkExtractFile(HEIC_BYTES).error, /HEIC/);
  assert.match(checkExtractFile(HEIC_BYTES).error, /JPEG|screenshot/);
  assert.equal(checkExtractFile(HEIC_BYTES).ok, false);
});

test("checkExtractFile passes a PDF and a screenshot, and reports the sniffed type", () => {
  assert.deepEqual(checkExtractFile(PDF_BYTES), { ok: true, mediaType: "application/pdf", error: "" });
  assert.deepEqual(checkExtractFile(PNG_BYTES), { ok: true, mediaType: "image/png", error: "" });
});

test("checkExtractFile refuses an oversize file and never reports a media type on a refusal", () => {
  const huge = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_EXTRACT_BYTES)]);
  const out = checkExtractFile(huge);
  assert.equal(out.ok, false);
  assert.equal(out.mediaType, "");
  assert.match(out.error, /too large/);
});

test("EXTRACT_MEDIA_TYPES is the intersection both vendors read, and MAX_EXTRACT_BYTES is 4 MiB", () => {
  // GIF is Anthropic-only and HEIC is Gemini-only. A file that imports on one
  // deployment and refuses on another is a bug nobody can reproduce, so the
  // list stays the intersection.
  assert.deepEqual(EXTRACT_MEDIA_TYPES,
    ["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  assert.equal(MAX_EXTRACT_BYTES, 4 * 1024 * 1024);
});

test("parseExtractJson takes a fenced array and ignores trailing junk", () => {
  const text = "```json\n[{\"address\":\"1 Main St\"}]\n```\nThanks!";
  const out = parseExtractJson(text);
  assert.equal(out.ok, true);
  assert.equal(out.rows[0].address, "1 Main St");
});

test("parseExtractJson refuses an object, a truncated array, and empty text", () => {
  assert.equal(parseExtractJson("{\"rows\":[]}").ok, false,
    "the prompt asks for an array; do not guess a wrapping object");
  assert.equal(parseExtractJson("Here: {\"rows\":[]}").ok, false,
    "prose before a wrapping object must not bypass the object check");
  assert.equal(parseExtractJson("[{\"a\":").ok, false);
  assert.equal(parseExtractJson("").ok, false);
});

test("classifyExtractRows keeps values on a failed row and drops unknown keys", () => {
  const out = classifyExtractRows([
    {
      address: "4100 W Franklin Rd, Boise ID",
      property_type: "Industrial",
      transaction: "sale",
      deal_date: "2026-03-12",
      price: "$4,250,000",
      verified: true,
      source_url: "https://example.com",
    },
    {
      address: "Meridian industrial (submarket)",
      property_type: "Industrial",
      transaction: "sale",
      price: "68.11",
    },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].error, null);
  assert.equal(out[0].values.address, "4100 W Franklin Rd, Boise ID");
  assert.equal(out[0].values.verified, undefined);
  assert.equal(out[0].values.source_url, undefined);
  assert.ok(out[1].error, "a numberless address must fail normalizeRow");
  assert.equal(out[1].values.address, "Meridian industrial (submarket)",
    "the confirm table cannot edit a value we dropped");
});

test("uploadPayloadToCsv turns confirm rows into a parseUpload-clean CSV", () => {
  const rows = [{
    address: "4100 W Franklin Rd, Boise ID",
    property_type: "Industrial",
    transaction: "sale",
    deal_date: "2026-03-12",
    price: "$4,250,000",
    size_sqft: "50000",
  }];
  const made = uploadPayloadToCsv({ rows });
  assert.equal(made.ok, true);
  const parsed = parseUpload(made.csv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].price, 4250000);
});

test("uploadPayloadToCsv refuses csv and rows together, and an empty rows array", () => {
  assert.equal(uploadPayloadToCsv({ csv: "address\n", rows: [{ address: "1 Main" }] }).ok, false);
  assert.equal(uploadPayloadToCsv({ rows: [] }).ok, false);
  assert.equal(uploadPayloadToCsv({ csv: "address,property_type,transaction,deal_date\n1 Main St,Industrial,sale,2026-01-05\n" }).ok, true);
});

test("VAULT_FIELD_KEYS is template plus optional spec, nothing else", () => {
  assert.deepEqual(VAULT_FIELD_KEYS, [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS]);
});

test("EXTRACT_KEYS is the vault fields minus lat and lng", () => {
  assert.deepEqual(EXTRACT_KEYS, [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS]
    .filter((k) => k !== "lat" && k !== "lng"));
  assert.ok(!EXTRACT_KEYS.includes("lat"));
  assert.ok(!EXTRACT_KEYS.includes("lng"));
  assert.ok(EXTRACT_KEYS.includes("address"));
  assert.ok(EXTRACT_KEYS.includes("beds_baths"));
});

test("extractVendorError maps a vendor 5xx to 502 and the spec copy, never search-outage copy", () => {
  const err = extractVendorError(500, "internal");
  assert.equal(err.statusCode, 502);
  assert.equal(err.userMessage, "Could not read that file. Nothing was saved.");
  assert.equal(err.userMessage.includes("comp search"), false);
});

test("extractVendorError maps a vendor 429 to the upload-busy line, not the search-busy line", () => {
  const err = extractVendorError(429, "resource exhausted");
  assert.equal(err.statusCode, 429);
  assert.equal(err.userMessage, "Too many uploads. Please wait a moment.");
  assert.equal(err.userMessage.includes("comp search"), false);
});

test("extractWasTruncated is true for Anthropic max_tokens and Gemini MAX_TOKENS or incomplete", () => {
  assert.equal(extractWasTruncated("max_tokens"), true);
  assert.equal(extractWasTruncated("MAX_TOKENS"), true);
  assert.equal(extractWasTruncated("incomplete"), true);
  assert.equal(extractWasTruncated("end_turn"), false);
  assert.equal(extractWasTruncated("STOP"), false);
  assert.equal(extractWasTruncated(""), false);
  assert.equal(extractWasTruncated(undefined), false);
});

// ---------------------------------------------------------------------------
// The lease side (migration 028)
//
// Until this shipped the vault only really worked for investment sales: the
// template told brokers to leave `price` blank on a lease and put the rent in
// notes as prose, so a leasing book carried no figure any median could read.
// The refusals below are the point, as everywhere else in this module — a rent
// stored against the wrong basis is a number twelve times wrong sitting in a
// broker's own records, which is precisely what nobody ever notices.
// ---------------------------------------------------------------------------

const leaseRow = (extra) => ({
  address: "100 Main St", property_type: "Office", transaction: "lease",
  deal_date: "2025-06-01", size_sqft: "12500", ...extra,
});

test("an annual rent is stored as given and annualizes to itself", () => {
  const r = normalizeRow(leaseRow({ rent_psf: "28.50", rent_basis: "annual", lease_type: "NNN" }));
  assert.equal(r.ok, true);
  assert.equal(r.row.rent_psf, 28.5);
  assert.equal(r.row.rent_basis, "annual");
  assert.equal(r.row.rent_psf_yr, 28.5);
  assert.equal(r.row.lease_type, "NNN");
});

test("a monthly rent is annualized once, on the server, into rent_psf_yr", () => {
  const r = normalizeRow(leaseRow({ rent_psf: "1.35", rent_basis: "per month" }));
  assert.equal(r.ok, true);
  assert.equal(r.row.rent_psf, 1.35, "what the broker typed is kept as typed");
  assert.equal(r.row.rent_psf_yr, 16.2, "and the canonical annual figure rides beside it");
});

// The whole reason rent_basis exists. $1.35/SF is an ordinary California
// monthly rent and an impossible annual one; defaulting either way stores a
// figure 12x wrong in the broker's own book.
test("a rent with no basis is REFUSED, never defaulted to annual", () => {
  const r = normalizeRow(leaseRow({ rent_psf: "28.50" }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /rent_basis is required/);
});

test("an unreadable basis says so once, without also claiming the column is missing", () => {
  const r = normalizeRow(leaseRow({ rent_psf: "28.50", rent_basis: "quarterly" }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /not "annual" or "monthly"/);
  assert.equal(r.errors.filter((e) => /required/.test(e)).length, 0,
    "a filled-in column must not also be reported as missing");
});

// The other way this field gets filled in wrong: the total for the space typed
// into a per-square-foot column.
test("a total rent typed into the per-SF column is refused with the reason", () => {
  const r = normalizeRow(leaseRow({ rent_psf: "356250", rent_basis: "annual" }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /too large to be a rent per square foot/);
});

test("a real Manhattan rent is not caught by that guard", () => {
  const r = normalizeRow(leaseRow({ rent_psf: "295", rent_basis: "annual" }));
  assert.equal(r.ok, true);
  assert.equal(r.row.rent_psf_yr, 295);
});

test("a rent on a SALE row is kept but never annualized into the lease median", () => {
  const r = normalizeRow(leaseRow({
    transaction: "sale", price: "12500000", rent_psf: "28.50", rent_basis: "annual",
  }));
  assert.equal(r.ok, true);
  assert.equal(r.row.rent_psf, 28.5);
  assert.equal(r.row.rent_psf_yr, null,
    "rent_psf_yr is the lease measure; a sale-leaseback must not enter the rent median");
  assert.ok(r.row.price_per_sqft > 0, "and its sale side is unaffected");
});

test("lease_type is optional — a broker who does not track it still gets their book in", () => {
  const r = normalizeRow(leaseRow({ rent_psf: "28.50", rent_basis: "annual" }));
  assert.equal(r.ok, true);
  assert.equal(r.row.lease_type, null);
});

test("lease_type vocabulary is generous about wording, strict about the result", () => {
  const t = (v) => normalizeRow(leaseRow({ rent_psf: "28.5", rent_basis: "annual", lease_type: v })).row.lease_type;
  assert.equal(t("triple net"), "NNN");
  assert.equal(t("Full Service"), "FS");
  assert.equal(t("modified gross"), "MG");
  assert.equal(normalizeRow(leaseRow({ rent_psf: "28.5", rent_basis: "annual", lease_type: "whatever" })).ok, false);
});

// isRateHeader stops a derived rate landing on a MEASURE it was divided from
// ("$/SF" importing 68.11 as a 68 sq ft building). A rent column is itself a
// rate, so the guard has to make room for it or the one header that
// unambiguously means rent could never claim rent.
test("a rate-shaped header may claim rent, but still may not claim size", () => {
  // normalizeHeader strips the "/" rather than making it a separator, so these
  // arrive as rentsfyr / rentsf. Both real headers, both rate-shaped.
  assert.equal(suggestMapping(["Address", "Rent/SF/Yr"]).mapping["rentsfyr"], "rent_psf");
  assert.equal(suggestMapping(["Address", "Rent/SF"]).mapping["rentsf"], "rent_psf");
  assert.equal(suggestMapping(["Address", "Asking Rent"]).mapping["asking_rent"], "rent_psf");

  const psf = suggestMapping(["Address", "Bldg SF", "$/SF"]);
  assert.equal(psf.mapping["sf"], undefined,
    "a $/SF column must still never be read as the building size");
  assert.equal(psf.mapping["bldg_sf"], "size_sqft",
    "and the real size column is still found beside it");
});

test("the template documents the rent columns, including why the basis is asked for", () => {
  const csv = templateCsv();
  for (const c of ["rent_psf", "rent_basis", "lease_type"]) {
    assert.ok(csv.includes(c), "the template header needs " + c);
  }
  assert.match(csv, /annual or monthly/i);
  assert.match(csv, /California/i, "the reason the basis has no default belongs on the page");
});

// comp_corpus has no rent column, and an unknown column 400s PostgREST — the
// documented shape of a silent harvest outage. submissionRowFrom is an
// explicit allowlist, so this holds by construction; the test is what keeps it
// holding when someone later reaches for a spread.
test("publishing a lease carries no rent column into the public records", () => {
  const comp = normalizeRow(leaseRow({ rent_psf: "28.50", rent_basis: "annual", lease_type: "NNN" })).row;
  const sub = submissionRowFrom(comp, { creditName: "Adler & Co", email: "b@example.com" });
  for (const k of ["rent_psf", "rent_basis", "lease_type", "rent_psf_yr"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(sub, k), false,
      k + " must not travel to comp_submissions");
  }
  assert.equal(sub.transaction, "Lease");
});

// --- who may publish, and under what name (2026-08-19) --------------------
//
// "Verified · via <firm>" is the strongest provenance a report shows and the
// entire currency the broker tier trades in. It claims a NAMED LICENSED
// broker vouched for the deal. Nothing enforced the licensed half, so anyone
// who reached a vault could make the badge say something untrue -- the owner
// included, who is not a licensed broker. Decided 2026-08-12, migration 034.

test("publishing needs a credit name AND a license number", () => {
  assert.equal(canPublishAs({ company: "Hawkins Ridge CRE", license_number: "01899123" }).ok, true);
  assert.equal(canPublishAs({ display_name: "Dana Reyes", license_number: "01899123" }).ok, true);
});

test("the credit name is refused FIRST, so an existing refusal keeps its shape", () => {
  // A broker with neither meets the message they met before this shipped,
  // and the vault turns that same code into the form that fixes it.
  const neither = canPublishAs(null);
  assert.equal(neither.ok, false);
  assert.equal(neither.code, "needs_credit_name");
  assert.match(neither.error, /credited to it/);
});

test("a credit name with no license is refused, and says which half is missing", () => {
  const g = canPublishAs({ company: "Hawkins Ridge CRE" });
  assert.equal(g.ok, false);
  assert.equal(g.code, "needs_license");
  assert.match(g.error, /license number/i);
  // The reason is stated rather than implied: the badge is a claim about a
  // person, and a broker asked for a number deserves to know what it buys.
  assert.match(g.error, /vouched/i);
});

test("a blank or whitespace license is absent, not present", () => {
  // NOT NULL DEFAULT '' in 034 means every existing profile arrives here as
  // "". Two flavours of absent is exactly how this check grows a hole.
  for (const v of ["", "   ", "\t", null, undefined]) {
    assert.equal(canPublishAs({ company: "X", license_number: v }).code, "needs_license",
      `license ${JSON.stringify(v)} must read as absent`);
  }
  assert.equal(licenseOf({ license_number: "  01899123  " }), "01899123");
  assert.equal(licenseOf(null), "");
});

test("the gate returns the name to publish under, so callers never re-derive it", () => {
  // Both publish routes take `by` from here. If they computed it themselves
  // the batch route and the single route could credit differently.
  assert.equal(canPublishAs({ company: "Hawkins Ridge CRE", display_name: "Dana Reyes",
    license_number: "01899123" }).by, "Hawkins Ridge CRE");
  assert.equal(canPublishAs({ display_name: "Dana Reyes", license_number: "01899123" }).by,
    "Dana Reyes");
});

test("saving an identity does NOT require a license, only publishing does", () => {
  // A broker sets their name the first time they open the vault and may not
  // have the number to hand. Refusing the whole save would block the credit
  // name too, and the credit name is what the page needs before it can say
  // anything useful about publishing at all.
  const saved = validateIdentity({ company: "Hawkins Ridge CRE" });
  assert.equal(saved.ok, true);
  assert.equal(saved.identity.license_number, "");
  assert.equal(canPublishAs(saved.identity).code, "needs_license");
});

test("a license number is trimmed and stripped of control characters like the rest", () => {
  const v = validateIdentity({ company: "X", license_number: " 018\u000199123 " });
  assert.equal(v.ok, true);
  assert.doesNotMatch(v.identity.license_number, /[\u0000-\u001F]/);
});

test("the profile SELECT carries license_number, or every publish refuses", () => {
  // canPublishAs reads the column off the row findBrokerProfile returns. Drop
  // it from the SELECT and the gate sees undefined on EVERY profile and
  // refuses every publish, with a message about a field the broker has
  // already filled in. Nothing else in the suite would notice.
  const fs = require("node:fs");
  const path = require("node:path");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const m = server.match(/const SELECT = "select=([^"]+)"/);
  assert.ok(m, "the broker profile SELECT must still be findable");
  assert.ok(m[1].split(",").includes("license_number"),
    `broker profile SELECT is missing license_number: ${m[1]}`);
});

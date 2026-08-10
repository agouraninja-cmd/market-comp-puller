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
  canPublish, creditName, submissionRowFrom,
  matchOffered, enforceVerifiedFlags,
  suggestMapping, HEADER_ALIASES, MAPPABLE_TARGETS,
  validateMapping, applyHeaderMapping,
  inspectCsv, normalizedHeaderRow,
  validateEdit, EDITABLE_FIELDS,
  exportColumns, exportCsv,
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

test("credit prefers the firm name, then a personal name", () => {
  assert.equal(creditName({ company: "Adler Industrial", display_name: "O K" }, { name: "Owen" }), "Adler Industrial");
  assert.equal(creditName({ display_name: "O Kleene" }, { name: "Owen" }), "O Kleene");
  assert.equal(creditName({}, { name: "Owen" }), "Owen");
  assert.equal(creditName(null, null), "", "no name at all is empty, not a crash");
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

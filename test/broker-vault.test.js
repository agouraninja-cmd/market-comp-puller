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
  templateCsv, TEMPLATE_COLUMNS, OPTIONAL_SPEC_COLUMNS, MAX_ROWS_PER_UPLOAD,
  canPublish, creditName, submissionRowFrom,
  matchOffered, enforceVerifiedFlags,
  suggestMapping, HEADER_ALIASES, MAPPABLE_TARGETS,
  validateMapping, applyHeaderMapping,
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

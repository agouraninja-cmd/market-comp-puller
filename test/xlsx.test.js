"use strict";
// The .xlsx reader, proved against real ZIP bytes.
//
// The fixtures here are BUILT, not committed: helpers/make-xlsx.js emits
// genuine local headers, a genuine central directory and genuine deflate
// streams through zlib, so these tests exercise the actual byte parsing rather
// than a stubbed-out shape. A committed binary fixture would prove the same
// thing once and then sit unreadable in the diff forever.
//
// What they CANNOT prove is that Microsoft Excel's own output parses — only a
// file from Excel does that. Every structural variation these fixtures cover
// (namespace prefixes, inline strings, gaps, stored vs deflated, sheet order)
// is one a real writer is known to produce, which is the next best thing.

const test = require("node:test");
const assert = require("node:assert");
const { readXlsxGrid, sniffSpreadsheet } = require("../xlsx.js");

// The fixture builder is shared with test/org-run.test.js, which imports the
// same Excel file through the real route. One writer, so the reader and the
// route are proved against identical bytes.
const { zip, book, WORKBOOK, RELS, SST, SHEET } = require("./helpers/make-xlsx.js");

// The ordinary case: a header row and two contacts, as shared strings.
function contactsBook() {
  const sst = ["Name", "Email", "Company", "Dana Wu", "dana@acme.co", "Acme Logistics",
    "Ray Ortiz", "ray@vero.io", "Vero Partners"].map((s) => `<si><t>${s}</t></si>`);
  const cell = (ref, idx) => `<c r="${ref}" t="s"><v>${idx}</v></c>`;
  return book(SHEET(
    `<row r="1">${cell("A1", 0)}${cell("B1", 1)}${cell("C1", 2)}</row>` +
    `<row r="2">${cell("A2", 3)}${cell("B2", 4)}${cell("C2", 5)}</row>` +
    `<row r="3">${cell("A3", 6)}${cell("B3", 7)}${cell("C3", 8)}</row>`
  ), { sst });
}

// ---------------------------------------------------------------------------

test("an ordinary sheet comes back as a grid of strings", () => {
  const { rows } = readXlsxGrid(contactsBook());
  assert.deepStrictEqual(rows.map((r) => [...r]), [
    ["Name", "Email", "Company"],
    ["Dana Wu", "dana@acme.co", "Acme Logistics"],
    ["Ray Ortiz", "ray@vero.io", "Vero Partners"],
  ]);
});

test("a Buffer, a Uint8Array and a plain array all read the same", () => {
  const buf = contactsBook();
  const a = readXlsxGrid(buf).rows.map((r) => [...r]);
  const b = readXlsxGrid(new Uint8Array(buf)).rows.map((r) => [...r]);
  const c = readXlsxGrid([...buf]).rows.map((r) => [...r]);
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a, c);
});

test("a gap in a row keeps later cells in their own columns", () => {
  // Excel omits an empty cell entirely. Without the r= attribute being read,
  // "Acme" would slide into the email column — a company filed as an address.
  const sst = ["Dana Wu", "Acme"].map((s) => `<si><t>${s}</t></si>`);
  const { rows } = readXlsxGrid(book(SHEET(
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>`
  ), { sst }));
  assert.deepStrictEqual([...rows[0]], ["Dana Wu", "", "Acme"]);
});

test("line is the real Excel row number, not the position in the grid", () => {
  // Rows 2 and 3 are blank and dropped. The surviving row is row 4 in the
  // spreadsheet the person is looking at, and that is the number a refusal has
  // to name — broker-vault.js:1158's rule, reached here from the other side.
  const sst = [`<si><t>Name</t></si>`, `<si><t>Dana Wu</t></si>`];
  const { rows } = readXlsxGrid(book(SHEET(
    `<row r="1"><c r="A1" t="s"><v>0</v></c></row>` +
    `<row r="2"><c r="A2"/></row>` +
    `<row r="3"><c r="A3" t="s"><v></v></c></row>` +
    `<row r="4"><c r="A4" t="s"><v>1</v></c></row>`
  ), { sst }));
  assert.deepStrictEqual(rows.map((r) => [...r]), [["Name"], ["Dana Wu"]]);
  assert.strictEqual(rows[0].line, 1);
  assert.strictEqual(rows[1].line, 4);
});

test("line is non-enumerable, so a row is still an ordinary array of cells", () => {
  const { rows } = readXlsxGrid(contactsBook());
  assert.deepStrictEqual(Object.keys(rows[0]), ["0", "1", "2"]);
  assert.strictEqual(JSON.parse(JSON.stringify(rows[0])).length, 3);
});

test("a string split across styled runs is joined, not truncated", () => {
  const sst = [`<si><r><t>Dana</t></r><r><t xml:space="preserve"> Wu</t></r></si>`];
  const { rows } = readXlsxGrid(book(SHEET(
    `<row r="1"><c r="A1" t="s"><v>0</v></c></row>`
  ), { sst }));
  assert.strictEqual(rows[0][0], "Dana Wu");
});

test("a phonetic guide is not appended to the value", () => {
  // Japanese Excel stores furigana alongside the text. Included, every such
  // name imports doubled.
  const sst = [`<si><t>山田</t><rPh sb="0" eb="2"><t>ヤマダ</t></rPh></si>`];
  const { rows } = readXlsxGrid(book(SHEET(
    `<row r="1"><c r="A1" t="s"><v>0</v></c></row>`
  ), { sst }));
  assert.strictEqual(rows[0][0], "山田");
});

test("inline strings, booleans, formula results and error cells", () => {
  const { rows } = readXlsxGrid(book(SHEET(
    `<row r="1">` +
    `<c r="A1" t="inlineStr"><is><t>Dana Wu</t></is></c>` +
    `<c r="B1" t="str"><v>dana@acme.co</v></c>` +
    `<c r="C1" t="b"><v>1</v></c>` +
    `<c r="D1" t="e"><v>#REF!</v></c>` +
    `<c r="E1"><v>5551234567</v></c>` +
    `</row>`
  )));
  // An error cell is emptied rather than stored: "#REF!" in a name column
  // would otherwise be filed as somebody's name.
  assert.deepStrictEqual([...rows[0]], ["Dana Wu", "dana@acme.co", "TRUE", "", "5551234567"]);
});

test("a number arrives as the digits Excel stored, uninterpreted", () => {
  // The file header's promise, pinned. 45678 is a date serial in Excel; this
  // reader must NOT turn it into one, and the vault must not adopt this reader
  // until something does.
  const { rows } = readXlsxGrid(book(SHEET(
    `<row r="1"><c r="A1"><v>45678</v></c><c r="B1"><v>1.5</v></c></row>`
  )));
  assert.deepStrictEqual([...rows[0]], ["45678", "1.5"]);
});

test("XML entities are decoded", () => {
  const sst = [`<si><t>Smith &amp; Co &lt;HQ&gt;</t></si>`, `<si><t>a&#39;b &#x2014; c</t></si>`];
  const { rows } = readXlsxGrid(book(SHEET(
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`
  ), { sst }));
  assert.deepStrictEqual([...rows[0]], ["Smith & Co <HQ>", "a'b — c"]);
});

test("namespace-prefixed tags parse", () => {
  const sheetXml = `<?xml version="1.0"?><x:worksheet><x:sheetData>` +
    `<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Dana Wu</x:t></x:is></x:c></x:row>` +
    `</x:sheetData></x:worksheet>`;
  assert.strictEqual(readXlsxGrid(book(sheetXml)).rows[0][0], "Dana Wu");
});

test("the FIRST TAB is read, not the file called sheet1", () => {
  // sheetId and file name survive reordering and deleting, so a workbook whose
  // first tab is "Contacts" can perfectly well store it as sheet3.xml. Reading
  // sheet1.xml would import the summary tab instead.
  const files = [
    { name: "xl/workbook.xml", text: WORKBOOK(["Contacts", "Summary"]) },
    { name: "xl/_rels/workbook.xml.rels", text: RELS(["worksheets/sheet3.xml", "worksheets/sheet1.xml"]) },
    { name: "xl/worksheets/sheet1.xml", text: SHEET(`<row r="1"><c r="A1" t="inlineStr"><is><t>WRONG TAB</t></is></c></row>`) },
    { name: "xl/worksheets/sheet3.xml", text: SHEET(`<row r="1"><c r="A1" t="inlineStr"><is><t>Dana Wu</t></is></c></row>`) },
  ];
  assert.strictEqual(readXlsxGrid(zip(files)).rows[0][0], "Dana Wu");
});

test("a stored (uncompressed) part reads as well as a deflated one", () => {
  const files = [
    { name: "xl/workbook.xml", text: WORKBOOK(["Sheet1"]), store: true },
    { name: "xl/_rels/workbook.xml.rels", text: RELS(["worksheets/sheet1.xml"]), store: true },
    { name: "xl/worksheets/sheet1.xml", store: true,
      text: SHEET(`<row r="1"><c r="A1" t="inlineStr"><is><t>Dana Wu</t></is></c></row>`) },
  ];
  assert.strictEqual(readXlsxGrid(zip(files)).rows[0][0], "Dana Wu");
});

test("sizes are taken from the central directory, not the local header", () => {
  // Flag bit 3 means the local header's sizes are zero and the real ones trail
  // the data. Trusting the local header yields an empty part, i.e. a
  // spreadsheet that silently looks like it has no rows.
  const files = [
    { name: "xl/workbook.xml", text: WORKBOOK(["Sheet1"]), flags: 0x8 },
    { name: "xl/_rels/workbook.xml.rels", text: RELS(["worksheets/sheet1.xml"]), flags: 0x8 },
    { name: "xl/worksheets/sheet1.xml", flags: 0x8,
      text: SHEET(`<row r="1"><c r="A1" t="inlineStr"><is><t>Dana Wu</t></is></c></row>`) },
  ];
  assert.strictEqual(readXlsxGrid(zip(files)).rows[0][0], "Dana Wu");
});

test("a zip comment does not hide the central directory", () => {
  const buf = zip([
    { name: "xl/workbook.xml", text: WORKBOOK(["Sheet1"]) },
    { name: "xl/_rels/workbook.xml.rels", text: RELS(["worksheets/sheet1.xml"]) },
    { name: "xl/worksheets/sheet1.xml", text: SHEET(`<row r="1"><c r="A1" t="inlineStr"><is><t>Dana Wu</t></is></c></row>`) },
  ], { comment: "packed by something" });
  assert.strictEqual(readXlsxGrid(buf).rows[0][0], "Dana Wu");
});

test("an empty sheet is an empty grid, not an error", () => {
  assert.deepStrictEqual(readXlsxGrid(book(SHEET(""))).rows, []);
});

// --- refusals, each by name ------------------------------------------------

test("an old .xls is refused by name", () => {
  const xls = Buffer.alloc(64);
  xls[0] = 0xd0; xls[1] = 0xcf; xls[2] = 0x11; xls[3] = 0xe0;
  assert.throws(() => readXlsxGrid(xls), (e) => {
    assert.strictEqual(e.code, "old_xls");
    assert.match(e.message, /older \.xls/i);
    assert.match(e.message, /save it as/i);   // says what to DO about it
    return true;
  });
});

test("an OpenDocument spreadsheet is refused by name", () => {
  const ods = zip([
    { name: "mimetype", text: "application/vnd.oasis.opendocument.spreadsheet", store: true },
    { name: "content.xml", text: "<office/>" },
  ]);
  assert.throws(() => readXlsxGrid(ods), (e) => e.code === "ods" && /\.ods/.test(e.message));
});

test("a password-protected spreadsheet is refused by name", () => {
  const enc = zip([
    { name: "xl/workbook.xml", text: WORKBOOK(["Sheet1"]), flags: 0x1 },
  ]);
  assert.throws(() => readXlsxGrid(enc), (e) => e.code === "encrypted" && /password/i.test(e.message));
});

test("a zip that is not a spreadsheet is refused", () => {
  const other = zip([{ name: "notes.txt", text: "hello" }]);
  assert.throws(() => readXlsxGrid(other), (e) => e.code === "not_xlsx");
});

test("a PDF, a CSV and an empty file are all refused, never half-read", () => {
  for (const junk of [Buffer.from("%PDF-1.4\n%junk"), Buffer.from("name,email\nDana,d@a.co"), Buffer.alloc(0)]) {
    assert.throws(() => readXlsxGrid(junk), (e) => e.code === "not_zip");
  }
});

test("a truncated zip is refused rather than read as empty", () => {
  const full = contactsBook();
  assert.throws(() => readXlsxGrid(full.subarray(0, full.length - 40)), (e) => /not_zip|zip64/.test(e.code));
});

test("sniffSpreadsheet reads the bytes, never the name", () => {
  assert.strictEqual(sniffSpreadsheet(contactsBook()), "zip");
  assert.strictEqual(sniffSpreadsheet(Buffer.from("name,email\n")), null);
  assert.strictEqual(sniffSpreadsheet(Buffer.alloc(2)), null);
  const xls = Buffer.alloc(16); xls[0] = 0xd0; xls[1] = 0xcf; xls[2] = 0x11; xls[3] = 0xe0;
  assert.strictEqual(sniffSpreadsheet(xls), "xls");
});

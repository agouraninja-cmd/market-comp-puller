"use strict";
// The BROWSER half of the contacts import, executed rather than read.
//
// The route tests (test/org-run.test.js) prove the server end to end, and stop
// exactly where the browser starts: deciding whether a picked file is a
// spreadsheet, and turning it into base64 without blowing up on a large one.
// Both of those live inside index.html's one big inline script, which nothing
// can require — so this file lifts the two pieces out by name and runs them.
//
// It is the same trick test/vault-page.test.js uses for a page built as a
// template literal, and for the same reason: a stray character in there emits
// broken JavaScript and a silently dead control, not a failing build.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { xlsxFromRows } = require("./helpers/make-xlsx.js");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// Lift a function declaration out of index.html by name, brace-matching so the
// nested braces inside it do not end the slice early.
function lift(name) {
  const at = HTML.indexOf("function " + name + "(");
  assert.notStrictEqual(at, -1, name + "() has been renamed or removed from index.html");
  let i = HTML.indexOf("{", at);
  let depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === "{") depth++;
    else if (HTML[i] === "}" && --depth === 0) break;
  }
  // eslint-disable-next-line no-new-func
  return new Function("return (" + HTML.slice(at, i + 1) + ")")();
}

test("toBase64 encodes exactly what the server will decode", () => {
  const toBase64 = lift("toBase64");
  const xlsx = xlsxFromRows([["Name", "Email"], ["Dana Wu", "dana@acme.co"]]);
  const encoded = toBase64(xlsx.buffer.slice(xlsx.byteOffset, xlsx.byteOffset + xlsx.byteLength));
  assert.strictEqual(encoded, xlsx.toString("base64"));
  // And the server's side of the round trip really gets the bytes back.
  assert.ok(Buffer.from(encoded, "base64").equals(xlsx));
});

test("toBase64 survives a file bigger than the argument stack", () => {
  // String.fromCharCode.apply on a whole megabyte-long array overflows and
  // throws. It only happens on a big file, which is exactly the case a quick
  // manual test never covers, so the chunking is pinned here.
  const toBase64 = lift("toBase64");
  const big = Buffer.alloc(900 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
  const encoded = toBase64(big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength));
  assert.ok(Buffer.from(encoded, "base64").equals(big));
});

test("the picker offers Excel files, and .xls too so the refusal can name it", () => {
  const input = HTML.match(/<input id="contactCsvFile"[\s\S]*?\/>/);
  assert.ok(input, "the contacts file input is gone");
  for (const token of [".csv", ".xlsx", ".xls"]) {
    assert.ok(input[0].includes(token), `the picker greys out ${token} files`);
  }
});

test("the import handler chooses its door from the BYTES, not the file name", () => {
  // A spreadsheet saved with a .csv extension must still import, and an .xls
  // must reach the server so the server can name it. Both follow from sniffing
  // the leading bytes; a name test would get both wrong.
  const handler = HTML.slice(HTML.indexOf('contactCsvFile").addEventListener("change"'));
  const body = handler.slice(0, handler.indexOf("\n  });"));
  assert.match(body, /file\.slice\(0,\s*8\)/, "it reads the leading bytes");
  assert.match(body, /0x50.*0x4b/, "it recognises a ZIP (xlsx)");
  assert.match(body, /0xd0.*0xcf/, "it recognises an OLE2 document (old .xls)");
  assert.ok(!/\.name\s*\.\s*(?:toLowerCase|endsWith|match)/.test(body),
    "it must not decide on the file name");
});

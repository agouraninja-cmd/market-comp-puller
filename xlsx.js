"use strict";
// ---------------------------------------------------------------------------
// Reading an .xlsx — the ZIP and the XML, by hand.
//
// WHY THIS FILE EXISTS AT ALL. Brokers keep lists in Excel, and until now the
// only door into the tenant contacts list was a CSV, which means asking
// somebody to do a Save As into a format they did not choose and do not think
// in. Every library that reads xlsx is an npm dependency, and this repo has
// none outside desktop-app/ (see CLAUDE.md). An .xlsx is a ZIP of XML and node
// ships zlib, so the format is reachable without one.
//
// PURE apart from `zlib`, which is a Node builtin and does no I/O: bytes in, a
// grid of strings out. No filesystem, no clock, no network. That is what lets
// npm test prove every refusal below against files it builds itself.
//
// ---------------------------------------------------------------------------
// IT READS TEXT. IT DOES NOT READ DATES, AND THAT IS THE POINT.
// ---------------------------------------------------------------------------
// Excel stores a date as a number counting days from 1900 (or from 1904 — it
// is a per-workbook setting), and whether a given number IS a date is decided
// by a format string in a different XML part. Getting that wrong turns a lease
// expiry into 1970, or into 45678, silently. This reader deliberately does
// none of it: a numeric cell comes back as the digits Excel stored.
//
// That is honest for the ONE caller it has — the firm's tenant contacts, whose
// four fields (name, email, company, notes) are all text — and it is why this
// must NOT be wired into the broker vault without doing the date work first.
// The vault is mostly dates and money, and broker-vault.js refuses "1.2M"
// rather than guess precisely because a wrong number nobody notices is worse
// than a rejected row. A date silently read as 45678 walks straight past that
// rule.
//
// ---------------------------------------------------------------------------
// IT REFUSES BY NAME. org-contacts.js's rule, and the vault extract's HEIC
// precedent: the likeliest wrong file here is a 2003-era .xls, which is not a
// ZIP at all and shares no byte with one. Told "that file could not be read",
// somebody goes looking for a fault in their contact list. Told "that is an
// older .xls", they hit Save As once and are done.
// ---------------------------------------------------------------------------

const { inflateRawSync } = require("zlib");

// A contacts sheet is a few hundred rows. This ceiling is a guard against a
// decompression bomb — a 40KB zip can inflate to gigabytes — so it is checked
// against the DECLARED uncompressed size before any inflating happens, and
// enforced again by zlib on what actually comes out.
const MAX_PART_BYTES = 24 * 1024 * 1024;
// Well above org-contacts.js's own MAX_ROWS_PER_IMPORT (2000), so the refusal
// a person reads is that one, phrased in contacts, rather than this one
// phrased in spreadsheets.
const MAX_ROWS = 20000;
const MAX_COLS = 256;

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function toBytes(bytes) {
  if (bytes == null) return new Uint8Array(0);
  if (bytes instanceof Uint8Array) return bytes;
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  if (bytes.buffer) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new Uint8Array(0);
}

// --- what kind of file is this ---------------------------------------------
// The BYTES decide, never the filename and never the browser's declared type.
// That is the vault extract's sniff rule and it is here for the same reason: a
// renamed file must not choose what gets parsed.
function sniffSpreadsheet(bytes) {
  const b = toBytes(bytes);
  if (b.length < 8) return null;
  // Old BIFF .xls (also .doc, .ppt): an OLE2 compound document.
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "xls";
  // Any ZIP: xlsx, but also .ods, .numbers, and a plain .zip. Telling those
  // apart needs the central directory, so readXlsxGrid does it.
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return "zip";
  return null;
}

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
// >>> 0 because an offset past 2GB would otherwise come back negative and
// index nothing. Such a file is refused below for being too large, but it is
// refused deliberately rather than by reading a nonsensical offset first.
const u32 = (b, i) => ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0);

function latin1(b, at, len) {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

function utf8(b) {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("utf8");
}

// --- the ZIP ---------------------------------------------------------------
// Only what an xlsx actually uses: stored and deflated entries listed in the
// central directory. Everything else is refused rather than guessed at.
function readZip(bytes) {
  const b = toBytes(bytes);
  if (b.length < 22) throw err("not_zip", "That file is empty or incomplete.");

  // The End Of Central Directory record sits at the end of the file, behind a
  // comment of up to 65535 bytes, so it is found by scanning backwards for its
  // signature rather than read from a fixed offset.
  let eocd = -1;
  const floor = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= floor; i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw err("not_zip", "That does not look like a spreadsheet file.");

  const entries = u16(b, eocd + 10);
  const cdOffset = u32(b, eocd + 16);
  // ZIP64. A contacts sheet is never 4GB or 65535 parts, so this is a corrupt
  // or exotic file rather than a format worth supporting.
  if (entries === 0xffff || cdOffset === 0xffffffff) {
    throw err("zip64", "That spreadsheet is too large or unusual to read here. Saving it as CSV will work.");
  }
  if (cdOffset >= b.length) throw err("not_zip", "That file looks damaged.");

  const files = new Map();
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) break;
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    // Sizes come from HERE and never from the local header. When flag bit 3 is
    // set the local header carries zeros and the real sizes trail the data in
    // a descriptor; reading the local ones yields an empty part, i.e. an xlsx
    // that silently looks like it has no rows in it.
    const compSize = u32(b, p + 20);
    const rawSize = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const localAt = u32(b, p + 42);
    const name = latin1(b, p + 46, nameLen);

    if (flags & 0x1) {
      throw err("encrypted", "That spreadsheet is password-protected. Remove the password, or save it as CSV.");
    }
    files.set(name, { method, compSize, rawSize, localAt });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!files.size) throw err("not_zip", "That file looks damaged.");

  const read = (name) => {
    const f = files.get(name);
    if (!f) return null;
    if (f.rawSize > MAX_PART_BYTES) throw err("too_big", "That spreadsheet is too large to read here.");
    let at = f.localAt;
    if (at + 30 > b.length || u32(b, at) !== 0x04034b50) throw err("not_zip", "That file looks damaged.");
    at += 30 + u16(b, at + 26) + u16(b, at + 28);
    const end = at + f.compSize;
    if (end > b.length) throw err("not_zip", "That file looks damaged.");
    const slice = b.subarray(at, end);
    let out;
    if (f.method === 0) out = slice;
    else if (f.method === 8) {
      try { out = inflateRawSync(slice, { maxOutputLength: MAX_PART_BYTES }); }
      catch (_) { throw err("bad_deflate", "That spreadsheet could not be opened. Saving it as CSV will work."); }
    } else {
      throw err("method", "That spreadsheet uses a compression this reader does not support. Saving it as CSV will work.");
    }
    return utf8(out);
  };

  return { files, read };
}

// --- the XML ---------------------------------------------------------------
// Regex, deliberately: these parts are machine-written by Excel against a
// fixed schema, not documents a person authored, and a real XML parser is the
// dependency this whole file exists to avoid. Every pattern tolerates a
// namespace prefix (`<x:row`), because some writers emit one and some do not.
const NS = "(?:[A-Za-z0-9]+:)?";

function decodeEntities(s) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    return Object.prototype.hasOwnProperty.call(named, e) ? named[e] : m;
  });
}

// Every <t> inside one block, joined. A single string can be split across
// styled runs — <r><t>Dana</t></r><r><t> Wu</t></r> is one cell — and taking
// only the first would import half a name. <rPh> is the phonetic guide
// Japanese Excel stores ALONGSIDE the text, so including it doubles the value.
function textOf(xml) {
  const clean = String(xml).replace(
    new RegExp("<" + NS + "rPh\\b[^>]*>[\\s\\S]*?</" + NS + "rPh>", "gi"), "");
  const re = new RegExp("<" + NS + "t\\b[^>]*?(\\/)?>([\\s\\S]*?)(?:</" + NS + "t>|$)", "gi");
  let out = "";
  let m;
  while ((m = re.exec(clean))) { if (!m[1]) out += m[2]; }
  return decodeEntities(out);
}

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = new RegExp("<" + NS + "si\\b[^>]*>([\\s\\S]*?)</" + NS + "si>", "gi");
  let m;
  while ((m = re.exec(xml))) out.push(textOf(m[1]));
  return out;
}

function textInTag(xml, tag) {
  const m = String(xml).match(
    new RegExp("<" + NS + tag + "\\b[^>]*>([\\s\\S]*?)</" + NS + tag + ">", "i"));
  return m ? m[1] : "";
}

// "BC7" -> 54. Excel NAMES its columns, so a row with a gap simply omits those
// cells; without this the cells after a gap slide left into the wrong field —
// a company filed as an email address.
function colIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

// The sheet a person means is the FIRST TAB, which is the order in
// workbook.xml — NOT sheet1.xml, whose number is an internal id that survives
// reordering and deleting. A workbook whose first tab is "Summary" and whose
// contacts sit on the second tab must not import the summary.
function firstSheetPath(book, rels) {
  let target = "";
  const sheet = book && book.match(new RegExp("<" + NS + "sheet\\b[^>]*>", "i"));
  if (sheet) {
    const rid = (sheet[0].match(/r:id\s*=\s*"([^"]+)"/i) || [])[1];
    if (rid && rels) {
      const re = /<Relationship\b[^>]*>/gi;
      let m;
      while ((m = re.exec(rels))) {
        const id = (m[0].match(/\bId\s*=\s*"([^"]+)"/i) || [])[1];
        if (id === rid) {
          target = (m[0].match(/\bTarget\s*=\s*"([^"]+)"/i) || [])[1] || "";
          break;
        }
      }
    }
  }
  if (!target) return "xl/worksheets/sheet1.xml";
  target = target.replace(/^\/+/, "");
  return /^xl\//.test(target) ? target : "xl/" + target;
}

/**
 * An .xlsx as a grid of strings.
 *
 * Rows come back shaped EXACTLY as broker-vault.js's parseCsv returns them:
 * arrays of cells, wholly blank rows dropped, each stamped with a
 * non-enumerable `line`. That is what lets one set of contacts rules serve
 * both doors without a second copy. Here `line` is the real Excel row number,
 * read off the row's own `r` attribute, so a refusal names the row the person
 * is actually looking at even when rows above it were blank.
 */
function readXlsxGrid(bytes) {
  const kind = sniffSpreadsheet(bytes);
  if (kind === "xls") {
    throw err("old_xls", "That is an older .xls file. Open it in Excel, save it as .xlsx (or as CSV), and try again.");
  }
  if (kind !== "zip") {
    throw err("not_zip", "That does not look like a spreadsheet. Excel .xlsx files and .csv files both work.");
  }

  const zip = readZip(bytes);
  if (!zip.files.has("xl/workbook.xml")) {
    // A ZIP that is not an xlsx. OpenDocument is worth naming: it is a real
    // spreadsheet somebody exported on purpose, not a mistake.
    if (zip.files.has("content.xml") || zip.files.has("mimetype")) {
      throw err("ods", "That is an OpenDocument spreadsheet (.ods). Save it as .xlsx or CSV, then try again.");
    }
    throw err("not_xlsx", "That does not look like an Excel spreadsheet. .xlsx and .csv both work.");
  }

  const strings = sharedStrings(zip.read("xl/sharedStrings.xml"));
  const path = firstSheetPath(zip.read("xl/workbook.xml"), zip.read("xl/_rels/workbook.xml.rels"));
  const sheet = zip.read(path) || zip.read("xl/worksheets/sheet1.xml");
  if (sheet == null) throw err("no_sheet", "That spreadsheet has no readable sheet in it.");

  const rows = [];
  const rowRe = new RegExp(
    "<" + NS + "row\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)</" + NS + "row>)", "gi");
  let rm;
  let fallbackLine = 0;
  while ((rm = rowRe.exec(sheet))) {
    fallbackLine += 1;
    if (rows.length >= MAX_ROWS) break;
    const declared = Number((String(rm[1]).match(/\br\s*=\s*"(\d+)"/i) || [])[1]);
    const line = Number.isFinite(declared) && declared > 0 ? declared : fallbackLine;
    const cells = [];

    const cellRe = new RegExp(
      "<" + NS + "c\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)</" + NS + "c>)", "gi");
    let cm;
    let seq = 0;
    while ((cm = cellRe.exec(rm[2] || ""))) {
      const attrs = cm[1] || "";
      const inner = cm[2] || "";
      const ref = (attrs.match(/\br\s*=\s*"([A-Za-z]+)\d*"/) || [])[1];
      const at = ref ? colIndex(ref) : seq;
      seq = at + 1;
      if (at < 0 || at >= MAX_COLS) continue;
      const type = (attrs.match(/\bt\s*=\s*"([^"]+)"/) || [])[1] || "n";

      let value = "";
      if (type === "s") {
        // The index must be DIGITS. An empty <v></v> is a blank cell, and
        // Number("") is 0 — so a looser test hands back shared string zero,
        // which in a contacts sheet is the first header. Every empty cell
        // silently imports as "Name". Found by a test, not by reading.
        const ref2 = textInTag(inner, "v").trim();
        const idx = /^\d+$/.test(ref2) ? Number(ref2) : -1;
        value = idx >= 0 && strings[idx] != null ? strings[idx] : "";
      } else if (type === "inlineStr") {
        value = textOf(inner);
      } else if (type === "b") {
        value = textInTag(inner, "v").trim() === "1" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        // #N/A, #REF! and friends. Empty rather than the error token: a cell
        // Excel could not compute holds no contact detail, and "#REF!" landing
        // in a name column would be stored as somebody's name.
        value = "";
      } else {
        // "str" (a formula's text result) and plain numbers alike — whatever
        // Excel wrote. See this file's header on why numbers stay uninterpreted.
        value = decodeEntities(textInTag(inner, "v"));
      }

      while (cells.length < at) cells.push("");
      cells[at] = value;
    }

    // parseCsv's rule, so both doors drop the same rows: a spacer line in a
    // hand-kept sheet is normal and is not an error.
    if (!cells.some((c) => String(c).trim() !== "")) continue;
    Object.defineProperty(cells, "line", { value: line, enumerable: false });
    rows.push(cells);
  }

  return { rows, sheet: path };
}

module.exports = { readXlsxGrid, sniffSpreadsheet, MAX_ROWS };

"use strict";
// Building a real .xlsx in a test.
//
// Fixtures here are BUILT rather than committed: this emits genuine local
// headers, a genuine central directory and genuine deflate streams through
// zlib, so the reader is exercised against actual bytes instead of a stubbed
// shape. A committed binary would prove the same thing once and then sit
// unreadable in every diff forever.
//
// It is a WRITER, so it is deliberately minimal and knows nothing about
// xlsx.js — if the two ever share code, a bug in the shared half would be
// invisible to every test that uses this.

const { deflateRawSync } = require("zlib");

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * A ZIP archive.
 * @param files {name, text, store?, flags?}[]
 */
function zip(files, opts = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const raw = Buffer.from(f.text, "utf8");
    const store = !!f.store;
    const data = store ? raw : deflateRawSync(raw);
    const name = Buffer.from(f.name, "utf8");
    const flags = f.flags || 0;
    // Flag bit 3: the local header carries ZEROS and the true sizes trail the
    // data. A reader taking its sizes from the local header gets an empty part.
    const zeroed = flags & 0x8;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(store ? 0 : 8, 8);
    lh.writeUInt32LE(zeroed ? 0 : crc32(raw), 14);
    lh.writeUInt32LE(zeroed ? 0 : data.length, 18);
    lh.writeUInt32LE(zeroed ? 0 : raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);

    const chunk = Buffer.concat([lh, name, data]);
    locals.push(chunk);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(store ? 0 : 8, 10);
    cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += chunk.length;
  }

  const cdBuf = Buffer.concat(central);
  const comment = Buffer.from(opts.comment || "", "utf8");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);

  return Buffer.concat([...locals, cdBuf, eocd, comment]);
}

const WORKBOOK = (sheets, { date1904 = false } = {}) =>
  `<?xml version="1.0"?><workbook>` +
  (date1904 ? `<workbookPr date1904="1"/>` : "") +
  `<sheets>` +
  sheets.map((s, i) => `<sheet name="${s}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
  `</sheets></workbook>`;

/**
 * A minimal xl/styles.xml: custom format codes by id, and <cellXfs> in order
 * so a cell's s="N" is index N of `xfs`. Written the way Excel writes it —
 * numFmts first, then the xf list — and knowing nothing of how it is read.
 */
const STYLES = ({ numFmts = {}, xfs = [0] } = {}) =>
  `<?xml version="1.0"?><styleSheet>` +
  (Object.keys(numFmts).length
    ? `<numFmts count="${Object.keys(numFmts).length}">` +
      Object.keys(numFmts).map((id) => `<numFmt numFmtId="${id}" formatCode="${esc(numFmts[id]).replace(/"/g, "&quot;")}"/>`).join("") +
      `</numFmts>`
    : "") +
  `<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>` +
  `<cellXfs count="${xfs.length}">` +
  xfs.map((id) => `<xf numFmtId="${id}" applyNumberFormat="1"><alignment/></xf>`).join("") +
  `</cellXfs></styleSheet>`;

const RELS = (targets) =>
  `<?xml version="1.0"?><Relationships>` +
  targets.map((t, i) => `<Relationship Id="rId${i + 1}" Target="${t}"/>`).join("") +
  `</Relationships>`;

const SST = (items) =>
  `<?xml version="1.0"?><sst count="${items.length}">` + items.join("") + `</sst>`;

const SHEET = (rowsXml) =>
  `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`;

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A one-sheet workbook whose sheet XML is supplied whole. `styles` is either
 * the object STYLES takes or a raw styles.xml string; `date1904` flips the
 * workbook's epoch.
 */
function book(sheetXml, { sst = [], sheetName = "xl/worksheets/sheet1.xml", styles = null, date1904 = false } = {}) {
  const files = [
    { name: "xl/workbook.xml", text: WORKBOOK(["Sheet1"], { date1904 }) },
    { name: "xl/_rels/workbook.xml.rels", text: RELS([sheetName.replace(/^xl\//, "")]) },
    { name: sheetName, text: sheetXml },
  ];
  if (sst.length) files.push({ name: "xl/sharedStrings.xml", text: SST(sst) });
  if (styles) files.push({ name: "xl/styles.xml", text: typeof styles === "string" ? styles : STYLES(styles) });
  return zip(files);
}

/**
 * The ordinary case: a grid of strings as a workbook, written the way Excel
 * writes text — shared strings, with r= references on every cell.
 *
 * `null` in a row means Excel omitted that cell entirely, which is what it
 * does for a blank; an empty row array means a blank line.
 *
 * A cell given as `{ n: 45730, s: 1 }` is written NUMERIC — `<c s="1"><v>`
 * with no `t` — which is how Excel stores a date, a price or a percent; `s`
 * indexes the `styles.xfs` list. Everything else stays a shared string.
 */
function xlsxFromRows(rows, { styles = null, date1904 = false } = {}) {
  const strings = [];
  const idOf = (s) => {
    const at = strings.indexOf(s);
    if (at >= 0) return at;
    strings.push(s);
    return strings.length - 1;
  };

  const colName = (i) => {
    let n = i + 1, out = "";
    while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
    return out;
  };

  const body = rows.map((cells, r) => {
    const line = r + 1;
    const xml = (cells || []).map((v, c) => {
      if (v == null || v === "") return "";
      if (typeof v === "object" && v.n != null) {
        const s = v.s != null ? ` s="${v.s}"` : "";
        return `<c r="${colName(c)}${line}"${s}><v>${v.n}</v></c>`;
      }
      return `<c r="${colName(c)}${line}" t="s"><v>${idOf(String(v))}</v></c>`;
    }).join("");
    return `<row r="${line}">${xml}</row>`;
  }).join("");

  return book(SHEET(body), { sst: strings.map((s) => `<si><t>${esc(s)}</t></si>`), styles, date1904 });
}

module.exports = { zip, book, xlsxFromRows, WORKBOOK, RELS, SST, SHEET, STYLES, crc32 };

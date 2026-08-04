// ---------------------------------------------------------------------------
// Minimal .xlsx writer — zero dependencies.
//
// This repo has never had an npm dependency (see CLAUDE.md) and the ledger does
// not get to be the exception. An .xlsx is a ZIP of XML parts, and Node ships
// both halves already: `zlib.deflateRawSync` for the compression and enough
// Buffer work for the ZIP container. The alternative was writing CSV and asking
// the owner to re-import it into a workbook by hand every month, which defeats
// the point of automating the fetch.
//
// Deliberately narrow: inline strings (no sharedStrings table) and one
// styles.xml written by hand. Formulas ship WITH their computed value cached
// alongside them — see cellXml(). The formula is what keeps a sheet live when
// someone types a new row; the cached value is what makes it readable anywhere
// Excel has not been given permission to calculate, which includes every
// attachment opened from an email.
// ---------------------------------------------------------------------------

const zlib = require("zlib");

// --- ZIP container ----------------------------------------------------------

// Standard CRC-32 (IEEE 802.3). Built once and reused; the ZIP central
// directory will not accept an entry without it.
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
 * files: [{ name, data: Buffer }] -> a Buffer holding the whole .xlsx.
 * Every entry is DEFLATE (method 8); timestamps are pinned so a rebuild with
 * identical data produces an identical file (nice for diffing/committing).
 */
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const name = Buffer.from(f.name, "utf8");

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // method: deflate
    local.writeUInt16LE(0, 10);           // mod time (pinned)
    local.writeUInt16LE(0x2821, 12);      // mod date (pinned: 2000-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra length
    name.copy(local, 30);

    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);      // central directory signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x2821, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);              // extra
    cd.writeUInt16LE(0, 32);              // comment
    cd.writeUInt16LE(0, 34);              // disk number
    cd.writeUInt16LE(0, 36);              // internal attrs
    cd.writeUInt32LE(0, 38);              // external attrs
    cd.writeUInt32LE(offset, 42);         // local header offset
    name.copy(cd, 46);

    locals.push(local, comp);
    central.push(cd);
    offset += local.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cdBuf, eocd]);
}

// --- XML helpers ------------------------------------------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** 1 -> "A", 27 -> "AA" */
function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// --- style ids --------------------------------------------------------------
// Indexes into cellXfs below. Exported so callers name a style instead of
// remembering a number.
const S = {
  DEFAULT: 0,
  BOLD: 1,
  MONEY: 2,
  DATE: 3,
  HEADER: 4,     // bold, white on dark fill
  PERCENT: 5,
  MONEY_BOLD: 6,
  INT: 7,
  TOTAL: 8,      // bold + top border
  MUTED: 9,      // small italic grey
  MONEY_TOTAL: 10,
  TITLE: 11,
  SUBHEAD: 12,   // bold on light fill
  ACC: 13,       // accounting: negatives in parentheses
  ACC_BOLD: 14,
  ACC_TOTAL: 15, // accounting + bold + top border
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red]-&quot;$&quot;#,##0.00"/>
<numFmt numFmtId="165" formatCode="0.0%;[Red]-0.0%"/>
<numFmt numFmtId="166" formatCode="#,##0"/>
<!-- Accounting style: negatives in parentheses, not a red minus. For the
     statement, which says so in its own header and is read by people who
     expect the convention. -->
<numFmt numFmtId="167" formatCode="&quot;$&quot;#,##0.00_);(&quot;$&quot;#,##0.00)"/>
</numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><i/><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1A2433"/><name val="Calibri"/></font>
<font><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1A2433"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDEAE3"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF9CA3AF"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<!-- The named "Normal" style is not optional in practice: without it Excel and
     openpyxl both complain the workbook has no default style. -->

<cellXfs count="16">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="167" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// --- sheet building ---------------------------------------------------------

/**
 * A cell is one of:
 *   null / undefined            -> empty
 *   { v: number, s? }           -> number
 *   { t: "s", v: string, s? }   -> inline string
 *   { f: "SUM(A1:A2)", s? }     -> formula (no cached value; Excel computes it)
 *   { d: Date, s? }             -> date
 * A bare string or number is shorthand for the string/number forms.
 */
function cellXml(ref, cell) {
  if (cell === null || cell === undefined || cell === "") return "";
  if (typeof cell === "number") cell = { v: cell };
  else if (typeof cell === "string") cell = { t: "s", v: cell };

  const s = cell.s ? ` s="${cell.s}"` : "";

  if (cell.f !== undefined) {
    // A formula MUST ship with its computed value cached alongside it. Excel only
    // recalculates when it is allowed to, and an .xlsx arriving by email opens in
    // Protected View, where calculation is disabled — so a formula with no <v>
    // renders as an empty cell and the whole sheet looks blank. fullCalcOnLoad is
    // not enough on its own; it was worth exactly nothing the first time this file
    // reached a Windows machine. The formula stays live for editing either way.
    if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
      return `<c r="${ref}"${s}><f>${esc(cell.f)}</f><v>${cell.v}</v></c>`;
    }
    if (typeof cell.v === "string") {
      return `<c r="${ref}"${s} t="str"><f>${esc(cell.f)}</f><v>${esc(cell.v)}</v></c>`;
    }
    return `<c r="${ref}"${s}><f>${esc(cell.f)}</f></c>`;
  }
  if (cell.d instanceof Date) {
    // Excel serial date: days since 1899-12-30 (its leap-year bug included).
    const serial = Math.floor(cell.d.getTime() / 86400000) + 25569;
    return `<c r="${ref}"${s}><v>${serial}</v></c>`;
  }
  if (cell.t === "s") return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
}

/**
 * sheet: { name, rows: [[cell,...],...], cols?: [width,...], freeze?: rowCount,
 *          filter?: "A1:J100" }
 */
function sheetXml(sheet) {
  const rows = sheet.rows.map((cells, i) => {
    const r = i + 1;
    const body = cells.map((c, j) => cellXml(colLetter(j + 1) + r, c)).join("");
    return body ? `<row r="${r}">${body}</row>` : `<row r="${r}"/>`;
  }).join("");

  const cols = sheet.cols
    ? `<cols>${sheet.cols.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";

  const freeze = sheet.freeze
    ? `<pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";

  const filter = sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${rows}</sheetData>
${filter}
</worksheet>`;
}

/** sheets: [{ name, rows, cols?, freeze?, filter? }] -> Buffer */
function workbook(sheets) {
  const files = [];

  files.push({
    name: "[Content_Types].xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`,
  });

  files.push({
    name: "_rels/.rels",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });

  files.push({
    name: "xl/workbook.xml",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) =>
  `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
<calcPr calcId="0" fullCalcOnLoad="1"/>
</workbook>`,
  });

  files.push({
    name: "xl/_rels/workbook.xml.rels",
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });

  files.push({ name: "xl/styles.xml", data: STYLES });

  sheets.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) });
  });

  return zip(files);
}

module.exports = { workbook, colLetter, S };

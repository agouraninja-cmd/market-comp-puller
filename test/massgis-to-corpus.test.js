// scripts/massgis-to-corpus.js: MassGIS assessor tables -> closed-sale rows the
// accuracy lab can score.
//
// Run: npm test
//
// What would go wrong silently, so it is pinned here:
//
//   * an owner's name reaching the output (the assessor table names every
//     owner, and this file's rows get passed around);
//   * a $1 family transfer, or one deed's price repeated across the parcels it
//     conveyed, being scored as a building's own closed price;
//   * a row the backtest cannot read, which it would count as "unusable" and
//     carry on, leaving a smaller answer key than the one that was built.
//
// The table and the zip are built here, byte by byte, so nothing is downloaded.

const test = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");

const M = require("../scripts/massgis-to-corpus");
const BACKTEST = require("../backtest");
const { parseDealDate } = require("../deal-date");

// A dBASE III table from field specs and row objects.
function makeDbf(fields, rows) {
  const recordLen = 1 + fields.reduce((n, f) => n + f.len, 0);
  const headerLen = 32 + fields.length * 32 + 1;
  const buf = Buffer.alloc(headerLen + rows.length * recordLen, 0x20);
  buf.fill(0, 0, headerLen);
  buf[0] = 0x03;
  buf.writeUInt32LE(rows.length, 4);
  buf.writeUInt16LE(headerLen, 8);
  buf.writeUInt16LE(recordLen, 10);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    buf.write(f.name, o, "latin1");
    buf[o + 11] = 0x43;
    buf[o + 16] = f.len;
  });
  buf[headerLen - 1] = 0x0d;
  rows.forEach((r, i) => {
    let o = headerLen + i * recordLen;
    buf[o] = r.__deleted ? 0x2a : 0x20;
    o += 1;
    fields.forEach((f) => {
      buf.write(String(r[f.name] == null ? "" : r[f.name]).slice(0, f.len), o, "utf8");
      o += f.len;
    });
  });
  return buf;
}

// A one-member zip, deflated, the way a town archive stores its table.
function makeZip(name, data) {
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = 30 + nameBuf.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12);
  end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, end]);
}

const FIELDS = [
  { name: "LS_DATE", len: 8 }, { name: "LS_PRICE", len: 10 }, { name: "LS_BOOK", len: 16 },
  { name: "LS_PAGE", len: 14 }, { name: "USE_CODE", len: 4 }, { name: "SITE_ADDR", len: 80 },
  { name: "CITY", len: 25 }, { name: "OWNER1", len: 80 }, { name: "TOTAL_VAL", len: 10 },
  { name: "YEAR_BUILT", len: 5 }, { name: "BLD_AREA", len: 10 }, { name: "UNITS", len: 5 },
];

let page = 100;
const parcel = (over) => Object.assign({
  LS_DATE: "20240315", LS_PRICE: "2000000", LS_BOOK: "40000", LS_PAGE: String(page++),
  USE_CODE: "3400", SITE_ADDR: "100 HANCOCK ST", CITY: "QUINCY", OWNER1: "SECRET OWNER LLC",
  TOTAL_VAL: "1900000", YEAR_BUILT: "1984", BLD_AREA: "10000", UNITS: "0",
}, over || {});

test("reads a .dbf: trims padding, skips deleted records, decodes only the fields asked for", () => {
  const buf = makeDbf(FIELDS, [parcel(), parcel({ __deleted: true }), parcel({ SITE_ADDR: "5 ELM ST" })]);
  const all = M.parseDbf(buf);
  assert.equal(all.rows.length, 2);
  assert.equal(all.rows[1].SITE_ADDR, "5 ELM ST");
  assert.ok(all.fields.includes("OWNER1"));
  const kept = M.parseDbf(buf, M.KEEP);
  assert.equal(kept.rows[0].LS_PRICE, "2000000");
  assert.equal(kept.rows[0].OWNER1, undefined, "an owner field is never decoded");
});

test("no owner field is on the list that is read, and none reaches the CSV", () => {
  assert.deepEqual(M.KEEP.filter((k) => /^OWN/i.test(k)), []);
  const { rows } = M.convert(M.parseDbf(makeDbf(FIELDS, [parcel()]), M.KEEP).rows);
  assert.equal(rows.length, 1);
  assert.ok(!/SECRET/i.test(M.toCsv(rows)));
});

test("pulls the Assess table out of a town zip by its name", () => {
  const dbf = makeDbf(FIELDS, [parcel()]);
  const zip = makeZip("L3_SHP_M243_Quincy/M243Assess_CY26_FY27.dbf", dbf);
  const entries = M.zipEntries(zip);
  assert.equal(entries.length, 1);
  assert.ok(M.zipRead(zip, entries[0]).equals(dbf));
  assert.throws(() => M.zipEntries(Buffer.from("not a zip at all, just some text")), /not a zip/);
});

test("use codes: the first three digits decide, and only the plain ones count", () => {
  assert.equal(M.typeOfUseCode("3400"), "Office");
  assert.equal(M.typeOfUseCode("340"), "Office");
  assert.equal(M.typeOfUseCode("3401"), "Office", "a town's own fourth character (office condo)");
  assert.equal(M.typeOfUseCode("1120"), "Multifamily");
  assert.equal(M.typeOfUseCode("401"), "Industrial");
  assert.equal(M.typeOfUseCode("3250"), "Retail");
  assert.equal(M.typeOfUseCode("1010"), null, "a single-family house");
  assert.equal(M.typeOfUseCode("3260"), null, "a restaurant is not priced by the square foot");
  assert.equal(M.typeOfUseCode("013C"), null);
  assert.equal(M.typeOfUseCode(""), null);
});

test("a good sale becomes a corpus-shaped public-record row", () => {
  const { rows, drops } = M.convert([parcel()]);
  assert.deepEqual(rows[0], {
    address: "100 Hancock St, Quincy, MA",
    market: "Quincy, MA",
    property_type: "Office",
    transaction: "Sale",
    deal_date: "2024-03",
    size_sqft: "10000",
    price_or_rate: "$2,000,000",
    price_per_sqft: "200.00",
    year_built: "1984",
    units: "",
    source_type: "public_record",
    source_name: "MassGIS assessor table (last sale)",
    verified: "",
  });
  assert.equal(Object.values(drops).reduce((a, b) => a + b, 0), 0);
});

test("each thing that is not a building's own closed price is dropped, and counted by reason", () => {
  const { rows, drops } = M.convert([
    parcel({ USE_CODE: "1010" }),                                   // a house
    parcel({ LS_PRICE: "0" }),                                      // never sold
    parcel({ LS_DATE: "" }),
    parcel({ LS_DATE: "20150601" }),                                // before --since
    parcel({ LS_PRICE: "1", TOTAL_VAL: "1" }),                      // a $1 transfer
    parcel({ BLD_AREA: "0" }),
    parcel({ SITE_ADDR: "HANCOCK ST" }),                            // no street number
    parcel({ LS_BOOK: "50000", LS_PAGE: "1" }),                     // one deed,
    parcel({ LS_BOOK: "50000", LS_PAGE: "1", USE_CODE: "3370" }),   // ...two parcels
    parcel({ LS_PRICE: "500000", TOTAL_VAL: "5000000" }),           // a tenth of its value
    parcel({ BLD_AREA: "500", TOTAL_VAL: "0" }),                    // $4,000/SF
  ]);
  assert.equal(rows.length, 0);
  assert.deepEqual(drops, { otherUse: 2, noSale: 2, tooOld: 1, belowFloor: 1, noSize: 1, noAddress: 1,
    multiParcel: 1, offAssessment: 1, offPsf: 1 });
});

test("a deed with no book and page is matched on its date and price instead", () => {
  const two = [
    parcel({ LS_BOOK: "", LS_PAGE: "", SITE_ADDR: "1 A ST" }),
    parcel({ LS_BOOK: "", LS_PAGE: "", SITE_ADDR: "3 A ST" }),
  ];
  assert.equal(M.convert(two).drops.multiParcel, 2);
});

test("--since and the price floor move with their options", () => {
  const old = parcel({ LS_DATE: "20150601" });
  assert.equal(M.convert([old]).rows.length, 0);
  assert.equal(M.convert([old], { since: "2015-01" }).rows.length, 1);
  const small = parcel({ LS_PRICE: "150000", TOTAL_VAL: "150000", BLD_AREA: "1000" });
  assert.equal(M.convert([small]).rows.length, 1);
  assert.equal(M.convert([small], { minPrice: 200000 }).rows.length, 0);
});

test("the backtest reads every row it is handed, as ground truth", () => {
  const parcels = [];
  for (let i = 0; i < 6; i++) {
    parcels.push(parcel({
      SITE_ADDR: (100 + i * 10) + " HANCOCK ST",
      LS_DATE: "2024" + String(i + 1).padStart(2, "0") + "15",
      LS_PRICE: String(2000000 + i * 137000),
      BLD_AREA: String(10000 + i * 900),
    }));
  }
  const { rows } = M.convert(parcels);
  assert.equal(rows.length, 6);
  const res = BACKTEST.score(rows, { parseDealDate, minSubjects: 1 });
  assert.equal(res.skipped.unusable, 0);
  assert.equal(res.skipped.notGroundTruth, 0);
  assert.ok(res.scored >= 1,"at least the latest sales have three earlier peers");
});

test("CSV: the header is the column list, and a comma inside a cell is quoted", () => {
  const csv = M.toCsv(M.convert([parcel()]).rows);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], M.COLUMNS.join(","));
  assert.ok(lines[1].startsWith('"100 Hancock St, Quincy, MA","Quincy, MA",Office,Sale,2024-03,10000,"$2,000,000",200.00'));
});

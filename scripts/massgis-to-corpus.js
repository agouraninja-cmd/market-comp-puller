#!/usr/bin/env node
// ---------------------------------------------------------------------------
// MassGIS parcels -> an answer key of CLOSED sales for the accuracy lab.
//
//   node scripts/massgis-to-corpus.js L3_SHP_M243_QUINCY.zip > quincy.csv
//   node scripts/massgis-to-corpus.js quincy.zip worcester.zip --since 2021-01 > ma.csv
//   node scripts/accuracy-lab.js ma.csv
//
// WHY THIS EXISTS. The accuracy lab can rank two versions of the valuation
// math against each other, but it could not say how far either is from a
// closed price: Idaho is a non-disclosure state, most `listing` rows from the
// first months are asking prices, and the whole corpus held fewer than ten
// public-record sales (corpus.md, "The answer key is weaker than it looks").
// Massachusetts publishes sale prices. MassGIS's standardized assessor table
// carries each parcel's LAST SALE (LS_DATE, LS_PRICE) beside its use code,
// building area and year built, free, one zip per town:
//   https://www.mass.gov/info-details/massgis-data-property-tax-parcels
// (the per-town links are that page's "download links table").
//
// WHAT IT WRITES. Rows shaped like the corpus export (`/api/comp-corpus`), so
// the lab and backtest.js read them unchanged, tiered `public_record`.
//
// WHAT IT IS NOT. Nothing here is on a request path, nothing is uploaded, and
// NOTHING IS WRITTEN TO THE CORPUS: this is a bench input. Putting these rows
// in front of customers is a separate decision with its own questions (a
// last-sale snapshot ages, and a report would need to say where the row came
// from). The assessor table also names every OWNER; those fields are never
// read into a row and never written.
//
// FOUR THINGS TO KNOW BEFORE TRUSTING A NUMBER BUILT ON IT
//
//   1. It is the LAST sale only. A building sold in 2021 and again in 2025
//      shows 2025; the 2021 price is gone. Fine for an answer key, thin for
//      a time series.
//   2. The table does not say whether a sale was arm's length. A $1 transfer
//      between relatives and a foreclosure deed sit beside real trades, so
//      three filters stand in: a price floor, the price against the
//      assessor's own value (Massachusetts assesses at full cash value, so a
//      real sale lands near it), and a $/SF sanity range. Every drop is
//      counted on stderr, by reason.
//   3. One deed can convey several parcels, and the table repeats the WHOLE
//      price on each. Rows sharing a book and page (or a date and price) are
//      dropped together: none of them holds that building's own price.
//   4. Building area is whatever that assessor recorded (gross, adjusted or
//      finished; the standard allows all three), so $/SF is comparable within
//      a town and looser between towns. The lab pools by market, which is
//      the town.
//
// No coordinates: the assess table has none (they are in the parcel polygons,
// in State Plane metres), so the lab's distance variants cannot move on these
// rows.
// ---------------------------------------------------------------------------

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---- reading a .dbf ---------------------------------------------------------

// dBASE III, which is what a shapefile's attribute table is: a 32-byte header,
// 32 bytes per field ending at 0x0D, then fixed-width records each led by a
// delete flag ("*" = deleted). Every value is text padded with spaces.
// `keep` limits which fields are decoded, which is also how owner fields stay
// unread.
function parseDbf(buf, keep) {
  if (!buf || buf.length < 33) throw new Error("not a .dbf file (too short)");
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields = [];
  let offset = 1;
  for (let o = 32; o + 32 <= headerLen && buf[o] !== 0x0d; o += 32) {
    const name = buf.toString("latin1", o, o + 11).replace(/\0[\s\S]*$/, "");
    const len = buf[o + 16];
    fields.push({ name, offset, len });
    offset += len;
  }
  const wanted = fields.filter((f) => !keep || keep.indexOf(f.name) >= 0);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const start = headerLen + i * recordLen;
    if (start + recordLen > buf.length) break;
    if (buf[start] === 0x2a) continue;
    const r = {};
    for (const f of wanted) r[f.name] = buf.toString("utf8", start + f.offset, start + f.offset + f.len).trim();
    rows.push(r);
  }
  return { fields: fields.map((f) => f.name), rows };
}

// ---- reading it out of the town zip -----------------------------------------

// Enough zip to pull one member out of a MassGIS town archive: find the end
// record, walk the central directory, inflate. No zip64, which a town file
// never needs; the statewide archive does, and is refused by name below.
function zipEntries(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("not a zip file");
  const total = buf.readUInt16LE(end + 10);
  let o = buf.readUInt32LE(end + 16);
  if (o === 0xffffffff || total === 0xffff) {
    throw new Error("zip64 archive (the statewide file?). Use the per-town zips, or unzip it and pass the Assess .dbf.");
  }
  const out = [];
  for (let i = 0; i < total && buf.readUInt32LE(o) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(o + 10);
    const csize = buf.readUInt32LE(o + 20);
    const nameLen = buf.readUInt16LE(o + 28);
    const extraLen = buf.readUInt16LE(o + 30);
    const commentLen = buf.readUInt16LE(o + 32);
    const local = buf.readUInt32LE(o + 42);
    const name = buf.toString("utf8", o + 46, o + 46 + nameLen);
    out.push({ name, method, csize, local });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(buf, entry) {
  const o = entry.local;
  if (buf.readUInt32LE(o) !== 0x04034b50) throw new Error("zip: bad local header for " + entry.name);
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error("zip: unsupported compression in " + entry.name);
}

// The assess table is "M243Assess_CY26_FY27.dbf": the town id, the word, the
// vintage. Matched on the word, since the rest changes every year.
function assessDbfFrom(file) {
  const buf = fs.readFileSync(file);
  if (/\.dbf$/i.test(file)) return buf;
  const hit = zipEntries(buf).filter((e) => /assess[^/]*\.dbf$/i.test(e.name));
  if (!hit.length) throw new Error("no Assess .dbf inside " + path.basename(file));
  return zipRead(buf, hit[0]);
}

// ---- which parcels, and as what ---------------------------------------------

// The Department of Revenue's property type classification codes. Towns append
// a fourth character of their own (Quincy's "3401" is an office condo), so
// only the first three digits are read. Deliberately NARROW: only the codes
// that are plainly one of our four types. A bank, a restaurant, a gas station
// or a mixed-use block has a price that is mostly not about its square feet,
// and a wrong type here would grade the math on pairings no report makes
// (the Boise mobile-home lesson, corpus.md).
const USE_TYPES = {
  111: "Multifamily", // apartments, four to eight units
  112: "Multifamily", // apartments, more than eight units
  316: "Industrial",  // other storage, warehouse and distribution
  400: "Industrial",  // buildings for manufacturing operations
  401: "Industrial",  // warehouses for storage of manufactured products
  322: "Retail",      // discount, junior department and department stores
  323: "Retail",      // shopping centers and malls
  324: "Retail",      // supermarkets
  325: "Retail",      // small retail and services stores
  340: "Office",      // general office buildings
  342: "Office",      // medical office buildings
  343: "Office",      // office condominiums (DOR's own code; some towns use 340x)
};

function typeOfUseCode(code) {
  const three = String(code || "").trim().slice(0, 3);
  return /^\d{3}$/.test(three) ? (USE_TYPES[Number(three)] || null) : null;
}

const DEFAULTS = {
  since: "2020-01",     // LS_DATE on or after, YYYY-MM
  minPrice: 100000,
  // Sale price over the assessor's CURRENT total value. Wide on purpose: the
  // value is this fiscal year's and the sale may be five years old.
  ratioLow: 0.4,
  ratioHigh: 2.5,
  psfLow: 20,
  psfHigh: 2000,
};

const KEEP = ["LS_DATE", "LS_PRICE", "LS_BOOK", "LS_PAGE", "USE_CODE", "SITE_ADDR", "ADDR_NUM",
  "FULL_STR", "CITY", "TOTAL_VAL", "YEAR_BUILT", "BLD_AREA", "UNITS"];

// "353 SOUTHERN ARTERY" -> "353 Southern Artery". Assessors type in capitals.
function titleCase(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/(^|[\s\-/])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

function num(v) {
  const n = Number(String(v == null ? "" : v).trim());
  return Number.isFinite(n) ? n : 0;
}

// One deed, several parcels: the table repeats the whole price on each.
function deedKey(r) {
  const book = String(r.LS_BOOK || "").trim(), page = String(r.LS_PAGE || "").trim();
  if (book && page) return "b:" + book + "/" + page;
  return "d:" + r.LS_DATE + "/" + r.LS_PRICE;
}

// Assess rows -> corpus-shaped rows, plus why each dropped row was dropped.
function convert(rows, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const sinceKey = String(o.since).replace("-", "");
  const drops = { otherUse: 0, noSale: 0, tooOld: 0, belowFloor: 0, noSize: 0, noAddress: 0,
    multiParcel: 0, offAssessment: 0, offPsf: 0 };

  // Counted over EVERY row with a sale, of any use: a deed that also conveyed
  // the parking lot next door is still not this building's own price.
  const deeds = new Map();
  rows.forEach((r) => {
    if (!(num(r.LS_PRICE) > 0) || !/^\d{8}$/.test(String(r.LS_DATE || ""))) return;
    const k = deedKey(r);
    deeds.set(k, (deeds.get(k) || 0) + 1);
  });

  const out = [];
  rows.forEach((r) => {
    const type = typeOfUseCode(r.USE_CODE);
    if (!type) { drops.otherUse += 1; return; }
    const date = String(r.LS_DATE || "");
    const price = num(r.LS_PRICE);
    if (!/^\d{8}$/.test(date) || !(price > 0)) { drops.noSale += 1; return; }
    if (date.slice(0, 6) < sinceKey) { drops.tooOld += 1; return; }
    if (price < o.minPrice) { drops.belowFloor += 1; return; }
    const sf = num(r.BLD_AREA);
    if (!(sf > 0)) { drops.noSize += 1; return; }
    const street = String(r.SITE_ADDR || "").trim() || [r.ADDR_NUM, r.FULL_STR].filter(Boolean).join(" ").trim();
    const city = String(r.CITY || "").trim();
    if (!/^\d/.test(street) || !city) { drops.noAddress += 1; return; }
    if (deeds.get(deedKey(r)) > 1) { drops.multiParcel += 1; return; }
    const assessed = num(r.TOTAL_VAL);
    if (assessed > 0) {
      const ratio = price / assessed;
      if (ratio < o.ratioLow || ratio > o.ratioHigh) { drops.offAssessment += 1; return; }
    }
    const psf = price / sf;
    if (psf < o.psfLow || psf > o.psfHigh) { drops.offPsf += 1; return; }
    const year = num(r.YEAR_BUILT);
    const units = num(r.UNITS);
    out.push({
      address: titleCase(street) + ", " + titleCase(city) + ", MA",
      market: titleCase(city) + ", MA",
      property_type: type,
      transaction: "Sale",
      deal_date: date.slice(0, 4) + "-" + date.slice(4, 6),
      size_sqft: String(Math.round(sf)),
      price_or_rate: "$" + Math.round(price).toLocaleString("en-US"),
      price_per_sqft: (Math.round(psf * 100) / 100).toFixed(2),
      year_built: year >= 1700 && year <= 2100 ? String(year) : "",
      units: units > 0 ? String(units) : "",
      source_type: "public_record",
      source_name: "MassGIS assessor table (last sale)",
      verified: "",
    });
  });
  return { rows: out, drops };
}

const COLUMNS = ["address", "market", "property_type", "transaction", "deal_date", "size_sqft",
  "price_or_rate", "price_per_sqft", "year_built", "units", "source_type", "source_name", "verified"];

function toCsv(rows) {
  const cell = (v) => {
    const s = String(v == null ? "" : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [COLUMNS.join(",")].concat(rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))).join("\n") + "\n";
}

// ---- main -------------------------------------------------------------------

function main(argv) {
  const files = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") opts.since = argv[++i];
    else if (a === "--min-price") opts.minPrice = Number(argv[++i]);
    else if (a === "--help" || a === "-h") files.length = 0, argv.length = 0;
    else files.push(a);
  }
  if (opts.since != null && !/^(19|20)\d{2}-\d{2}$/.test(String(opts.since))) {
    console.error("--since takes YYYY-MM"); process.exit(2);
  }
  if (!files.length) {
    console.error("usage: node scripts/massgis-to-corpus.js <town.zip | Assess.dbf> [...] [--since YYYY-MM] [--min-price N] > out.csv");
    process.exit(2);
  }
  let all = [];
  files.forEach((f) => {
    const { rows } = parseDbf(assessDbfFrom(f), KEEP);
    const res = convert(rows, opts);
    all = all.concat(res.rows);
    const d = res.drops;
    const byType = {};
    res.rows.forEach((r) => { byType[r.property_type] = (byType[r.property_type] || 0) + 1; });
    console.error(path.basename(f) + ": " + rows.length + " parcels -> " + res.rows.length + " sales  " +
      JSON.stringify(byType));
    console.error("  dropped: other use " + d.otherUse + ", no sale " + d.noSale + ", before --since " + d.tooOld +
      ", under the price floor " + d.belowFloor + ", no building area " + d.noSize + ", no street address " + d.noAddress +
      ", several parcels on one deed " + d.multiParcel + ", far from assessed value " + d.offAssessment +
      ", $/SF out of range " + d.offPsf);
  });
  process.stdout.write(toCsv(all));
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseDbf, zipEntries, zipRead, typeOfUseCode, convert, toCsv, titleCase, COLUMNS, DEFAULTS, KEEP };

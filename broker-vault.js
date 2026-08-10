// ---------------------------------------------------------------------------
// Broker vault — reading a broker's spreadsheet into rows we will store.
//
// Plan: docs/superpowers/plans/2026-08-05-broker-vault-v1.md
//
// PURE, like entitlements.js and comp-gate.js: no I/O, no requires, no clock
// reads. That is what lets `npm test` exercise every parsing edge case with no
// database, no server and no fixture files — which matters more here than
// anywhere else in the repo, because this code decides what a paying broker's
// private records actually say. A misparsed column is a wrong number in
// somebody's book of business, and they will check the first one.
//
// Two rules shape everything below:
//
//   1. REJECT, NEVER GUESS. A row we cannot read with certainty is reported
//      back to the broker by line number, not stored with a best effort. The
//      site already takes this stance on the display side (displayMoney
//      refuses ambiguous strings rather than risk a wrong number); an import
//      is the same bet with worse consequences, because the wrong number then
//      persists.
//
//   2. NOTHING HERE THROWS. A broker's spreadsheet is untrusted input arriving
//      over HTTP. Every function returns null or an error string on garbage,
//      so a malformed file is a readable message and never a 500.
//
// NOT here, deliberately: the `market` value. It must be computed with
// server.js's own marketOf() and no other parse, because broker_comps.market
// has to agree byte for byte with comp_corpus.market for a published comp to
// land without translation. A second copy of that parse in this file would be
// a second thing to keep in sync, and the repo already has one such pair
// (compWeight) carrying a warning comment. server.js attaches it.
// ---------------------------------------------------------------------------

// The downloadable template's header row, in order. A broker fills this in;
// we do not try to guess what their own column names meant. See the plan's
// decision 2 for why: "Sale Price", "Price", "$" and "Consideration" all mean
// the same thing, and a wrong guess puts the price in the size column.
const TEMPLATE_COLUMNS = [
  "address",
  "property_type",
  "transaction",
  "deal_date",
  "price",
  "size_sqft",
  "cap_rate",
  "tenancy",
  "year_built",
  "notes",
  // Optional, and last on purpose: the four required columns lead, and a
  // broker skimming the header should not meet two fields they may not have
  // before they meet the ones they must. Many CRM and MLS exports carry these
  // already. Supplying them means the property's address is never sent out to
  // be geocoded — see migration 017 and the spec it names.
  "lat",
  "lng",
];

// Per-type spec columns a broker may optionally include. Same names as
// TYPE_COMP_FIELDS in server.js and the same columns as comp_corpus, so a
// published comp needs no translation.
const OPTIONAL_SPEC_COLUMNS = [
  "clear_height", "dock_doors",
  "building_class", "floor_plate",
  "center_type", "anchor_tenant",
  "units", "price_per_unit",
  "lot_acres", "price_per_acre", "zoning",
  "beds_baths",
];

const PROPERTY_TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];

// Free-text fields are capped rather than rejected — length is not a
// correctness question, and truncating a note is not the same class of error
// as misreading a price.
const MAX_TEXT = 500;
const MAX_SHORT_TEXT = 60;

// A ceiling on one import. Not a licensing limit — a guard against a runaway
// file turning one HTTP request into a hundred thousand inserts.
const MAX_ROWS_PER_UPLOAD = 5000;

// --- CSV ---------------------------------------------------------------------

/**
 * A CSV reader that handles the three things real spreadsheet exports do:
 * quoted fields containing commas, doubled quotes ("") meaning one literal
 * quote, and newlines inside quoted fields. Hand-rolled because this repo has
 * no dependencies, and because the alternative — text.split(",") — silently
 * corrupts every address containing a comma, which is most of them.
 *
 * Returns an array of rows, each an array of cell strings. Never throws.
 */
function parseCsv(text) {
  const src = String(text == null ? "" : text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  // A UTF-8 BOM is what Excel writes on "Save as CSV". Left in place it
  // becomes part of the first header name, so `address` never matches.
  if (src.charCodeAt(0) === 0xfeff) i = 1;

  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); row = []; };

  while (i < src.length) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += c; i++; continue;
    }

    if (c === '"' && cell === "") { quoted = true; i++; continue; }
    if (c === ",") { endCell(); i++; continue; }
    if (c === "\r") { i++; continue; }          // CRLF -> LF
    if (c === "\n") { endRow(); i++; continue; }
    cell += c; i++;
  }
  // A file not ending in a newline still has a final row.
  if (cell !== "" || row.length) endRow();

  // Drop entirely blank lines — trailing newlines and spacer rows are normal
  // in hand-maintained spreadsheets and are not errors.
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// Header names are matched case-insensitively with spaces, hyphens and
// underscores treated alike, so "Property Type", "property-type" and
// "PROPERTY_TYPE" all land on `property_type`. This is NOT the clever
// column-guessing the plan rules out — it is only whitespace and case,
// applied to our own template's names.
function normalizeHeader(name) {
  return String(name == null ? "" : name)
    .trim().toLowerCase()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// --- column mapping --------------------------------------------------------
//
// Aliases a broker's own export is likely to use, keyed on normalizeHeader
// output. This does NOT overturn the "we do not guess" decision above
// TEMPLATE_COLUMNS: nothing here is applied silently. A suggestion is shown
// beside two or three of that column's real values and the broker confirms it
// before anything is written.
const HEADER_ALIASES = {
  address:       ["property_address", "prop_address", "street_address", "site_address", "addr"],
  property_type: ["type", "prop_type", "asset_type", "product_type"],
  transaction:   ["deal_type", "transaction_type", "sale_or_lease", "lease_or_sale"],
  deal_date:     ["sale_date", "close_date", "closing_date", "transaction_date", "sold_date", "date"],
  price:         ["sale_price", "sales_price", "purchase_price", "sold_price"],
  size_sqft:     ["sf", "sq_ft", "sqft", "square_feet", "square_footage", "building_sf", "building_size", "size"],
  cap_rate:      ["cap", "going_in_cap", "cap_pct"],
  tenancy:       ["tenancy_type"],
  year_built:    ["yr_built", "built", "year_constructed"],
  notes:         ["comments", "remarks", "note"],
  lat:           ["latitude"],
  lng:           ["longitude", "long", "lon"],
};

// Every field a column may be mapped onto.
const MAPPABLE_TARGETS = [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS];

/**
 * Suggest a mapping from a file's headers onto our fields.
 *
 * The ambiguity rule is the load-bearing part: a target is suggested only when
 * exactly ONE column claims it. "Sale Price" and "Consideration" both mean
 * price, and breaking that tie ourselves is the failure the original decision
 * was written to prevent.
 */
function suggestMapping(headers) {
  const norm = (Array.isArray(headers) ? headers : []).map(normalizeHeader);

  // Which columns claim each target, exact matches tracked separately so a
  // literal `price` column can settle a tie an alias would otherwise create.
  const exact = new Map();   // target -> [normalized header]
  const alias = new Map();   // target -> [normalized header]
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (const h of norm) {
    if (!h) continue;
    if (MAPPABLE_TARGETS.includes(h)) { push(exact, h, h); continue; }
    for (const [target, list] of Object.entries(HEADER_ALIASES)) {
      if (list.includes(h)) push(alias, target, h);
    }
  }

  const mapping = {};
  const ambiguous = [];
  const used = new Set();

  for (const target of MAPPABLE_TARGETS) {
    const hits = exact.get(target) || alias.get(target) || [];
    const free = hits.filter((h) => !used.has(h));
    if (free.length === 1) {
      mapping[free[0]] = target;
      used.add(free[0]);
    } else if (free.length > 1) {
      ambiguous.push(target);
    }
  }

  return { mapping, ambiguous };
}

// --- value readers -----------------------------------------------------------

const text = (v, max = MAX_TEXT) =>
  String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);

/**
 * Money. Accepts "$1,250,000", "1250000", "1,250,000.50".
 *
 * REFUSES shorthand ("1.2M", "450k") and accounting negatives ("(1,000)"),
 * matching displayMoney()'s stance in index.html: an ambiguous figure is
 * returned as an error, never as a guess. A broker who wrote 1.2M can be told
 * to write 1200000; a broker whose 1.2M silently became 1.2 cannot be told
 * anything, because nobody will notice.
 */
function parseMoney(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };
  if (/[a-z]/i.test(raw.replace(/^(usd|us\$)\s*/i, ""))) {
    return { ok: false, error: `"${raw}" is not a plain number — write 1200000, not 1.2M` };
  }
  if (/^\(.*\)$/.test(raw)) return { ok: false, error: `"${raw}" looks negative` };
  const cleaned = raw.replace(/^(usd|us\$)\s*/i, "").replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return { ok: false, error: `"${raw}" is not a number` };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, error: `"${raw}" is not a number` };
  if (n < 0) return { ok: false, error: `"${raw}" is negative` };
  return { ok: true, value: n };
}

/** A plain count or area. Accepts "45,000" and "45,000 SF"; the unit is dropped. */
function parseNumber(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };
  const cleaned = raw
    .replace(/\b(sf|sq\.?\s*ft\.?|square\s+feet|ft2|units?|acres?)\b/gi, "")
    .replace(/[,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return { ok: false, error: `"${raw}" is not a number` };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, error: `"${raw}" is not a number` };
  if (n < 0) return { ok: false, error: `"${raw}" is negative` };
  return { ok: true, value: n };
}

/**
 * One half of a coordinate pair, in decimal degrees.
 *
 * NOT parseNumber(), and this is the one place the spec's letter could not be
 * followed. `docs/superpowers/specs/2026-08-06-private-comp-geocoding.md` §3
 * says "reuse parseNumber()", but parseNumber REJECTS NEGATIVE NUMBERS — and
 * every longitude in the United States is negative. It would have refused the
 * spec's own worked example (`lng: -116.2023`, Boise) and every comp any US
 * broker will ever upload. Flagged back to Jacob rather than quietly worked
 * around, since the display half reads what this produces.
 *
 * Rejects rather than guesses, matching this module's stance everywhere else:
 * a wrong coordinate puts a broker's building on the wrong continent, and
 * unlike a wrong price nobody will recognise it as wrong.
 *
 * `bound` is the absolute limit for this axis: 90 for latitude, 180 for
 * longitude.
 */
function parseCoord(v, label, bound) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };
  // Degrees-minutes-seconds and the N/S/E/W suffixes are refused rather than
  // converted. They are unambiguous to a human and ambiguous to a parser
  // (which of 116°12'8" W and -116.2023 did the spreadsheet mean by "116 12
  // 8"?), and a broker who sees the refusal can paste decimal degrees.
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^[+-]?\d*\.?\d+$/.test(cleaned)) {
    return { ok: false, error: `${label}: "${raw}" is not a decimal-degrees number` };
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${label}: "${raw}" is not a decimal-degrees number` };
  }
  if (n < -bound || n > bound) {
    return { ok: false, error: `${label}: ${n} is outside ${-bound} to ${bound}` };
  }
  return { ok: true, value: n };
}

/** A percentage. Accepts "6.25%" and "6.25". Rejects anything outside 0-100. */
function parsePercent(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };
  const cleaned = raw.replace(/%/g, "").replace(/[,\s]/g, "");
  if (!/^\d*\.?\d+$/.test(cleaned)) return { ok: false, error: `"${raw}" is not a percentage` };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return { ok: false, error: `"${raw}" is not a percentage between 0 and 100` };
  }
  return { ok: true, value: n };
}

const MONTH_END = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validYmd(y, m, d) {
  if (!(y >= 1900 && y <= 2100)) return false;
  if (!(m >= 1 && m <= 12)) return false;
  if (!(d >= 1 && d <= MONTH_END[m - 1])) return false;
  // Reject 29 February in a non-leap year rather than let Postgres do it.
  if (m === 2 && d === 29 && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return false;
  return true;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * A deal date, returned as "YYYY-MM-DD".
 *
 * Accepts ISO (2025-03-14) and US slash order (3/14/2025, 03/14/25).
 * Two-digit years map 00-69 -> 2000s, 70-99 -> 1900s.
 *
 * Deliberately REFUSES:
 *  - bare numbers, which is how Excel exports a date it thinks is a serial
 *    (45000). Guessing would silently invent a date.
 *  - day-first order (14/03/2025 parses, 03/04/2025 does NOT become 4 March).
 *    US order is assumed because the corpus is US; an ambiguous date is read
 *    one way consistently rather than guessed per row. Documented on the
 *    template so a broker can see the assumption.
 *  - month names ("March 2025"), which usually mean a month with no day.
 */
function parseDate(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validYmd(y, mo, d)
      ? { ok: true, value: iso(y, mo, d) }
      : { ok: false, error: `"${raw}" is not a real date` };
  }

  m = /^(\d{1,2})[/](\d{1,2})[/](\d{2}|\d{4})$/.exec(raw);
  if (m) {
    let [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3].length === 2) y += y <= 69 ? 2000 : 1900;
    // A first field above 12 is unambiguously a day, i.e. day-first order.
    // Reading it as US order would be wrong, so say so instead.
    if (mo > 12 && d <= 12) {
      return { ok: false, error: `"${raw}" looks day-first — write it as YYYY-MM-DD` };
    }
    return validYmd(y, mo, d)
      ? { ok: true, value: iso(y, mo, d) }
      : { ok: false, error: `"${raw}" is not a real date` };
  }

  if (/^\d+$/.test(raw)) {
    return { ok: false, error: `"${raw}" is not a date — write it as YYYY-MM-DD` };
  }
  return { ok: false, error: `"${raw}" is not a date we can read — use YYYY-MM-DD` };
}

/** sale | lease. Generous about wording, strict about the result. */
function parseTransaction(v) {
  const raw = text(v, 40).toLowerCase();
  if (!raw) return { ok: false, error: "transaction is required (sale or lease)" };
  if (/^(sale|sold|sales|purchase|acquisition)$/.test(raw)) return { ok: true, value: "sale" };
  if (/^(lease|leased|rental|rent|letting)$/.test(raw)) return { ok: true, value: "lease" };
  return { ok: false, error: `"${raw}" is not "sale" or "lease"` };
}

function parsePropertyType(v) {
  const raw = text(v, 40);
  if (!raw) return { ok: false, error: "property_type is required" };
  const hit = PROPERTY_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  return hit
    ? { ok: true, value: hit }
    : { ok: false, error: `"${raw}" is not one of ${PROPERTY_TYPES.join(", ")}` };
}

/**
 * The dedupe key: lowercased, punctuation stripped, whitespace collapsed.
 * Re-importing an overlapping spreadsheet is normal broker behaviour, so
 * "1234 W. Mission Blvd." and "1234 W Mission Blvd" must be one comp.
 * Deliberately conservative — it does not expand "Blvd" to "Boulevard",
 * because merging two genuinely different properties is worse than keeping
 * one duplicate a broker can delete.
 */
function addressKey(v) {
  return String(v == null ? "" : v)
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- one row -----------------------------------------------------------------

/**
 * Validate and normalize a single row, already keyed by column name.
 *
 * Returns { ok: true, row } or { ok: false, errors: [string] } — ALL the
 * problems with the row, not just the first, so a broker fixing a spreadsheet
 * gets one complete list instead of discovering the next error on re-upload.
 *
 * `market` is NOT set here; server.js attaches it with its own marketOf().
 */
function normalizeRow(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const row = {};

  const address = text(src.address, 200);
  if (!address) errors.push("address is required");
  // A comp with no street number is an area estimate, not a property. The
  // public corpus tolerates those as data (isAggregateAddress downgrades their
  // provenance instead of dropping them); a broker's own vault should not,
  // because they typed it and can fix it.
  else if (!/^\s*\d/.test(address)) {
    errors.push(`"${address}" has no street number — the vault stores individual properties`);
  }
  row.address = address;
  row.address_key = addressKey(address);

  const type = parsePropertyType(src.property_type);
  if (type.ok) row.property_type = type.value; else errors.push(type.error);

  const txn = parseTransaction(src.transaction);
  if (txn.ok) row.transaction = txn.value; else errors.push(txn.error);

  // Required: it is half of the dedupe key, and a comp with no date cannot be
  // filtered by any lookback, which makes it unusable for the one thing comps
  // are for.
  const date = parseDate(src.deal_date);
  if (!date.ok) errors.push(date.error);
  else if (date.value == null) errors.push("deal_date is required (YYYY-MM-DD)");
  else row.deal_date = date.value;

  const price = parseMoney(src.price);
  if (price.ok) row.price = price.value; else errors.push(`price: ${price.error}`);

  const size = parseNumber(src.size_sqft);
  if (size.ok) row.size_sqft = size.value; else errors.push(`size_sqft: ${size.error}`);

  const cap = parsePercent(src.cap_rate);
  if (cap.ok) row.cap_rate = cap.value; else errors.push(`cap_rate: ${cap.error}`);

  // Derived rather than imported: the broker's own $/SF column would be a
  // fourth number to disagree with the other three, and this one is exact.
  // Only for sales — dividing an annual rent by size is a different metric
  // ($/SF/yr) and putting it in the same column would corrupt every median.
  row.price_per_sqft =
    row.transaction === "sale" && row.price != null && row.size_sqft > 0
      ? Math.round((row.price / row.size_sqft) * 100) / 100
      : null;

  // One explicit key rather than a multi-column unique constraint, matching
  // comp_corpus's dedupe_key. The reason is Postgres, not taste: NULLs compare
  // as DISTINCT in a unique constraint, so `unique (user_id, address_key,
  // deal_date, price)` would let an UNPRICED comp re-import without limit on
  // every upload — and unpriced comps are explicitly allowed below. Building
  // the key as a string makes a null price an empty segment that compares
  // equal to itself, and it gives PostgREST a plain column for on_conflict.
  row.dedupe_key = `${row.address_key}|${row.deal_date || ""}|${row.price == null ? "" : row.price}`;

  row.tenancy = text(src.tenancy, MAX_SHORT_TEXT) || null;
  row.year_built = text(src.year_built, 12) || null;
  row.notes = text(src.notes, MAX_TEXT) || null;

  for (const key of OPTIONAL_SPEC_COLUMNS) {
    row[key] = text(src[key], MAX_SHORT_TEXT) || null;
  }

  // Coordinates, if the broker's export carried them.
  //
  // NOT added to OPTIONAL_SPEC_COLUMNS, which is where §3 of the spec put
  // them. Two reasons, both structural:
  //
  //   1. Those columns are written verbatim onto the broker_comps row (the
  //      loop above), and there is no `lat` column on broker_comps. PostgREST
  //      400s on an unknown column, which on this path means the whole
  //      upload fails — the exact silent-schema-mismatch failure CLAUDE.md
  //      warns about under Comp corpus.
  //   2. They are attributes of the BUILDING, not of the deal. §3 of the same
  //      spec says so and builds migration 017 on broker_properties for it.
  //      Storing them per-comp would put the same pair on every deal for a
  //      building and let the copies disagree.
  //
  // So they ride on underscore-prefixed keys, which are this repo's existing
  // convention for "carried between functions, never a column" (see `_newest`
  // in broker-properties.js). server.js strips them before the comp insert and
  // hands them to the property upsert.
  //
  // BOTH OR NEITHER, checked here rather than left to the database: a lone
  // latitude is a mistake, not a partial answer, and telling the broker which
  // line it was on is worth more than a constraint violation they never see.
  const lat = parseCoord(src.lat, "lat", 90);
  const lng = parseCoord(src.lng, "lng", 180);
  if (!lat.ok) errors.push(lat.error);
  if (!lng.ok) errors.push(lng.error);
  if (lat.ok && lng.ok) {
    const have = (lat.value != null) + (lng.value != null);
    if (have === 1) {
      errors.push("lat and lng must be given together — one on its own places a pin on the equator");
    } else if (have === 2 && lat.value === 0 && lng.value === 0) {
      // Null Island. Overwhelmingly a failed spreadsheet lookup rather than a
      // building in the Gulf of Guinea, and a confidently wrong pin is worse
      // than an obviously missing one.
      errors.push("lat and lng are both 0 — that is Null Island, not a location");
    } else if (have === 2) {
      row._lat = lat.value;
      row._lng = lng.value;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, row };
}

// --- a whole file -------------------------------------------------------------

/**
 * Read an uploaded CSV into rows ready for insert.
 *
 * Returns { ok, rows, errors, total, skipped, duplicates } — never throws.
 * `errors` carries a spreadsheet line number per bad row (the header is line
 * 1, so these match what the broker sees in Excel).
 *
 * A file with SOME bad rows still imports the good ones and reports the rest;
 * an all-or-nothing import would mean one typo in row 400 rejects 399 good
 * comps. A file with NO readable header is a hard failure, because that is a
 * wrong-file mistake rather than a data mistake.
 */
function parseUpload(csvText, { maxRows = MAX_ROWS_PER_UPLOAD, maxErrors = 100 } = {}) {
  const empty = { ok: false, rows: [], errors: [], total: 0, skipped: 0, duplicates: 0 };
  const table = parseCsv(csvText);
  if (!table.length) {
    return { ...empty, errors: ["That file is empty."] };
  }

  const headers = table[0].map(normalizeHeader);
  // `address` is the one column nothing works without, so it doubles as the
  // "is this even the template?" check.
  if (!headers.includes("address")) {
    return {
      ...empty,
      errors: ["That file has no `address` column — download the template and paste your comps into it."],
    };
  }

  const body = table.slice(1);
  if (body.length > maxRows) {
    return {
      ...empty,
      errors: [`That file has ${body.length} rows; the limit is ${maxRows} per upload. Split it and import in parts.`],
    };
  }

  const rows = [];
  const errors = [];
  const seen = new Set();
  let skipped = 0;
  let duplicates = 0;

  body.forEach((cells, i) => {
    const lineNo = i + 2;                      // header is line 1
    const obj = {};
    headers.forEach((h, c) => { if (h) obj[h] = cells[c]; });

    const result = normalizeRow(obj);
    if (!result.ok) {
      skipped++;
      if (errors.length < maxErrors) errors.push(`Line ${lineNo}: ${result.errors.join("; ")}`);
      return;
    }
    // Within-file duplicates, caught here so the database's unique constraint
    // is a backstop rather than the thing generating the error message. Same
    // key the database will use, so the two cannot disagree.
    const key = result.row.dedupe_key;
    if (seen.has(key)) { duplicates++; return; }
    seen.add(key);
    rows.push(result.row);
  });

  if (errors.length >= maxErrors) {
    errors.push(`…and more. Showing the first ${maxErrors}.`);
  }

  return {
    ok: rows.length > 0,
    rows,
    errors,
    total: body.length,
    skipped,
    duplicates,
  };
}

/**
 * Quote a cell for CSV output: wrap in quotes when it contains a comma, a
 * quote or a newline, and double any embedded quotes.
 *
 * Not optional for the template — the example address contains two commas, so
 * writing it bare shifts every column right and the first thing a broker does
 * with our own file fails validation. (It did; there is a test.)
 */
function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The template a broker downloads, as CSV text. One example row, clearly fake. */
function templateCsv() {
  const example = {
    address: "1234 W Mission Blvd, Ontario, CA",
    property_type: "Industrial",
    transaction: "sale",
    deal_date: "2025-03-14",
    price: "12500000",
    size_sqft: "84000",
    cap_rate: "5.75",
    tenancy: "Single tenant",
    year_built: "1998",
    notes: "Dates are YYYY-MM-DD. Prices are plain numbers - no $ signs, no 1.2M.",
    // Decimal degrees, and both or neither. Shown filled in because a blank
    // example column reads as "leave this alone", and these are the two that
    // keep a private address from being sent out to place its map pin.
    lat: "34.0709",
    lng: "-117.6509",
  };
  return [
    TEMPLATE_COLUMNS.map(csvCell).join(","),
    TEMPLATE_COLUMNS.map((c) => csvCell(example[c])).join(","),
  ].join("\n") + "\n";
}

// --- publishing: the one sanctioned door through the privacy wall ------------
//
// Ecosystem Plan §4. A broker flips one of their own comps to public and gets
// visible credit for it in every report it appears in. Credit is the
// compensation — there is no payment for data.
//
// The mechanism is a COPY, not a shared read: publishing writes a row into
// `comp_submissions`, the table the verified-comp pipeline already reads
// (fetchVerifiedComps -> the prompt -> attachVerifiedAttribution -> the green
// "Verified · via <firm>" badge). Nothing public ever gains a read on
// `broker_comps`, so the wall is unchanged by this feature — which is the
// whole reason to copy rather than to add a `published` filter to a public
// query.

// A comp has to be worth publishing before it is worth crediting. These mirror
// what the public corpus already demands of a comp it will show a customer.
function canPublish(comp) {
  const c = comp || {};
  if (!c.address || !/^\s*\d/.test(String(c.address))) {
    return { ok: false, reason: "Only individual properties can be published — this address has no street number." };
  }
  if (!c.deal_date) return { ok: false, reason: "A published comp needs a deal date." };
  // An unpriced comp is fine to KEEP (brokers track undisclosed deals) but
  // publishing one credits a broker for a row that cannot support anyone's
  // valuation, which is the only thing the public corpus is for.
  if (c.price == null || Number(c.price) <= 0) {
    return { ok: false, reason: "A published comp needs a price — an unpriced comp cannot support a valuation." };
  }
  if (c.size_sqft == null || Number(c.size_sqft) <= 0) {
    return { ok: false, reason: "A published comp needs a size, or its price per square foot cannot be checked." };
  }
  if (!c.property_type) return { ok: false, reason: "A published comp needs a property type." };
  return { ok: true };
}

// The name a published comp is credited to. Company first: "Verified · via
// Adler Industrial" is what a broker is publishing FOR, and a firm name is
// what a property owner recognizes. Falls back to a personal name.
function creditName(profile, user) {
  const p = profile || {}, u = user || {};
  return text(p.company, MAX_SHORT_TEXT)
    || text(p.display_name, MAX_SHORT_TEXT)
    || text(u.name, MAX_SHORT_TEXT)
    || "";
}

/**
 * A vault comp -> the `comp_submissions` row that publishes it.
 *
 * Two conversions here are easy to get wrong and silent when wrong:
 *
 *  1. **`transaction` must be capitalised.** fetchVerifiedComps filters with
 *     `transaction=eq.Sale` / `eq.Lease`. The vault stores lowercase, so a
 *     verbatim copy would never match a sales- or lease-focused search — the
 *     comp would simply never be offered, with no error anywhere.
 *
 *  2. **`comp_submissions` columns are all text**, because they were filled by
 *     a human form. The vault holds real numbers. Numbers must be stringified,
 *     not passed through, or PostgREST coerces inconsistently.
 */
function submissionRowFrom(comp, { creditName: by, email }) {
  const c = comp || {};
  const str = (v) => (v == null || v === "" ? null : String(v));
  return {
    status: "approved",
    broker_name: by || null,
    broker_company: by || null,
    broker_email: String(email || "").trim().toLowerCase() || null,
    address: c.address,
    property_type: c.property_type,
    // Capitalised — see note 1 above.
    transaction: c.transaction === "sale" ? "Sale" : c.transaction === "lease" ? "Lease" : null,
    deal_date: str(c.deal_date),
    size_sqft: str(c.size_sqft),
    price_or_rate: str(c.price),
    cap_rate: str(c.cap_rate),
    notes: c.notes || null,
  };
}

// --- who may wear the Verified badge ----------------------------------------
//
// The badge means "a named broker vouched for this deal". It is the single
// most trusted provenance the report can show, and — since the broker tier
// pays brokers in credit rather than cash — it is also the entire currency the
// tier trades in. A badge that can appear without a broker behind it is worth
// nothing to the broker who earned theirs.
//
// The model is TOLD to set `verified: false` on anything it found by web
// search. It does not always comply: 16 corpus rows were found badged verified
// on 2026-08-05 against a grand total of one broker submission ever, mostly
// Boise and Eagle addresses nobody ever submitted.
//
// So this is ENFORCEMENT, deliberately mirroring the source_type rule in
// server.js's normalizeSourceTypes: prompt rules are requests, normalization
// is a guarantee. A comp is verified if and only if it matches a comp we
// actually offered. There is no third way to earn the badge.

const normAddr = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Which offered comp (if any) a returned comp is. The model copies an offered
 * address faithfully, so exact-or-prefix in either direction ties them
 * together; the length floor stops "1 " matching half the world.
 */
function matchOffered(address, offered) {
  const a = normAddr(address);
  if (!a || !Array.isArray(offered)) return null;
  return offered.find((v) =>
    v && v.a && (v.a === a ||
      (v.a.length >= 8 && a.length >= 8 && (a.startsWith(v.a) || v.a.startsWith(a))))) || null;
}

/**
 * Force every comp's `verified` flag to the truth, and attribute the ones that
 * earned it. MUTATES `comps` (the caller owns a freshly parsed report).
 *
 * Returns { cleared, kept, citedIds } — `cleared` is how many badges the model
 * claimed and did not deserve, which is worth logging: it is the only visible
 * signal that the prompt rule is being ignored.
 *
 * Note it runs with an EMPTY `offered` list too, which is the case the old
 * code returned early on. That early return is exactly how a search with no
 * broker comps in play — a property type nobody has ever submitted for —
 * shipped invented badges straight into the corpus.
 */
function enforceVerifiedFlags(comps, offered) {
  const out = { cleared: 0, kept: 0, citedIds: [] };
  if (!Array.isArray(comps)) return out;
  const list = Array.isArray(offered) ? offered.filter((v) => v && v.a) : [];
  const cited = new Set();

  for (const c of comps) {
    if (!c || typeof c !== "object") continue;
    if (c.verified !== true) { c.verified = false; continue; }
    const m = matchOffered(c.address, list);
    if (!m) {
      // Claimed but unearned. Clear the attribution too — a stale verified_by
      // on an unverified comp would still render "via <firm>" beside it.
      c.verified = false;
      delete c.verified_by;
      delete c.verified_by_slug;
      out.cleared++;
      continue;
    }
    out.kept++;
    if (m.by) c.verified_by = m.by;
    if (m.id) cited.add(m.id);
  }
  out.citedIds = [...cited];
  return out;
}

module.exports = {
  normAddr,
  matchOffered,
  enforceVerifiedFlags,
  canPublish,
  creditName,
  submissionRowFrom,
  parseCsv,
  normalizeHeader,
  suggestMapping,
  parseMoney,
  parseNumber,
  parseCoord,
  parsePercent,
  parseDate,
  parseTransaction,
  parsePropertyType,
  addressKey,
  normalizeRow,
  parseUpload,
  csvCell,
  templateCsv,
  TEMPLATE_COLUMNS,
  OPTIONAL_SPEC_COLUMNS,
  PROPERTY_TYPES,
  MAX_ROWS_PER_UPLOAD,
  HEADER_ALIASES,
  MAPPABLE_TARGETS,
};

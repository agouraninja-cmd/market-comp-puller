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
  // The lease half of the book. price/price_per_sqft describe a sale and are
  // left blank on a lease (the template says so), so without these a leasing
  // broker's comps carried no figure at all and every median read "no priced
  // sales yet". rent_basis sits next to rent_psf rather than being inferred —
  // see parseRentBasis for why guessing it is a 12x error.
  "rent_psf",
  "rent_basis",
  "lease_type",
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
// One ceiling for every file the extract path forwards to the vendor, PDF or
// image. It is not only a vendor limit: the route reads the file as base64
// inside a JSON body, and base64 costs a third more than the bytes it carries,
// so 4 MiB arrives as ~5.6 MB against that handler's 8 MB body cap.
const MAX_EXTRACT_BYTES = 4 * 1024 * 1024;

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

/**
 * A guidance or example line rather than a comp.
 *
 * Our own template ships its rules as `#` lines (see templateCsv), which is
 * how they survive the broker's first edit — they used to live in the example
 * row's `notes` cell and died the moment that row was typed over.
 *
 * ONLY THE FIRST CELL IS EXAMINED, and that is the load-bearing part: it lets
 * an example row sit fully populated under its correct headers and still be
 * inert, so the file we hand a broker can never plant a fake comp in their own
 * book of business. They activate a row by typing an address over the `#`,
 * which is the same keystroke as filling the cell in.
 *
 * Never applied to the header row — that is row 0, and a file whose first
 * column is literally headed "#" must still parse.
 *
 * A comment is SKIPPED, not rejected: parseUpload counts them separately and
 * reports the count, because this module's rule is that a row is either stored
 * or explained. A broker's own export with a `#` row is refused today too (by
 * normalizeRow's "has no street number"), and the count is what keeps that
 * visible instead of trading a loud rejection for a silent drop.
 */
function isCommentRow(cells) {
  return String((cells && cells[0]) == null ? "" : cells[0]).trim().startsWith("#");
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
    .replace(/[^a-z0-9_]/g, "")
    // A stripped symbol can leave an underscore stub behind: "Cap Rate (%)"
    // is "cap_rate_(%)" after the whitespace pass, and dropping the "(%)"
    // leaves "cap_rate_" — one invisible character away from the exact
    // target it plainly names, which is how the first real broker file got
    // no suggestion for its cap-rate column (2026-08-10). Same class:
    // "Sale Price ($)" → "sale_price_". Still only whitespace, case and
    // punctuation — no word in the header is being interpreted.
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * The normalized header vector for a raw header row.
 *
 * A header can be non-empty and still normalize to "": normalizeHeader strips
 * every non-alphanumeric character, so "$", "#", "%" and "($)" all reduce to
 * nothing. Those columns are real and often meaningful — the comment above
 * TEMPLATE_COLUMNS names "$" as a header brokers use for price — so each gets
 * a positional synthetic key rather than silently disappearing from the
 * mapping screen, which is the exact failure this feature exists to prevent.
 *
 * A TRULY blank header keeps its "" and stays excluded, so trailing commas
 * still cost nothing and two trailing blanks still do not collide.
 *
 * This is the ONE place that decision is made. `inspectCsv`, `validateMapping`
 * and `parseUpload` all route through it rather than each calling
 * `normalizeHeader` directly, because a mapping built against one of these and
 * checked or applied against another is exactly how a broker's "$" column
 * would pass the mapping screen and then fail (or silently vanish) on import.
 */
function normalizedHeaderRow(rawHeaders) {
  return (Array.isArray(rawHeaders) ? rawHeaders : []).map((h, i) => {
    const n = normalizeHeader(h);
    if (n) return n;
    return String(h == null ? "" : h).trim() ? `column_${i}` : "";
  });
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
  transaction:   ["deal_type", "transaction_type", "sale_or_lease", "lease_or_sale", "trans", "trans_type"],
  deal_date:     ["sale_date", "close_date", "closing_date", "transaction_date", "sold_date", "date"],
  price:         ["sale_price", "sales_price", "purchase_price", "sold_price", "consideration"],
  // The abbreviated forms ("Bldg SF", "RBA", "GLA") are what brokerage
  // exports actually say — the first real file's size column was "Bldg SF"
  // and suggested nothing (2026-08-10). RBA (rentable building area) and
  // GLA (gross leasable area) are the CoStar-family names for the same
  // measure.
  size_sqft:     ["sf", "sq_ft", "sqft", "square_feet", "square_footage", "building_sf", "building_size", "size",
                  "bldg_sf", "bldg_sqft", "bldg_size", "building_sqft", "gross_sf", "total_sf", "rba", "gla"],
  cap_rate:      ["cap", "going_in_cap", "cap_pct", "cap_rate_pct"],
  tenancy:       ["tenancy_type"],
  year_built:    ["yr_built", "built", "year_constructed"],
  notes:         ["comments", "remarks", "note"],
  // Rent headers are rate-shaped by nature ("Rent/SF", "$/SF/Yr", "Rent PSF"),
  // which is why RATE_TARGETS below exempts this target from the rate-header
  // guard rather than the guard being loosened for everyone.
  // Two families here, and the second is easy to get wrong: normalizeHeader
  // STRIPS punctuation rather than turning it into a separator, so the headers
  // brokers actually use — "Rent/SF", "Rent/SF/Yr", "$/SF/YR" — normalize to
  // rentsf, rentsfyr and sfyr with no underscore anywhere. Writing the
  // underscored forms alone (rent_sf) matches none of them, which is how the
  // first pass at this shipped aliases that could never fire.
  rent_psf:      ["rent", "rental_rate", "asking_rent", "base_rent", "lease_rate",
                  "annual_rent", "rent_rate", "rent_per_sf",
                  "rentsf", "rentsfyr", "rentsfmo", "rentpsf", "rentpsfyr",
                  "sfyr", "psfyr", "annualrentsf"],
  rent_basis:    ["rent_period", "rent_frequency", "basis", "per"],
  lease_type:    ["lease_structure", "lease_basis", "expense_type", "service_type"],
  lat:           ["latitude"],
  lng:           ["longitude", "long", "lon"],
};

// Targets that ARE a rate, and may therefore be claimed by a rate-shaped
// header. Everything else a rate-shaped header touches would be a measure it
// was derived from, which is the corruption isRateHeader exists to prevent.
const RATE_TARGETS = ["rent_psf", "price_per_unit", "price_per_acre"];

// A rate-shaped header names a DERIVED figure, never the measure itself:
// "$/SF" is a price divided by a size, and mapping it onto either side of
// that division corrupts the side it lands on. The first real broker file
// proved the hazard is live, not theoretical: its "$/SF" column normalizes
// to bare "sf" (the $ and / both strip), which made it the sole claimant of
// the size alias — so the mapper confidently suggested importing $68.11 as
// a 68 sq ft building (2026-08-10). Tested on the RAW header, before
// normalization erases the "/" that is the whole signal.
//
// Guards ALIAS claims only. An exact target name is never blocked: "Price
// Per Unit" is rate-shaped AND the literal name of a real multifamily
// column, and a broker who used our own header gets our own column.
function isRateHeader(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s) return false;
  if (/\/\s*(sf|sq\.?\s*ft|sqft|square\s*foot|square\s*feet|acre|unit|yr|year|mo|month|nnn)\b/.test(s)) return true;
  if (/\bper\s+(sf|sq\.?\s*ft|sqft|square\s*foot|acre|unit|month|year)\b/.test(s)) return true;
  if (/^\$\s*(\/|per)\s*/.test(s)) return true;
  if (/^p\.?\s?s\.?\s?f\.?$/.test(s) || /\bpsf\b/.test(s)) return true;
  return false;
}

// Every field a column may be mapped onto.
const MAPPABLE_TARGETS = [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS];
const VAULT_FIELD_KEYS = [...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS];
// Keys offered to the extract model. lat/lng stay on the confirm table so a
// broker can type them, but a table PDF almost never carries them and a
// hallucinated coordinate permanently locates a private property.
const EXTRACT_KEYS = VAULT_FIELD_KEYS.filter((k) => k !== "lat" && k !== "lng");

// The four fields normalizeRow refuses a row without. Kept here as one list so
// the mapper and the row parser cannot disagree about what "required" means.
const REQUIRED_TARGETS = ["address", "property_type", "transaction", "deal_date"];

/**
 * Suggest a mapping from a file's headers onto our fields.
 *
 * The ambiguity rule is the load-bearing part: a target is suggested only when
 * exactly ONE column claims it. "Sale Price" and "Consideration" both mean
 * price, and breaking that tie ourselves is the failure the original decision
 * was written to prevent.
 */
function suggestMapping(headers) {
  const raw = Array.isArray(headers) ? headers : [];
  const norm = raw.map(normalizeHeader);

  // Which columns claim each target, exact matches tracked separately so a
  // literal `price` column can settle a tie an alias would otherwise create.
  const exact = new Map();   // target -> [normalized header]
  const alias = new Map();   // target -> [normalized header]
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (!h) continue;
    if (MAPPABLE_TARGETS.includes(h)) { push(exact, h, h); continue; }
    // A derived-rate column ("$/SF") may claim nothing by alias — see
    // isRateHeader. The check reads the RAW header because the "/" carrying
    // the meaning does not survive normalization.
    //
    // Except onto a target that IS a rate. "Rent/SF", "$/SF/Yr" and "Rent PSF"
    // are rate-shaped by construction and are the ordinary way a broker's
    // export names the rent column, so the blanket guard would leave the one
    // header that unambiguously means rent unable to claim rent. The hazard
    // the guard exists for is a rate landing on one of the MEASURES it was
    // divided from (a "$/SF" column importing 68.11 as a 68 sq ft building);
    // a rate landing on a rate is the correct answer, not that failure.
    const rateShaped = isRateHeader(raw[i]);
    for (const [target, list] of Object.entries(HEADER_ALIASES)) {
      if (rateShaped && !RATE_TARGETS.includes(target)) continue;
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

/**
 * Validate a confirmed mapping before anything is imported. Refuses rather
 * than repairing: a mapping we quietly fixed is a mapping the broker did not
 * actually approve.
 */
function validateMapping(mapping, headers) {
  const errors = [];
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return { ok: false, errors: ["No column mapping was supplied."] };
  }

  // normalizedHeaderRow, not a bare normalizeHeader map: a header like "$"
  // that normalizes away entirely still gets a positional `column_N` key
  // over there, and this set has to agree or a mapping built against
  // inspectCsv's own output is refused as "no column called column_0".
  const present = new Set(normalizedHeaderRow(headers).filter(Boolean));
  const claimedBy = new Map();

  for (const [source, target] of Object.entries(mapping)) {
    if (!present.has(source)) {
      errors.push(`The file has no column called "${source}".`);
      continue;
    }
    if (!MAPPABLE_TARGETS.includes(target)) {
      errors.push(`"${target}" is not a field we store.`);
      continue;
    }
    if (claimedBy.has(target)) {
      errors.push(`Two columns are both mapped to ${target}: "${claimedBy.get(target)}" and "${source}". Pick one.`);
      continue;
    }
    claimedBy.set(target, source);
  }

  const missing = REQUIRED_TARGETS.filter((t) => !claimedBy.has(t));
  if (missing.length) {
    errors.push(`Still needed: ${missing.join(", ")}.`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Rename a header row per a confirmed mapping. Unmapped columns are renamed to
 * a name nothing matches, rather than left alone: a file may contain a literal
 * `price` column the broker chose NOT to map, and leaving it would collide
 * with the column they did map.
 */
function applyHeaderMapping(headers, mapping) {
  const m = mapping && typeof mapping === "object" ? mapping : {};
  return (Array.isArray(headers) ? headers : []).map((h, i) =>
    Object.prototype.hasOwnProperty.call(m, h) ? m[h] : `_ignored_${i}`
  );
}

// --- value readers -----------------------------------------------------------

const text = (v, max = MAX_TEXT) =>
  String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);

// The explicit ways a spreadsheet says "there is no number here". Compared
// case-insensitively with whitespace collapsed. Deliberately a closed set of
// literal markers: each one names ABSENCE, so treating it as an empty cell
// loses nothing — the line this must never cross is interpreting a value
// (that is why "TBD" of the pending-deal kind and shorthand like "1.2M" stay
// rejections). Shared by parseMoney and parseNumber.
const NO_VALUE_TOKENS = new Set([
  "undisclosed", "not disclosed", "n/a", "na", "none", "confidential",
  "withheld", "unknown", "-", "--", "—", "–",
]);

/**
 * Money. Accepts "$1,250,000", "1250000", "1,250,000.50", and reads an
 * explicit no-value marker ("Undisclosed", "N/A" — NO_VALUE_TOKENS above) as
 * an empty cell, because that is what it says.
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
  // An explicit no-value marker means the same thing as an empty cell. This
  // is NOT the shorthand-guessing the comment above rules out: "Undisclosed"
  // names the absence of a number, and reading it as absent loses nothing —
  // where reading "1.2M" as anything requires inventing a value. The set is
  // closed and literal on purpose; the first real broker file wrote
  // "Undisclosed" and lost the whole row to the 1.2M error (2026-08-10),
  // when the template itself promises an undisclosed deal still counts.
  if (NO_VALUE_TOKENS.has(raw.toLowerCase().replace(/\s+/g, " "))) {
    return { ok: true, value: null };
  }
  if (/[a-z]/i.test(raw.replace(/^(usd|us\$)\s*/i, ""))) {
    // Only shorthand that actually looks like shorthand earns the 1.2M
    // advice — telling someone who wrote "Call broker" to write 1200000
    // explains the wrong mistake.
    if (/^[\d.,\s$]*\d\s*(k|m|mm|b|bn|mil|million|thousand)\.?$/i.test(raw.replace(/^(usd|us\$)\s*/i, ""))) {
      return { ok: false, error: `"${raw}" is not a plain number — write 1200000, not 1.2M` };
    }
    return { ok: false, error: `"${raw}" is not a number — leave the cell blank if the price is undisclosed; the deal still counts` };
  }
  if (/^\(.*\)$/.test(raw)) return { ok: false, error: `"${raw}" looks negative` };
  const cleaned = raw.replace(/^(usd|us\$)\s*/i, "").replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return { ok: false, error: `"${raw}" is not a number` };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, error: `"${raw}" is not a number` };
  if (n < 0) return { ok: false, error: `"${raw}" is negative` };
  return { ok: true, value: n };
}

/** A plain count or area. Accepts "45,000" and "45,000 SF"; the unit is dropped.
 *  A no-value marker ("N/A" — NO_VALUE_TOKENS above) reads as an empty cell. */
function parseNumber(v) {
  const raw = String(v == null ? "" : v).trim();
  if (!raw) return { ok: true, value: null };
  if (NO_VALUE_TOKENS.has(raw.toLowerCase().replace(/\s+/g, " "))) {
    return { ok: true, value: null };
  }
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

/**
 * annual | monthly. Required whenever a rent is given, and deliberately NOT
 * defaulted.
 *
 * The quoting convention is regional, not national: California industrial and
 * retail quote rent MONTHLY ("$1.35/SF NNN" means per month) while most of the
 * US quotes annually ("$16.20/SF/yr"). Those two strings describe the same
 * deal. Defaulting to annual would silently store a Los Angeles broker's 1.35
 * as $1.35/SF/yr — twelve times low, in their own records, looking entirely
 * plausible. This module rejects "1.2M" rather than guessing what it meant for
 * exactly the same reason: a rejected row is fixed in a minute, and a wrong
 * number is never noticed at all.
 *
 * The vocabulary is generous (yr/annum/pa, mo/month/pcm) because brokers write
 * it a dozen ways; the RESULT is one of two values.
 */
function parseRentBasis(v) {
  const raw = text(v, 40).toLowerCase().replace(/[^a-z]/g, "");
  if (!raw) return { ok: true, value: null };
  if (/^(annual|annually|annum|perannum|pa|year|yearly|yr|peryear|persfyr|nnnyr)$/.test(raw)) {
    return { ok: true, value: "annual" };
  }
  if (/^(monthly|month|mo|permonth|pcm|persfmo)$/.test(raw)) {
    return { ok: true, value: "monthly" };
  }
  return { ok: false, error: `rent_basis: "${text(v, 40)}" is not "annual" or "monthly"` };
}

/**
 * NNN | FS | MG, or nothing.
 *
 * Optional on purpose, which is the deliberate asymmetry with rent_basis
 * above. Mixing annual and monthly rents makes a median WRONG, so it is
 * refused. Mixing triple-net and full-service makes the same median WEAKER —
 * $28.50 NNN and $28.50 full-service are genuinely different deals — so it is
 * disclosed on the page instead. Different problems, different answers; a
 * broker who does not track lease structure should still get their book in.
 */
function parseLeaseType(v) {
  const raw = text(v, 40).toLowerCase().replace(/[^a-z]/g, "");
  if (!raw) return { ok: true, value: null };
  if (/^(nnn|triplenet|net|absolutenet|nn)$/.test(raw)) return { ok: true, value: "NNN" };
  if (/^(fs|fsg|fullservice|fullservicegross|gross)$/.test(raw)) return { ok: true, value: "FS" };
  if (/^(mg|modifiedgross|modified|ig|industrialgross)$/.test(raw)) return { ok: true, value: "MG" };
  return { ok: false, error: `lease_type: "${text(v, 40)}" is not NNN, FS or MG` };
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

/**
 * Read a CSV's shape without importing it: headers, a few real values per
 * column, and a suggested mapping. Writes nothing and decides nothing; the
 * broker confirms what this proposes.
 */
function inspectCsv(csvText, { samples = 3 } = {}) {
  const empty = {
    ok: false, error: "", headers: [], normalized: [], samples: {},
    suggested: {}, ambiguous: [], cleanTemplate: false, rowCount: 0,
  };
  const table = parseCsv(csvText);
  if (!table.length) return { ...empty, error: "That file is empty." };

  const headers = table[0];
  // normalizedHeaderRow gives a header with real content that normalizes
  // away entirely (e.g. "$") a positional `column_N` key rather than letting
  // it vanish; `validateMapping` and `parseUpload` route through the SAME
  // helper, so a mapping built against what this returns is recognized
  // end-to-end rather than only on the inspection screen.
  const normalized = normalizedHeaderRow(headers);

  // A mapping is keyed on the normalised header name, so two columns sharing
  // one name have no way to be told apart. Refuse rather than pick. The
  // synthetic `column_N` keys above go through this same check, so a file
  // that happens to ALSO have a literal "column_0" header collides with a
  // "$" in the first column rather than silently merging the two.
  const seen = new Set();
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (!h) continue;
    if (seen.has(h)) {
      return { ...empty, error: `Two columns are both called "${headers[i]}". Rename one and upload again.` };
    }
    seen.add(h);
  }

  // Comment lines are not rows a broker is mapping. Left in, the address
  // column's samples read "# Required: address, property_type, ..." and the
  // row count is a dozen too high on our own template.
  const body = table.slice(1).filter((cells) => !isCommentRow(cells));
  const sampleMap = {};
  for (let c = 0; c < normalized.length; c++) {
    if (!normalized[c]) continue;
    const vals = [];
    for (const row of body) {
      const v = String(row[c] == null ? "" : row[c]).trim();
      if (v) vals.push(v);
      if (vals.length >= samples) break;
    }
    sampleMap[normalized[c]] = vals;
  }

  const { mapping: suggested, ambiguous } = suggestMapping(headers);

  // Clean means every non-empty header is already one of ours AND the four
  // required fields are present. Requiring EVERY header to be known is what
  // catches the silent case: a file with an unknown "Sq Ft" column imports
  // today with no sizes and no explanation.
  const nonEmpty = normalized.filter(Boolean);
  const cleanTemplate =
    nonEmpty.every((h) => MAPPABLE_TARGETS.includes(h)) &&
    REQUIRED_TARGETS.every((t) => nonEmpty.includes(t));

  return {
    ok: true, error: "", headers, normalized, samples: sampleMap,
    suggested, ambiguous, cleanTemplate, rowCount: body.length,
  };
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

  // --- the lease side ------------------------------------------------------
  //
  // Rent is an INPUT, not a derivation. There is nothing to derive it from:
  // `price` is blank on a lease by the template's own instruction, and a
  // broker who typed something there could have meant the annual rent, the
  // monthly rent, or the total value over the term — three numbers that differ
  // by more than an order of magnitude. Reading rent out of `price` would be
  // guessing, so a lease rent has its own column and comes with its own basis.
  const rent = parseMoney(src.rent_psf);
  if (rent.ok) row.rent_psf = rent.value; else errors.push(`rent_psf: ${rent.error}`);

  const basis = parseRentBasis(src.rent_basis);
  if (basis.ok) row.rent_basis = basis.value; else errors.push(basis.error);

  const leaseType = parseLeaseType(src.lease_type);
  if (leaseType.ok) row.lease_type = leaseType.value; else errors.push(leaseType.error);

  // The basis is required WITH a rent and meaningless without one. Refusing
  // here rather than defaulting is the whole point — see parseRentBasis.
  // `basis.ok` guards this: a rent_basis that failed to PARSE has already said
  // so, and adding "rent_basis is required" underneath it tells the broker
  // their filled-in column is missing. Only a genuinely absent basis reaches
  // this line.
  if (basis.ok && row.rent_psf != null && row.rent_basis == null) {
    errors.push('rent_basis is required with a rent — "annual" or "monthly", ' +
      "because $1.35/SF means a very different deal in each");
  }

  // Derived, exactly like price_per_sqft above: one canonical annual figure so
  // the medians, the chart and the filter cannot quote three different numbers
  // for one lease. A rent on a SALE row is kept as typed but never annualized
  // — a sale-leaseback may legitimately carry both, and inventing a lease
  // metric for a sale would put it in the lease median.
  row.rent_psf_yr =
    row.transaction === "lease" && row.rent_psf != null && row.rent_basis
      ? Math.round(row.rent_psf * (row.rent_basis === "monthly" ? 12 : 1) * 100) / 100
      : null;

  // The other way this field gets filled in wrong: the TOTAL rent typed into a
  // per-square-foot column. $356,250/yr on a 12,500 SF suite is $28.50/SF, and
  // the two are easy to transpose in a spreadsheet. Manhattan trophy retail
  // reaches the high hundreds per square foot, so the ceiling is set well above
  // any real quoted rent and only catches figures that cannot be per-SF at all.
  if (row.rent_psf_yr != null && row.rent_psf_yr > 2000) {
    errors.push(`rent_psf: ${row.rent_psf} is too large to be a rent per square foot ` +
      "— give the rent per SF, not the total for the space");
  }

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

// broker_comps.id is a uuid column (migration 013), so PostgREST rejects a
// malformed `?id=` outright and the caller's fetch throws. Checking the
// SHAPE first lets the PATCH/DELETE routes answer the same 404 an unknown-
// but-valid id already gets, instead of letting the thrown PostgREST error
// fall into the generic catch and answer 502 — which reads as "our server
// broke" for what is actually "the caller sent nonsense", and would also
// tell a prober whether it is worth trying other ids by the status code
// alone.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

// The fields a broker may change. Deliberately an ALLOWLIST built from the
// two column constants rather than "everything on the row": a patch that
// could set user_id would be an account-takeover primitive, and one that
// could set `published` would put a row in the public corpus without the
// submission that credits it.
//
// This matters even though normalizeRow already builds its `row` by explicit
// field-by-field assignment and never spreads its input, so today a patch
// carrying user_id or published would be dropped by normalizeRow alone with
// no allowlist at all. EDITABLE_FIELDS is defense in depth against a future
// normalizeRow that spreads `src` for convenience -- the moment it does, this
// allowlist is the only thing still standing between a patch and those
// columns. The "EDITABLE_FIELDS itself" test below is what keeps this
// allowlist honest, since nothing about a merged row's SHAPE can tell
// "properly filtered" apart from "normalizeRow happened to drop it anyway".
const EDITABLE_FIELDS = Object.freeze([...TEMPLATE_COLUMNS, ...OPTIONAL_SPEC_COLUMNS]);

/**
 * Validate an edit to one stored comp.
 *
 * NOT a second validator. It rebuilds the row's template-shaped input, applies
 * the patch over it, and runs `normalizeRow` -- the same function every
 * imported row goes through. That is what makes a hand-typed "1.2M" or an
 * Excel serial date fail here exactly as it fails on import, and what keeps
 * `dedupe_key`, `address_key` and the sales-only `price_per_sqft` rule
 * produced by one piece of code instead of two that can drift.
 *
 * `existing` is the stored row (or anything with the same field names).
 * `patch` is the browser's partial; keys outside EDITABLE_FIELDS are dropped.
 */
function validateEdit(existing, patch) {
  const base = existing && typeof existing === "object" ? existing : {};
  const p = patch && typeof patch === "object" ? patch : {};
  const merged = {};
  for (const f of EDITABLE_FIELDS) {
    merged[f] = Object.prototype.hasOwnProperty.call(p, f) ? p[f] : base[f];
  }
  return normalizeRow(merged);
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
function parseUpload(csvText, { maxRows = MAX_ROWS_PER_UPLOAD, maxErrors = 100, mapping = null } = {}) {
  const empty = { ok: false, rows: [], errors: [], total: 0, skipped: 0, duplicates: 0, commented: 0 };
  const table = parseCsv(csvText);
  if (!table.length) {
    return { ...empty, errors: ["That file is empty."] };
  }

  // normalizedHeaderRow, not a bare map(normalizeHeader): applyHeaderMapping
  // below has to be fed the SAME vector validateMapping just checked the
  // mapping against, or a mapping keyed on a synthetic `column_N` (a "$"
  // column, say) would pass validation and then be neutralized to
  // `_ignored_N` here because this array never produced that key to match.
  let headers = normalizedHeaderRow(table[0]);
  if (mapping) {
    // Validate BEFORE applying: an invalid mapping must refuse the upload, not
    // import a partial one. Same stance as every other refusal in this module.
    const check = validateMapping(mapping, table[0]);
    if (!check.ok) return { ...empty, errors: check.errors };
    headers = applyHeaderMapping(headers, mapping);
  }
  // `address` is the one column nothing works without, so it doubles as the
  // "is this even the template?" check. With a mapping applied it is always
  // present, because validateMapping requires it.
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
  let commented = 0;

  // Iterate the WHOLE body and skip inside the loop rather than filtering
  // comments out first: line numbers are the raw body index, and a filtered
  // array would renumber every error away from what Excel shows the broker.
  body.forEach((cells, i) => {
    const lineNo = i + 2;                      // header is line 1
    if (isCommentRow(cells)) { commented++; return; }
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

  // The untouched template: every line is one of ours. Without this the route
  // falls through to its generic "nothing in that file could be imported",
  // which does not tell the broker that the `#` lines are the template's own
  // notes or where their own rows are supposed to go.
  if (!rows.length && !skipped && commented) {
    errors.push(
      "Every line in that file starts with # — those are the template's own notes. " +
      "Type your comps in below them, or over the example rows."
    );
  }

  return {
    ok: rows.length > 0,
    rows,
    errors,
    // Data rows only. This is the number the broker compares `imported`
    // against, and "imported 3 of 16" on a three-comp file reads as data loss.
    total: body.length - commented,
    skipped,
    duplicates,
    commented,
  };
}

/**
 * Neutralize spreadsheet formula injection: a cell starting with `=`, `+`,
 * `-` or `@` is a FORMULA to Excel, LibreOffice and Google Sheets — quoting
 * does not help, because the quotes are gone by the time the cell is
 * interpreted. `=HYPERLINK(...)` in a comp's notes would execute on the
 * broker's own machine when they open their export, and the admin CSVs carry
 * visitor-typed and model-supplied text opened in the owner's Excel.
 *
 * The guard is the standard leading apostrophe, with one exception: a cell
 * that is entirely a plain number is left alone, because every exported
 * longitude starts with `-` and an apostrophe there would fail parseCoord on
 * re-import and strip the building's location. The exception must match the
 * WHOLE cell — `-2+cmd|...` starts with a digit-after-minus but is still a
 * live payload, so a prefix test is not enough. Text that trips the guard
 * (`- great location`) was already broken in Excel (#NAME?), so the
 * apostrophe renders it correctly rather than corrupting anything; it does
 * survive a re-import into the stored value, which is the accepted trade for
 * never emitting a live formula.
 */
function guardFormula(s) {
  return /^[=+\-@]/.test(s) && !/^-?[0-9.]+$/.test(s) ? "'" + s : s;
}

/**
 * Quote a cell for CSV output: wrap in quotes when it contains a comma, a
 * quote or a newline, and double any embedded quotes.
 *
 * Not optional for the template — the example address contains two commas, so
 * writing it bare shifts every column right and the first thing a broker does
 * with our own file fails validation. (It did; there is a test.)
 *
 * Formula-guarded first (see guardFormula) — every CSV this module emits is
 * opened in a spreadsheet by design, so there is no un-guarded variant.
 */
function csvCell(v) {
  const s = guardFormula(String(v == null ? "" : v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The template a broker downloads, as CSV text.
 *
 * A header row, the rules as `#` lines, then three inert example rows.
 *
 * THE RULES RIDE IN THE FILE, and that is the whole design. They used to live
 * in the single example row's `notes` cell, where the broker's first edit
 * deleted them — and the file, not the page, is what is open in Excel hours
 * later when the question actually arises. isCommentRow skips every line
 * below, so the broker may delete them or leave them.
 *
 * They also have to stay TRUE. The old text said "no $ signs", which is
 * false: parseMoney strips `$` and commas, parseNumber accepts "45,000 SF",
 * parsePercent accepts "6.25%". Asking a broker to strip what we already
 * strip costs them an afternoon and costs us their trust the first time they
 * notice. Only shorthand (1.2M) is genuinely refused.
 *
 * Every `#` line is emitted as ONE cell through csvCell, so a line containing
 * commas is quoted and Excel shows it as a single run of text rather than
 * shrapnel across twelve columns.
 *
 * NOTHING HERE IMPORTS. Each example carries `#` in the address cell, so our
 * own file can never plant a fake comp in a broker's book — see isCommentRow.
 */
function templateCsv() {
  const notes = [
    "Lines starting with # are ignored on import. Delete them or leave them.",
    "Required: address, property_type, transaction, deal_date. Everything else is optional - a deal with an undisclosed price still counts.",
    `property_type: one of ${PROPERTY_TYPES.join(", ")}.`,
    "transaction: sale or lease.",
    "deal_date: 2025-03-14. Slash dates work too and are read US style, month first: 3/14/2025 means 14 March 2025.",
    "price and size_sqft: $1,250,000 and 45,000 SF are both fine. 1.2M is not - write it out in full.",
    "cap_rate: 5.75 or 5.75%.",
    // Stated as a pair, and the basis line says WHY it is required rather than
    // just that it is: a broker who reads "annual or monthly" as boilerplate
    // and leaves it blank gets a rejected row, and the reason has to be on the
    // page they are already looking at.
    "Leases: put the rent per SF in rent_psf and say which in rent_basis - annual or monthly.",
    "rent_basis has no default on purpose. $1.35/SF is a normal California monthly rent and an impossible annual one, so we ask rather than guess.",
    "lease_type: NNN, FS (full service) or MG (modified gross). Optional, but a median mixing them is a weaker number and we will say so.",
    // Filled in on the sale example rather than left blank, because a blank
    // column reads as "leave this alone" and these two are what keep a private
    // address from being sent to a third party to place its map pin.
    "lat and lng: decimal degrees, both or neither. Supplying them keeps this address off third-party geocoders.",
    `You can add any of these columns too: ${OPTIONAL_SPEC_COLUMNS.join(", ")}.`,
    "The rows below are examples. Type your own address over the # to use one, or delete them.",
  ];

  // A priced sale, a lease, and a sale with an undisclosed price. The last two
  // exist because /vault's first-run copy promises both are welcome and the
  // template used to demonstrate neither.
  const examples = [
    {
      address: "#", property_type: "Industrial", transaction: "sale",
      deal_date: "2025-03-14", price: "12500000", size_sqft: "84000",
      cap_rate: "5.75", tenancy: "Single tenant", year_built: "1998",
      notes: "Sold fully leased.", lat: "34.0709", lng: "-117.6509",
    },
    {
      address: "#", property_type: "Office", transaction: "lease",
      deal_date: "2025-06-01", size_sqft: "12500",
      rent_psf: "28.50", rent_basis: "annual", lease_type: "NNN",
      tenancy: "Multi-tenant", year_built: "2004",
      // The rent used to live in this sentence as prose, which is where it
      // stayed: unqueryable, absent from every median, and the reason a
      // leasing book showed "no priced sales yet" on every card.
      notes: "5-year term. Leave price blank on a lease - the rent goes in rent_psf.",
    },
    {
      address: "#", property_type: "Retail", transaction: "sale",
      deal_date: "2024-11-20", size_sqft: "9400",
      tenancy: "Single tenant", year_built: "1986",
      notes: "Price undisclosed - the deal still counts.",
    },
  ];

  return [
    TEMPLATE_COLUMNS.map(csvCell).join(","),
    ...notes.map((n) => csvCell(`# ${n}`)),
    ...examples.map((e) => TEMPLATE_COLUMNS.map((c) => csvCell(e[c])).join(",")),
  ].join("\n") + "\n";
}

// --- export --------------------------------------------------------------
//
// The reverse of templateCsv: a broker's OWN stored comps, turned back into
// the shape parseUpload reads, so "export, fix fifty rows in Excel,
// re-import" is a real workflow rather than a one-way trip.

/**
 * The columns one export needs.
 *
 * TEMPLATE_COLUMNS alone is NOT the answer, and assuming it was is the bug
 * this function exists to prevent. The optional per-type columns
 * (clear_height, units, lot_acres and nine more) are importable and stored, so
 * an export without them would hand a broker a book with every clear height
 * gone — silently, which is the failure mode the whole vault is written
 * against. They are appended only when something actually carries data, so a
 * book with no per-type fields gets no trailing empty columns.
 */
function exportColumns(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const used = OPTIONAL_SPEC_COLUMNS.filter((c) =>
    list.some((r) => r && r[c] != null && String(r[c]).trim() !== ""));
  return [...TEMPLATE_COLUMNS, ...used];
}

/**
 * Joins a broker's stored comps with their (separately fetched) property
 * coordinates, producing the rows exportCsv actually writes.
 *
 * Pulled out of server.js so this join can be tested with no database: it is
 * the exact spot the "both or neither" rule has to hold, and the whole
 * reason this needs its own function is that `Number(null) === 0` and
 * `Number.isFinite(0) === true`. A property row with no location on file
 * (today, essentially every one — import-time geocoding is deferred) has
 * `lat: null, lng: null`, and coercing before null-checking reads that as a
 * located building at 0,0: Null Island, which `normalizeRow` refuses on
 * re-import ("lat and lng are both 0"). A lone real latitude has the same
 * failure the other way — `lng` coerces to 0 and the pair re-imports
 * cleanly as a wrong coordinate in the Atlantic, which is worse, because
 * nothing refuses it. Checking `!= null` first is what makes "no
 * coordinates on file" export blank instead of zero.
 *
 * NOT the same rule `attachPropertyCoords` enforces in server.js, despite
 * the comment that used to say so — that function has this identical
 * `Number(null)` flaw and should not be trusted as a reference until it is
 * fixed too (tracked separately; it drives live blended comps, not export).
 *
 * `coordsById` is a Map of property_id -> { lat, lng } (or absent/partial);
 * a comp with no `property_id`, or none found in the map, exports blank.
 */
function exportRowsWithCoords(comps, coordsById) {
  const list = Array.isArray(comps) ? comps : [];
  const coords = coordsById instanceof Map ? coordsById : new Map();
  return list.map((c) => {
    const p = coords.get(c && c.property_id) || {};
    const located = p.lat != null && p.lng != null &&
      Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));
    return {
      ...c,
      lat: located ? Number(p.lat) : undefined,
      lng: located ? Number(p.lng) : undefined,
    };
  });
}

/**
 * A broker's own comps as CSV, in the shape our own importer reads.
 *
 * The round trip is the requirement: export, fix fifty rows in Excel,
 * re-import with no mapping screen (a file already in our column names skips
 * it). A test runs the output of this function back through parseUpload.
 *
 * `lat`/`lng` must already be lifted onto each row from the joined property —
 * they are not columns on broker_comps. Omitting them would strip a private
 * address's coordinates on re-import and send it out to a third-party
 * geocoder on the next report.
 */
function exportCsv(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = exportColumns(list);
  return [
    cols.map(csvCell).join(","),
    ...list.map((r) => cols.map((c) => csvCell(r ? r[c] : "")).join(",")),
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
// what a property owner recognizes; a broker who works under their own name
// states that as their display name and gets it for the same reason.
//
// IT READS THE PROFILE ONLY — never the account's `name` (dropped
// 2026-08-12). That fallback made the publish flow's own promise false:
// the confirm says "credited to your firm by name", and a vault-first
// broker has no profile, so their comps were quietly credited to whatever
// they typed into the signup form — usually a personal name, then copied
// into `broker_company` by submissionRowFrom and shown publicly as their
// firm. Nobody chose that, so nobody could correct it.
//
// With no stated identity this returns "" and the publish route refuses
// with `needs_credit_name`, which the vault turns into a one-time question.
// Asking once is the whole point: a credit is a public claim about who
// someone is, and inheriting it from an unrelated field is a guess.
function creditName(profile) {
  const p = profile || {};
  return text(p.company, MAX_SHORT_TEXT)
    || text(p.display_name, MAX_SHORT_TEXT)
    || "";
}

// The identity a broker states for their published comps: a firm, a personal
// name, or both. Pure so `npm test` covers the rules on strings that become
// PUBLIC — the "via <firm>" credit on every report the comp reaches, and the
// market-page directory listing.
//
// One requirement, and it is the same one creditName answers: at least one of
// the two must survive trimming, or there is no credit to publish under. The
// two fields stay SEPARATE all the way down (broker_profiles has a column for
// each) rather than being collapsed into one string here — publicBrokerRow in
// broker-directory.js lists them independently, and a firm is not a person.
function validateIdentity(input) {
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  // Control characters would travel into a public page and an admin CSV.
  // Formula-shaped values are handled downstream by guardFormula at the one
  // place they can do harm (csvCell), so they are deliberately not refused
  // here — a firm legitimately named "+Plus Realty" keeps its name.
  const clean = (v) =>
    text(String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F-\u009F]+/g, " "), MAX_SHORT_TEXT);
  const display_name = clean(src.display_name);
  const company = clean(src.company);
  if (!display_name && !company) {
    return { ok: false, error: "Enter your firm, or your own name if you work under it." };
  }
  return { ok: true, identity: { display_name, company } };
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

// --- Document extract ------------------------------------------------------
//
// A table PDF or a screenshot of one is read by a model, then classified here,
// then confirmed in the browser. Nothing in this section writes.
// sniffExtractMedia is a magic-byte check so a renamed .xlsx cannot reach the
// vendor. parseExtractJson only accepts an array — wrapping objects are a
// guess we refuse.

// What the extract path accepts. Images are here because the file a broker
// actually has is often a screenshot of a CoStar table or a photo of a comp
// sheet, not an exported PDF, and both providers read an image with the same
// call the PDF uses.
//
// The list is the INTERSECTION of what the two providers accept, not the union
// of it: Anthropic reads GIF and Gemini does not, Gemini reads HEIC and
// Anthropic does not, and a file that imports on one deployment and refuses on
// another is a bug report nobody can reproduce. Adding a type means checking
// both vendors, not one.
const EXTRACT_MEDIA_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

// The bytes decide, never the filename and never the browser's Content-Type:
// both are caller-supplied, and the whole point of this check is that what we
// forward to a third-party vendor is what it claims to be.
function sniffExtractMedia(bytes) {
  const b = bytes;
  if (!b || b.length < 12) return "";
  const at = (i, ...sig) => sig.every((v, k) => b[i + k] === v);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return "application/pdf";                 // %PDF
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  // RIFF....WEBP — the four size bytes in between are what makes this a
  // two-part check rather than one prefix.
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  // Recognized to be REFUSED by name below: an iPhone photo is the most likely
  // unsupported file to arrive here, and "unsupported file" would send a
  // broker looking for a fault in their comp sheet.
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {                                          // ....ftyp
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (brand === "heic" || brand === "heix" || brand === "heif" || brand === "mif1") return "image/heic";
  }
  return "";
}

// One place for every reason the extract route turns a file away, so the copy
// a broker reads cannot drift between the size check and the type check.
function checkExtractFile(bytes) {
  const media = sniffExtractMedia(bytes);
  if (media === "image/heic") {
    return {
      ok: false, mediaType: "",
      error: "iPhone HEIC photos can't be read yet. Save it as a JPEG, or send a screenshot instead.",
    };
  }
  if (!EXTRACT_MEDIA_TYPES.includes(media)) {
    return {
      ok: false, mediaType: "",
      error: "That file isn't something we can read. Use a PDF, or a PNG, JPEG or WebP screenshot.",
    };
  }
  if (bytes.length > MAX_EXTRACT_BYTES) {
    return { ok: false, mediaType: "", error: "That file is too large to read. The limit is 4 MB." };
  }
  return { ok: true, mediaType: media, error: "" };
}

// A vendor failure on extract is not a site-wide search outage. Search's
// upstreamError paints /admin red and tells the broker "comp search is
// unavailable"; this returns the spec copy and a status the extract route
// can send, with no UPSTREAM_HEALTH side effects.
function extractVendorError(status) {
  const n = Number(status) || 0;
  const err = new Error(n === 429
    ? "Too many uploads. Please wait a moment."
    : "Could not read that file. Nothing was saved.");
  err.statusCode = n === 429 ? 429 : 502;
  err.userMessage = err.message;
  return err;
}

function extractWasTruncated(stopReason) {
  const r = String(stopReason || "");
  return r === "max_tokens" || r === "MAX_TOKENS" || r === "incomplete";
}

function parseExtractJson(rawText) {
  const empty = { ok: false, rows: [], error: "We couldn't find a deals table in that file." };
  let text = String(rawText || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let starterPos = -1;
  let inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
    } else if (ch === "\"") inString = true;
    else if (ch === "[" || ch === "{") {
      starterPos = i;
      if (ch === "{") return empty;
      break;
    }
  }
  if (starterPos === -1) return empty;
  const start = starterPos;
  let depth = 0;
  inString = false;
  escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
    } else if (ch === "\"") inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return empty;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return empty;
    return { ok: true, rows: parsed, error: "" };
  } catch (err) {
    return empty;
  }
}

function vaultValues(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const k of VAULT_FIELD_KEYS) {
    if (src[k] == null) continue;
    const s = String(src[k]).trim();
    if (s) out[k] = s;
  }
  return out;
}

function classifyExtractRows(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.map((raw) => {
    const values = vaultValues(raw);
    const result = normalizeRow(values);
    return {
      values,
      error: result.ok ? null : (result.errors || []).join("; "),
    };
  });
}

function uploadPayloadToCsv({ csv, rows } = {}) {
  const hasRows = rows != null;
  const hasCsv = csv != null && csv !== "";
  if (hasRows && hasCsv) {
    return { ok: false, csv: "", error: "Send csv or rows, not both." };
  }
  if (hasRows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, csv: "", error: "Nothing to import." };
    }
    return { ok: true, csv: exportCsv(rows), error: "" };
  }
  if (typeof csv === "string") return { ok: true, csv, error: "" };
  return { ok: false, csv: "", error: "Nothing to import." };
}

module.exports = {
  normAddr,
  matchOffered,
  enforceVerifiedFlags,
  canPublish,
  creditName,
  validateIdentity,
  submissionRowFrom,
  parseCsv,
  isCommentRow,
  normalizeHeader,
  normalizedHeaderRow,
  suggestMapping,
  isRateHeader,
  validateMapping,
  applyHeaderMapping,
  inspectCsv,
  parseMoney,
  parseNumber,
  parseCoord,
  parsePercent,
  parseDate,
  parseTransaction,
  parsePropertyType,
  addressKey,
  normalizeRow,
  validateEdit,
  EDITABLE_FIELDS,
  isUuid,
  parseUpload,
  guardFormula,
  csvCell,
  templateCsv,
  exportColumns,
  exportCsv,
  exportRowsWithCoords,
  TEMPLATE_COLUMNS,
  OPTIONAL_SPEC_COLUMNS,
  PROPERTY_TYPES,
  MAX_ROWS_PER_UPLOAD,
  MAX_EXTRACT_BYTES,
  EXTRACT_MEDIA_TYPES,
  HEADER_ALIASES,
  MAPPABLE_TARGETS,
  REQUIRED_TARGETS,
  VAULT_FIELD_KEYS,
  EXTRACT_KEYS,
  sniffExtractMedia,
  checkExtractFile,
  parseExtractJson,
  classifyExtractRows,
  uploadPayloadToCsv,
  extractVendorError,
  extractWasTruncated,
};

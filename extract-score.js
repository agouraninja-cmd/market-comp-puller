// Scores the extraction test: 20 real comp files through POST /api/vault/extract,
// measured against hand-keyed ground truth. This is the gate on the whole
// Archive block (docs/superpowers/specs/2026-08-21-archive-email-ingestion-design.md
// §9, and the transition plan's own sequence step 1), so the numbers it
// produces decide whether email ingestion is worth building at all.
//
// Pure on purpose, like eval-score.js and for the same reason: `npm test`
// exercises every scoring judgment with no server, no vendor call, and no
// real broker file. scripts/extraction-eval.js owns the I/O.
//
// The vocabulary, fixed here so the numbers mean the same thing every run:
//   recall           deals found / deals actually in the file. A missed row is
//                    the worst failure — nothing on screen shows an absence.
//   field precision  of matched rows' fields present in BOTH extraction and
//                    truth, how many agree. Compared through broker-vault.js's
//                    own parsers, so "$1,250,000" and 1250000 are one value —
//                    the harness must not fail a row the importer would accept.
//   fabrication      a field present in the extraction and absent from the
//                    truth, or a whole extracted row matching no truth deal.
//                    THE number that decides the feature: normalizeRow catches
//                    a malformed value and cannot catch a well-formed
//                    invention, and a wrong number in a broker's own records
//                    is the one error nobody ever notices.
//   refusals         rows the vault's own validators rejected (the `error`
//                    field the route already returns). Counted and listed for
//                    a human to sort into "genuinely bad data" vs "good value
//                    the parser could not read" — that judgment is not
//                    automatable and is not pretended to be.
//
// Matching is by addressKey + deal date, with an addressKey-only rescue pass,
// because repeat properties are real (the vault's own repeat-property lesson:
// same street number, two cities). A truth deal may match at most one
// extracted row and vice versa — double-matching would let one lucky row hide
// a miss and a fabrication at once.

const VAULT = require("./broker-vault");

// Fields compared through a parser rather than as text, so formatting
// differences between the model's output and the truth file never score as
// errors. Anything not named here compares as collapsed, casefolded text.
const MONEY_FIELDS = new Set(["price", "rent_psf", "price_per_unit", "price_per_acre"]);
const NUMERIC_FIELDS = new Set(["size_sqft", "lot_acres", "units", "floor_plate", "year_built"]);
const PERCENT_FIELDS = new Set(["cap_rate"]);

// Never scored: `address` is the match key (scoring it double-counts every
// miss), and notes is free prose two honest readers write differently.
const UNSCORED = new Set(["address", "notes"]);

function canon(field, value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  let r = null;
  if (field === "deal_date") r = VAULT.parseDate(raw);
  else if (field === "transaction") r = VAULT.parseTransaction(raw);
  else if (field === "property_type") r = VAULT.parsePropertyType(raw);
  else if (MONEY_FIELDS.has(field)) r = VAULT.parseMoney(raw);
  else if (NUMERIC_FIELDS.has(field)) r = VAULT.parseNumber(raw);
  else if (PERCENT_FIELDS.has(field)) r = VAULT.parsePercent(raw);
  if (r && r.ok && r.value != null) return String(r.value);
  // Unparseable through the strict parser (or a text field): compare as
  // normalized text, so "Class A" and "class a" agree while staying honest
  // about values neither side can parse.
  return raw.toLowerCase().replace(/\s+/g, " ");
}

function fieldsOf(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (UNSCORED.has(k)) continue;
    const s = String(v == null ? "" : v).trim();
    if (s !== "") out[k] = s;
  }
  return out;
}

function rowKey(values) {
  const addr = VAULT.addressKey(values && values.address);
  const d = VAULT.parseDate(values && values.deal_date);
  return addr + "|" + (d && d.ok && d.value ? d.value : "");
}

/**
 * Score one file. `extracted` is the route's `rows` array
 * ([{ values, error }]); `truth` is the hand-keyed deals array.
 * Returns per-file tallies plus itemized misses/fabrications, because an
 * aggregate nobody can audit is a number nobody should trust.
 */
function scoreFile(extracted, truth) {
  const rows = Array.isArray(extracted) ? extracted : [];
  const deals = Array.isArray(truth) ? truth : [];

  const refusals = rows.filter((r) => r && r.error).map((r) => ({
    address: (r.values && r.values.address) || "(no address)",
    error: r.error,
  }));
  const usable = rows.filter((r) => r && !r.error && r.values);

  // Pass 1: address + date. Pass 2: address alone, first unmatched wins —
  // greedy is fine because within one file two truth deals at one address on
  // different dates already matched in pass 1 if the dates were read at all.
  const truthLeft = deals.map((d, i) => ({ d, i }));
  const pairs = [];
  const unmatchedRows = [];
  for (const pass of [1, 2]) {
    const pool = pass === 1 ? usable : unmatchedRows.splice(0);
    for (const row of pool) {
      const want = pass === 1
        ? rowKey(row.values)
        : VAULT.addressKey(row.values.address);
      const at = truthLeft.findIndex(({ d }) =>
        (pass === 1 ? rowKey(d) : VAULT.addressKey(d.address)) === want);
      if (at >= 0) pairs.push({ row, deal: truthLeft.splice(at, 1)[0].d });
      else unmatchedRows.push(row);
    }
  }

  const missed = truthLeft.map(({ d }) => d.address || "(no address)");
  const fabricatedRows = unmatchedRows.map((r) => r.values.address || "(no address)");

  // Field-level, over matched pairs only.
  let fieldsCompared = 0, fieldsCorrect = 0, fieldsFabricated = 0, fieldsOmitted = 0;
  const wrong = [];
  const fabricatedFields = [];
  const perField = {};
  const bump = (f, k) => {
    perField[f] = perField[f] || { compared: 0, correct: 0, fabricated: 0, omitted: 0 };
    perField[f][k]++;
  };
  for (const { row, deal } of pairs) {
    const got = fieldsOf(row.values);
    const want = fieldsOf(deal);
    for (const [f, v] of Object.entries(got)) {
      if (!(f in want)) {
        // Present in the output, absent from the source: the fatal class.
        fieldsFabricated++; bump(f, "fabricated");
        fabricatedFields.push({ address: deal.address, field: f, value: v });
        continue;
      }
      fieldsCompared++; bump(f, "compared");
      if (canon(f, v) === canon(f, want[f])) { fieldsCorrect++; bump(f, "correct"); }
      else wrong.push({ address: deal.address, field: f, got: v, want: want[f] });
    }
    for (const f of Object.keys(want)) {
      if (!(f in got)) { fieldsOmitted++; bump(f, "omitted"); }
    }
  }

  return {
    truthDeals: deals.length,
    matched: pairs.length,
    missed,
    fabricatedRows,
    refusals,
    fieldsCompared, fieldsCorrect, fieldsFabricated, fieldsOmitted,
    wrong, fabricatedFields, perField,
  };
}

/** Fold per-file scores into the run's headline numbers. */
function summarize(fileScores) {
  const t = {
    files: 0, truthDeals: 0, matched: 0, missedCount: 0,
    fabricatedRowCount: 0, refusalCount: 0,
    fieldsCompared: 0, fieldsCorrect: 0, fieldsFabricated: 0, fieldsOmitted: 0,
    perField: {},
  };
  for (const s of fileScores) {
    if (!s) continue;
    t.files++;
    t.truthDeals += s.truthDeals;
    t.matched += s.matched;
    t.missedCount += s.missed.length;
    t.fabricatedRowCount += s.fabricatedRows.length;
    t.refusalCount += s.refusals.length;
    t.fieldsCompared += s.fieldsCompared;
    t.fieldsCorrect += s.fieldsCorrect;
    t.fieldsFabricated += s.fieldsFabricated;
    t.fieldsOmitted += s.fieldsOmitted;
    for (const [f, c] of Object.entries(s.perField)) {
      const agg = t.perField[f] = t.perField[f] ||
        { compared: 0, correct: 0, fabricated: 0, omitted: 0 };
      for (const k of Object.keys(c)) agg[k] += c[k];
    }
  }
  t.recall = t.truthDeals ? t.matched / t.truthDeals : null;
  t.fieldPrecision = t.fieldsCompared ? t.fieldsCorrect / t.fieldsCompared : null;
  // Both invention shapes over everything extracted on matched rows + whole
  // invented rows — a single number for the single question that decides this.
  const extractedUnits = t.fieldsCompared + t.fieldsFabricated + t.fabricatedRowCount;
  t.fabricationRate = extractedUnits
    ? (t.fieldsFabricated + t.fabricatedRowCount) / extractedUnits : null;
  return t;
}

module.exports = { scoreFile, summarize, canon, rowKey, MONEY_FIELDS, NUMERIC_FIELDS, UNSCORED };

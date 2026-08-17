"use strict";
// ---------------------------------------------------------------------------
// Model-report parsing and normalization — PURE. No I/O beyond diagnostic
// console lines, no clock reads, no requires, same contract as
// entitlements.js and market.js, which is what lets `npm test` pin these
// coercions with no server boot.
//
// This file is the whole /api/comps parse pipeline
// (parseCompJson → expandCompKeys → normalizeSourceTypes → normalizeCurrency
// → normalizeTrendPct → reconcilePricePerSqft → normalizeSubjectAssessed),
// extracted from server.js 2026-08-08. A new pipeline step belongs HERE, not
// in a new file. (normalizeSubjectLastSale still lives in server.js.)
//
// Two deliberate injections keep this module require-free:
// TYPE_COMP_FIELDS stays in server.js — it is the prompt's source of truth
// and the add-comp-field skill's checker greps it there — so expandCompKeys
// takes it as an argument; and the source_type rule lives in corpus-audit.js
// (the audit must apply the SAME rule to old harvested rows), so
// normalizeSourceTypes takes enforcedSourceType as an argument too.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Safely extract a JSON object from Claude's text output
// ---------------------------------------------------------------------------
// The first balanced {...} in a text, found with the same string- and
// escape-aware walk the live-preview comp extractor uses — because the
// captured parse failure was a COMPLETE report followed by stray text
// containing a brace, which fools a first-{-to-last-} slice.
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseCompJson(rawText, stats) {
  let text = (rawText || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    text = text.slice(first, last + 1);
  }
  try {
    return stripEmDashes(JSON.parse(text));
  } catch (err) {
    // Layer A rescue (2026-08-04): try the first BALANCED object before
    // giving up — the comps sanity check keeps a stray early object from
    // being mistaken for the report (both lanes always return comps).
    const inner = extractFirstJsonObject(text);
    if (inner && inner.length < text.length) {
      try {
        const salvaged = JSON.parse(inner);
        if (salvaged && Array.isArray(salvaged.comps)) {
          console.warn(`Comp JSON salvaged: first balanced object parsed, ${text.length - inner.length} trailing chars discarded`);
          if (stats) stats.rescue = "salvaged";
          return stripEmDashes(salvaged);
        }
      } catch (_) { /* fall through to the diagnostic + rethrow */ }
    }
    // Evidence for the recurring "unexpected format" flake (a Phoenix search
    // failed BOTH attempts on 2026-08-03): log where the parse died and the
    // bytes around it, so one Render log line is enough to diagnose without
    // a reproduction. Bounded snippet, never the whole report. Rethrows —
    // behavior is unchanged.
    const at = Number((String(err.message).match(/position (\d+)/) || [])[1]);
    if (Number.isFinite(at)) {
      console.error(`Comp JSON parse failure at ${at}/${text.length}: ${JSON.stringify(text.slice(Math.max(0, at - 120), at + 200))}`);
    } else {
      console.error(`Comp JSON parse failure (${err.message}); head=${JSON.stringify(text.slice(0, 160))} tail=${JSON.stringify(text.slice(-160))}`);
    }
    throw err;
  }
}

// Site style rule: no em dashes anywhere. The prompt already forbids them,
// but models slip, so scrub every string in the parsed report. Numeric
// ranges become hyphens; prose dashes become commas.
function stripEmDashes(value) {
  if (typeof value === "string") {
    return value
      .replace(/(\d)\s*—\s*(\$?\d)/g, "$1-$2")
      .replace(/\s*—\s*/g, ", ");
  }
  if (Array.isArray(value)) return value.map(stripEmDashes);
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = stripEmDashes(value[k]);
  }
  return value;
}

// Compact comp encoding (2026-08-03): the model writes each comp under these
// SHORT keys and the server re-expands immediately after parse — the long key
// names alone measured 20-23% of a real report, and model OUTPUT is the wall
// clock. Long -> short. A NEW COMP FIELD NEEDS AN ENTRY HERE (the
// add-comp-field skill has the step). Shorts must stay unique and must never
// collide with a long name (a test pins both).
const SHORT_COMP_KEYS = {
  address: "a", date: "d", transaction: "t", size_sqft: "sf",
  price_or_rate: "p", price_per_sqft: "psf", cap_rate: "cap",
  tenancy: "ten", year_built: "yr", notes: "n", source_url: "u",
  source_type: "st", verified: "v",
  clear_height: "ch", dock_doors: "dd", building_class: "bc",
  floor_plate: "fp", center_type: "ct", anchor_tenant: "at",
  units: "un", price_per_unit: "ppu", lot_acres: "ac",
  price_per_acre: "ppa", zoning: "z", beds_baths: "bb",
  condition: "cd",
};
const LONG_COMP_KEYS = Object.fromEntries(
  Object.entries(SHORT_COMP_KEYS).map(([l, s]) => [s, l])
);

// Re-expand one short-keyed comp. Tolerant by design: long keys pass through
// (a model that ignores the encoding produces exactly the old behavior),
// unknown keys survive, and a long key wins over its short twin if both
// arrive. Never throws on junk — returns it unchanged.
function expandComp(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return c;
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    const long = LONG_COMP_KEYS[k];
    if (long) { if (!(long in c)) out[long] = v; }
    else out[k] = v;
  }
  return out;
}

// Expand every comp in a parsed report, then backfill omitted fields to ""
// for the base shape + this type's fields (+ tenancy/year_built unless Land),
// and coerce `verified` to a boolean — so the stored/served report is
// byte-shaped exactly like the pre-encoding output and nothing downstream
// (normalization, gate, cache, harvest, market pages) can meet undefined.
// `typeCompFields` is the caller's TYPE_COMP_FIELDS map (see the header).
function expandCompKeys(parsed, type, typeCompFields) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  const base = ["address", "date", "transaction", "size_sqft", "price_or_rate",
    "price_per_sqft", "cap_rate", "notes", "source_url", "source_type"];
  const spec = (typeCompFields || {})[type];
  const fill = [...base, ...(spec ? spec.fields : []),
    ...(type === "Land" ? [] : ["tenancy", "year_built"])];
  parsed.comps = parsed.comps.map((c) => {
    const e = expandComp(c);
    if (!e || typeof e !== "object" || Array.isArray(e)) return e;
    for (const k of fill) if (e[k] == null) e[k] = "";
    e.verified = e.verified === true;
    return e;
  });
  return parsed;
}

// currency/usd_rate drive the front-end's convert-to-USD toggle. Coerce to a
// safe pair: unknown/blank currency reads as USD (the pre-feature behavior),
// and a rate that isn't a positive finite number becomes null so the toggle
// simply doesn't render. Rates are sanity-bounded at 10: the strongest real
// currency is ~$3.3/unit, and anything larger is almost certainly an inverted
// rate (units-per-USD, e.g. MXN "18.7" or JPY "155") rather than a genuinely
// strong currency. This is a deliberate asymmetry: a bad rate keeps the
// currency label but drops the toggle (prices really are in that currency;
// relabeling them USD would be worse). usd_rate is left as a JS number (the
// front-end multiplies by it), unlike every other field, which stays a string.
function normalizeCurrency(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const code = String(parsed.currency || "").trim().toUpperCase();
  parsed.currency = /^[A-Z]{3}$/.test(code) ? code : "USD";
  const rate = Number(parsed.usd_rate);
  parsed.usd_rate =
    parsed.currency !== "USD" && Number.isFinite(rate) && rate > 0 && rate < 10
      ? rate
      : null;
  return parsed;
}

// source_type drives a trust badge and lands in CSV exports, so stray model
// values are coerced onto the enum. Unknown maps to "estimate": the label may
// under-claim a comp's provenance, never over-claim it. Both halves of the
// rule (coerce onto the enum, then ENFORCE the individual-property
// requirement) live in corpus-audit.js as enforcedSourceType, passed in by
// the caller — the prompt already forbids market-level rows as comps, but in
// thin markets the model pads anyway, and a prompt rule is a request while
// normalization is a guarantee.
function normalizeSourceTypes(parsed, enforcedSourceType) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  for (const c of parsed.comps) {
    if (!c || typeof c !== "object") continue;
    c.source_type = enforcedSourceType(c.source_type, c.address);
  }
  return parsed;
}

// A house's condition is the largest thing the valuation cannot see (see
// VALUATION.conditionSpread), so it is asked for as a CLOSED vocabulary rather
// than free text: four words, ranked, that a homeowner picking from a dropdown
// and a model reading a listing can both apply to the same house and mean the
// same thing.
//
// The gate is deliberately STRICT — exact matches and a short alias list, and
// anything else becomes "" (unknown) rather than a guess. This is the same
// reject-rather-than-guess stance yearOf takes with "c. 1994" and broker-vault
// takes with "1.2M", and it matters more here than usual: the value is shown
// as a fact in a comp table whose entire selling point is provenance, and a
// fuzzy matcher that reads "partially renovated" as Renovated would state
// something about a stranger's house that nobody checked.
//
// If the fill rate turns out poor, the fix is the PROMPT (which names the four
// words and tells the model to answer with exactly one of them), never a
// looser parser here. Widening this list is how a provenance column quietly
// becomes an opinion column.
const CONDITION_VALUES = ["Needs work", "Original", "Updated", "Renovated"];
const CONDITION_ALIASES = {
  "needs work": "Needs work", "needs-work": "Needs work",
  "needs_work": "Needs work", "needswork": "Needs work",
  "original": "Original", "updated": "Updated", "renovated": "Renovated",
};
function normalizeConditionValue(v) {
  const raw = String(v == null ? "" : v).trim().toLowerCase().replace(/\.$/, "");
  return CONDITION_ALIASES[raw] || "";
}
function normalizeConditions(parsed) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  for (const c of parsed.comps) {
    if (!c || typeof c !== "object") continue;
    // Only rewrite a key the comp actually carries: expandCompKeys backfills
    // "" for this type's fields, and writing the key onto a comp of a type
    // that never collects it would add a column's worth of empty strings to
    // every harvested Industrial row.
    if ("condition" in c) c.condition = normalizeConditionValue(c.condition);
  }
  return parsed;
}

// annual_price_trend_pct powers the front-end's time adjustment of older
// comps, so a bad value multiplies straight into the valuation. Coerce to a
// plain number and refuse anything outside +/-30%/yr (almost certainly a
// monthly figure, a whole-window change, or noise) — null simply disables
// the adjustment. Zero also maps to null: no trend means no indexing.
function normalizeTrendPct(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const v = Number(String(parsed.annual_price_trend_pct ?? "").replace(/%/g, "").trim());
  parsed.annual_price_trend_pct =
    Number.isFinite(v) && v !== 0 && Math.abs(v) <= 30 ? v : null;
  return parsed;
}

// ---------------------------------------------------------------------------
// $/SF reconciliation — the model's per-comp price_per_sqft feeds the
// valuation math directly, so verify it against the comp's own stated
// price ÷ size instead of taking it on faith. Fill it when missing, replace
// it when it disagrees with the comp's own figures by more than 10%
// (rounding never trips that; rate-vs-price and order-of-magnitude slips
// blow far past it). All three parsers are strict whole-string matchers on
// the displayMoney philosophy: a value that could mean two things (a range,
// a per-unit rate, a parenthetical) is refused, and refusal always means
// "leave the comp untouched" — never a guessed number.
// ---------------------------------------------------------------------------
const GROUPED_INT = /^\d{1,3}(,\d{3})+$/; // "6,400,000" yes; "12,50" no

function moneyNumberFrom(numStr, suffix) {
  const intPart = numStr.split(".")[0];
  if (intPart.includes(",") && !GROUPED_INT.test(intPart)) return null;
  const n = Number(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[
    (suffix || "").toLowerCase()
  ] || 1;
  return n * mult;
}

// Total sale price: "$6,400,000", "$1.2M", "1.2 million", "850K". Refuses
// ranges (em-dash ranges are already hyphens via stripEmDashes), per-SF
// rates, parentheticals, negatives — anything beyond one plain figure.
function parseSalePrice(s) {
  const m = /^\s*~?\s*(?:US)?\$?\s*([\d,]+(?:\.\d+)?)\s*(mm?|million|k|thousand|b|billion)?\s*\.?\s*$/i
    .exec(String(s || ""));
  return m ? moneyNumberFrom(m[1], m[2]) : null;
}

// Building size: "48,000", "48,000 SF", "48000 sq ft".
function parseSizeSqft(s) {
  const m = /^\s*~?\s*([\d,]+(?:\.\d+)?)\s*(?:sf|sq\.?\s?ft\.?|square\s+feet)?\s*$/i
    .exec(String(s || ""));
  return m ? moneyNumberFrom(m[1], "") : null;
}

// Stated $/SF: "$115", "115.50", "$115/SF". Unparseable reads as missing,
// which is safe — a fill only happens when price AND size parsed cleanly.
function parsePsf(s) {
  const m = /^\s*~?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:\/\s?sf)?\s*$/i.exec(String(s || ""));
  return m ? moneyNumberFrom(m[1], "") : null;
}

function reconcilePricePerSqft(parsed) {
  if (!parsed || !Array.isArray(parsed.comps)) return parsed;
  // "$" only for USD reports — a foreign report's prices are local currency,
  // and a baked-in "$" would be a false label (must run after normalizeCurrency).
  // Legacy cached payloads may lack the currency field entirely; blank reads
  // as USD, matching normalizeCurrency's own convention.
  const prefix = (parsed.currency || "USD") === "USD" ? "$" : "";
  const fmtPsf = (v) => {
    const r = v >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
    return prefix + r.toLocaleString("en-US");
  };
  for (const c of parsed.comps) {
    try {
      if (!c || typeof c !== "object") continue;
      // Same sale test as the front-end hero: blank transaction counts as sale.
      if (String(c.transaction || "").toLowerCase().startsWith("lease")) continue;
      const price = parseSalePrice(c.price_or_rate);
      const size = parseSizeSqft(c.size_sqft);
      if (price === null || size === null) continue;
      const derived = price / size;
      // Same sane per-SF band the front-end uses for user-added comps.
      if (derived < 1 || derived > 100000) continue;
      const stated = parsePsf(c.price_per_sqft);
      if (stated === null || Math.abs(stated - derived) / derived > 0.10) {
        c.price_per_sqft = fmtPsf(derived);
        c.psf_reconciled = true; // front-end discloses the recompute
      }
    } catch (err) {
      // Never let a malformed comp break the report — leave it untouched.
    }
  }
  return parsed;
}

// "Verified" is a badge only the server awards (a local broker vouched for the
// comp and our team reviewed it). The model is told not to use the word in
// narrative, but a prompt rule is a request and this is the guarantee: when the
// finished report carries NO verified comp, any narrative claim of verification
// is contradicted by the comp table the reader is looking at. Reported by a
// reviewer as "the summary says there are verified comps but then you're not
// showing any", where the badges read Estimate / News / Listing.
//
// Three deliberate limits:
//   - It only fires at ZERO verified comps. With even one, the word is accurate
//     and useful, and rewriting it would make the report LESS informative.
//   - It rewrites rather than deletes. Cutting a clause can strip the honesty
//     caveat the summary rules require in that same sentence; swapping the one
//     loaded word keeps the meaning and the sentence intact.
//   - Whole words only, case preserved, so "unverified" -> "unconfirmed" and a
//     sentence-initial "Verified" keeps its capital.
// Must run AFTER the badges are enforced, since it reads the final flags.
const VERIFIED_WORD_SWAPS = [
  [/\bunverified\b/gi, "unconfirmed"],
  [/\bbroker-verified\b/gi, "confirmed"],
  [/\bverifications\b/gi, "confirmations"],
  [/\bverification\b/gi, "confirmation"],
  [/\bverifiable\b/gi, "confirmable"],
  [/\bverifies\b/gi, "confirms"],
  [/\bverified\b/gi, "confirmed"],
  [/\bverify\b/gi, "confirm"],
];

// Preserve the original's capitalization so a sentence-initial word stays
// capitalized and an all-caps one stays shouted.
function matchCase(source, replacement) {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function scrubVerifiedWords(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const [re, to] of VERIFIED_WORD_SWAPS) {
    out = out.replace(re, (m) => matchCase(m, to));
  }
  return out;
}

function scrubUnearnedVerifiedClaims(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const comps = Array.isArray(parsed.comps) ? parsed.comps : [];
  // A real badge anywhere in the report makes the word legitimate.
  if (comps.some((c) => c && c.verified === true)) return parsed;

  parsed.summary = scrubVerifiedWords(parsed.summary);
  parsed.market_trend = scrubVerifiedWords(parsed.market_trend);
  if (Array.isArray(parsed.value_drivers)) {
    parsed.value_drivers = parsed.value_drivers.map((v) => scrubVerifiedWords(v));
  }
  if (parsed.price_discovery && typeof parsed.price_discovery === "object") {
    parsed.price_discovery.note = scrubVerifiedWords(parsed.price_discovery.note);
  }
  // Per-comp notes are narrative too, and sit in the same table as the badges
  // they would be contradicting, which is the tightest possible collision.
  for (const c of comps) {
    if (c && typeof c === "object") c.notes = scrubVerifiedWords(c.notes);
  }
  return parsed;
}

// The subject's county assessed (taxable) value — a public-record cross-check
// for the hero's approaches table, never a headline. Opposite of last-sale:
// VALUE is required (a year with no number is useless) and YEAR is optional
// (an assessment with no year is still a public number). Pure: the caller
// passes `now` so this module never reads the clock. Spec:
// docs/superpowers/specs/2026-08-14-tax-assessed-approach-design.md
function assessedYearOf(raw, now) {
  const s = String(raw == null ? "" : raw).trim();
  const m = /^(?:tax\s*year\s*)?(\d{4})$/i.exec(s);
  if (!m) return "";
  const y = Number(m[1]);
  if (y < 1990) return "";
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return "";
  if (y > now.getUTCFullYear() + 1) return "";
  return String(y);
}

function normalizeSubjectAssessed(parsed, now) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const raw = parsed.subject_assessed;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    delete parsed.subject_assessed;
    return parsed;
  }
  const str = (v) => String(v == null ? "" : v).trim();
  const value = str(raw.value).slice(0, 40);
  if (parseSalePrice(value) == null) {
    delete parsed.subject_assessed;
    return parsed;
  }
  let url = str(raw.source_url).slice(0, 500);
  if (!/^https?:\/\//i.test(url)) url = "";
  parsed.subject_assessed = {
    value,
    year: assessedYearOf(raw.year, now),
    source_url: url,
  };
  return parsed;
}

// The subject's current asking / list price, read off the same listing page
// the SUBJECT SIZE step already opens. A list price with no parseable dollar
// figure is dropped (unlike last sale, where a date with no price is still
// worth showing): without a number this field cannot feed askFit or the
// comparison card, and an empty "currently listed" line is noise. The URL
// is kept only when it is http(s). Not harvested: a listing is not a comp.
function normalizeSubjectAsking(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const raw = parsed.subject_asking;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    delete parsed.subject_asking;
    return parsed;
  }
  const str = (v) => String(v == null ? "" : v).trim();
  const price = str(raw.price).slice(0, 40);
  const m = String(price).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  const n = m ? parseFloat(m[0]) : NaN;
  if (!(n > 0)) { delete parsed.subject_asking; return parsed; }
  let url = str(raw.source_url).slice(0, 500);
  if (!/^https?:\/\//i.test(url)) url = "";
  parsed.subject_asking = { price, source_url: url };
  return parsed;
}

// The subject's construction year, same lookup as size / asking. Stored as a
// 4-digit number so valuation.js's yearOf can read it without a second parse
// convention. Anything that is not exactly a year in 1800-2100 is dropped.
function normalizeSubjectYearBuilt(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const raw = parsed.subject_year_built;
  if (raw == null || raw === "") { delete parsed.subject_year_built; return parsed; }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const y = Math.round(raw);
    if (y >= 1800 && y <= 2100) { parsed.subject_year_built = y; return parsed; }
    delete parsed.subject_year_built;
    return parsed;
  }
  const ym = String(raw).trim().match(/^(18|19|20)\d{2}$/);
  if (ym) { parsed.subject_year_built = Number(ym[0]); return parsed; }
  delete parsed.subject_year_built;
  return parsed;
}

module.exports = {
  extractFirstJsonObject,
  parseCompJson,
  stripEmDashes,
  SHORT_COMP_KEYS,
  expandCompKeys,
  normalizeSourceTypes,
  normalizeCurrency,
  normalizeTrendPct,
  parseSalePrice,
  parseSizeSqft,
  parsePsf,
  reconcilePricePerSqft,
  scrubUnearnedVerifiedClaims,
  normalizeSubjectAssessed,
  normalizeSubjectAsking,
  normalizeSubjectYearBuilt,
  CONDITION_VALUES,
  normalizeConditionValue,
  normalizeConditions,
};

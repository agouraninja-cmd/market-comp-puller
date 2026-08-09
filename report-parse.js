"use strict";
// ---------------------------------------------------------------------------
// Model-report parsing and normalization — PURE. No I/O beyond diagnostic
// console lines, no clock reads, no requires, same contract as
// entitlements.js and market.js, which is what lets `npm test` pin these
// coercions with no server boot.
//
// This file is the designated home of the /api/comps parse pipeline
// (parseCompJson → expandCompKeys → normalizeSourceTypes → normalizeCurrency
// → normalizeTrendPct → reconcilePricePerSqft), being extracted from
// server.js one function at a time as each gains tests. Still in server.js:
// normalizeSourceTypes, normalizeTrendPct, reconcilePricePerSqft. Add the
// next one HERE, not in a new file.
//
// TYPE_COMP_FIELDS deliberately stays in server.js — it is the prompt's
// source of truth and the add-comp-field skill's checker greps it there —
// so expandCompKeys takes it as an argument instead of importing it.
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

module.exports = {
  extractFirstJsonObject,
  parseCompJson,
  stripEmDashes,
  SHORT_COMP_KEYS,
  expandCompKeys,
  normalizeCurrency,
};

"use strict";
// ---------------------------------------------------------------------------
// Model-report normalization — PURE. No I/O, no clock reads, no requires,
// same contract as entitlements.js and market.js, which is what lets
// `npm test` pin these coercions with no server boot.
//
// This file is the designated home of the /api/comps parse pipeline
// (parseCompJson → expandCompKeys → normalizeSourceTypes → normalizeCurrency
// → normalizeTrendPct → reconcilePricePerSqft), being extracted from
// server.js one function at a time as each gains tests. Today it holds
// normalizeCurrency; the rest still live in server.js. Add the next one
// HERE, not in a new file.
// ---------------------------------------------------------------------------

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

module.exports = { normalizeCurrency };

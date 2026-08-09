"use strict";
// ---------------------------------------------------------------------------
// Report identity — PURE apart from Node's crypto (deterministic, no I/O).
// Extracted from server.js 2026-08-08 so `npm test` can pin the one contract
// that keeps a $20 single-report unlock working:
//
//   reportIdFor() must produce the same key as reportKeyOf() applied to the
//   plaintext index.html's exportReportKey() builds — the purchase key and
//   the export-tally key are the SAME string, which is what stops a bought
//   report burning a free export. test/report-id.test.js compiles the real
//   browser function out of index.html and proves the two agree; if you
//   change either builder, that test is the tripwire.
//
// The lookback deliberately left this key on 2026-08-04: while it was in
// there, a re-run at a wider window was a different id that matched no
// purchase, so a purchase could never carry Pro's ten-year window.
// ---------------------------------------------------------------------------
const crypto = require("crypto");

// Stable identity for "the same report". Hashed so no address is stored in a
// usage table; normalization (trim, lowercase, whitespace collapse) lives
// HERE so both callers — the purchase side and the export side — share it.
function reportKeyOf(raw) {
  return crypto.createHash("sha256")
    .update(String(raw || "").trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex").slice(0, 32);
}

// The identity a single-report purchase is keyed on: ADDRESS + TYPE.
// Derived from the SEARCH body, never accepted from the client as an id.
function reportIdFor({ address, type } = {}) {
  if (!address || !type) return "";
  return reportKeyOf([address, type].join("|"));
}

module.exports = { reportKeyOf, reportIdFor };

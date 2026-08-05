// ---------------------------------------------------------------------------
// Corpus audit — the structural integrity rules for the comp corpus.
//
// Deliberately PURE, like entitlements.js and comp-gate.js: no I/O, no fetch,
// no clock reads (the caller passes `now`), no require()s. That is what makes
// `npm test` able to exercise every rule with no database and no network.
//
// This module is also the ONE home of the badge-enforcement rule. It used to
// live inline in server.js's normalizeSourceTypes; the audit needs the same
// rule to detect rows that predate a tightening of it, and a second copy is
// exactly the hazard CLAUDE.md flags for compWeight and exportReportKey.
//
// Scope note: nothing here reads a source_url over the network. Roughly half
// the corpus cites hosts that hard-block server-side fetching (measured
// 2026-08-05), so every check is structural on purpose. See
// docs/superpowers/specs/2026-08-05-corpus-audit-design.md.
// ---------------------------------------------------------------------------

"use strict";

const SOURCE_TYPES = ["public_record", "listing", "news", "estimate"];

// Keyed on aggregate VOCABULARY, not on address shape: plenty of genuine small
// multifamily and retail comps are listed without a street number ("Highland
// Park Triplex, Pittsburgh, PA"), so requiring one would discard real data.
// Street names survive too: "123 Market St" has no aggregate word, while
// "Market Median" does.
const AGGREGATE_ADDRESS_RE =
  /\b(benchmark|median|average|avg|composite|index|market (report|data|summary|stats?|statistics)|year[\s-]end (summary|report))\b/i;

function isAggregateAddress(address) {
  return AGGREGATE_ADDRESS_RE.test(String(address || ""));
}

// The street-number test, kept byte-identical to the regex that shipped in
// server.js on 2026-07-30. It rejects hyphenated ranges ("7657-7695 S 5th
// Ave"), which under-claims a real address. Under-claiming is the safe
// direction, so the audit COUNTS these rather than widening the rule here.
const STREET_NUMBERED_RE = /^\s*\d+\s+\S/;

// The single badge rule. Coerces a model-supplied source_type onto the enum,
// then enforces the individual-property requirement. Unknown maps to
// "estimate": the label may under-claim a comp's provenance, never over-claim
// it.
function enforcedSourceType(claimed, address) {
  const raw = String(claimed || "").toLowerCase();
  let type =
    SOURCE_TYPES.find((t) => raw === t) ||
    (/record|assessor|deed|tax|county|public/.test(raw) ? "public_record"
      : /list|broker|flyer|loopnet|crexi|costar/.test(raw) ? "listing"
        : /news|article|press|announc/.test(raw) ? "news"
          : "estimate");
  if (type !== "estimate" &&
      (!STREET_NUMBERED_RE.test(String(address || "")) || isAggregateAddress(address))) {
    type = "estimate";
  }
  return type;
}

module.exports = {
  enforcedSourceType,
  isAggregateAddress,
  AGGREGATE_ADDRESS_RE,
  SOURCE_TYPES,
};

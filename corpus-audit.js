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

// --- Citation specificity ---------------------------------------------------

// Directionals and street-type suffixes differ too often between a URL slug
// and what a broker types to be worth matching on.
const STREET_STOPWORDS = new Set(["north", "south", "east", "west", "northeast", "northwest",
  "southeast", "southwest", "street", "road", "avenue", "boulevard", "drive", "lane", "way",
  "court", "place", "parkway", "highway", "circle", "terrace", "trail", "loop", "suite", "unit"]);

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || ""));
  return m ? m[1].toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "") : "";
}

// Path only (no host, no query), lowercased, so a host name can never be
// mistaken for evidence about the property.
function pathWordsOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(String(url || ""));
  if (!m) return "";
  return safeDecode(m[1] || "").toLowerCase();
}

function leadingNumber(address) {
  const m = /^\s*(\d+)/.exec(String(address == null ? "" : address));
  return m ? m[1] : null;
}

function tokensOf(text) {
  return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((t) => t.length >= 4 && !STREET_STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// Does the citation point at THIS property? Three signals, combined so no
// single weak one can pass on its own:
//   idMatch     a bounded run of 5+ digits, i.e. a listing id
//   numberMatch the street number as a bounded digit token in the path
//   tokenMatch  a distinctive word from the address in the path
//
// The compound (numberMatch AND street tokenMatch) defeats a real false
// positive: a four-digit year in a path ("/2025-05/") would otherwise match
// the street number of "2025 Main St". News gets a looser rule because a
// legitimate article names the deal without carrying the street number, and
// an early draft of this heuristic wrongly flagged exactly such a URL.
//
// This answers a question about the CITATION, never about whether the comp is
// true. Whether the deal is real needs the page, which this module
// deliberately never fetches.
function urlIdentifiesProperty(row) {
  const r = row || {};
  const path = pathWordsOf(r.source_url);
  if (!path) return false;
  const flat = path.replace(/[^a-z0-9]+/g, " ");

  if (/(^|[^0-9])\d{5,}([^0-9]|$)/.test(path)) return true;

  const streetLine = String(r.address == null ? "" : r.address).split(",")[0];
  const streetTokenMatch = tokensOf(streetLine).some((t) => flat.indexOf(t) >= 0);

  const num = leadingNumber(r.address);
  const numberMatch = !!num && num.length <= 10 &&
    new RegExp("(^|[^0-9])" + num + "([^0-9]|$)").test(path);
  if (numberMatch && streetTokenMatch) return true;

  if (String(r.source_type || "").toLowerCase() === "news") {
    return tokensOf(r.address).some((t) => flat.indexOf(t) >= 0);
  }
  return false;
}

module.exports = {
  enforcedSourceType,
  isAggregateAddress,
  urlIdentifiesProperty,
  hostOf,
  AGGREGATE_ADDRESS_RE,
  SOURCE_TYPES,
};

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

// LAND ONLY. An unimproved parcel has no building to number, so the market
// identifies it by its corner instead: "NEC 159th & Brentwood St" names one
// specific 0.55-acre parcel as precisely as a street number names a
// warehouse. The street-number rule above was written for BUILDINGS, and on
// the 2026-08-19 eval it demoted three real priced Olathe land listings to
// "estimate" -- 38% of that report's comps -- which is not padding being
// caught but real provenance being thrown away: "estimate" is excluded from
// corpus retrieval and from the accuracy backtest, so those rows are lost
// rather than merely mislabeled.
//
// Deliberately narrow. It requires an ampersand between two non-empty tokens,
// or an explicit corner designator, and it is tested against the STREET LINE
// (the text before the first comma) so a "&" in a city or company suffix
// cannot qualify one. " and " is NOT accepted: it appears inside ordinary
// names ("Land and Cattle Co") where "&" between two street names does not.
// The aggregate test still applies on top of this, so a genuine market-level
// row is still forced to estimate however it is punctuated.
const INTERSECTION_RE = /\S\s*&\s*\S/;
const CORNER_DESIGNATOR_RE =
  /\b(n[ew]c|s[ew]c|(north|south)(east|west) corner|n[ew] corner|s[ew] corner)\b/i;

function isIntersectionAddress(address) {
  const streetLine = String(address || "").split(",")[0] || "";
  return INTERSECTION_RE.test(streetLine) || CORNER_DESIGNATOR_RE.test(streetLine);
}

// The single badge rule. Coerces a model-supplied source_type onto the enum,
// then enforces the individual-property requirement. Unknown maps to
// "estimate": the label may under-claim a comp's provenance, never over-claim
// it.
// `propertyType` is OPTIONAL and only ever widens what counts as an
// individual property, never narrows it: omit it and this behaves exactly as
// it did before Land was given its corner-address exemption, which is what
// keeps every existing caller and every harvested row scored the same way.
function enforcedSourceType(claimed, address, propertyType) {
  const raw = String(claimed || "").toLowerCase();
  let type =
    SOURCE_TYPES.find((t) => raw === t) ||
    (/record|assessor|deed|tax|county|public/.test(raw) ? "public_record"
      : /list|broker|flyer|loopnet|crexi|costar/.test(raw) ? "listing"
        : /news|article|press|announc/.test(raw) ? "news"
          : "estimate");
  const identifiesOneProperty =
    STREET_NUMBERED_RE.test(String(address || "")) ||
    (String(propertyType || "") === "Land" && isIntersectionAddress(address));
  if (type !== "estimate" && (!identifiesOneProperty || isAggregateAddress(address))) {
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

// --- The assembled report ---------------------------------------------------

// Measured 2026-08-05: each of these answered 403 to a browser-User-Agent
// request, and together they cover roughly half the corpus. This is a snapshot
// of bot policy, not a fact about the data, which is why it is reported as
// context and NEVER scored. Scoring it would report a bot-detection rate while
// calling it an accuracy rate.
const BLOCKED_HOSTS = new Set([
  "loopnet.com", "cityfeet.com", "propertyshark.com", "commercialsearch.com",
]);

const FINDING_KEYS = ["weak_citation", "badge_drift", "shared_citation", "unparseable_date", "no_price"];

function normAddress(a) {
  return String(a == null ? "" : a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normUrl(u) {
  return typeof u === "string" ? u.trim().toLowerCase().replace(/\/+$/, "") : "";
}

// Presence of a price, not its value. Reads the FIRST numeric run rather than
// stripping every non-digit: real rows quote ranges ("$7.00-$12.00/SF/yr NNN"),
// and stripping turns that into "7.0012.00", which parses as NaN and would
// flag a perfectly good row as priceless. "Undisclosed" and "Rate Upon
// Request" still correctly have no number at all.
function hasPrice(row) {
  const num = (s) => {
    const m = /\d[\d,]*(?:\.\d+)?/.exec(String(s == null ? "" : s));
    return !!m && Number(m[0].replace(/,/g, "")) > 0;
  };
  return num(row.price_or_rate) || num(row.price_per_sqft);
}

// Lower index is stronger provenance.
function rankOf(t) {
  const i = SOURCE_TYPES.indexOf(t);
  return i === -1 ? SOURCE_TYPES.length : i;
}

// Report-only by design: this returns findings and NEVER mutates a row.
// Total by design: a malformed row yields findings rather than throwing, so
// one bad row can never take down the whole report.
function auditCorpus(rows, opts) {
  const list = Array.isArray(rows) ? rows : [];
  const parseDealDate = (opts && opts.parseDealDate) || (() => null);

  // Pre-pass: how many DISTINCT addresses cite each url. Two comps sharing one
  // url is the strongest available tell that a thin market was padded from a
  // single listing page.
  const addressesPerUrl = new Map();
  for (const raw of list) {
    const r = raw || {};
    const u = normUrl(r.source_url);
    if (!u) continue;
    if (!addressesPerUrl.has(u)) addressesPerUrl.set(u, new Set());
    addressesPerUrl.get(u).add(normAddress(r.address));
  }

  const findings = {};
  FINDING_KEYS.forEach((k) => { findings[k] = 0; });
  const hosts = { fetchable: 0, blocked: 0, unknown: 0 };
  const flagged = [];
  let clean = 0;

  for (const raw of list) {
    const r = raw || {};
    const found = [];

    if (!urlIdentifiesProperty(r)) found.push("weak_citation");

    // Drift: the row claims stronger provenance than today's rule would grant.
    const stored = String(r.source_type || "").toLowerCase();
    if (SOURCE_TYPES.includes(stored) &&
        rankOf(stored) < rankOf(enforcedSourceType(stored, r.address, r.property_type))) {
      found.push("badge_drift");
    }

    const u = normUrl(r.source_url);
    if (u && (addressesPerUrl.get(u) || new Set()).size > 1) found.push("shared_citation");

    if (parseDealDate(r.deal_date) == null) found.push("unparseable_date");
    if (!hasPrice(r)) found.push("no_price");

    const host = hostOf(r.source_url);
    if (!host) hosts.unknown++;
    else if (BLOCKED_HOSTS.has(host)) hosts.blocked++;
    else hosts.fetchable++;

    if (found.length === 0) { clean++; continue; }
    found.forEach((k) => { findings[k]++; });
    flagged.push({
      address: String(r.address == null ? "" : r.address).slice(0, 120),
      market: String(r.market == null ? "" : r.market).slice(0, 60),
      property_type: String(r.property_type == null ? "" : r.property_type).slice(0, 30),
      source_type: String(r.source_type == null ? "" : r.source_type).slice(0, 20),
      source_url: String(r.source_url == null ? "" : r.source_url).slice(0, 160),
      findings: found,
    });
  }

  // Deterministic ordering: worst first, then by address, so repeated runs on
  // unchanged data produce an identical list.
  flagged.sort((a, b) => (b.findings.length - a.findings.length) || a.address.localeCompare(b.address));

  return {
    total: list.length,
    clean,
    // An empty corpus scores 1 rather than NaN: there is nothing wrong with it.
    score: list.length ? clean / list.length : 1,
    findings,
    hosts,
    worst: flagged.slice(0, 15),
  };
}

module.exports = {
  auditCorpus,
  enforcedSourceType,
  isIntersectionAddress,
  isAggregateAddress,
  urlIdentifiesProperty,
  hostOf,
  AGGREGATE_ADDRESS_RE,
  SOURCE_TYPES,
  BLOCKED_HOSTS,
  FINDING_KEYS,
};

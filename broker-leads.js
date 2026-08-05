"use strict";
// ---------------------------------------------------------------------------
// Broker lead inbox rules — PURE. No I/O, no clock reads, no requires beyond
// this comment, same contract as entitlements.js and comp-gate.js, which is
// what lets `npm test` cover the privacy wall with no database.
//
// server.js owns every read and write, and computes every `market` with
// marketOf() before calling in. This module never parses an address.
//
// Spec: docs/superpowers/specs/2026-08-05-broker-lead-inbox-design.md
// ---------------------------------------------------------------------------

// One lead can fan out at most this many broker emails. A hot market with
// hundreds of covering brokers should not turn one form submit into a
// mail storm billed to the owner's Resend account.
const MAX_NOTIFY_PER_LEAD = 20;

// The inbox window. Leads are perishable; 90 days is already generous.
const LEAD_WINDOW_DAYS = 90;

function coverageKey(market, propertyType) {
  return `${String(market || "").trim()}|${String(propertyType || "").trim()}`;
}

function buildCoverageSet(rows) {
  const set = new Set();
  for (const r of rows || []) {
    if (!r) continue;
    const k = coverageKey(r.market, r.property_type);
    if (k !== "|") set.add(k);
  }
  return set;
}

// Leads arrive with `market` already computed by the caller (marketOf).
// Matching is EXACT, deliberately: both sides are written in canonical form,
// and a lenient match here would paper over a drift bug worth surfacing.
function filterLeadsForCoverage(leads, coverageRows) {
  const set = buildCoverageSet(coverageRows);
  return (leads || []).filter((l) => l && set.has(coverageKey(l.market, l.type)));
}

// THE PRIVACY WALL for leads. A broker-facing lead is exactly these six
// fields. Name, email, phone, company and street address exist on the input
// row and must never appear on the output — there is a test pinning the exact
// key list. Add a field here only with the same deliberation the spec gave
// these six.
function anonymizeLead(lead, introSet) {
  const size = Number(lead.size_sqft);
  return {
    id: lead.id,
    market: String(lead.market || ""),
    type: String(lead.type || ""),
    size_sqft: Number.isFinite(size) && size > 0 ? size : null,
    ts: String(lead.ts || ""),
    intro_requested: Boolean(introSet && introSet.has(String(lead.id))),
  };
}

// First inbox open: coverage rows derived from approved submissions. The
// caller supplies {market, property_type} pairs (market via marketOf).
function seedCoverageFromSubmissions(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!r || !String(r.market || "").trim() || !String(r.property_type || "").trim()) continue;
    const k = coverageKey(r.market, r.property_type);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ market: r.market, property_type: r.property_type, source: "earned" });
  }
  return out;
}

// A lead's size, as typed or as carried by report meta. Grouped digits are
// fine; shorthand ("1.2M") is refused rather than guessed — same principle as
// the vault importer. Bounded to keep nonsense out of broker emails.
function cleanSizeSqft(v) {
  const s = String(v == null ? "" : v).replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
}

// Coverage rows (already filtered to the lead's market+type by the caller's
// query) reduced to unique user ids, capped.
function notifyTargets(coverageRows) {
  const seen = new Set();
  const out = [];
  for (const r of coverageRows || []) {
    const id = r ? String(r.user_id || "") : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_NOTIFY_PER_LEAD) break;
  }
  return out;
}

module.exports = {
  coverageKey,
  buildCoverageSet,
  filterLeadsForCoverage,
  anonymizeLead,
  seedCoverageFromSubmissions,
  cleanSizeSqft,
  notifyTargets,
  MAX_NOTIFY_PER_LEAD,
  LEAD_WINDOW_DAYS,
};

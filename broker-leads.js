"use strict";
// ---------------------------------------------------------------------------
// Broker lead inbox rules — PURE. No I/O, no clock reads, no requires beyond
// this comment, same contract as entitlements.js and comp-gate.js, which is
// what lets `npm test` cover the privacy wall with no database.
//
// server.js owns every read and write, and computes every `market` with
// marketOf() before calling in. This module never parses an address.
//
// Property-type validation deliberately lives with VAULT.PROPERTY_TYPES in
// server.js, not here, so nobody grows a second enum that can drift from it.
//
// Spec: docs/superpowers/specs/2026-08-05-broker-lead-inbox-design.md
// ---------------------------------------------------------------------------

// One lead can fan out at most this many broker emails. A hot market with
// hundreds of covering brokers should not turn one form submit into a
// mail storm billed to the owner's Resend account.
const MAX_NOTIFY_PER_LEAD = 20;

// The inbox window. Leads are perishable; 90 days is already generous.
// The number is repeated as prose in the vault page's empty state and the
// My Desk card copy (server.js / index.html, Task 7) — keep all three in step.
const LEAD_WINDOW_DAYS = 90;

// A market is "City, ST" or it is not a market. marketOf() falls back to
// echoing address text when it finds no state (see server.js marketOf), which
// once put a street address in an analytics market column in production
// (2026-07-31). The same fallback must never key coverage, and must never
// render to a broker.
const MARKET_SHAPE = /^[^,]+,\s[A-Z]{2}$/;
function isCanonicalMarket(v) {
  return MARKET_SHAPE.test(String(v == null ? "" : v).trim());
}

// The "|" delimiter can't collide: property_type always comes from a closed
// enum (VAULT.PROPERTY_TYPES, none of which contain "|"), and every caller of
// this key requires market to already be canonical "City, ST" shape
// (isCanonicalMarket) before it gets here. The safety is those two
// constraints, not the choice of separator.
function coverageKey(market, propertyType) {
  return `${String(market || "").trim()}|${String(propertyType || "").trim()}`;
}

// `siblingsOf` is OPTIONAL and INJECTED, never required from market.js: this
// module's whole discipline is that it does not know what an address or a
// metro is -- the caller computes market with marketOf() before calling in,
// and now supplies the adjacency table the same way. Omit it and every
// behaviour below is byte-identical to before metro matching existed, which
// is what keeps the notify path, the tests, and any future caller safe by
// default.
function buildCoverageSet(rows, siblingsOf) {
  const set = new Set();
  const near = typeof siblingsOf === "function" ? siblingsOf : null;
  for (const r of rows || []) {
    if (!r) continue;
    const market = String(r.market || "").trim();
    const type = String(r.property_type || "").trim();
    if (!market || !type) continue;
    set.add(coverageKey(market, type));
    // A broker covering Boise industrial is covering Meridian industrial:
    // those cities trade as one market, which is exactly what METRO_GROUPS
    // records. The property type is NOT widened with it -- an industrial
    // broker in the next suburb is still an industrial broker, and crossing
    // types would put a retail lead in their inbox on the strength of
    // geography alone.
    if (!near) continue;
    for (const sib of near(market) || []) {
      if (isCanonicalMarket(sib)) set.add(coverageKey(sib, type));
    }
  }
  return set;
}

// Leads arrive with `market` already computed by the caller (marketOf).
// Matching is EXACT against that set, deliberately: both sides are written in
// canonical form, and a lenient match here (substring, case-folding, fuzzy
// city names) would paper over a drift bug worth surfacing. Metro adjacency is
// not leniency -- it is a curated list of cities that share one submarket,
// expanded into exact keys above.
function filterLeadsForCoverage(leads, coverageRows, siblingsOf) {
  const set = buildCoverageSet(coverageRows, siblingsOf);
  return (leads || []).filter((l) => l && set.has(coverageKey(l.market, l.type)));
}

// The market keys a NEW lead should alert on: its own, plus the rest of its
// metro. The inbox widens by expanding the broker's coverage; the notify path
// cannot -- it starts from one lead and queries coverage rows in SQL -- so it
// widens from the other end and asks for every market in the group. The two
// meet in the middle and agree, which they must: a broker who can see a lead
// in their inbox and was never emailed about it, or emailed about one the
// inbox then hides, is a bug either way.
//
// Always includes the market itself, and only ever returns canonical keys, so
// the caller can interpolate the result straight into a PostgREST in.() list.
function coverageMarketsFor(market, siblingsOf) {
  const key = String(market || "").trim();
  if (!isCanonicalMarket(key)) return [];
  const out = [key];
  const near = typeof siblingsOf === "function" ? siblingsOf : null;
  for (const sib of (near ? near(key) : []) || []) {
    if (isCanonicalMarket(sib) && out.indexOf(sib) < 0) out.push(sib);
  }
  return out;
}

// How many EXTRA markets a coverage row reaches, for the page to disclose.
// A broker whose stated coverage says "Boise, ID" and whose inbox shows a
// Meridian lead should not have to wonder whether that is a bug.
function nearbyCountFor(market, siblingsOf) {
  return Math.max(0, coverageMarketsFor(market, siblingsOf).length - 1);
}

// THE PRIVACY WALL for leads. A broker-facing lead is exactly these six
// fields. Name, email, phone, company and street address exist on the input
// row and must never appear on the output — there is a test pinning the exact
// key list. Add a field here only with the same deliberation the spec gave
// these six.
function anonymizeLead(lead, introSet) {
  const l = lead || {};
  return {
    id: l.id,
    market: isCanonicalMarket(l.market) ? String(l.market).trim() : "",
    type: String(l.type || ""),
    size_sqft: cleanSizeSqft(l.size_sqft),
    ts: String(l.ts || ""),
    intro_requested: Boolean(
      introSet && typeof introSet.has === "function" && introSet.has(String(l.id))),
  };
}

// First inbox open: coverage rows derived from approved submissions. The
// caller supplies {market, property_type} pairs (market via marketOf). A
// non-canonical market (marketOf's no-state fallback) is dropped rather than
// seeded, so it can never become a coverage key that matches nothing forever.
function seedCoverageFromSubmissions(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (!r || !isCanonicalMarket(r.market) || !String(r.property_type || "").trim()) continue;
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
// query) reduced to unique user ids, capped. The output is interpolated
// directly into a PostgREST `id=in.(...)` filter (server.js), so anything not
// UUID-shaped is dropped here rather than trusted downstream.
function notifyTargets(coverageRows) {
  const seen = new Set();
  const out = [];
  for (const r of coverageRows || []) {
    const id = r ? String(r.user_id || "") : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || seen.has(id)) continue;
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
  coverageMarketsFor,
  nearbyCountFor,
  anonymizeLead,
  seedCoverageFromSubmissions,
  cleanSizeSqft,
  notifyTargets,
  isCanonicalMarket,
  MAX_NOTIFY_PER_LEAD,
  LEAD_WINDOW_DAYS,
};

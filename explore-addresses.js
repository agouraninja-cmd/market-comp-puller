"use strict";
// ---------------------------------------------------------------------------
// Address Explorer pick list — which street-numbered buildings a visitor
// sees for a market, and which property type each one carries.
//
// PURE: no I/O, no clock, no requires. The route in server.js owns the
// corpus read and the Instant-badge cache probe; this module decides the
// list. That split is load-bearing: the explorer used to inherit the form's
// current type (Industrial by default), so Tabbing through the chips could
// not tell a warehouse from an office. Each picked row now carries its own
// type, and a type-less request interleaves classes so one dense industrial
// book cannot hide every other asset.
//
// isAggregateAddress and parseDealDate are injected so this file never
// grows a second copy of either (the repo already has one such pair —
// compWeight — and it carries a ⚠).
// ---------------------------------------------------------------------------

const MAX_ADDRESSES = 8;

// Same street-number rule the route shipped with: a leading number that
// isn't a quantity, so "10000 SF" and "12 units" never become a pin.
const STREET_OK = /^\d+\s+(?!(sf|sq|sqft|acres?|units?)\b)/i;

function streetKey(addr) {
  return String(addr || "").split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\b(street|avenue|boulevard|drive|road|lane|court|place|parkway|highway)\b/g,
      (w) => ({ street: "st", avenue: "ave", boulevard: "blvd", drive: "dr", road: "rd", lane: "ln", court: "ct", place: "pl", parkway: "pkwy", highway: "hwy" }[w]));
}

function isPortfolioRow(address) {
  return /&|\band\b/i.test(String(address || "").split(",")[0]);
}

function pickExploreAddresses(rows, opts) {
  const o = opts || {};
  const max = Number.isFinite(o.max) && o.max > 0 ? Math.floor(o.max) : MAX_ADDRESSES;
  const typeFilter = o.type ? String(o.type) : "";
  const market = String(o.market || "");
  const isAggregate = typeof o.isAggregateAddress === "function" ? o.isAggregateAddress : () => false;
  const parseDate = typeof o.parseDealDate === "function" ? o.parseDealDate : () => 0;

  const candidates = [];
  for (const r of rows || []) {
    const type = String((r && (r.property_type || r.type)) || "");
    if (typeFilter && type !== typeFilter) continue;
    if (!typeFilter && !type) continue;
    const a = String((r && r.address) || "").trim();
    if (!STREET_OK.test(a) || isAggregate(a) || isPortfolioRow(a)) continue;
    const address = a.includes(",") ? a : (market ? `${a}, ${market}` : a);
    candidates.push({
      address,
      type,
      dealDate: parseDate(r && r.deal_date) || 0,
      key: streetKey(a),
    });
  }

  candidates.sort((x, y) => (y.dealDate - x.dealDate) || x.address.localeCompare(y.address));

  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    unique.push({ address: c.address, type: c.type, dealDate: c.dealDate });
  }

  if (typeFilter) return unique.slice(0, max);

  // Round-robin across types so a dense industrial market cannot hide every
  // other class. Type order follows first appearance in the newest-deal
  // sort, so the sequence stays deterministic for the same corpus.
  const queues = new Map();
  const typeOrder = [];
  for (const c of unique) {
    if (!queues.has(c.type)) {
      queues.set(c.type, []);
      typeOrder.push(c.type);
    }
    queues.get(c.type).push(c);
  }
  const out = [];
  while (out.length < max) {
    let added = false;
    for (const t of typeOrder) {
      const q = queues.get(t);
      if (q && q.length) {
        out.push(q.shift());
        added = true;
        if (out.length >= max) break;
      }
    }
    if (!added) break;
  }
  return out;
}

module.exports = { pickExploreAddresses, streetKey, MAX_ADDRESSES };

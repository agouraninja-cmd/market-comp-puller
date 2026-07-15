// Shared market-snapshot distillation: turns one /api/comps response into the
// market-seed entry shape that renderMarketPageHTML consumes. Used by BOTH
// gen-market-seed.js (the curated seed script) and server.js's on-demand
// /api/explore-market endpoint — keep it dependency-free.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Markets with fewer priced sale comps than this are never PUBLISHED (the
// explorer may still show them as an ephemeral preview).
const MIN_PRICED_SALE_COMPS = 3;

function num(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : NaN;
}

function pct(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const r = (p / 100) * (n - 1);
  const lo = Math.floor(r), hi = Math.ceil(r);
  return lo === hi ? sorted[lo] : sorted[lo] + (r - lo) * (sorted[hi] - sorted[lo]);
}

// "Mar 2026" -> sortable integer (year*12 + month). NaN if unparseable.
function dateKey(s) {
  const m = String(s || "").toLowerCase().match(/([a-z]{3})[a-z]*\s+(\d{4})/);
  if (!m || !(m[1] in MONTHS)) return NaN;
  return Number(m[2]) * 12 + MONTHS[m[1]];
}

function slugify(type, city, state) {
  return `${type}-${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Distill a comps response into a market-page snapshot. Returns
// { snapshot, pricedSaleCount }; snapshot is null when there are ZERO priced
// sale comps (the $/SF tiles would be unrenderable). The ≥MIN_PRICED_SALE_COMPS
// publish gate is the CALLER's job — the explorer shows 1-2-comp snapshots as
// previews, while gen-market-seed drops them entirely.
function distillMarketSnapshot(t, data) {
  const comps = Array.isArray(data.comps) ? data.comps : [];

  // Sale comps only for pricing stats — lease $/SF/yr is a different unit.
  const saleComps = comps.filter((c) => !String(c.transaction || "").toLowerCase().startsWith("lease"));
  const ppsfVals = saleComps.map((c) => num(c.price_per_sqft)).filter((v) => v > 0).sort((a, b) => a - b);
  if (!ppsfVals.length) return { snapshot: null, pricedSaleCount: 0 };

  const keys = comps.map((c) => dateKey(c.date)).filter((k) => isFinite(k));
  const fmtKey = (k) => `${Object.keys(MONTHS)[k % 12].replace(/^./, (c) => c.toUpperCase())} ${Math.floor(k / 12)}`;
  const dateRange = keys.length ? `${fmtKey(Math.min(...keys))} – ${fmtKey(Math.max(...keys))}` : "";

  const snapshot = {
    type: t.type,
    city: t.city,
    state: t.state,
    generatedAt: new Date().toISOString().slice(0, 10),
    summary: String(data.summary || "").trim(),
    market_trend: String(data.market_trend || "").trim(),
    value_drivers: Array.isArray(data.value_drivers)
      ? data.value_drivers.map((d) => String(d || "").trim()).filter(Boolean).slice(0, 4)
      : [],
    cap_rate_low: (data.market_cap_rate_range && data.market_cap_rate_range.low) || "",
    cap_rate_high: (data.market_cap_rate_range && data.market_cap_rate_range.high) || "",
    ppsf: {
      count: ppsfVals.length,
      median: Math.round(pct(ppsfVals, 50)),
      low: Math.round(pct(ppsfVals, 25)),
      high: Math.round(pct(ppsfVals, 75)),
      min: Math.round(ppsfVals[0]),
      max: Math.round(ppsfVals[ppsfVals.length - 1]),
    },
    date_range: dateRange,
    comps: comps.slice(0, 8).map((c) => ({
      address: c.address || "",
      date: c.date || "",
      transaction: c.transaction || "",
      size_sqft: c.size_sqft || "",
      price_or_rate: c.price_or_rate || "",
      price_per_sqft: c.price_per_sqft || "",
      source_type: c.source_type || "",
    })),
  };
  return { snapshot, pricedSaleCount: ppsfVals.length };
}

module.exports = { MIN_PRICED_SALE_COMPS, slugify, distillMarketSnapshot };

// Regenerates market-seed.json — the static data behind the /markets SEO pages.
// Runs a real (cached) search per target market against a LOCAL running server
// and distills each into a market snapshot. One-off / refresh tool; commit the
// resulting market-seed.json. Usage: start the app (npm start), then:
//   node gen-market-seed.js
// Costs one billed Anthropic search per market that isn't already cached.

const fs = require("fs");
const path = require("path");

const BASE = process.env.GEN_BASE || "http://localhost:3000";

// Curated, high-value CRE search targets: real markets owners look up. Keep
// this list intentionally small — a few genuinely useful pages beat many thin
// ones. Add rows here and re-run to expand coverage.
const TARGETS = [
  { type: "Industrial", city: "Ontario", state: "CA" },
  { type: "Industrial", city: "Dallas", state: "TX" },
  { type: "Industrial", city: "Atlanta", state: "GA" },
  { type: "Industrial", city: "Phoenix", state: "AZ" },
  { type: "Industrial", city: "Columbus", state: "OH" },
  { type: "Office", city: "Dallas", state: "TX" },
  { type: "Office", city: "Atlanta", state: "GA" },
  { type: "Retail", city: "Phoenix", state: "AZ" },
  { type: "Retail", city: "Dallas", state: "TX" },
  { type: "Multifamily", city: "Atlanta", state: "GA" },
];

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

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

async function buildOne(t) {
  const body = { address: `${t.city}, ${t.state}`, type: t.type, note: "", months: 24, txFocus: "both" };
  const r = await fetch(`${BASE}/api/comps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const comps = Array.isArray(data.comps) ? data.comps : [];

  // Sale comps only for pricing stats — lease $/SF/yr is a different unit.
  const saleComps = comps.filter((c) => !String(c.transaction || "").toLowerCase().startsWith("lease"));
  const ppsfVals = saleComps.map((c) => num(c.price_per_sqft)).filter((v) => v > 0).sort((a, b) => a - b);
  if (ppsfVals.length < 3) {
    console.log(`  SKIP ${t.type} ${t.city}, ${t.state} — only ${ppsfVals.length} priced sale comps`);
    return null;
  }

  const keys = comps.map((c) => dateKey(c.date)).filter((k) => isFinite(k));
  const fmtKey = (k) => `${Object.keys(MONTHS)[k % 12].replace(/^./, (c) => c.toUpperCase())} ${Math.floor(k / 12)}`;
  const dateRange = keys.length ? `${fmtKey(Math.min(...keys))} – ${fmtKey(Math.max(...keys))}` : "";

  return {
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
}

(async () => {
  const out = {};
  for (const t of TARGETS) {
    process.stdout.write(`Generating ${t.type} — ${t.city}, ${t.state} ... `);
    try {
      const snap = await buildOne(t);
      if (snap) {
        out[slugify(t.type, t.city, t.state)] = snap;
        console.log(`ok (${snap.ppsf.count} comps, median $${snap.ppsf.median}/SF)`);
      }
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }
  const file = path.join(__dirname, "market-seed.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${Object.keys(out).length} market pages to ${file}`);
})();

// Regenerates market-seed.json — the static data behind the /markets SEO pages.
// Runs a real (cached) search per target market against a LOCAL running server
// and distills each into a market snapshot. One-off / refresh tool; commit the
// resulting market-seed.json. Usage: start the app (npm start), then:
//   node gen-market-seed.js              # refresh every target (merges: a failed
//                                        # target keeps its existing page)
//   node gen-market-seed.js --new-only   # only generate targets with no existing
//                                        # page — expansion runs bill only new markets
// Costs one billed Anthropic search per market that isn't already cached.

const fs = require("fs");
const path = require("path");

const BASE = process.env.GEN_BASE || "http://localhost:3000";

// Curated, high-value CRE search targets: real markets owners look up. Keep
// this list intentionally small — a few genuinely useful pages beat many thin
// ones. Add rows here and re-run to expand coverage.
const TARGETS = [
  // Industrial — the site's strongest vertical, so it gets the deepest coverage.
  { type: "Industrial", city: "Ontario", state: "CA" },
  { type: "Industrial", city: "Riverside", state: "CA" },
  { type: "Industrial", city: "Fontana", state: "CA" },
  { type: "Industrial", city: "Phoenix", state: "AZ" },
  { type: "Industrial", city: "Las Vegas", state: "NV" },
  { type: "Industrial", city: "Dallas", state: "TX" },
  { type: "Industrial", city: "Houston", state: "TX" },
  { type: "Industrial", city: "Atlanta", state: "GA" },
  { type: "Industrial", city: "Columbus", state: "OH" },
  { type: "Industrial", city: "Indianapolis", state: "IN" },
  { type: "Industrial", city: "Memphis", state: "TN" },
  { type: "Industrial", city: "Savannah", state: "GA" },
  // Office
  { type: "Office", city: "Dallas", state: "TX" },
  { type: "Office", city: "Atlanta", state: "GA" },
  { type: "Office", city: "Austin", state: "TX" },
  { type: "Office", city: "Nashville", state: "TN" },
  { type: "Office", city: "Charlotte", state: "NC" },
  { type: "Office", city: "Tampa", state: "FL" },
  { type: "Office", city: "Denver", state: "CO" },
  { type: "Office", city: "San Diego", state: "CA" },
  // Retail
  { type: "Retail", city: "Phoenix", state: "AZ" },
  { type: "Retail", city: "Dallas", state: "TX" },
  { type: "Retail", city: "Houston", state: "TX" },
  { type: "Retail", city: "Orlando", state: "FL" },
  { type: "Retail", city: "Las Vegas", state: "NV" },
  { type: "Retail", city: "San Antonio", state: "TX" },
  { type: "Retail", city: "Charlotte", state: "NC" },
  { type: "Retail", city: "Sacramento", state: "CA" },
  // Multifamily — often prices per unit, so some targets may miss the
  // ≥3-priced-sale-comps filter; prune persistent failures rather than
  // relaxing the filter.
  { type: "Multifamily", city: "Atlanta", state: "GA" },
  { type: "Multifamily", city: "Phoenix", state: "AZ" },
  { type: "Multifamily", city: "Dallas", state: "TX" },
  { type: "Multifamily", city: "Tampa", state: "FL" },
  { type: "Multifamily", city: "Austin", state: "TX" },
  { type: "Multifamily", city: "Charlotte", state: "NC" },
  { type: "Multifamily", city: "Las Vegas", state: "NV" },
  { type: "Multifamily", city: "Columbus", state: "OH" },
];

// Distillation lives in market-snapshot.js, shared with server.js's
// /api/explore-market endpoint so on-demand pages match seeded ones exactly.
const { MIN_PRICED_SALE_COMPS, slugify, distillMarketSnapshot } = require("./market-snapshot");

async function buildOne(t) {
  // NOTE: this body must stay in lockstep with /api/explore-market's internal
  // pipeline (same address format/note/months/txFocus and default maxComps) —
  // they share the search cache, and a mismatch would silently double-bill.
  const body = { address: `${t.city}, ${t.state}`, type: t.type, note: "", months: 24, txFocus: "both" };
  const r = await fetch(`${BASE}/api/comps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const { snapshot, pricedSaleCount } = distillMarketSnapshot(t, data);
  if (!snapshot || pricedSaleCount < MIN_PRICED_SALE_COMPS) {
    console.log(`  SKIP ${t.type} ${t.city}, ${t.state} — only ${pricedSaleCount} priced sale comps`);
    return null;
  }
  return snapshot;
}

(async () => {
  const file = path.join(__dirname, "market-seed.json");
  // Merge into the existing seed so a target that fails a re-run keeps its
  // live page instead of silently vanishing from the site.
  let out = {};
  try { out = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
  const newOnly = process.argv.includes("--new-only");
  for (const t of TARGETS) {
    const slug = slugify(t.type, t.city, t.state);
    if (newOnly && out[slug]) {
      console.log(`Skipping ${t.type} — ${t.city}, ${t.state} (exists; --new-only)`);
      continue;
    }
    process.stdout.write(`Generating ${t.type} — ${t.city}, ${t.state} ... `);
    try {
      const snap = await buildOne(t);
      if (snap) {
        out[slug] = snap;
        console.log(`ok (${snap.ppsf.count} comps, median $${snap.ppsf.median}/SF)`);
      } else if (out[slug]) {
        console.log(`  kept existing page for ${slug}`);
      }
    } catch (e) {
      console.log(`FAILED: ${e.message}${out[slug] ? " — kept existing page" : ""}`);
    }
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${Object.keys(out).length} market pages to ${file}`);
})();

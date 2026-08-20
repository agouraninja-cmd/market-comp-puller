#!/usr/bin/env node
// Backfill `direction` onto the market pages standing today, by READING the
// trend sentence each page already carries.
//
// WHY NOT A FRESH SEARCH. The momentum read the Explorer badge renders normally
// comes from `price_discovery.direction`, which every report asks the model for
// directly. distillMarketSnapshot only started keeping it on 2026-08-20, so the
// 42 pages built before that have none, and re-running the searches to get one
// costs a full regeneration of every page.
//
// But those pages are not silent about momentum. Each already stores
// `market_trend`, a researched sentence that the market page PRINTS, e.g.
// "Industrial sale prices in Ontario pulled back roughly 15% from 2022 peak
// levels through mid-2026". Sorting that sentence into one of three words
// invents nothing: it restates a claim the page already makes to the public,
// so the badge cannot end up contradicting the page it links to.
//
// It is still second-hand, which is why:
//   - the model must answer "unclear" rather than guess, and a great many of
//     these sentences ARE genuinely two-sided ("bifurcated", "held ... while
//     large-format compressed"). An unclear market keeps no badge, which is what
//     every market looked like before this ran.
//   - each page records direction_source, so a derived read is never mistaken
//     later for one the search actually produced.
//
// A regeneration overwrites these automatically: distillMarketSnapshot sets
// direction from price_discovery and stamps direction_source "price_discovery".
//
// Seed pages are rewritten in market-seed.json (committed; review the diff).
// Explorer pages are PATCHed into Supabase market_pages.
//
//   node scripts/derive-market-direction.js            # dry run, prints every call
//   node scripts/derive-market-direction.js --apply
"use strict";

const fs = require("fs");
const path = require("path");
const { DIRECTIONS } = require("../market-snapshot");

const REPO = path.join(__dirname, "..");
for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
const APPLY = process.argv.includes("--apply");

// Small and cheap on purpose: this is a three-way sort of one sentence, not a
// judgement about a market. The reasoning that matters already happened when
// the sentence was researched.
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = [
  "You sort a single sentence about commercial real estate SALE PRICES into one of four labels.",
  "",
  "Answer with exactly one word, lowercase, nothing else:",
  "  expanding    - the sentence says sale prices have been RISING",
  "  flat         - the sentence says prices have held roughly steady, or moved only slightly",
  "  contracting  - the sentence says sale prices have been FALLING",
  "  unclear      - anything else",
  "",
  "Answer 'unclear' whenever the sentence pulls both ways, for example when one",
  "segment rose while another fell, when pricing is described as bifurcated or",
  "mixed, or when it reports transaction VOLUME or investor interest rather than",
  "the direction of prices. Do not resolve a two-sided sentence by picking the",
  "bigger half, and do not use your own knowledge of the market. Judge only what",
  "this sentence claims.",
].join("\n");

async function classify(sentence) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: "user", content: sentence }],
    }),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const body = await r.json();
  // FIRST word only. The model answers with the label and occasionally starts
  // explaining itself, which max_tokens then cuts mid-sentence; reading the
  // whole reply would throw away a correct answer because of the trailing
  // chatter. Anything outside the vocabulary is "unclear", never coerced.
  const text = String((body.content || []).map((c) => c.text || "").join(""));
  const word = (text.trim().toLowerCase().match(/^[a-z]+/) || [""])[0];
  return DIRECTIONS.has(word) ? word : null;
}

(async () => {
  if (!API_KEY) { console.error("ANTHROPIC_API_KEY is not set."); process.exit(1); }

  const seedPath = path.join(REPO, "market-seed.json");
  const seedRaw = fs.readFileSync(seedPath, "utf8");
  const seed = JSON.parse(seedRaw);
  // Committed as 2-space JSON with NO trailing newline. Detected rather than
  // assumed: writing the file back in a shape one byte off its own reformats
  // all 27 pages and buries the real change in the diff.
  const seedTrailer = seedRaw.endsWith("\n") ? "\n" : "";
  let dbRows = [];
  if (SUPABASE_URL && SUPABASE_KEY) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/market_pages?select=slug,payload&limit=1000`, {
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (r.ok) dbRows = await r.json();
  }

  const targets = [
    ...Object.keys(seed).map((slug) => ({ slug, payload: seed[slug], store: "seed" })),
    ...dbRows.map((r) => ({ slug: r.slug, payload: r.payload, store: "db" })),
  ];

  const tally = { expanding: 0, flat: 0, contracting: 0, unclear: 0, skipped: 0 };
  const dbWrites = [];
  let seedChanged = false;

  for (const t of targets) {
    const p = t.payload;
    // Never overwrite a read the search itself produced.
    if (p.direction && p.direction_source !== "market_trend") { tally.skipped++; continue; }
    const sentence = String(p.market_trend || "").trim();
    if (!sentence) { tally.skipped++; continue; }

    const direction = await classify(sentence);
    tally[direction || "unclear"]++;
    console.log(`  ${t.slug.padEnd(34)} ${t.store.padEnd(5)} ${direction || "unclear (no badge)"}`);

    if (!direction) continue;
    if (t.store === "seed") {
      seed[t.slug] = { ...p, direction, direction_source: "market_trend" };
      seedChanged = true;
    } else {
      dbWrites.push({ slug: t.slug, payload: { ...p, direction, direction_source: "market_trend" } });
    }
  }

  console.log(`\n${targets.length} pages · expanding ${tally.expanding} · flat ${tally.flat}` +
    ` · contracting ${tally.contracting} · unclear ${tally.unclear} · skipped ${tally.skipped}`);
  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write."); return; }

  if (seedChanged) {
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + seedTrailer);
    console.log("market-seed.json rewritten — review the diff before committing.");
  }
  for (const row of dbWrites) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/market_pages?slug=eq.${encodeURIComponent(row.slug)}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`,
        "content-type": "application/json", prefer: "return=minimal",
      },
      body: JSON.stringify({ payload: row.payload }),
    });
    console.log(`  PATCH ${row.slug} -> ${r.status}`);
  }
})();

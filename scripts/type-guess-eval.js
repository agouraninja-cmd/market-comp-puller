#!/usr/bin/env node
// Can an AI tell a property's type from its address alone?
//
// WHY THIS EXISTS. The Comp report page (/bulk) asks for a property type in a
// <select> that silently defaults to its first option, Industrial, so a run
// where nobody touched it values an office building, a strip center or an
// apartment complex against warehouse comps. The owner wants the picker gone
// and the type guessed instead. This script measures whether that guess is
// good enough before anything is built on it.
//
// GROUND TRUTH is market-seed.json: 247 real deals the search pipeline found
// for the market pages, each found by a search FOR one type (an Industrial
// market page's comps were searched for as Industrial), most of them carrying
// that type's own fields (clear height and dock doors, unit counts, anchor
// tenants). The label is therefore "what kind of deal this was found as",
// which is close to but not exactly the truth: an industrial search can turn
// up a flex building. Every disagreement is checked by hand in the write-up,
// rather than the label being trusted blindly.
//
// THE GUESSER SEES ONLY THE ADDRESS. `build` writes two files: the labeled set
// (kept away from the guesser) and blind batches of { id, address } shuffled
// across types and markets, so a batch cannot be read as "these are all
// Ontario warehouses". `score` reads the guesses back and reports accuracy,
// per-type recall, the confusion matrix and how accurate the confident
// answers were.
//
// Usage:
//   node scripts/type-guess-eval.js build [outDir] [--per-type 20] [--batch 11] [--exclude a.json,b.json] [--seed N] [--prefix h]
//   node scripts/type-guess-eval.js run [dir] [--provider gemini|anthropic] [--no-search] [--prompt 2] [--model M] [--thinking low]
//                                       [--two-step [--deep-model M] [--deep-thinking medium]]
//   node scripts/type-guess-eval.js score <set.json> <guesses.json> [more guesses.json ...]   (later files win by id)
//
// `run` asks the production provider (needs that provider's key in the env or
// .env; it is billed). The 2026-10-09 results were produced without one, by
// Claude subagents given the exact guessPrompt() text, and are committed in
// docs/evals/type-guess/.
//
// A guesses file is a JSON array of { id, type, confidence, evidence }, where
// confidence is "high" | "medium" | "low". Several files are merged by id.
//
// Requiring this module starts nothing; the pure helpers are exported for
// test/type-guess-eval.test.js.

"use strict";

const fs = require("fs");
const path = require("path");

const TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];
const CONFIDENCE = ["high", "medium", "low"];

// mulberry32: a seeded shuffle, so `build` writes the same set every time and
// a rerun is comparable with the last one.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, seed) {
  const out = list.slice();
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A person types a street address. A comp written as a submarket or a
// district ("Financial District (general submarket estimate)") is not one, so
// it is not a fair question to ask.
function isStreetAddress(address) {
  return /^\s*\d+[A-Za-z]?(?:-\d+)?\s+\S/.test(String(address || ""));
}

// Every comp in the seed, flattened, deduped by address, street addresses only.
function seedRows(seed) {
  const seen = new Set();
  const rows = [];
  for (const [market, page] of Object.entries(seed)) {
    for (const c of page.comps || []) {
      const key = String(c.address || "").trim().toLowerCase();
      if (!isStreetAddress(c.address) || seen.has(key)) continue;
      seen.add(key);
      rows.push({ market, label: page.type, address: String(c.address).trim(), comp: c });
    }
  }
  return rows;
}

// Up to `perType` of each type, taken round-robin across that type's markets
// so no one city dominates a type's score.
function sampleSet(rows, perType, prefix = "t") {
  const byType = {};
  for (const r of rows) (byType[r.label] = byType[r.label] || []).push(r);
  const picked = [];
  for (const type of Object.keys(byType).sort()) {
    const byMarket = {};
    for (const r of byType[type]) (byMarket[r.market] = byMarket[r.market] || []).push(r);
    const queues = Object.keys(byMarket).sort().map((m) => byMarket[m].slice());
    const take = [];
    while (take.length < perType && queues.some((q) => q.length)) {
      for (const q of queues) if (q.length && take.length < perType) take.push(q.shift());
    }
    picked.push(...take);
  }
  return picked.map((r, i) => ({ id: prefix + String(i + 1).padStart(3, "0"), ...r }));
}

function blindBatches(set, size, seed) {
  const order = shuffle(set.map((r) => ({ id: r.id, address: r.address })), seed);
  const out = [];
  for (let i = 0; i < order.length; i += size) out.push(order.slice(i, i + size));
  return out;
}

// The one question every guesser is asked, word for word, whoever runs it (a
// Claude subagent in the 2026-10-09 runs, the `run` command against the
// production provider). The definitions are the app's own: Multifamily spans
// duplexes to 300-unit communities, a condo or townhome is Residential
// (report-and-valuation.md, flow 3a).
const TYPE_LINES = [
  "- Industrial: warehouse, distribution, logistics, manufacturing, flex / light industrial, industrial outdoor storage.",
  "- Office: office building, office park, medical office.",
  "- Retail: shopping center, strip center, store, restaurant, bank branch, gas station, single-tenant net-lease retail.",
  "- Multifamily: apartment building or complex, duplex to large community (2+ rental units on one property).",
  "- Land: vacant land, a lot or development site with no meaningful building.",
  "- Residential: single-family home, condo, townhome.",
];

const ANSWER_LINES = (batch) => [
  "Reply with ONLY a JSON array, one object per address, in this shape:",
  "[{\"id\":\"t001\",\"type\":\"Office\",\"confidence\":\"high\",\"evidence\":\"one short sentence\"}]",
  "",
  "Addresses:",
  ...batch.map((r) => `${r.id}: ${r.address}`),
];

// Version 1 is the first run's prompt, kept byte-identical so its committed
// guesses stay reproducible. Version 2 is the fix for what version 1 got
// wrong: all 13 of its misses were addresses it could not find, answered from
// a neighbour or a tenant directory. So version 2 says how to search (drop
// the street suffix, then deal words, then the parcel record), ranks the
// evidence (a page about THIS street number beats a business listed there,
// and a neighbour is not evidence), and says what to fall back on when
// nothing is found. It was written after reading version 1's misses, so its
// honest score is on the HOLDOUT set it never saw, not on the first 85.
function guessPrompt(batch, { search, version = 1 }) {
  // Version 3 is the DEEP pass: only for addresses a quick pass answered with
  // less than "high", i.e. ones it could not find. More searches, and the two
  // sources a quick pass skips: the county's parcel record (its land-use
  // code names the type) and the businesses listed at that exact number.
  if (version === 3) {
    return [
      "A quick web lookup could not find a page about the exact building at each street address below. Find out what kind of property it is, for a commercial real estate valuation tool.",
      "Choose exactly one type:",
      ...TYPE_LINES,
      "",
      "Work through these, up to 6 searches per address, and open a promising page with WebFetch when the snippet is not enough:",
      "1. The county's parcel or appraisal-district record for the address. Its land-use or property-class code names the type (e.g. warehouse, retail store, office, apartments, vacant land).",
      "2. Listing and deal sites for this exact street number: LoopNet, Crexi, CityFeet, apartment sites, sale news.",
      "3. The businesses listed at this exact street number (maps listings, directories). One tenant can mislead, but the mix tells you the building: shops, restaurants and personal services -> Retail; offices and clinics in suites -> Office; manufacturers, distributors, contractors and storage -> Industrial; an apartment community's name -> Multifamily.",
      "4. Variants of the address: without the street suffix, with the ZIP, with the cross street.",
      "A different street number, even next door, is not evidence about this building.",
      "Confidence: \"high\" if a page about this exact street number settles it; \"medium\" if the evidence about it is indirect or mixed; \"low\" if you still found nothing about it (then give your best guess).",
      ...ANSWER_LINES(batch),
    ].join("\n");
  }
  if (version === 2) {
    return [
      "You are finding out what kind of property sits at each street address below, for a commercial real estate valuation tool. The tool's users mostly look up commercial property, so a single-family house is the least likely answer unless a page shows it is one.",
      "Choose exactly one type:",
      ...TYPE_LINES,
      "",
      "How to look each address up (at most 3 searches per address; stop as soon as you have a page about this exact building):",
      "1. Search the street number, the street name WITHOUT its suffix, and the city, e.g. 1200 Elm Springfield. Pages write St/Street, Pkwy/Parkway, Rd/Road differently, so leave the suffix out.",
      "2. If nothing is about this exact building, search the same words plus words a deal page uses: sold, for lease, LoopNet, Crexi, apartments.",
      "3. If still nothing, search the county assessor or parcel record for the address.",
      "",
      "What counts as evidence:",
      "- Strong: a page about THIS street number on THIS street: a sale or lease listing, a news story about its sale, an apartment community's own site, the assessor's land-use code, a building or center name.",
      "- Weak: a business listed at the address (a doctor, a restaurant, a contractor). Businesses rent space in every kind of building: an office suite can sit in a warehouse, a restaurant can be a pad in a shopping center. Use it only to break a tie.",
      "- Not evidence: a different street number, even next door.",
      "- Building facts settle it: clear height, dock or loading doors -> Industrial; a unit count or 'apartments' -> Multifamily; a shopping center name, anchor tenants, a net-lease store -> Retail; suites on floors, Class A/B -> Office; acreage for sale with no building -> Land.",
      "If nothing is about this exact building, answer from the street itself: business parks and streets named Commerce, Industrial, Distribution, Logistics, Trade Center or Business Park point to Industrial; otherwise use the land use you can see on the same street and in the ZIP.",
      "Confidence: \"high\" only if you found a page about this exact street number; \"medium\" if what you found about it is weak or conflicting; \"low\" if you found nothing about it.",
      ...ANSWER_LINES(batch),
    ].join("\n");
  }
  return [
    "You are classifying commercial real estate by address. For each address below, decide what the property AT THAT ADDRESS is today.",
    "Choose exactly one type:",
    ...TYPE_LINES,
    search
      ? "Look each address up on the web (at most 2 searches per address) and use what you find: listings, county records, news of the sale, the tenant's own site, the building's name."
      : "Do NOT search or use any tool. Answer from the address text alone (street name, city, ZIP, what you know about the area).",
    "Confidence: \"high\" only if you found (or know) what this exact address is; \"medium\" for strong indirect evidence; \"low\" for a guess.",
    ...ANSWER_LINES(batch),
  ].join("\n");
}

function normType(t) {
  const s = String(t || "").trim().toLowerCase();
  return TYPES.find((x) => x.toLowerCase() === s) || null;
}

function normConfidence(c) {
  const s = String(c || "").trim().toLowerCase();
  return CONFIDENCE.includes(s) ? s : "low";
}

function pct(n, d) {
  return d ? Math.round((1000 * n) / d) / 10 : null;
}

// The whole report, as data. A guess for an id not in the set is ignored; an
// id with no guess counts as wrong, never as skipped, because a guesser that
// silently drops the hard ones would otherwise score better than it is.
function score(set, guesses) {
  const byId = new Map();
  for (const g of guesses) if (g && g.id) byId.set(g.id, g);
  const labels = [...new Set(set.map((r) => r.label))].sort((a, b) => TYPES.indexOf(a) - TYPES.indexOf(b));
  const cols = TYPES.slice();
  const matrix = {};
  for (const l of labels) { matrix[l] = {}; for (const c of cols.concat(["(none)"])) matrix[l][c] = 0; }
  const perType = {};
  const byConf = {};
  for (const c of CONFIDENCE) byConf[c] = { n: 0, right: 0 };
  const misses = [];
  let right = 0;
  for (const r of set) {
    const g = byId.get(r.id);
    const guess = g ? normType(g.type) : null;
    const conf = g ? normConfidence(g.confidence) : "low";
    const ok = guess === r.label;
    matrix[r.label][guess || "(none)"]++;
    const p = (perType[r.label] = perType[r.label] || { n: 0, right: 0 });
    p.n++;
    byConf[conf].n++;
    if (ok) { right++; p.right++; byConf[conf].right++; }
    else misses.push({ id: r.id, address: r.address, market: r.market, label: r.label, guess: guess || "(none)", confidence: conf, evidence: g ? String(g.evidence || "") : "" });
  }
  for (const t of Object.keys(perType)) perType[t].pct = pct(perType[t].right, perType[t].n);
  for (const c of CONFIDENCE) byConf[c].pct = pct(byConf[c].right, byConf[c].n);
  // The product question: if only a HIGH-confidence guess sets the type and
  // anything less asks the user, how often does it ask, and how often is an
  // automatic answer wrong?
  const auto = byConf.high;
  return {
    n: set.length,
    right,
    accuracy: pct(right, set.length),
    perType,
    byConfidence: byConf,
    autoPick: { answered: auto.n, coverage: pct(auto.n, set.length), wrong: auto.n - auto.right, accuracy: auto.pct },
    matrix,
    misses,
  };
}

function formatReport(name, rep) {
  const lines = [];
  lines.push(`## ${name}`);
  lines.push(`Overall: ${rep.right}/${rep.n} right (${rep.accuracy}%)`);
  lines.push("");
  lines.push("Per type:");
  for (const [t, p] of Object.entries(rep.perType)) lines.push(`  ${t.padEnd(12)} ${p.right}/${p.n} (${p.pct}%)`);
  lines.push("");
  lines.push("By confidence:");
  for (const c of CONFIDENCE) {
    const b = rep.byConfidence[c];
    lines.push(`  ${c.padEnd(7)} ${b.right}/${b.n}${b.n ? ` (${b.pct}%)` : ""}`);
  }
  lines.push(`Auto-pick on high only: answers ${rep.autoPick.coverage}% of addresses, wrong ${rep.autoPick.wrong} times (${rep.autoPick.accuracy}% right); the rest ask the user.`);
  lines.push("");
  const cols = TYPES.concat(["(none)"]).filter((c) => Object.values(rep.matrix).some((row) => row[c]));
  lines.push("Confusion (rows = label, columns = guess):");
  lines.push("  " + "".padEnd(12) + cols.map((c) => c.slice(0, 6).padStart(7)).join(""));
  for (const [l, row] of Object.entries(rep.matrix)) lines.push("  " + l.padEnd(12) + cols.map((c) => String(row[c] || 0).padStart(7)).join(""));
  if (rep.misses.length) {
    lines.push("");
    lines.push("Misses:");
    for (const m of rep.misses) lines.push(`  ${m.id} [${m.label} -> ${m.guess}, ${m.confidence}] ${m.address} :: ${m.evidence}`);
  }
  return lines.join("\n");
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function argValue(argv, flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
}

// The model's reply is meant to be a bare JSON array, but a model that wraps
// it in a sentence or a code fence should not cost the whole batch.
function parseGuesses(text) {
  const s = String(text || "");
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try {
    const out = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(out) ? out.filter((g) => g && typeof g === "object" && g.id) : [];
  } catch (_) { return []; }
}

// server.js's .env rule: fill only what is undefined, so an empty string set
// by the caller stays empty.
function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch (_) { /* no .env, no keys */ }
}

const PROVIDERS = {
  gemini: () => require("../search-provider-gemini.js"),
  anthropic: () => require("../search-provider-anthropic.js"),
};

// Asks the PRODUCTION provider the same questions the 2026-10-09 runs asked
// Claude subagents, through the same provider modules server.js uses. Every
// call is billed to the key's account (a few cents a set on Gemini Flash).
async function askProvider(batches, { providerName, search, model, thinkingLevel, version }) {
  const make = PROVIDERS[providerName];
  if (!make) throw new Error(`unknown provider "${providerName}" (gemini | anthropic)`);
  const provider = make();
  loadDotEnv();
  const apiKey = (process.env[provider.apiKeyEnv] || "").trim();
  if (!apiKey) throw new Error(`${provider.apiKeyEnv} is not set (env or .env)`);
  const useModel = model || process.env.MODEL || provider.defaultModel;
  const all = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const started = Date.now();
    const body = provider.buildRequestBody({
      model: useModel, prompt: guessPrompt(batch, { search, version }), maxComps: 12,
      searchUses: batch.length * (version === 3 ? 6 : version === 2 ? 3 : 2), thinkingLevel,
    });
    if (!search) delete body.tools;
    const init = provider.requestInit({ apiKey, model: useModel });
    const res = await fetch(init.url, { method: "POST", headers: init.headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`batch ${i + 1}: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    const got = parseGuesses(provider.parseResponse(data).text);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`v${version} batch ${i + 1}/${batches.length}: ${got.length}/${batch.length} answered in ${secs}s`);
    all.push(...got);
  }
  return all;
}

// The design under test (docs/superpowers/specs/2026-10-09-auto-property-type-design.md):
// a quick pass on every address, then the deep pass (version 3) on every
// answer that came back less than "high". --deep-model / --deep-thinking let
// the deep pass think harder than the quick one.
async function runProvider(dir, opts) {
  const batches = readJson(path.join(dir, "blind-batches.json"));
  const tag = `${opts.providerName}${opts.search ? "" : "-nosearch"}${opts.version > 1 ? "-v" + opts.version : ""}`;
  const quick = await askProvider(batches, opts);
  const quickOut = path.join(dir, `guesses-${tag}.json`);
  fs.writeFileSync(quickOut, JSON.stringify(quick, null, 1) + "\n");
  console.log(`${quick.length} guesses -> ${quickOut}`);
  if (!opts.twoStep) return [quickOut];
  const byId = new Map(batches.flat().map((r) => [r.id, r]));
  const unsure = quick.filter((g) => normConfidence(g.confidence) !== "high" && byId.has(g.id)).map((g) => byId.get(g.id));
  const deepBatches = [];
  for (let i = 0; i < unsure.length; i += 6) deepBatches.push(unsure.slice(i, i + 6));
  const deep = await askProvider(deepBatches, {
    ...opts, version: 3, model: opts.deepModel || opts.model, thinkingLevel: opts.deepThinking || opts.thinkingLevel,
  });
  const deepOut = path.join(dir, `guesses-${tag}-deep.json`);
  fs.writeFileSync(deepOut, JSON.stringify(deep, null, 1) + "\n");
  console.log(`${unsure.length} unsure -> ${deep.length} deep guesses -> ${deepOut}`);
  return [quickOut, deepOut];
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === "build") {
    const outDir = argv[1] && !argv[1].startsWith("--") ? argv[1] : "docs/evals/type-guess";
    const perType = argValue(argv, "--per-type", 20);
    const size = argValue(argv, "--batch", 11);
    const seed = readJson(path.join(__dirname, "..", "market-seed.json"));
    // --exclude <set.json> builds a HOLDOUT: none of that set's addresses, so a
    // prompt written after reading one set's misses is scored on addresses it
    // was never tuned on.
    const exIdx = argv.indexOf("--exclude");
    // Comma-separate several sets to exclude all of them.
    const excluded = new Set(exIdx >= 0
      ? argv[exIdx + 1].split(",").flatMap((p) => readJson(p)).map((r) => r.address.trim().toLowerCase())
      : []);
    const pIdx = argv.indexOf("--prefix");
    const prefix = pIdx >= 0 ? argv[pIdx + 1] : exIdx >= 0 ? "h" : "t";
    const set = sampleSet(seedRows(seed).filter((r) => !excluded.has(r.address.toLowerCase())), perType, prefix);
    fs.mkdirSync(outDir, { recursive: true });
    const labeled = set.map((r) => ({
      id: r.id, address: r.address, label: r.label, market: r.market,
      source_url: r.comp.source_url || "", source_type: r.comp.source_type || "",
    }));
    fs.writeFileSync(path.join(outDir, "set.json"), JSON.stringify(labeled, null, 1) + "\n");
    const batches = blindBatches(set, size, argValue(argv, "--seed", 20261009));
    fs.writeFileSync(path.join(outDir, "blind-batches.json"), JSON.stringify(batches, null, 1) + "\n");
    const counts = {};
    for (const r of set) counts[r.label] = (counts[r.label] || 0) + 1;
    console.log(`${set.length} addresses`, counts, `in ${batches.length} blind batches -> ${outDir}`);
    return 0;
  }
  if (cmd === "score") {
    const [setPath, ...guessPaths] = argv.slice(1);
    if (!setPath || !guessPaths.length) { console.error("usage: score <set.json> <guesses.json> [...]"); return 2; }
    const set = readJson(setPath);
    const guesses = guessPaths.flatMap((p) => readJson(p));
    const rep = score(set, guesses);
    console.log(formatReport(guessPaths.map((p) => path.basename(p)).join(" + "), rep));
    return 0;
  }
  if (cmd === "run") {
    const dir = argv[1] && !argv[1].startsWith("--") ? argv[1] : "docs/evals/type-guess";
    const flag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
    return runProvider(dir, {
      providerName: flag("--provider") || process.env.SEARCH_PROVIDER || "gemini",
      search: !argv.includes("--no-search"),
      model: flag("--model"),
      thinkingLevel: flag("--thinking") || process.env.THINKING_LEVEL || undefined,
      version: [2, 3].includes(Number(flag("--prompt"))) ? Number(flag("--prompt")) : 1,
      twoStep: argv.includes("--two-step"),
      deepModel: flag("--deep-model"),
      deepThinking: flag("--deep-thinking"),
    }).then((outs) => {
      // Later files win by id, so quick + deep scores the two-step result.
      const guesses = outs.flatMap((p) => readJson(p));
      console.log(formatReport(outs.map((p) => path.basename(p)).join(" + "), score(readJson(path.join(dir, "set.json")), guesses)));
      return 0;
    });
  }
  console.error("usage: node scripts/type-guess-eval.js build|run|score ...");
  return 2;
}

module.exports = { TYPES, rng, shuffle, isStreetAddress, seedRows, sampleSet, blindBatches, guessPrompt, parseGuesses, normType, normConfidence, score, formatReport };

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2))).then(
    (code) => { process.exitCode = code; },
    (err) => { console.error(err.message || err); process.exitCode = 1; });
}

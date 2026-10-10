// Working out a property's type from its address, so nobody has to pick one.
//
// WHY THIS EXISTS. Every report needs a property type, and asking people for
// it failed in the most expensive way: the Comp report page's type box
// silently started on Industrial, so a run nobody touched valued an office
// tower or an apartment complex against warehouse sales. The owner asked for
// the picker to go entirely (2026-10-09). This module holds the rules for the
// lookup that replaces it; server.js owns the calls, the memo and the routes.
// Spec and measurements:
//   docs/superpowers/specs/2026-10-09-auto-property-type-design.md
//   docs/evals/2026-10-09-property-type-guess.md
//
// TWO PASSES, BECAUSE THAT IS WHAT MEASURED ABOVE 90%. A quick lookup (up to
// 3 searches) answers every address with a type and how sure it is. Only an
// answer below "high" gets the deep lookup (up to 6 searches: the county's
// parcel record, listings for that exact street number, the businesses listed
// there). On 100 real addresses never used to write these instructions, the
// quick pass alone got 88 and quick + deep got 97; every "high" answer was
// right. The quick pass alone, reworded three ways, never beat ~85-92%: what
// moved the number was the second look at the unsure third, not the wording.
//
// THE PROMPT TEXT IS THE MEASURED TEXT. quickPrompt and deepPrompt are,
// byte for byte, versions 2 and 3 of scripts/type-guess-eval.js, which
// imports them from here rather than keeping a copy. Change a word and the
// measurement no longer describes production: rerun the eval
// (`node scripts/type-guess-eval.js run <set> --two-step`) before shipping.
//
// Pure and dependency-free: no fetch, no env, no clock. Required by server.js
// and by the eval script; tested in test/property-type.test.js.

"use strict";

// ⚠ Must equal broker-vault.js PROPERTY_TYPES, the list every report, the
// vault and the hidden #propertyType select are built from. test/property-
// type.test.js fails the build if the two drift.
const TYPES = ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"];
const CONFIDENCE = ["high", "medium", "low"];

// Searches each pass may spend per address. Anthropic honors these as the
// web_search tool's max_uses; Gemini's google_search takes no cap, so there
// the prompt's own "at most N searches" is the only limit.
const QUICK_SEARCHES = 3;
const DEEP_SEARCHES = 6;

// The app's own definitions: Multifamily spans duplexes to 300-unit
// communities, a condo or townhome is Residential (report-and-valuation.md,
// flow 3a).
const TYPE_LINES = [
  "- Industrial: warehouse, distribution, logistics, manufacturing, flex / light industrial, industrial outdoor storage.",
  "- Office: office building, office park, medical office.",
  "- Retail: shopping center, strip center, store, restaurant, bank branch, gas station, single-tenant net-lease retail.",
  "- Multifamily: apartment building or complex, duplex to large community (2+ rental units on one property).",
  "- Land: vacant land, a lot or development site with no meaningful building.",
  "- Residential: single-family home, condo, townhome.",
];

// The answer shape, and the addresses as `id: address` lines. Production asks
// about one address at a time, as a list of one, so the reply is parsed the
// same way the eval parsed its batches.
const ANSWER_LINES = (batch) => [
  "Reply with ONLY a JSON array, one object per address, in this shape:",
  "[{\"id\":\"t001\",\"type\":\"Office\",\"confidence\":\"high\",\"evidence\":\"one short sentence\"}]",
  "",
  "Addresses:",
  ...batch.map((r) => `${r.id}: ${r.address}`),
];

// The quick pass (the eval's version 2).
function quickPrompt(batch) {
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

// The deep pass (the eval's version 3), only for answers below "high".
function deepPrompt(batch) {
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

function normType(t) {
  const s = String(t || "").trim().toLowerCase();
  return TYPES.find((x) => x.toLowerCase() === s) || null;
}

function normConfidence(c) {
  const s = String(c || "").trim().toLowerCase();
  return CONFIDENCE.includes(s) ? s : "low";
}

// The reply is meant to be a bare JSON array, but a model that wraps it in a
// sentence or a code fence should not cost the answer. Returns the raw
// objects that carry an id; normalizing is answerFrom's job.
function parseAnswers(text) {
  const s = String(text || "");
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try {
    const out = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(out) ? out.filter((g) => g && typeof g === "object" && g.id) : [];
  } catch (_) { return []; }
}

// One address's answer out of a reply, normalized, or null when the reply
// names no known type for it. A type outside the six is NOT coerced to the
// nearest one: an unknown answer must stay unknown, so the caller can try the
// next pass rather than run a report on a type nobody chose.
function answerFrom(text, id) {
  const hit = parseAnswers(text).find((g) => String(g.id) === String(id));
  const type = hit ? normType(hit.type) : null;
  if (!type) return null;
  return {
    type,
    confidence: normConfidence(hit.confidence),
    // Shown to the member as "found on …", so it is trimmed and capped here
    // rather than trusted to be one short sentence.
    evidence: String(hit.evidence || "").replace(/\s+/g, " ").trim().slice(0, 240),
  };
}

// The deep pass runs on anything the quick pass was not sure of, including no
// answer at all. "medium" goes deeper too: on the first measured set, medium
// quick answers were right 8 times in 11.
function needsDeep(quick) {
  return !quick || quick.confidence !== "high";
}

// The deep answer wins whenever it named a type: it searched more, on purpose,
// with the quick answer's doubt as its whole reason to run. With no deep
// answer (a failed or unparseable call) the quick answer stands, whatever its
// confidence, because a best guess with its confidence attached beats asking
// the member, which is what this module exists to stop.
function finalAnswer(quick, deep) {
  if (deep) return { ...deep, pass: "deep" };
  if (quick) return { ...quick, pass: "quick" };
  return null;
}

// Only answers backed by something about the building itself are remembered.
// A "low" answer is a guess from the street; storing it would make one bad
// guess permanent for every later search of that address, and looking it up
// again is cheap and may find a page that did not exist the first time.
function shouldRemember(answer) {
  return Boolean(answer && normType(answer.type) && (answer.confidence === "high" || answer.confidence === "medium"));
}

// A street address starts with a number. Anything else (a neighbourhood, a
// city, a centre's name) is not one building, and the lookup would be a guess
// about an area.
function looksLikeStreetAddress(address) {
  return /^\s*\d/.test(String(address || "")) && String(address).trim().length <= 300;
}

// The live score for /admin. `rows` are analytics events: the server's
// `type_lookup` (one per resolution; source "memo", "<pass>_<confidence>" or
// "failed") and the browser's `type_autofill` pings. Only two pings count
// against the lookup: "lookup_changed" (a person overturned the type it found,
// in the address check) and "found_retyped" ("Wrong type?" on a report whose
// type it chose). "report_retyped" is a report typed by a person or the map,
// and is not the lookup's mistake.
//
// keptPct is the share of answers nobody overturned. It is an UPPER bound on
// accuracy (a wrong type nobody notices is never corrected), so it is the
// number to watch fall, not proof that 90% holds. correctedPct is NOT clamped:
// the two counts are independent tallies over one capped window, so a
// correction can outlive the answer it was about, and over 100 means unpaired
// rows, which is worth seeing (the type-autofill tile's rule).
function lookupStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const looks = list.filter((r) => r && r.kind === "type_lookup");
  const src = (r) => String(r.source || "");
  const count = (test) => looks.filter((r) => test(src(r))).length;
  const memo = count((s) => s === "memo");
  const failed = count((s) => s === "failed");
  const firstLook = count((s) => s.startsWith("quick_"));
  const secondLook = count((s) => s.startsWith("deep_"));
  const sure = count((s) => s.endsWith("_high"));
  const answered = looks.length - failed;
  const pings = list.filter((r) => r && r.kind === "type_autofill");
  const changed = pings.filter((r) => src(r) === "lookup_changed").length;
  const retyped = pings.filter((r) => src(r) === "found_retyped").length;
  const corrected = changed + retyped;
  const correctedPct = answered ? Math.round((corrected / answered) * 1000) / 10 : 0;
  const times = looks
    .filter((r) => src(r) !== "memo" && Number.isFinite(r.duration_ms))
    .map((r) => r.duration_ms)
    .sort((a, b) => a - b);
  return {
    lookups: looks.length, answered, memo, failed, firstLook, secondLook, sure,
    changed, retyped, corrected, correctedPct,
    keptPct: answered ? Math.max(0, Math.round((100 - correctedPct) * 10) / 10) : 0,
    medianMs: times.length ? times[Math.floor((times.length - 1) / 2)] : null,
  };
}

module.exports = {
  TYPES, CONFIDENCE, QUICK_SEARCHES, DEEP_SEARCHES, TYPE_LINES, ANSWER_LINES,
  quickPrompt, deepPrompt, normType, normConfidence, parseAnswers, answerFrom,
  needsDeep, finalAnswer, shouldRemember, looksLikeStreetAddress, lookupStats,
};

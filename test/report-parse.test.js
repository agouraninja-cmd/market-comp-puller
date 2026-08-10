"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const RP = require("../report-parse");

// --- normalizeCurrency: the currency/usd_rate pair --------------------------
// Pins the behavior the function had while it lived in server.js. The pair
// drives the front-end's convert-to-USD toggle and harvestComps' non-USD
// skip, so the conventions here (blank = USD, bad rate = null) are contracts.

test("normalizeCurrency passes non-objects through untouched", () => {
  assert.equal(RP.normalizeCurrency(null), null);
  assert.equal(RP.normalizeCurrency(undefined), undefined);
  assert.equal(RP.normalizeCurrency("raw text"), "raw text");
});

test("normalizeCurrency returns the same object it was given (pipeline style)", () => {
  const parsed = { currency: "CAD", usd_rate: 0.73 };
  assert.equal(RP.normalizeCurrency(parsed), parsed);
});

test("blank or missing currency reads as USD (the pre-feature behavior)", () => {
  assert.equal(RP.normalizeCurrency({}).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "" }).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "  " }).currency, "USD");
});

test("a currency code is three letters or it is USD", () => {
  assert.equal(RP.normalizeCurrency({ currency: "cad" }).currency, "CAD");
  assert.equal(RP.normalizeCurrency({ currency: " EUR " }).currency, "EUR");
  assert.equal(RP.normalizeCurrency({ currency: "C$" }).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "CANADIAN" }).currency, "USD");
  assert.equal(RP.normalizeCurrency({ currency: "12" }).currency, "USD");
});

test("a USD report never carries a rate", () => {
  assert.equal(RP.normalizeCurrency({ currency: "USD", usd_rate: 1 }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ usd_rate: 0.5 }).usd_rate, null);
});

test("a foreign report keeps a sane positive rate, as a number", () => {
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 0.73 }).usd_rate, 0.73);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: "0.73" }).usd_rate, 0.73);
  assert.equal(RP.normalizeCurrency({ currency: "KWD", usd_rate: 3.25 }).usd_rate, 3.25);
});

test("an inverted rate is dropped but the currency label survives", () => {
  // MXN "18.7" is units-per-USD, not USD-per-unit. Relabeling the prices USD
  // would be worse than losing the toggle — the deliberate asymmetry.
  const r = RP.normalizeCurrency({ currency: "MXN", usd_rate: 18.7 });
  assert.equal(r.currency, "MXN");
  assert.equal(r.usd_rate, null);
});

test("rate bounds: (0, 10) exclusive on both ends", () => {
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 10 }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 9.99 }).usd_rate, 9.99);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: 0 }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: -0.7 }).usd_rate, null);
});

test("an unparseable rate becomes null, never NaN", () => {
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: "abc" }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD", usd_rate: Infinity }).usd_rate, null);
  assert.equal(RP.normalizeCurrency({ currency: "CAD" }).usd_rate, null);
});

// --- SHORT_COMP_KEYS: the compact comp encoding ------------------------------

test("SHORT_COMP_KEYS maps the base fields to their short twins", () => {
  assert.equal(RP.SHORT_COMP_KEYS.address, "a");
  assert.equal(RP.SHORT_COMP_KEYS.price_per_sqft, "psf");
  assert.equal(RP.SHORT_COMP_KEYS.verified, "v");
});

test("shorts are unique and never collide with a long name", () => {
  const longs = Object.keys(RP.SHORT_COMP_KEYS);
  const shorts = Object.values(RP.SHORT_COMP_KEYS);
  assert.equal(new Set(shorts).size, shorts.length, "two longs share a short");
  for (const s of shorts) assert.ok(!longs.includes(s), `short "${s}" is also a long name`);
});

// --- expandCompKeys: short keys back to the classic shape --------------------
// The third argument is the caller's TYPE_COMP_FIELDS map — server.js keeps
// the real one (it is the prompt's source of truth); tests inject a fixture.

const FIELDS = { Industrial: { fields: ["clear_height", "dock_doors"] },
                 Land: { fields: ["lot_acres", "price_per_acre", "zoning"] } };

test("expandCompKeys expands short keys and backfills the classic shape", () => {
  const parsed = { comps: [{ a: "1 Elm St, Boise, ID", p: "$1,000,000", st: "listing" }] };
  const c = RP.expandCompKeys(parsed, "Industrial", FIELDS).comps[0];
  assert.equal(c.address, "1 Elm St, Boise, ID");
  assert.equal(c.price_or_rate, "$1,000,000");
  assert.equal(c.source_type, "listing");
  assert.equal(c.notes, "", "omitted base fields backfill to empty string");
  assert.equal(c.clear_height, "", "the type's own fields backfill too");
  assert.equal(c.tenancy, "", "tenancy/year_built fill for non-Land types");
  assert.equal(c.verified, false, "verified coerces to a boolean");
});

test("expandCompKeys leaves tenancy/year_built off Land comps", () => {
  const parsed = { comps: [{ a: "Parcel 9, Boise, ID" }] };
  const c = RP.expandCompKeys(parsed, "Land", FIELDS).comps[0];
  assert.ok(!("tenancy" in c));
  assert.equal(c.zoning, "");
});

test("a long key passes through and wins over its short twin", () => {
  const parsed = { comps: [{ address: "Long St, Boise, ID", a: "Short St, Boise, ID" }] };
  assert.equal(RP.expandCompKeys(parsed, "Industrial", FIELDS).comps[0].address,
    "Long St, Boise, ID");
});

test("unknown keys survive expansion", () => {
  const parsed = { comps: [{ a: "1 Elm St, Boise, ID", mystery: "kept" }] };
  assert.equal(RP.expandCompKeys(parsed, "Industrial", FIELDS).comps[0].mystery, "kept");
});

test("verified is true only for literal true", () => {
  const mk = (v) => RP.expandCompKeys({ comps: [{ a: "x", v }] }, "Industrial", FIELDS).comps[0].verified;
  assert.equal(mk(true), true);
  assert.equal(mk("true"), false);
  assert.equal(mk(1), false);
});

test("expandCompKeys never throws on junk", () => {
  assert.equal(RP.expandCompKeys(null, "Industrial", FIELDS), null);
  assert.deepEqual(RP.expandCompKeys({ comps: "nope" }, "Industrial", FIELDS), { comps: "nope" });
  assert.equal(RP.expandCompKeys({ comps: [null] }, "Industrial", FIELDS).comps[0], null);
});

// --- parseCompJson: fences, slices, salvage ----------------------------------

test("parseCompJson parses clean JSON", () => {
  assert.deepEqual(RP.parseCompJson('{"comps":[]}'), { comps: [] });
});

test("parseCompJson strips code fences and surrounding narration", () => {
  assert.deepEqual(RP.parseCompJson('```json\n{"comps":[]}\n```'), { comps: [] });
  assert.deepEqual(RP.parseCompJson('Here is the report:\n{"comps":[]}\nHope this helps!'),
    { comps: [] });
});

test("parseCompJson salvages a complete report followed by brace-bearing junk", () => {
  const stats = {};
  // The junk carries its own closing brace so the first-{-to-last-} slice
  // grabs an unparseable span — the exact captured failure mode.
  const out = RP.parseCompJson('{"comps":[{"a":"1 Elm"}]} trailing {junk}', stats);
  assert.equal(out.comps.length, 1);
  assert.equal(stats.rescue, "salvaged");
});

test("parseCompJson refuses to salvage an early object that is not the report", () => {
  // The salvage sanity check: a stray first object with no comps array must
  // not be mistaken for the report — the parse fails instead.
  assert.throws(() => RP.parseCompJson('{"note":"hi"} then {broken}'), SyntaxError);
});

test("parseCompJson scrubs em dashes: numeric ranges to hyphens, prose to commas", () => {
  const out = RP.parseCompJson('{"summary":"Rates 5—10 today — a wide spread","comps":[]}');
  assert.equal(out.summary, "Rates 5-10 today, a wide spread");
});

// --- extractFirstJsonObject / stripEmDashes: the small parts -----------------

test("extractFirstJsonObject ignores braces inside strings", () => {
  assert.equal(RP.extractFirstJsonObject('x {"a":"}{"} y'), '{"a":"}{"}');
});

test("extractFirstJsonObject returns null when nothing balances", () => {
  assert.equal(RP.extractFirstJsonObject("no json here {"), null);
  assert.equal(RP.extractFirstJsonObject("none at all"), null);
});

test("stripEmDashes keeps a dollar range numeric and recurses into arrays", () => {
  assert.equal(RP.stripEmDashes("$4—$5"), "$4-$5");
  assert.deepEqual(RP.stripEmDashes(["a — b"]), ["a, b"]);
});

// --- normalizeSourceTypes: the badge enum, enforced --------------------------
// The rule itself lives in corpus-audit.js (enforcedSourceType); the pipeline
// step takes it as an argument the way expandCompKeys takes TYPE_COMP_FIELDS.
// These tests wire in the REAL rule so the pairing is what's pinned.

const AUDIT = require("../corpus-audit");

test("normalizeSourceTypes coerces unknown values to estimate, never over-claims", () => {
  // "brokerage flyer" would map to listing via the synonym table — this value
  // matches nothing, which is the under-claim case.
  const parsed = { comps: [{ address: "1 Elm St, Boise, ID", source_type: "word of mouth" }] };
  RP.normalizeSourceTypes(parsed, AUDIT.enforcedSourceType);
  assert.equal(parsed.comps[0].source_type, "estimate");
});

test("normalizeSourceTypes keeps honest provenance on a street-numbered address", () => {
  const parsed = { comps: [{ address: "1 Elm St, Boise, ID", source_type: "listing" }] };
  RP.normalizeSourceTypes(parsed, AUDIT.enforcedSourceType);
  assert.equal(parsed.comps[0].source_type, "listing");
});

test("normalizeSourceTypes forces an aggregate row to estimate whatever it claims", () => {
  const parsed = { comps: [{
    address: "Financial District (general submarket estimate), Boston, MA",
    source_type: "listing" }] };
  RP.normalizeSourceTypes(parsed, AUDIT.enforcedSourceType);
  assert.equal(parsed.comps[0].source_type, "estimate");
});

test("normalizeSourceTypes never throws on junk", () => {
  assert.equal(RP.normalizeSourceTypes(null, AUDIT.enforcedSourceType), null);
  const parsed = { comps: [null, "x"] };
  assert.equal(RP.normalizeSourceTypes(parsed, AUDIT.enforcedSourceType), parsed);
});

// --- normalizeTrendPct: the time-adjustment input ----------------------------

test("normalizeTrendPct coerces a plain number string, tolerating a percent sign", () => {
  assert.equal(RP.normalizeTrendPct({ annual_price_trend_pct: "6.5" }).annual_price_trend_pct, 6.5);
  assert.equal(RP.normalizeTrendPct({ annual_price_trend_pct: "-6.5%" }).annual_price_trend_pct, -6.5);
});

test("normalizeTrendPct refuses zero and anything outside ±30%/yr", () => {
  assert.equal(RP.normalizeTrendPct({ annual_price_trend_pct: "0" }).annual_price_trend_pct, null);
  assert.equal(RP.normalizeTrendPct({ annual_price_trend_pct: "31" }).annual_price_trend_pct, null);
  assert.equal(RP.normalizeTrendPct({ annual_price_trend_pct: "-30" }).annual_price_trend_pct, -30);
  assert.equal(RP.normalizeTrendPct({ annual_price_trend_pct: "wild" }).annual_price_trend_pct, null);
  assert.equal(RP.normalizeTrendPct({}).annual_price_trend_pct, null);
});

// --- the strict money parsers ------------------------------------------------
// Whole-string matchers on the displayMoney philosophy: anything that could
// mean two things is refused, and refusal means "leave the comp untouched".

test("parseSalePrice reads plain figures and shorthand", () => {
  assert.equal(RP.parseSalePrice("$6,400,000"), 6400000);
  assert.equal(RP.parseSalePrice("$1.2M"), 1200000);
  assert.equal(RP.parseSalePrice("1.2 million"), 1200000);
  assert.equal(RP.parseSalePrice("850K"), 850000);
  assert.equal(RP.parseSalePrice("US$2.5MM"), 2500000);
});

test("parseSalePrice refuses ranges, rates, negatives and bad grouping", () => {
  assert.equal(RP.parseSalePrice("$4-$5M"), null);
  assert.equal(RP.parseSalePrice("$115/SF"), null);
  assert.equal(RP.parseSalePrice("-500000"), null);
  assert.equal(RP.parseSalePrice("12,50"), null);
  assert.equal(RP.parseSalePrice(""), null);
});

test("parseSizeSqft reads sizes with or without units", () => {
  assert.equal(RP.parseSizeSqft("48,000"), 48000);
  assert.equal(RP.parseSizeSqft("48,000 SF"), 48000);
  assert.equal(RP.parseSizeSqft("48000 sq ft"), 48000);
  assert.equal(RP.parseSizeSqft("~48,000 sf"), 48000);
  assert.equal(RP.parseSizeSqft("48,000 - 50,000"), null);
});

test("parsePsf reads a stated $/SF", () => {
  assert.equal(RP.parsePsf("$115"), 115);
  assert.equal(RP.parsePsf("115.50"), 115.5);
  assert.equal(RP.parsePsf("$115/SF"), 115);
  assert.equal(RP.parsePsf("$110-$120"), null);
});

// --- reconcilePricePerSqft: trust but verify ---------------------------------

test("reconcile fills a missing $/SF from the comp's own price and size", () => {
  const parsed = { currency: "USD", comps: [{
    transaction: "Sale", price_or_rate: "$6,400,000", size_sqft: "48,000", price_per_sqft: "" }] };
  RP.reconcilePricePerSqft(parsed);
  assert.equal(parsed.comps[0].price_per_sqft, "$133");
  assert.equal(parsed.comps[0].psf_reconciled, true);
});

test("reconcile replaces a stated $/SF that disagrees by more than 10%", () => {
  const parsed = { currency: "USD", comps: [{
    transaction: "Sale", price_or_rate: "$6,400,000", size_sqft: "48,000", price_per_sqft: "$100" }] };
  RP.reconcilePricePerSqft(parsed);
  assert.equal(parsed.comps[0].price_per_sqft, "$133");
});

test("reconcile leaves a stated $/SF within 10% untouched", () => {
  const parsed = { currency: "USD", comps: [{
    transaction: "Sale", price_or_rate: "$6,400,000", size_sqft: "48,000", price_per_sqft: "$130" }] };
  RP.reconcilePricePerSqft(parsed);
  assert.equal(parsed.comps[0].price_per_sqft, "$130");
  assert.ok(!("psf_reconciled" in parsed.comps[0]));
});

test("reconcile skips leases — an annual rent over size is not a sale $/SF", () => {
  const parsed = { currency: "USD", comps: [{
    transaction: "Lease", price_or_rate: "$480,000", size_sqft: "48,000", price_per_sqft: "" }] };
  RP.reconcilePricePerSqft(parsed);
  assert.equal(parsed.comps[0].price_per_sqft, "");
});

test("reconcile writes no dollar sign on a non-USD report", () => {
  const parsed = { currency: "CAD", comps: [{
    transaction: "Sale", price_or_rate: "6,400,000", size_sqft: "48,000", price_per_sqft: "" }] };
  RP.reconcilePricePerSqft(parsed);
  assert.equal(parsed.comps[0].price_per_sqft, "133");
});

test("reconcile refuses a derived figure outside the sane per-SF band", () => {
  const parsed = { currency: "USD", comps: [{
    transaction: "Sale", price_or_rate: "$5,000", size_sqft: "48,000", price_per_sqft: "" }] };
  RP.reconcilePricePerSqft(parsed);
  assert.equal(parsed.comps[0].price_per_sqft, "", "derived $0.10/SF must be refused");
});

test("reconcile never throws on junk comps", () => {
  const parsed = { comps: [null, "x", {}] };
  assert.equal(RP.reconcilePricePerSqft(parsed), parsed);
});

// --- scrubUnearnedVerifiedClaims -------------------------------------------
// "Verified" is a badge only the server awards. When the finished report holds
// no verified comp, narrative that claims verification contradicts the comp
// table the reader is looking at (reported live: the summary claimed verified
// comps while every badge read Estimate / News / Listing).

test("scrub rewrites a verification claim when no comp earned the badge", () => {
  const parsed = {
    summary: "Three verified sales support the range.",
    comps: [{ verified: false }, {}],
  };
  RP.scrubUnearnedVerifiedClaims(parsed);
  assert.equal(parsed.summary, "Three confirmed sales support the range.");
});

test("scrub leaves the word alone when a comp really is verified", () => {
  const parsed = {
    summary: "Three verified sales support the range.",
    comps: [{ verified: false }, { verified: true }],
  };
  RP.scrubUnearnedVerifiedClaims(parsed);
  assert.equal(parsed.summary, "Three verified sales support the range.",
    "one real badge makes the word accurate; rewriting it would lose information");
});

test("scrub covers every narrative surface, including per-comp notes", () => {
  const parsed = {
    summary: "Verified data is thin.",
    market_trend: "Prices verified against county records rose.",
    value_drivers: ["Verified sales are scarce", "Supply is tight"],
    price_discovery: { direction: "flat", note: "Needs verification." },
    comps: [{ verified: false, notes: "Price verified via the listing." }],
  };
  RP.scrubUnearnedVerifiedClaims(parsed);
  assert.equal(parsed.summary, "Confirmed data is thin.");
  assert.equal(parsed.market_trend, "Prices confirmed against county records rose.");
  assert.deepEqual(parsed.value_drivers, ["Confirmed sales are scarce", "Supply is tight"]);
  assert.equal(parsed.price_discovery.note, "Needs confirmation.");
  assert.equal(parsed.comps[0].notes, "Price confirmed via the listing.");
});

test("scrub preserves capitalization and handles the whole word family", () => {
  const parsed = { summary: "Verified. unverified. VERIFIED. verification. broker-verified.", comps: [] };
  RP.scrubUnearnedVerifiedClaims(parsed);
  assert.equal(parsed.summary, "Confirmed. unconfirmed. CONFIRMED. confirmation. confirmed.");
});

test("scrub matches whole words only, so it cannot corrupt a longer token", () => {
  const parsed = { summary: "See veriflex.com and the reverified-holdings deal.", comps: [] };
  RP.scrubUnearnedVerifiedClaims(parsed);
  assert.equal(parsed.summary, "See veriflex.com and the reverified-holdings deal.");
});

test("scrub never throws on junk", () => {
  assert.equal(RP.scrubUnearnedVerifiedClaims(null), null);
  const parsed = { comps: [null, "x", {}], summary: undefined, value_drivers: "not an array" };
  assert.equal(RP.scrubUnearnedVerifiedClaims(parsed), parsed);
});

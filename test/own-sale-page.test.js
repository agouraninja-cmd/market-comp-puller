// The building's own sale ON THE PAGE (index.html). valuation.js holds the
// rule and test/own-sale-rule.test.js holds that; this file holds the page's
// half: the one wrapper that hands the rule its inputs (ownSaleBlend), the
// words the page says for each answer the rule can give, the member's switch,
// and the wiring that keeps every card on one figure.
//
// WHY IT MATTERS. ownSaleBlend decides what nine tenths of the headline
// rests on. Hand it the wrong asking price and a member's own question moves
// the answer; drop one of the subject's names and a good sale is refused as
// "another address"; skip it in one card and the DCF sells at a figure the
// hero does not show. And a refusal reason added to valuation.js with no
// sentence here leaves the reader with a value that silently ignores a sale
// printed one line below it.
//
// The functions are LIFTED out of index.html's text and run in a vm context
// with the real valuation.js, the way test/index-html.test.js does it. Every
// expected figure is worked out from valuation.js's header by hand, with the
// arithmetic beside it.
//
// Run: node --test test/own-sale-page.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const V = require("../valuation.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const VSRC = fs.readFileSync(path.join(__dirname, "..", "valuation.js"), "utf8");
const SERVER_SRC = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function liftFn(open) {
  const from = html.indexOf(open);
  assert.ok(from > 0, "could not find `" + open.trim() + "` in index.html: renamed or moved?");
  const to = html.indexOf("\n  }\n", from);
  assert.ok(to > from, "could not bound `" + open.trim() + "`");
  return html.slice(from, to + 4);
}
// A function body out of valuation.js, bounded the same way.
function vFn(open) {
  const from = VSRC.indexOf(open);
  assert.ok(from > 0, "could not find `" + open.trim() + "` in valuation.js");
  return VSRC.slice(from, VSRC.indexOf("\n  }\n", from) + 4);
}
const all = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

const HELPERS = ["  function ownSaleBlend(compRange, parsed, meta) {", "  function ownSaleOff(meta) {",
  "  function ownSaleShare(own) {", "  function ownSaleLeads(own) {", "  function ownSaleHalfWhy(own) {",
  "  function ownSaleRefusal(own, shared, noun) {", "  function renderOwnSaleSwitch(own, meta) {",
  "  function ensureCuration(meta) {", "  function compKeyOf(c) {"];
const lifted = HELPERS.map(liftFn).join("\n");
function page(extra) {
  const ctx = vm.createContext({ VALUATION: V, Math, String, Number, Object, Array, ...extra });
  vm.runInContext(lifted, ctx);
  return ctx;
}

// A sale the rule leans on in full: $4,000,000 for 20,000 SF ($200/SF),
// closed half a year before the report, an ordinary sale cited to a news
// page, recorded for this address in Ohio (a deed there shows the price), and
// stamped by the server. No trend, so A is the price itself.
const ADDRESS = "100 Main St, Columbus, OH 43215";
const SOLD_MS = Date.parse("2025-06-16");
const AS_OF = SOLD_MS + 0.5 * 365.25 * 24 * 3600 * 1000;
const SALE = { date: "2025-06-16", price: "$4,000,000", source_url: "https://news.example.com/deal/100-main",
  source_type: "news", address: ADDRESS, size_sqft: "20000", basis: "arms_length", settled: 1 };
const COMPS = { low: 3600000, mid: 4200000, high: 4600000 };
const report = (over) => ({ currency: "USD", annual_price_trend_pct: 0, subject_last_sale: { ...SALE }, ...over });
const metaOf = (over) => ({ type: "Industrial", address: ADDRESS, generatedAt: new Date(AS_OF).toISOString(),
  subject: { priceMin: 4000000, priceMax: 4000000 }, ...over });

function blendPage(opts) {
  const o = opts || {};
  const seen = [];
  const spy = { ...V, valueWithOwnSale: (c, s, x) => { seen.push({ c, s, x }); return V.valueWithOwnSale(c, s, x); } };
  const ctx = page({
    VALUATION: spy, window: o.window || {},
    netLeaseOn: () => !!o.netLease, numericValue: V.numericValue,
    subjectSizeForMatch: () => 20000, ownSaleCompPsf: () => 0,
  });
  vm.runInContext(liftFn("  function asOfOf(meta) {") + liftFn("  function trendPctOf(parsed) {"), ctx);
  return { blend: ctx.ownSaleBlend, seen };
}

test("ownSaleBlend leans on a vetted sale with the real rule: 0.9 of the sale and 0.1 of the comps", () => {
  const { blend, seen } = blendPage();
  const own = blend(COMPS, report(), metaOf());
  // w = 0.9 (under a year), A = $4,000,000, spread 10%, comps held = 1 (4.2M is inside 1.5x).
  // Likely = 0.9 x 4.0M + 0.1 x 4.2M = 4,020,000, rounded to the $25,000 step: 4,025,000.
  // Low  = 0.9 x 3.6M + 0.1 x 3.6M = 3,600,000.
  // High = 0.9 x 4.4M + 0.1 x 4.6M = 4,420,000, rounded: 4,425,000.
  assert.equal(own.anchored, true, "the known-good sale must be leaned on: " + own.refused);
  assert.equal(own.weight, 0.9);
  assert.deepEqual({ low: own.low, mid: own.mid, high: own.high }, { low: 3600000, mid: 4025000, high: 4425000 });
  assert.deepEqual(own.comp, COMPS, "the comps' own figures ride along untouched");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].x.asOf, AS_OF, "aged against the report's date, never the wall clock");
  assert.equal(seen[0].x.subjectSize, 20000, "the size being valued");
  assert.equal(seen[0].x.propertyType, "Industrial");
  assert.equal(seen[0].x.off, false);
});

test("ownSaleBlend says nothing on a leases-only search, in net lease mode, or with the server's switch off", () => {
  // A rent and a cap rate are not dollars of building: null is "no sale was weighed".
  assert.equal(blendPage().blend(COMPS, report(), metaOf({ txFocus: "leases" })), null);
  assert.equal(blendPage({ netLease: true }).blend(COMPS, report(), metaOf({ type: "Retail" })), null);
  assert.equal(blendPage({ window: { CN_AUTH_BOOT: { ownSale: false } } }).blend(COMPS, report(), metaOf()), null,
    "OWN_SALE=off reaches a report rendered from a saved payload through the boot object");
  assert.equal(blendPage().blend(COMPS, report(), null), null);
  // Present but not false is not the rollback.
  assert.equal(blendPage({ window: { CN_AUTH_BOOT: { ownSale: true } } }).blend(COMPS, report(), metaOf()).anchored, true);
});

test("ownSaleBlend hands the rule every name the report has for the subject, so a renamed address still matches", (t) => {
  // The search moved the address (subject_address_corrected) and the sale is
  // recorded under the corrected one. Dropping that name would refuse a good
  // sale as "another address" and quietly value the building on comps alone.
  const typed = "100 Main Street Columbus OH";
  const meta = metaOf({ address: "99 Wrong Rd, Columbus, OH 43215", addressTyped: typed });
  const parsed = report({ subject_address_corrected: ADDRESS });
  const { blend, seen } = blendPage();
  assert.equal(blend(COMPS, parsed, meta).anchored, true);
  assert.deepEqual([...seen[0].x.subjectAddresses], ["99 Wrong Rd, Columbus, OH 43215", typed, ADDRESS]);
  t.diagnostic("without the corrected name the same sale is another building's");
  const without = blendPage().blend(COMPS, report(), metaOf({ address: "99 Wrong Rd, Columbus, OH 43215" }));
  assert.equal(without.refused, "other_address");
});

test("ownSaleBlend reads the listing the search found as the asking price, never the price typed in the form", () => {
  // The form's price is $4,000,000, exactly the sale price: read as the
  // asking price it would refuse the sale as "matches_asking" and drop the
  // estimate under the member's cursor. It must change nothing.
  const { blend, seen } = blendPage();
  assert.equal(blend(COMPS, report(), metaOf()).anchored, true);
  assert.equal(seen[0].x.asking, 0, "no listing was found, so there is no asking price");
  // The same figure as a LISTING the search found is the listing read as a closing.
  const listed = blendPage();
  const own = listed.blend(COMPS, report({ subject_asking: { price: "$4,000,000" } }), metaOf({ subject: {} }));
  assert.equal(listed.seen[0].x.asking, 4000000);
  assert.equal(own.refused, "matches_asking");
  assert.deepEqual({ low: own.low, mid: own.mid, high: own.high }, COMPS, "a refused sale leaves the comps' figures");
});

test("the member's switch is meta.curation.ownSaleOff, and turned off the sale is refused as off", () => {
  const ctx = page({});
  assert.equal(ctx.ownSaleOff({ curation: { ownSaleOff: true } }), true);
  for (const m of [null, {}, { curation: {} }, { curation: { ownSaleOff: false } }]) assert.equal(ctx.ownSaleOff(m), false);
  const own = blendPage().blend(COMPS, report(), metaOf({ curation: { ownSaleOff: true } }));
  assert.equal(own.refused, "off");
  assert.equal(own.mid, COMPS.mid);
});

test("the sale's share is a whole percent and it leads only at a weight of one half or more", () => {
  const ctx = page({});
  assert.equal(ctx.ownSaleShare({ weight: 0.9 }), 90);
  assert.equal(ctx.ownSaleShare({ weight: 0.444 }), 44);
  assert.equal(ctx.ownSaleShare({ weight: 0.445 }), 45);
  assert.equal(V.OWN_SALE_LEADS_AT, 0.5, "the spec's line between leading and helping");
  assert.equal(ctx.ownSaleLeads({ anchored: true, weight: 0.5 }), true);
  assert.equal(ctx.ownSaleLeads({ anchored: true, weight: 0.49 }), false);
  assert.equal(ctx.ownSaleLeads({ anchored: false, weight: 0.9 }), false, "a refused sale never leads");
  assert.equal(ctx.ownSaleLeads(null), false);
});

// Every refusal reason the rule can return, read out of valuation.js's own
// source so a reason added there without a sentence here fails this file.
const ANCHOR = vFn("  function ownSaleAnchor(lastSale, opts) {");
const BLEND = vFn("  function valueWithOwnSale(comp, lastSale, opts) {");
const SOURCE = vFn("  function ownSaleSource(lastSale, subjectAddress) {");
assert.ok(ANCHOR.includes('src.why === "estimate_source" ? "no_source"'), "an estimate source is refused as no_source");
const REASONS = new Set([...all(ANCHOR, /no\("([a-z_]+)"/g), ...all(BLEND, /refused = "([a-z_]+)"/g),
  ...all(SOURCE, /ok: false, why: "([a-z_]+)"/g).filter((w) => w !== "estimate_source")]);
// The ones ownSaleRefusal's comment gives no sentence: nothing to speak of
// (no price, no date, a date ahead of the report), too old to count, a type
// or currency the rule does not cover, a report from before the sale was vetted.
const SILENT = ["no_price", "no_date", "future", "old", "type", "currency", "unsettled"];
const refusedOwn = (reason, extra) => ({ anchored: false, refused: reason, weight: 0, comp: COMPS,
  ownSale: { ok: false, reason, saleAddress: "9 Other St, Columbus, OH 43215", saleSize: 40000, subjectSize: 20000, ...extra } });

test("every refusal valuation.js can give has a sentence on the page, or is one deliberately given none", () => {
  const ctx = page({});
  assert.ok(REASONS.size >= 19, "the reasons could not be read out of valuation.js: " + [...REASONS]);
  for (const r of REASONS) {
    const said = ctx.ownSaleRefusal(refusedOwn(r, r === "basis" ? { why: "portfolio" } : {}), false);
    if (SILENT.includes(r)) assert.equal(said, "", r + " is meant to say nothing");
    else assert.ok(said.length > 10, `refusal "${r}" has no sentence on the page`);
  }
  for (const r of SILENT) assert.ok(REASONS.has(r), r + " is no longer a reason valuation.js gives: update SILENT");
  // Nothing at all when the sale was leaned on, or none was reported.
  assert.equal(ctx.ownSaleRefusal({ anchored: true, refused: null, ownSale: { ok: true } }, false), "");
  assert.equal(ctx.ownSaleRefusal(null, false), "");
  assert.equal(ctx.ownSaleRefusal({ anchored: false, refused: null, ownSale: null }, false), "");
});

test("each kind of sale the rule refuses on its basis is named, and an unknown kind gets the general sentence", () => {
  const ctx = page({});
  const say = (why) => ctx.ownSaleRefusal(refusedOwn("basis", { why }), false);
  const general = say("unstated");
  assert.equal(say("other"), general);
  const refusing = Object.keys(V.OWN_SALE_BASIS_WORDS).filter((k) => k !== "arms_length" && !V.OWN_SALE_HALF_BASES[k]);
  assert.ok(refusing.length >= 8);
  for (const k of refusing) {
    assert.notEqual(say(k), general, `the "${k}" basis falls through to the general sentence`);
    assert.match(say(k), /^the search found /, `the "${k}" caveat is the search's finding, not ours`);
  }
});

test("a dead link and an undisclosed price, the server's two findings, are said apart", () => {
  const ctx = page({});
  const whys = all(SERVER_SRC, /ls\.unusable = "([a-z_]+)"/g);
  assert.deepEqual(whys.sort(), ["dead_source", "price_undisclosed"]);
  const said = whys.map((why) => ctx.ownSaleRefusal(refusedOwn("unusable", { why }), false));
  assert.notEqual(said[0], said[1]);
  assert.match(said[1], /not disclosed/);
});

test("the off sentence names who turned it off, and a shared report's reader is not told they did", () => {
  const ctx = page({});
  assert.equal(ctx.ownSaleRefusal(refusedOwn("off"), false), "you turned it off");
  assert.equal(ctx.ownSaleRefusal(refusedOwn("off"), true), "the report's owner turned it off");
});

test("a scope refusal quotes both sizes and says which box to change", () => {
  const said = page({}).ownSaleRefusal(refusedOwn("scope"), false);
  assert.equal(said, "it covered about 40,000 SF and this report values 20,000 SF. If 40,000 SF is the right size, change the size above");
});

test("no refusal sentence calls the sale verified, and recorded only as the search's word", () => {
  // Never-break rule 8, and the rules file: the sale is "reported", never
  // "verified" or "recorded" as our own finding about a named building.
  // No sentence says "recorded" at all now: other_address and unit said "it
  // is recorded for", a claim about the public record nobody checked.
  const ctx = page({});
  const reasons = [...REASONS].filter((r) => !SILENT.includes(r));
  const whys = { basis: Object.keys(V.OWN_SALE_BASIS_WORDS), unusable: ["dead_source", "price_undisclosed"] };
  for (const r of reasons) {
    for (const why of whys[r] || [undefined]) {
      for (const shared of [false, true]) {
        const said = ctx.ownSaleRefusal(refusedOwn(r, { why }), shared);
        assert.doesNotMatch(said, /verif/i, `${r}/${why}: ${said}`);
        assert.doesNotMatch(said, /\brecorded\b/i, `${r}/${why}: ${said}`);
      }
    }
  }
});

test("every reason valuation.js can halve a sale's weight for has a clause that follows because", () => {
  const ctx = page({});
  const halves = new Set([...Object.keys(V.OWN_SALE_HALF_BASES), ...all(ANCHOR, /half = "([a-z_]+)"/g),
    ...all(ANCHOR, /half \|\| "([a-z_]+)"/g), ...all(SOURCE, /half: "([a-z_]+)"/g)]);
  for (const h of ["sale_leaseback", "allocated", "from_comp", "ask_far", "listing_page", "unclassified", "non_disclosure"]) {
    assert.ok(halves.has(h), h + " could not be read out of valuation.js");
  }
  for (const h of halves) {
    const clause = ctx.ownSaleHalfWhy({ ownSale: { half: h, askPct: 30 } });
    assert.ok(clause.length > 20, `half reason "${h}" has no clause`);
    assert.doesNotMatch(clause, /^[A-Z]|\.$/, `"${h}" must read on from "because": ${clause}`);
  }
  assert.match(ctx.ownSaleHalfWhy({ ownSale: { half: "ask_far", askPct: 30 } }), /^it is listed today 30% above /);
  assert.match(ctx.ownSaleHalfWhy({ ownSale: { half: "ask_far", askPct: -40 } }), /^it is listed today 40% below /);
  assert.equal(ctx.ownSaleHalfWhy({ ownSale: { half: null } }), "");
  assert.equal(ctx.ownSaleHalfWhy(null), "");
});

// A stand-in document: just enough of the DOM for the switch and the offer.
function el(tag) {
  const e = {
    tagName: tag, children: [], className: "", onclick: null, listeners: {}, _text: "",
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(v) { this._text = String(v); this.children = []; },
  };
  return e;
}
function docWith(ids) {
  const byId = {};
  ids.forEach((id) => { byId[id] = el("div"); });
  return { byId, getElementById: (id) => byId[id] || null, createElement: el,
    createTextNode: (s) => ({ textContent: String(s) }) };
}
function switchPage(meta) {
  const document = docWith(["ownerSaleSwitch"]);
  let applied = 0;
  const ctx = page({ document, currentMeta: meta, applyCuration: () => { applied += 1; } });
  const box = document.byId.ownerSaleSwitch;
  const button = () => box.children.find((c) => c.tagName === "button");
  return { ctx, box, button, applied: () => applied };
}

test("the switch hides with no sale weighed, offers comps alone while leaning, and the sale again once off", () => {
  const meta = { curation: { excluded: [], added: [] } };
  const s = switchPage(meta);
  s.ctx.renderOwnSaleSwitch(null, meta);
  assert.ok(s.box.classList.contains("hidden"));
  assert.equal(s.box.textContent, "");
  s.ctx.renderOwnSaleSwitch(refusedOwn("matches_asking"), meta);
  assert.ok(s.box.classList.contains("hidden"), "a refused sale the member did not turn off offers no switch");

  s.ctx.renderOwnSaleSwitch({ anchored: true, refused: null, comp: COMPS }, meta);
  assert.ok(!s.box.classList.contains("hidden"));
  assert.equal(s.button().textContent, "Value it on comps alone");
  s.button().onclick();
  assert.equal(meta.curation.ownSaleOff, true, "the click writes the member's switch");
  assert.equal(s.applied(), 1, "and goes through applyCuration, the door every curation edit uses");

  s.ctx.renderOwnSaleSwitch(refusedOwn("off"), meta);
  assert.equal(s.button().textContent, "Use its own sale again");
  assert.match(s.box.textContent, /uses the comps alone/);
  s.button().onclick();
  assert.equal("ownSaleOff" in meta.curation, false, "turned back on, the key is cleared, not set false");
  assert.equal(s.applied(), 2);
});

test("with no comps beside the sale the switch does not promise comps alone", () => {
  const meta = { curation: {} };
  const s = switchPage(meta);
  s.ctx.renderOwnSaleSwitch({ anchored: true, refused: null, comp: null }, meta);
  assert.equal(s.button().textContent, "Leave that sale out");
  s.ctx.renderOwnSaleSwitch({ ...refusedOwn("off"), comp: null }, meta);
  assert.match(s.box.textContent, /the comps alone give no estimate here/);
});

test("a shared report shows its owner's choice and never offers the switch", () => {
  const meta = { shared: true, curation: { ownSaleOff: true } };
  const s = switchPage(meta);
  s.ctx.renderOwnSaleSwitch({ anchored: true, refused: null, comp: COMPS }, meta);
  assert.ok(s.box.classList.contains("hidden"));
  s.ctx.renderOwnSaleSwitch(refusedOwn("off"), meta);
  assert.ok(s.box.classList.contains("hidden"));
  assert.equal(s.button(), undefined);
});

test("ensureCuration keeps the switch only as true and drops any other value", () => {
  const ctx = page({});
  for (const v of [false, "true", 1, null]) {
    const meta = { curation: { ownSaleOff: v } };
    ctx.ensureCuration(meta);
    assert.equal("ownSaleOff" in meta.curation, false, JSON.stringify(v) + " must not survive");
  }
  const on = { curation: { ownSaleOff: true } };
  ctx.ensureCuration(on);
  assert.equal(on.curation.ownSaleOff, true);
});

test("the saved-comps offer leaves out a sale of the subject's own building under any of its names", () => {
  const document = docWith(["corpusOffer", "corpusOfferRows"]);
  const rows = [
    { address: "100 Main St, Columbus, OH 43215", transaction: "Sale", date: "Jun 2025", price_or_rate: "$4,000,000" },
    { address: "200 Oak Ave, Columbus, OH 43215", transaction: "Sale", date: "Jun 2025", price_or_rate: "$3,000,000" },
    { address: "100 Main St, Columbus, OH 43215", transaction: "Lease", date: "Jan 2026", price_or_rate: "$9/SF/yr" },
    { address: "5 Corrected Way, Columbus, OH 43215", transaction: "Sale", date: "May 2025", price_or_rate: "$4,100,000" },
  ];
  const ctx = page({
    document, currentMeta: { address: ADDRESS }, currentParsed: { subject_address_corrected: "5 Corrected Way, Columbus, OH 43215" },
    curationControlsAllowed: () => true, currentComps: [], corpusOfferRows: rows, corpusOfferLocked: 0,
    sourceBadge: () => null, addCorpusComp: () => {},
  });
  vm.runInContext(liftFn("  function renderCorpusOffer() {"), ctx);
  ctx.renderCorpusOffer();
  const offered = document.byId.corpusOfferRows.children.map((r) => r.children[0].children[0].children[0].textContent);
  // A lease in the subject's building is a real lease comp, and stays.
  assert.deepEqual(offered, ["200 Oak Ave, Columbus, OH 43215", "100 Main St, Columbus, OH 43215"]);
  assert.match(document.byId.corpusOfferRows.children[1].textContent, /Lease/);
});

test("the page wires both value cards through ownSaleBlend, and the switch out of print and capture", () => {
  const hero = liftFn("  function renderOwnerHero(parsed, meta) {");
  const sell = liftFn("  function sellTodayEstimate(parsed, meta) {");
  assert.match(hero, /ownSaleBlend\(/);
  assert.match(sell, /ownSaleBlend\(/);
  assert.equal((html.match(/valueWithOwnSale\(/g) || []).length, 1, "a second caller of the rule would be a second answer");
  const tag = html.match(/<p id="ownerSaleSwitch" class="([^"]*)"/);
  assert.ok(tag, "#ownerSaleSwitch is missing from the markup");
  assert.ok(/\bno-print\b/.test(tag[1]) && /\bno-capture\b/.test(tag[1]) && /\bhidden\b/.test(tag[1]), tag[1]);
  const asm = liftFn("  function beginAssembly() {");
  const hideList = asm.match(/\[("widenSearchWrap"[^\]]*)\]\.forEach\(\(id\) =>\s*document\.getElementById\(id\)\.classList\.add\("asm-hidden"\)/);
  assert.ok(hideList && hideList[1].includes('"ownerSaleSwitch"'), "beginAssembly must hide the last report's switch");
});

test("the own-sale copy says reported, never verified, and carries no em dash", () => {
  const start = html.indexOf("    const ownLs = (parsed && parsed.subject_last_sale)");
  const end = html.indexOf("\n", html.indexOf("    const ownEstimateNote = "));
  assert.ok(start > 0 && end > start, "the hero's own-sale closures moved");
  const copy = html.slice(start, html.indexOf("\n", end + 1)) + lifted.slice(0, lifted.indexOf("  function ensureCuration"));
  const literals = (copy.replace(/^\s*\/\/.*$/gm, "").match(/"[^"\n]*"|`[^`]*`/g) || []).join("\n");
  assert.match(literals, /was reported sold for/);
  assert.match(literals, /own reported sale/);
  assert.doesNotMatch(literals, /verified/i);
  assert.ok(!literals.includes(String.fromCharCode(0x2014)), "an em dash in the own-sale copy");
});

test("a unit refusal says which side named the unit, and the disagree sentence uses the noun and the constant", () => {
  // A suite valued against the whole building's sale used to be told the
  // sale was "recorded for one unit", the opposite of the truth.
  const ctx = page({});
  const unit = (side) => ctx.ownSaleRefusal(refusedOwn("unit", { unitSide: side }), false, "building");
  assert.equal(unit("sale"), "the search reported it as a sale of one unit, not of the whole building this report values");
  assert.equal(unit("subject"), "the search reported it as a sale of the whole building, and this report values one unit of it");
  assert.equal(unit("both"), "the search reported it for a different unit from the one this report values");
  const dis = ctx.ownSaleRefusal(refusedOwn("disagree"), false, "property");
  assert.match(dis, new RegExp(`more than ${V.OWN_SALE_DISAGREE} times`));
  assert.match(dis, /covered this property alone$/);
  assert.equal(ctx.ownSaleRefusal(refusedOwn("no_source", { why: "estimate_source" }), false),
    "the search called its own source for that price an estimate");
});

// bov-doc.js — everything the BOV builder (/bov) knows: how a typed figure is
// read, which of a broker's comps suit a subject, the range they support, and
// the Broker Opinion of Value itself, as a document. Pure, so every rule in
// its header is checked here with no browser and no database.
//
// Run: npm test   (node --test, no dependencies, no network)

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const B = require("../bov-doc");
const VAULT = require("../broker-vault");

const comp = (o) => Object.assign({
  id: "c1", address: "8120 W Fairview Ave, Boise, ID 83704", market: "Boise, ID", property_type: "Industrial",
  transaction: "sale", deal_date: "2026-08-14", size_sqft: 42000, price: 3696000, price_per_sqft: 88, cap_rate: 6.4,
}, o);
const BOOK = [
  comp({}),
  comp({ id: "c2", address: "1450 N Eagle Rd, Meridian, ID 83642", market: "Meridian, ID", deal_date: "2026-06-02", size_sqft: 51500, price: 4840000, price_per_sqft: 93.98 }),
  comp({ id: "c3", address: "3305 S Federal Way, Boise, ID 83705", deal_date: "2026-03-19", size_sqft: 38200, price: 3247000, price_per_sqft: 85 }),
  comp({ id: "c4", address: "415 W Main St, Boise, ID 83702", property_type: "Office", deal_date: "2026-05-11", size_sqft: 18400, price: 3128000, price_per_sqft: 170 }),
  comp({ id: "c5", address: "6600 W Overland Rd, Boise, ID 83709", transaction: "lease", deal_date: "2026-07-01", size_sqft: 22000, price: null, price_per_sqft: null, rent_psf_yr: 9.6, lease_type: "NNN" }),
  comp({ id: "c6", address: "900 W Unpriced Way, Boise, ID 83704", deal_date: "2026-09-01", price: null, price_per_sqft: null }),
];
const draftFor = (o) => {
  const d = B.blankDraft();
  d.subject.address = "8400 W Fairview Ave, Boise, ID 83704";
  d.subject.size = "45,000";
  return Object.assign(d, o || {});
};
const BRAND = { firmName: "Summit Commercial Advisors", preparerName: "Dana Whitfield", licenseNumber: "DB41822", phone: "(208) 555-0142" };
const doc = (d, o) => B.documentHtml(d, Object.assign({ comps: BOOK, brand: BRAND, today: "2026-11-27" }, o));

test("a typed figure is read in full or refused, never guessed (rule 3)", () => {
  assert.deepEqual(B.money("$1,250,000"), { ok: true, value: 1250000 });
  assert.deepEqual(B.money("1250000.50"), { ok: true, value: 1250000.5 });
  assert.deepEqual(B.money(""), { ok: true, value: null });
  for (const bad of ["1.2M", "1.2 million", "about 3m", "1,2,3x", "-5", "0"]) {
    const r = B.money(bad);
    assert.equal(r.ok, false, bad + " was read as a dollar amount");
    assert.equal(r.value, null);
    assert.ok(r.error, bad + " was refused without saying why");
  }
  assert.equal(B.number("45,000 SF").value, 45000);
  assert.equal(B.number("4.5 acres").value, 4.5);
  assert.equal(B.number("45k").ok, false);
  assert.equal(B.percent("6.25%").value, 6.25);
  assert.equal(B.percent("0.0625").value, 0.0625, "a small rate is read as written; the builder shows what it comes to");
  assert.equal(B.percent("65").ok, false, "a 65% cap rate is a typo");
  assert.equal(B.year("1998").value, 1998);
  assert.equal(B.year("98").ok, false);
});

test("the property types are the vault's own", () => {
  assert.deepEqual(B.PROPERTY_TYPES, VAULT.PROPERTY_TYPES);
});

test("a sale's rate is the stored one, and a lease never has one (the comps page's rule)", () => {
  assert.equal(B.saleRate(BOOK[0]), 88);
  assert.equal(B.saleRate(BOOK[4]), null, "a lease entered a sale figure");
  assert.equal(B.saleRate(comp({ price_per_sqft: null })), null, "a $/SF was derived from price over size");
  assert.equal(B.rentRate(BOOK[4]), 9.6);
  // Land is per acre: the stored figure, else the sale's own price over its acres.
  assert.equal(B.saleRate({ property_type: "Land", transaction: "sale", price: 900000, lot_acres: 4.5 }), 200000);
  assert.equal(B.saleRate({ property_type: "Land", transaction: "sale", price: 900000, lot_acres: 4.5, price_per_acre: 210000 }), 210000);
  assert.equal(B.saleRate({ property_type: "Land", transaction: "lease", price: 900000, lot_acres: 4.5 }), null);
});

test("the comps ticked to start are priced sales of the subject's type, its own market first", () => {
  const d = draftFor();
  const ids = B.suggestComps(BOOK, d.subject);
  assert.deepEqual(ids, ["c1", "c3", "c2"], "Boise's two, newest first, then Meridian's");
  assert.ok(!ids.includes("c4"), "an office sale was suggested for an industrial building");
  assert.ok(!ids.includes("c5"), "a lease was suggested as a comparable sale");
  assert.ok(!ids.includes("c6"), "a sale with no price was suggested");
  // An address the helper cannot read a market from still gets its type's sales.
  assert.deepEqual(B.suggestComps(BOOK, { type: "Industrial", address: "somewhere" }), ["c1", "c2", "c3"]);
  assert.ok(B.suggestComps(new Array(20).fill(0).map((_, i) => comp({ id: "x" + i })), d.subject).length <= B.SUGGEST_MAX);
  assert.equal(B.marketOfAddress("8400 W Fairview Ave, Boise, ID 83704"), "Boise, ID");
  assert.equal(B.marketOfAddress("8400 W Fairview Ave"), "");
});

test("the range is taken over the subject's own type alone, and says what it left out (rule 4)", () => {
  const d = draftFor({ compIds: ["c1", "c2", "c3", "c4", "c5", "c6"] });
  const basis = B.saleBasis(B.chosenComps(d, BOOK), "Industrial");
  assert.equal(basis.n, 3);
  assert.equal(basis.low, 85); assert.equal(basis.median, 88); assert.equal(basis.high, 93.98);
  assert.equal(basis.unit, "sf");
  assert.equal(basis.others, 1, "the office sale was not counted as left out");
  assert.equal(basis.unpriced, 1);
  assert.equal(basis.from, "2026-03-19"); assert.equal(basis.to, "2026-08-14");
  const html = doc(d);
  assert.match(html, /1 of these sales is of another property type and is shown for context/);
  assert.match(html, /1 sale has no disclosed price or size and is not in the figures above/);
  assert.match(html, /Comparable leases/);
  assert.equal(B.saleBasis([], "Industrial").n, 0);
  assert.equal(B.saleBasis(B.chosenComps(d, BOOK), "Land").unit, "acre");
});

test("a suggested value is rounded to a figure a person would quote, and needs a rate and a size", () => {
  const basis = B.saleBasis(BOOK.slice(0, 3), "Industrial");
  assert.deepEqual(B.suggestValue(basis, 45000), { low: 3825000, likely: 3950000, high: 4225000, single: false });
  assert.equal(B.suggestValue(basis, null), null);
  assert.equal(B.suggestValue(B.saleBasis([], "Industrial"), 45000), null);
  assert.equal(B.suggestValue(B.saleBasis([BOOK[0]], "Industrial"), 45000).single, true, "one sale is one value, never an invented range");
  assert.equal(B.roundValue(183400), 183000);
  assert.equal(B.roundValue(612400), 610000);
  assert.equal(B.roundValue(12345678), 12300000);
});

test("the opinion on the document is the one the broker typed, and nothing is computed onto it (rule 1)", () => {
  const d = draftFor({ compIds: ["c1", "c2", "c3"] });
  const bare = doc(d);
  assert.ok(!bare.includes("bvd-value"), "a value block was drawn with no value typed");
  assert.ok(!/Probable selling price|Opinion of value<\/span>/.test(bare), "a value was put on the letterhead unasked");
  // The comps' own arithmetic is on the comparables page, under their name.
  assert.match(bare, /At 45,000 SF<\/span><b>\$3,825,000 – \$4,225,000/);
  d.value = { low: "3,800,000", high: "4,200,000", list: "4,050,000" };
  const html = doc(d);
  assert.match(html, /Probable selling price<\/span><b>\$3,800,000 – \$4,200,000<\/b><i>\$84\.44\/SF – \$93\.33\/SF<\/i>/);
  assert.match(html, /Recommended list price<\/span><b>\$4,050,000<\/b><i>\$90\.00\/SF<\/i>/);
  // A figure that cannot be read is left off, not guessed.
  d.value = { low: "3.8M", high: "4,200,000", list: "" };
  const op = B.opinion(d);
  assert.ok(op.errors.low); assert.equal(op.low, null); assert.equal(op.high, 4200000);
  assert.ok(!doc(d).includes("3.8"), "an unreadable figure reached the document");
  d.value = { low: "4,500,000", high: "4,200,000", list: "" };
  assert.match(B.opinion(d).errors.high, /below the low end/);
});

test("every BOV says it is not an appraisal, and a broker's own disclaimer is added, never swapped in (rule 2)", () => {
  const d = draftFor({ compIds: ["c1"], value: { low: "3,800,000", high: "4,200,000", list: "" } });
  for (const html of [doc(d), doc(d, { brand: null }), doc(d, { brand: Object.assign({ disclaimer: "Summit makes no warranty." }, BRAND) })]) {
    assert.match(html, /It is not an appraisal\./);
    assert.match(html, /Uniform Standards of Professional Appraisal Practice/);
    assert.match(html, /Prepared with CompNinja/);
    assert.match(html, /Broker Opinion of Value/);
  }
  assert.match(doc(d, { brand: Object.assign({ disclaimer: "Summit makes no warranty." }, BRAND) }), /Summit makes no warranty\./);
  assert.equal(B.limitingConditions().length, 2);
  // The page never calls the document, or the tool, an appraisal of its own.
  assert.doesNotMatch(doc(d).replace(/not an appraisal|calls for an appraisal|an appraisal is wanted|Appraisal Practice|certified appraiser/g, ""), /apprais/i);
});

test("everything a person typed is escaped on the way into the document (rule 6)", () => {
  const d = draftFor({ compIds: ["c9"], value: { low: "3,800,000", high: "4,200,000", list: "" } });
  d.subject.address = '8400 <script>alert(1)</script> Ave, Boise, ID';
  d.subject.highlights = '<img src=x onerror=alert(1)>';
  d.subject.occupancy = '"><b>bold';
  d.client.name = "O'Brien & <Sons>";
  d.text.summary = "<iframe>";
  d.manual = [{ id: "m1", address: "1 <i>Main</i> St, Boise, ID", date: "2026-01-02", size: "10,000", price: "900,000", cap: "" }];
  const html = doc(d, { comps: [comp({ id: "c9", address: '<svg onload=x>, Boise, ID', lease_type: "<u>" })],
    brand: { firmName: "<b>Firm</b>", preparerName: "<x>", licenseNumber: "<y>", phone: "<z>", email: "<w>", disclaimer: "<q>", logo: "javascript:alert(1)" } });
  for (const raw of ["<script>", "<img", "<iframe>", "<svg", "<i>Main", "<b>Firm", "<b>bold", "<Sons>", "<x>", "<y>", "<z>", "<w>", "<q>", "javascript:"]) {
    assert.ok(!html.includes(raw), raw + " reached the document unescaped");
  }
  assert.match(html, /O&#39;Brien &amp; &lt;Sons&gt;/);
});

test("a cover photo is a picture this browser made or our own sealed street photo, and nothing else", () => {
  assert.equal(B.okPhoto("data:image/jpeg;base64,AAAA"), "data:image/jpeg;base64,AAAA");
  assert.equal(B.okPhoto("/api/streetview?t=abc.DEF-123_~"), "/api/streetview?t=abc.DEF-123_~");
  for (const bad of ["https://evil.example/x.jpg", "javascript:alert(1)", "data:text/html;base64,AAAA", "/api/streetview?address=1+Main", "data:image/svg+xml;base64,AAAA", '/api/streetview?t=a"><x']) {
    assert.equal(B.okPhoto(bad), "", bad + " was accepted as a cover photo");
  }
  assert.equal(B.okPhoto("data:image/png;base64," + "A".repeat(1000000)), "", "a photo too large to keep was accepted");
  const d = draftFor({ photo: "https://evil.example/x.jpg" });
  assert.ok(!doc(d).includes("evil.example"));
});

test("a draft out of storage is cleaned: unknown keys dropped, strings capped, lists capped", () => {
  const d = B.cleanDraft({
    from: "not-a-uuid", extra: "x", accent: "hotpink", photo: "javascript:1",
    subject: { address: "a".repeat(999), type: "Castle", size: 45000, evil: 1 },
    compIds: new Array(40).fill("c1"), touchedComps: "yes",
    manual: new Array(30).fill({ address: "1 Main St", date: "02/03/2026", size: "1", price: "2", cap: "3" }).concat([{ address: "" }]),
    text: { summary: "s".repeat(9999) },
  });
  assert.equal(d.from, ""); assert.equal(d.extra, undefined); assert.equal(d.accent, "navy"); assert.equal(d.photo, "");
  assert.equal(d.subject.address.length, B.LIMITS.address); assert.equal(d.subject.type, "Industrial");
  assert.equal(d.subject.size, "45000"); assert.equal(d.subject.evil, undefined);
  assert.equal(d.compIds.length, B.COMPS_MAX); assert.equal(d.touchedComps, false);
  assert.equal(d.manual.length, B.MANUAL_MAX); assert.equal(d.manual[0].date, "", "a date in another shape was kept");
  assert.deepEqual(d.manual.map((m) => m.id).slice(0, 3), ["m1", "m2", "m3"]);
  assert.equal(d.text.summary.length, B.LIMITS.text);
  assert.deepEqual(B.cleanDraft(null), B.blankDraft());
  assert.deepEqual(B.cleanDraft([1, 2]), B.blankDraft());
  assert.equal(B.cleanDraft({ from: "75fecf88-d150-44d8-bc61-3946177cbb3a" }).from, "75fecf88-d150-44d8-bc61-3946177cbb3a");
});

test("a typed comparable takes the subject's type and prices itself from its own figures", () => {
  const c = B.manualComp({ id: "m1", address: "1 Main St, Boise, ID", date: "2026-01-02", size: "10,000", price: "$900,000", cap: "6.5%" }, "Industrial");
  assert.equal(c.property_type, "Industrial"); assert.equal(c.transaction, "sale");
  assert.equal(c.price_per_sqft, 90); assert.equal(c.cap_rate, 6.5); assert.equal(c.manual, true);
  const land = B.manualComp({ id: "m1", address: "Lot 4", size: "4.5", price: "900,000" }, "Land");
  assert.equal(land.lot_acres, 4.5); assert.equal(land.price_per_acre, 200000); assert.equal(land.size_sqft, null);
  assert.equal(B.manualComp({ id: "m1", address: "x", size: "10k", price: "1.2M" }, "Industrial").price_per_sqft, null, "shorthand was read");
  const d = draftFor({ manual: [{ address: "1 Main St, Boise, ID", date: "2026-01-02", size: "10,000", price: "900,000", cap: "" }] });
  assert.equal(B.saleBasis(B.chosenComps(B.cleanDraft(d), []), "Industrial").median, 90);
});

test("land is sized in acres and priced per acre throughout", () => {
  const d = draftFor({ value: { low: "850,000", high: "950,000", list: "" } });
  d.subject.type = "Land"; d.subject.size = ""; d.subject.acres = "4.5";
  d.manual = [{ address: "Lot 9, Kuna, ID", date: "2026-02-01", size: "5", price: "1,000,000", cap: "" }];
  assert.equal(B.subjectSize(d), 4.5);
  const html = doc(d, { comps: [] });
  assert.match(html, /4\.5 acres/);
  assert.match(html, /\$200,000\/acre/);
  assert.match(html, /Price per acre/);
  assert.ok(!/\/SF/.test(html), "a land BOV quoted a price per square foot");
});

test("the income cross-check needs both figures, and prints only then", () => {
  const d = draftFor({ compIds: ["c1"] });
  assert.equal(B.incomeValue(d), null);
  d.income = { noi: "262,000", cap: "" };
  assert.equal(B.incomeValue(d), null);
  assert.ok(!doc(d).includes("Income cross-check"));
  d.income.cap = "6.5";
  assert.deepEqual(B.incomeValue(d), { noi: 262000, cap: 6.5, value: 4025000 });
  assert.match(doc(d), /Income cross-check[\s\S]*\$262,000 a year[\s\S]*6\.5%[\s\S]*<b>\$4,025,000<\/b> \(\$89\.44\/SF\)/);
  d.income.noi = "262k";
  assert.equal(B.incomeValue(d), null, "shorthand NOI was read");
});

test("readiness names what is missing, and only an address, a size, a comp and a value stop the print", () => {
  const empty = B.readiness(B.blankDraft(), BOOK, null);
  assert.equal(empty.ready, false);
  assert.deepEqual(empty.need.map((n) => n[0]), ["address", "size", "value", "comps"]);
  const d = draftFor({ compIds: ["c1"], value: { low: "3,800,000", high: "", list: "" } });
  const one = B.readiness(d, BOOK, null);
  assert.equal(one.ready, true);
  assert.deepEqual(one.want.map((n) => n[0]), ["comps", "client", "brand", "summary"]);
  assert.match(B.readiness(d, BOOK, { firmName: "Summit" }).want.map((n) => n[1]).join("|"), /license number/);
  d.value.low = "3.8M";
  assert.equal(B.readiness(d, BOOK, BRAND).ready, false, "an unreadable value was let through to print");
  d.value.low = "3,800,000"; d.subject.size = "45k";
  assert.equal(B.readiness(d, BOOK, BRAND).ready, false);
});

test("the hints a broker sees while writing never reach the printed copy", () => {
  const d = B.blankDraft();
  assert.match(doc(d, { preview: true, brand: null }), /bvd-hint/);
  assert.ok(!doc(d, { brand: null }).includes("bvd-hint"), "a hint was printed");
  assert.ok(!doc(d, { preview: false, brand: null }).includes("goes here"));
});

test("the letterhead is the saved branding, else the credit identity, and a logo is an inline image or nothing", () => {
  const who = B.preparerOf(null, { display_name: "Dana", company: "Summit", creditedTo: "Summit" });
  assert.equal(who.firm, "Summit"); assert.equal(who.name, "Dana");
  assert.equal(B.preparerOf({ firmName: "Summit", preparerName: "Summit" }, null).name, "", "the firm was printed twice");
  assert.equal(B.preparerOf({ firmName: "S", logo: "https://x.example/l.png" }, null).logo, "");
  assert.equal(B.preparerOf({ firmName: "S", logo: "data:image/png;base64,AAAA" }, null).logo, "data:image/png;base64,AAAA");
  const d = draftFor({ compIds: ["c1"] });
  assert.match(doc(d), /License DB41822/);
  assert.match(doc(d), /Prepared by<\/span><b>Dana Whitfield<\/b><i>Summit Commercial Advisors<\/i>/);
});

test("the two starting drafts are built from the draft's own facts", () => {
  const d = draftFor({ compIds: ["c1", "c2", "c3"], value: { low: "3,800,000", high: "4,200,000", list: "4,050,000" } });
  const s = B.starterSummary(d, BOOK);
  assert.match(s, /based on 3 comparable industrial sales in and around Boise, ID that closed between Mar 2026 and Aug 2026, at \$85\.00 to \$93\.98 per SF, with a median of \$88\.00 per SF\./);
  assert.match(s, /between \$3,800,000 and \$4,200,000 \(\$84\.44 to \$93\.33 per SF\)/);
  assert.match(s, /bringing it to market at \$4,050,000\./);
  assert.equal(B.starterSummary(B.blankDraft(), []), "", "a summary was written from nothing");
  assert.match(B.starterStrategy(d), /^We recommend listing the property at \$4,050,000\./);
  assert.match(B.starterStrategy(B.blankDraft()), /^We recommend pricing the property inside the range/);
  assert.equal(B.fileName(d), "BOV-8400-W-Fairview-Ave");
  assert.equal(B.fileName(B.blankDraft()), "BOV");
});

test("the stylesheet is paper: named colours, an accent from the list, and print rules of its own", () => {
  const css = B.documentCss("forest");
  assert.ok(css.includes("#1F4D3A"), "the chosen accent is not in the stylesheet");
  assert.equal(B.documentCss("hotpink"), B.documentCss("navy"), "an unknown accent did not fall back to navy");
  assert.ok(!/var\(--/.test(css), "the document reads a site token, which would print the dark theme's ink on white");
  assert.match(css, /@page\{size:letter;/);
  assert.match(css, /@media print\{/);
  assert.match(css, /\.bvd-sheet\{[^}]*break-before:page/);
  // Every class the document writes has a rule, or is one of the two that need none.
  const html = doc(draftFor({ compIds: ["c1", "c4", "c5"], value: { low: "3,800,000", high: "4,200,000", list: "4,050,000" }, income: { noi: "262,000", cap: "6.5" },
    text: { summary: "s", market: "m", strategy: "t", about: "a" }, photo: "data:image/jpeg;base64,AAAA" }), { preview: true });
  const used = new Set((html.match(/class="([^"]+)"/g) || []).flatMap((m) => m.slice(7, -1).split(/\s+/)));
  for (const c of used) assert.ok(css.includes("." + c), "." + c + " is written by the document and styled nowhere");
});

test("the file makes no request and keeps nothing (rule 5)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "bov-doc.js"), "utf8").replace(/\/\/[^\n]*/g, "");
  for (const word of ["fetch(", "XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "document.cookie", "require("]) {
    assert.ok(!src.includes(word), "bov-doc.js uses " + word);
  }
});

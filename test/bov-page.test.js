// /bov — the BOV builder (bov-page.js draws it, bov-builder.js runs it,
// bov-doc.js knows everything; 2026-11-27). The walls and the markup are
// rendered here, and the browser script is RUN against a small stand-in
// document, because its one promise (nothing a broker types leaves the
// page) is a promise about what it does, not about how it reads.
//
// Run: npm test   (node --test, no dependencies, no network)

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { renderBovBody } = require("../bov-page");
const B = require("../bov-doc");

const ROOT = path.join(__dirname, "..");
const BUILDER = fs.readFileSync(path.join(ROOT, "bov-builder.js"), "utf8");
const PAGE_SRC = fs.readFileSync(path.join(ROOT, "bov-page.js"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

const comp = (o) => Object.assign({
  id: "c1", address: "8120 W Fairview Ave, Boise, ID 83704", market: "Boise, ID", property_type: "Industrial",
  transaction: "sale", deal_date: "2026-08-14", size_sqft: 42000, price: 3696000, price_per_sqft: 88,
}, o);
const BOOK = [comp({}), comp({ id: "c2", address: "3305 S Federal Way, Boise, ID 83705", deal_date: "2026-03-19", price_per_sqft: 85 }),
  comp({ id: "c3", address: "415 W Main St, Boise, ID 83702", property_type: "Office", price_per_sqft: 170 })];
const open = (j, tag) => ({ s: 200, j: Object.assign({ comps: BOOK, identity: { display_name: "Dana", company: "Summit", creditedTo: "Summit" } }, j), tag: tag || "abc123" });
const BOV_ID = "75fecf88-d150-44d8-bc61-3946177cbb3a";
const OWNER = "The Owner LLC";

test("each refusal is a wall with its own words, and ships no form, no comps and no script", () => {
  const cases = [
    [null, /couldn&rsquo;t be loaded just now/],
    [{ s: 401, j: { error: "Not signed in." } }, /Please <a href="\/desk">sign in<\/a> to write a BOV\./],
    [{ s: 403, j: { error: "x" } }, /<strong>The BOV builder is part of Pro\.<\/strong>[\s\S]*See your plan/],
    [{ s: 503, j: { error: "Your comps are unavailable right now." } }, /Your comps are unavailable right now\./],
  ];
  for (const [boot, words] of cases) {
    const html = renderBovBody(boot);
    assert.match(html, words);
    assert.ok(!html.includes('id="bbApp"'), "a refused page shipped the form");
    assert.ok(!html.includes("<script"), "a refused page shipped a script");
    assert.ok(!html.includes("__BOV_BOOT__"));
    assert.match(html, /<h1>BOV builder<\/h1>/);
  }
  // "Part of Pro", never a broker plan (vault.md: one subscription).
  assert.doesNotMatch(renderBovBody({ s: 403 }), /broker plan/i);
  assert.match(renderBovBody({ s: 503, j: { error: "<b>x</b>" } }), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("the open page ships the form, the boot and its two scripts in order, with nothing able to close the script", () => {
  const html = renderBovBody(open({ comps: [comp({ address: "</script><script>alert(1)</script>" })] }));
  assert.ok(html.includes('id="bbApp"'));
  assert.ok(!html.includes("</script><script>alert(1)"), "a comp's address closed the boot script");
  assert.ok(html.includes("\\u003c/script>"));
  const boot = html.indexOf("window.__BOV_BOOT__="), docJs = html.indexOf('<script src="/bov-doc.js">'), run = html.indexOf('<script src="/bov-builder.js">');
  assert.ok(boot > -1 && boot < docJs && docJs < run, "the boot, BOVDOC and the builder are out of order");
  // The document's stylesheet is in the page from the first paint, and the
  // printed copy has its own home outside the page's wrapper.
  assert.match(html, /<style id="bbDocCss">\.bvd\{/);
  assert.match(html, /<div id="bovSheet"><\/div>/);
  assert.match(html, /body\.bov-printing>\*\{display:none!important\}/);
  assert.match(html, /body\.bov-printing>#bovSheet\{display:block!important/);
  // Every property type, from the one list.
  for (const t of B.PROPERTY_TYPES) assert.ok(html.includes("<option>" + t + "</option>"), t);
  for (const [key] of B.ACCENTS) assert.ok(html.includes('data-accent="' + key + '"'), key);
});

test("the page says once that the draft stays here, and never calls itself an appraisal", () => {
  const html = renderBovBody(open());
  assert.match(html, /Nothing you type here is sent to CompNinja\./);
  assert.match(html, /It is your opinion,\s+on your letterhead\./);
  assert.doesNotMatch(html.replace(/<style[\s\S]*?<\/style>/g, ""), /apprais/i, "the builder's own copy says appraisal");
  // The owner is not a licensed broker: the page never says CompNinja's value.
  assert.doesNotMatch(html, /CompNinja(&rsquo;|')s (opinion|value|estimate)/i);
});

test("every figure field opens the number keyboard on a phone", () => {
  const html = renderBovBody(open());
  for (const id of ["bbSize", "bbAcres", "bbLow", "bbHigh", "bbList", "bbNoi", "bbCap", "bbmSize", "bbmPrice", "bbmCap"]) {
    assert.match(html, new RegExp('<input id="' + id + '" type="text" inputmode="decimal"'), id + " opens the letter keyboard");
  }
  assert.match(html, /<input id="bbYear" type="text" inputmode="numeric"/);
});

test("the page's stylesheet restyles no shared button and hides what is marked hidden", () => {
  const css = (renderBovBody(open()).match(/<style>([\s\S]*?)<\/style>/) || [])[1];
  assert.ok(css, "the page ships no stylesheet of its own");
  assert.doesNotMatch(css, /(^|[\s,}])\.btn[\s{.:,]/m, "bov-page.js restyles the shared .btn (components.js)");
  assert.match(css, /\.bb-page \[hidden\]\{display:none!important\}/);
  assert.match(css, /body>main\.wrap\{min-height:100vh/, "the footer is on the first screen");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,6}\b/, "a literal colour in the page's own stylesheet (the tokens are theme.js's)");
});

test("every element the builder reaches for is in the page", () => {
  const html = renderBovBody(open());
  const ids = new Set((html.match(/\bid="([^"]+)"/g) || []).map((m) => m.slice(4, -1)));
  const asked = new Set();
  for (const m of BUILDER.matchAll(/\$\("([A-Za-z0-9]+)"\)/g)) asked.add(m[1]);
  for (const m of BUILDER.matchAll(/\["(bb[A-Za-z0-9]+)", "/g)) asked.add(m[1]);
  assert.ok(asked.size > 40, "the scan found too few ids to mean anything");
  for (const id of asked) assert.ok(ids.has(id), "bov-builder.js reads #" + id + ", which the page does not have");
});

test("the builder's every request is one of four, and the draft is in none of them (rule 6)", () => {
  const code = BUILDER.replace(/\/\/[^\n]*/g, "");
  const urls = [...code.matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(urls, ["/api/branding", "/api/broker/bovs", "/api/broker/bovs/update", "/api/building-photo"]);
  assert.equal((code.match(/fetch\(/g) || []).length, 4, "a request with a computed address");
  for (const word of ["sendBeacon", "XMLHttpRequest", "WebSocket", "EventSource", "navigator.clipboard", "document.cookie"]) {
    assert.ok(!code.includes(word), "bov-builder.js uses " + word);
  }
  // The two bodies it sends, whole: one address for a photo, one status.
  const bodies = [...code.matchAll(/body: JSON\.stringify\(([^\n]+?)\) \}\)/g)].map((m) => m[1]);
  assert.deepEqual(bodies, ["{ places: [{ address: address }] }", '{ id: id, status: "delivered" }']);
  // innerHTML is written only with BOVDOC's own escaped document.
  const writes = [...code.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]);
  assert.deepEqual(writes, ["B.documentHtml(draft, docOpts(true))", "B.documentHtml(draft, docOpts(false))"]);
  // Storage is this browser's, under the account's tag.
  assert.match(code, /var STORE_KEY = "cnBov1:" \+ \(BOOT\.tag \|\| "me"\);/);
  assert.ok(!code.includes("sessionStorage"));
});

test("both scripts are served as JavaScript and never cached, and the page is a member tab", () => {
  for (const f of ["bov-doc.js", "bov-builder.js"]) {
    assert.match(SERVER, new RegExp('"/' + f.replace(".", "\\.") + '": \\{ file: "' + f.replace(".", "\\.") + '", type: "text/javascript; charset=utf-8", maxAge: 0 \\}'), f);
  }
  assert.ok(require("../instant-nav").TAB_PATHS.includes("/bov"));
  assert.match(SERVER, /logPageVisit\(req, "bov_visit"/);
  assert.match(SERVER, /const CTA_FREE_PAGES = new Set\(\[\.\.\.VAULT_PAGE_PATHS, "\/bov",/);
  // bov-page.js reads nothing itself: the gate is server.js's vaultReadPayload.
  assert.doesNotMatch(PAGE_SRC.replace(/\/\/[^\n]*/g, ""), /fetch\(|sbRequest|process\.env/);
});

// ---- the builder, run ---------------------------------------------------------
// A stand-in document: the ids the page really ships, each an element that
// keeps its value, its attributes and its listeners.
class El {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {};
    this.value = ""; this.className = ""; this._text = ""; this.innerHTML = ""; this.style = {}; this.options = [{}];
    this.disabled = false; this.open = false; this.checked = false; this.clientWidth = 700; this.parentNode = null;
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this.children = []; this._text = String(v == null ? "" : v); }
  appendChild(k) { k.parentNode = this; this.children.push(k); return k; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t, ev) { (this.listeners[t] || []).forEach((fn) => fn.call(this, Object.assign({ target: this }, ev))); }
  querySelectorAll() { return []; }
  remove() {}
  click() { this.fire("click"); }
  get hidden() { return "hidden" in this.attrs; }
  get classList() {
    const el = this;
    return { add: (c) => { el.className += " " + c; }, remove: (c) => { el.className = el.className.replace(" " + c, ""); } };
  }
}
function run({ boot, storage = {}, search = "", bovs = [], brand = null, prerendering = false } = {}) {
  const b = boot || open();
  const html = renderBovBody(b);
  const els = {};
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) els[m[1]] = new El();
  els.bbFromRow.setAttribute("hidden", "");
  const calls = [], replaced = [];
  const body = new El("body");
  const doc = {
    getElementById: (id) => els[id] || null, createElement: (t) => new El(t),
    createTextNode: (t) => Object.assign(new El("#text"), { _text: String(t) }),
    body, title: "BOV builder", prerendering,
  };
  const win = {
    BOVDOC: B, __BOV_BOOT__: JSON.parse(JSON.stringify({ j: b.j, tag: b.tag })),
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    location: { search, replace: (u) => replaced.push(u) }, addEventListener() {}, removeEventListener() {},
    confirm: () => true, printed: [], shop: null,
  };
  win.print = () => { win.printed.push(doc.title); };
  win.cnShopNav = (dev) => { win.shop = dev; };
  const fetch = (url, init) => {
    calls.push({ url, method: (init && init.method) || "GET", body: init && init.body });
    const j = url === "/api/branding" ? { branding: brand || {}, firm: null }
      : url === "/api/broker/bovs" ? { bovs }
      : url === "/api/building-photo" ? { photos: ["/api/streetview?t=tok"] } : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
  };
  vm.runInNewContext(BUILDER, {
    window: win, document: doc, fetch, setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {}, URLSearchParams,
    FileReader: function () {}, Image: function () {}, console,
  });
  const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)));
  const type = (id, v) => { els[id].value = v; els[id].fire("input"); };
  return { els, calls, storage, win, doc, body, replaced, settle, type };
}

test("it opens with the closest comps ticked, and asks the server only for the letterhead and the BOV log", async () => {
  const p = run();
  await p.settle();
  assert.deepEqual(p.calls.map((c) => c.method + " " + c.url), ["GET /api/branding", "GET /api/broker/bovs"]);
  assert.equal(p.els.bbCompN.textContent, "2 chosen", "the two industrial sales were not ticked to start");
  assert.equal(p.els.bbPrint.disabled, true, "an empty BOV can be printed");
  assert.match(p.els.bbReady.textContent, /Still needed: the property\u2019s address; the building\u2019s size; your opinion of value\./);
  assert.match(p.els.bbZoom.innerHTML, /bvd-hint/, "the preview does not show what is missing");
  assert.deepEqual(Object.keys(p.storage), [], "the page wrote to storage on load (rule 15)");
});

test("typing fills the document and is kept in this browser under the account's tag, and no request carries it", async () => {
  const p = run({ brand: { firmName: "Summit Commercial Advisors", licenseNumber: "DB41822" } });
  await p.settle();
  p.type("bbAddr", "8400 W Fairview Ave, Boise, ID 83704");
  p.type("bbSize", "45,000");
  p.type("bbClient", OWNER);
  p.type("bbNoi", "262,000");
  p.els.bbUse.click();
  assert.equal(p.els.bbLow.value, "3,825,000"); assert.equal(p.els.bbHigh.value, "3,950,000");
  assert.equal(p.els.bbList.value, "3,900,000", "an empty list price takes the median");
  p.type("bbList", "4,000,000");
  p.els.bbUse.click();
  assert.equal(p.els.bbList.value, "4,000,000", "Use this range wrote over a list price the broker typed");
  assert.equal(p.els.bbPrint.disabled, false);
  assert.match(p.els.bbReady.textContent, /^Ready to print\./);
  assert.ok(p.els.bbZoom.innerHTML.includes(OWNER));
  assert.match(p.els.bbZoom.innerHTML, /\$3,825,000 \u2013 \$3,950,000/);
  const kept = JSON.parse(p.storage["cnBov1:abc123"]);
  assert.equal(kept.drafts._.d.client.name, OWNER);
  assert.equal(kept.drafts._.d.income.noi, "262,000");
  // Rule 6: after all of that, the page has still asked only its two reads.
  assert.deepEqual(p.calls.map((c) => c.url), ["/api/branding", "/api/broker/bovs"]);
  for (const c of p.calls) assert.equal(c.body, undefined);
});

test("a kept draft comes back for the same account and not for another", async () => {
  const first = run();
  await first.settle();
  first.type("bbAddr", "8400 W Fairview Ave, Boise, ID 83704");
  first.type("bbClient", OWNER);
  const again = run({ storage: first.storage });
  await again.settle();
  assert.equal(again.els.bbClient.value, OWNER);
  const other = run({ storage: first.storage, boot: open({}, "zzz999") });
  await other.settle();
  assert.equal(other.els.bbClient.value, "", "another account on this browser read the draft");
  assert.equal(other.els.bbAddr.value, "");
});

test("a card's link starts the BOV from its row, and a kept draft is never written over by it", async () => {
  const row = { id: BOV_ID, market: "Boise, ID", property_type: "Office", status: "open", size_sqft: 18000, address: "415 W Main St, Boise, ID 83702" };
  const p = run({ search: "?from=" + BOV_ID, bovs: [row] });
  await p.settle();
  assert.equal(p.els.bbAddr.value, "415 W Main St, Boise, ID 83702");
  assert.equal(p.els.bbType.value, "Office");
  assert.equal(p.els.bbSize.value, "18,000");
  assert.equal(p.els.bbFromRow.hidden, false);
  assert.equal(p.els.bbCompN.textContent, "1 chosen", "the suggestion did not follow the card's type");
  p.type("bbAddr", "417 W Main St, Boise, ID 83702");
  const back = run({ search: "?from=" + BOV_ID, bovs: [row], storage: p.storage });
  await back.settle();
  assert.equal(back.els.bbAddr.value, "417 W Main St, Boise, ID 83702", "the card's address replaced what the broker typed");
  // An id that is not this account's BOV starts a plain draft.
  const stranger = run({ search: "?from=" + BOV_ID, bovs: [] });
  await stranger.settle();
  assert.equal(stranger.els.bbFrom.value, "");
  assert.equal(stranger.els.bbAddr.value, "");
});

test("printing draws the copy without hints, names the file, and offers the one write only for an open BOV", async () => {
  const row = { id: BOV_ID, market: "Boise, ID", property_type: "Industrial", status: "open", size_sqft: 45000, address: "8400 W Fairview Ave, Boise, ID 83704" };
  const p = run({ search: "?from=" + BOV_ID, bovs: [row] });
  await p.settle();
  p.els.bbUse.click();
  const sheet = p.els.bovSheet;
  p.els.bbPrint.click();
  assert.ok(!sheet.innerHTML.includes("bvd-hint"), "a hint reached the printed copy");
  assert.match(sheet.innerHTML, /8400 W Fairview Ave/);
  assert.equal(sheet.parentNode, p.body, "the printed copy was not moved under body");
  assert.match(p.body.className, /bov-printing/);
  // The browser offers the page's title as the PDF's name.
  assert.deepEqual(p.win.printed, ["BOV-8400-W-Fairview-Ave"]);
  // Nothing was written by printing.
  assert.ok(!p.calls.some((c) => c.method === "POST"));
  p.els.bbDelivered.click();
  await p.settle();
  const post = p.calls.filter((c) => c.method === "POST");
  assert.equal(post.length, 1);
  assert.equal(post[0].url, "/api/broker/bovs/update");
  assert.deepEqual(JSON.parse(post[0].body), { id: BOV_ID, status: "delivered" });
  assert.equal(p.els.bbDoneMsg.textContent, "Moved to Delivered.");
});

test("a street photo is one press, sends only the address, and takes only our own sealed src", async () => {
  const p = run();
  await p.settle();
  p.els.bbPhotoStreet.click();
  assert.ok(!p.calls.some((c) => c.url === "/api/building-photo"), "a photo was asked for with no address");
  p.type("bbAddr", "8400 W Fairview Ave, Boise, ID 83704");
  p.type("bbClient", OWNER);
  p.els.bbPhotoStreet.click();
  await p.settle();
  const ask = p.calls.filter((c) => c.url === "/api/building-photo");
  assert.equal(ask.length, 1);
  assert.deepEqual(JSON.parse(ask[0].body), { places: [{ address: "8400 W Fairview Ave, Boise, ID 83704" }] });
  assert.match(p.els.bbZoom.innerHTML, /<img src="\/api\/streetview\?t=tok"/);
});

test("a development firm's member is sent to Sites, but never from a page built ahead of the click", async () => {
  const dev = open({ firm: { id: "f1", name: "Ridgeline", kind: "development" } });
  const p = run({ boot: dev });
  assert.deepEqual(p.replaced, ["/sites"]);
  assert.equal(p.win.shop, true);
  assert.deepEqual(p.calls, [], "the page read on its way out");
  assert.deepEqual(run({ boot: dev, prerendering: true }).replaced, []);
  const broker = run({ boot: open({ firm: { id: "f2", name: "Summit", kind: "broker" } }) });
  assert.deepEqual(broker.replaced, []);
  assert.equal(broker.win.shop, false);
});

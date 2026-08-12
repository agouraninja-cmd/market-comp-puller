// The /vault page renderer.
//
// renderVaultHTML is pure — a boot payload in, a string out — so it can be
// exercised with no database, no session and no browser, which is the same
// reason entitlements.js and comp-gate.js are testable.
//
// The first test is the one that earns this file. The whole page, including
// ~550 lines of browser JavaScript, is built inside ONE template literal.
// That means a stray `${`, or a regex or escape written with one backslash
// instead of two, does not fail here — it silently emits broken JavaScript,
// and the page dies at the first line with a blank workspace and a console
// error nobody is watching. Parsing what is actually emitted is the only
// check that catches it, and it costs a millisecond.

const test = require("node:test");
const assert = require("node:assert");

const { renderVaultHTML } = require("../vault-page");

const CHROME = { CN_LOGO: "<svg></svg>", MARKET_CSS: "" };

function comp(o) {
  return Object.assign({
    id: "c1", upload_id: "u1", market: "Boise, ID", property_type: "Industrial",
    address: "100 Main St", deal_date: "2026-03-14", transaction: "sale",
    price: 1000000, size_sqft: 10000, price_per_sqft: 100, published: false,
  }, o);
}
function boot(comps, identity) {
  return { s: 200, j: {
    comps, uploads: [],
    counts: { returned: comps.length, published: comps.filter((c) => c.published).length },
    markets: [...new Set(comps.map((c) => c.market))],
    types: [...new Set(comps.map((c) => c.property_type))],
    // The credit identity, as vaultReadPayload serves it. Default is the
    // unstated case, which is what every pre-existing test wants.
    identity: identity || { display_name: "", company: "", creditedTo: "" },
  } };
}
// The page's own inline script, as the browser would receive it.
function pageScript(html) {
  const m = html.match(/<script>\n\(function\(\)\{[\s\S]*?\}\)\(\);\n<\/script>/);
  assert.ok(m, "could not find the page's inline script");
  return m[0].replace(/^<script>/, "").replace(/<\/script>$/, "");
}

// ---------------------------------------------------------------------------
// The emitted JavaScript is real JavaScript
// ---------------------------------------------------------------------------

test("the script the page emits parses", () => {
  // new Function compiles without running: no DOM needed, and a syntax error
  // anywhere in the emitted script throws here instead of shipping.
  assert.doesNotThrow(() => new Function(pageScript(renderVaultHTML(boot([comp({})]), CHROME))));
});

test("it parses for every boot state the route can produce", () => {
  for (const b of [null, { s: 401, j: { error: "Not signed in." } },
                   { s: 403, j: { error: "Broker plan." } },
                   { s: 503, j: { error: "Unavailable." } }, boot([])]) {
    assert.doesNotThrow(() => new Function(pageScript(renderVaultHTML(b, CHROME))),
      "emitted script failed to parse for boot " + JSON.stringify(b && b.s));
  }
});

// ---------------------------------------------------------------------------
// The dashboard's own contract with the rest of the system
// ---------------------------------------------------------------------------

test("the dashboard reads none of vault-api's INTERNAL_FIELDS", () => {
  // vault-api.js keeps user_id, address_key and dedupe_key in the response
  // only until the dashboard confirms it does not read them. This test IS that
  // confirmation, and it keeps being true: the page groups repeat properties
  // on its own copy of addressKey rather than the stored column.
  const { INTERNAL_FIELDS } = require("../vault-api");
  const js = pageScript(renderVaultHTML(boot([comp({})]), CHROME));
  for (const f of INTERNAL_FIELDS) {
    assert.ok(!new RegExp("\\." + f + "\\b").test(js) && !js.includes('"' + f + '"'),
      "the vault page reads " + f + ", which vault-api.js lists as internal and intends to drop");
  }
});

test("it asks for the whole book, not the default page", () => {
  // GET /api/vault defaults to limit=200. The rollup counts the whole book, so
  // a broker with 400 comps would otherwise be shown half of it with no hint.
  const js = pageScript(renderVaultHTML(boot([comp({})]), CHROME));
  assert.match(js, /\/api\/vault\?limit=1000/);
  // And it must not go back to narrowing server-side, which would leave the
  // browser holding only the current slice to compute the rollup from.
  assert.ok(!/"market="\+encodeURIComponent/.test(js),
    "the page is filtering server-side again; the rollup would only count the current slice");
});

// ---------------------------------------------------------------------------
// Escaping — comp text is broker-authored and reaches the page as data
// ---------------------------------------------------------------------------

test("a comp address cannot break out of the boot payload", () => {
  const html = renderVaultHTML(boot([comp({ address: "</script><img src=x onerror=alert(1)>" })]), CHROME);
  assert.ok(!html.includes("</script><img"), "raw </script> reached the page");
  assert.ok(html.includes("\\u003c/script>") || html.includes("\\u003c"), "< was not escaped in the boot JSON");
  assert.doesNotThrow(() => new Function(pageScript(html)));
});

test("the boot payload stays valid JSON through escaping", () => {
  const html = renderVaultHTML(boot([comp({ address: '1 "Quoted" St </script>', notes: "a<b>c" })]), CHROME);
  // The boot tag is one line: `<script>window.__VAULT_BOOT__=…;</script>`.
  // Anchoring on `;</script>` matters — a laxer match runs on to the END of
  // the main script tag and captures the whole page script with it.
  const m = html.match(/window\.__VAULT_BOOT__=([\s\S]*?);<\/script>/);
  assert.ok(m, "boot payload not found");
  // \u003c is a valid JSON escape, so the browser parses this back to the
  // original text — the escaping protects the tag, not the data.
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.j.comps[0].address, '1 "Quoted" St </script>');
});

// ---------------------------------------------------------------------------
// The empty vault
// ---------------------------------------------------------------------------

test("an empty vault hides the dashboard rather than showing empty panels", () => {
  // A broker's first visit must land on the uploader with nothing in the way.
  // The markup ships hidden and only renderRollup() reveals it, so this holds
  // before any script runs.
  const html = renderVaultHTML(boot([]), CHROME);
  assert.match(html, /<section id="rollupSec" class="hide">/);
  assert.match(html, /id="chartBox"[^>]*class="dbox chart hide"|class="dbox chart hide" id="chartBox"/);
  assert.match(html, /id="repBox"[^>]*class="dbox hide"|class="dbox hide" id="repBox"/);
});

// ---------------------------------------------------------------------------
// The gut check (v4 slice 1)
// ---------------------------------------------------------------------------

test("the page loads /gut-check.js and guards the global", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.match(html, /<script src="\/gut-check\.js"><\/script>/,
    "the gut-check module must load before the inline script");
  const js = pageScript(html);
  // The panel must degrade to hidden — never a thrown ReferenceError that
  // kills the whole workspace — if /gut-check.js fails to load.
  assert.match(js, /typeof GUTCHECK/,
    "the inline script must guard its use of the GUTCHECK global");
});

test("the gut-check panel ships hidden and lives inside the filtered section", () => {
  const html = renderVaultHTML(boot([]), CHROME);
  // Inside #compsSec (so applyFirstRun's hide covers it) and hidden until
  // renderGutCheck reveals it — same pattern as #chartBox / #repBox.
  assert.match(html, /id="gutBox"[^>]*class="dbox hide"|class="dbox hide" id="gutBox"/);
  const comps_ix = html.indexOf('<section id="compsSec">');
  const gut_ix = html.indexOf('id="gutBox"');
  const chart_ix = html.indexOf('id="chartBox"');
  assert.ok(comps_ix < gut_ix && gut_ix < chart_ix,
    "gutBox must sit inside #compsSec, above the chart");
});

test("the emitted script still parses with the gut-check code in it", () => {
  assert.doesNotThrow(() => new Function(pageScript(renderVaultHTML(boot([comp({})]), CHROME))));
});

// ---------------------------------------------------------------------------
// The gut check actually renders (review follow-up)
//
// The three tests above only prove the markup exists and the emitted script
// COMPILES. None of them execute renderGutCheck, so a field-name typo against
// gut-check.js's real output shape (b.corpus.q1_ppsf, b.snapshot.ppsf.low,
// b.cap.corpus_median, outliers[id].dir/pct) would compile fine, pass every
// test above, and render blank in production. These tests run the REAL
// emitted script against a minimal DOM stub, with the REAL gut-check.js
// module wired in as the GUTCHECK global — that is the point: they pin the
// cross-module field contract against its actual producer, not a
// hand-written fixture of the shape.
// ---------------------------------------------------------------------------

const GUTCHECK = require("../gut-check");
// The mapper tests answer /api/vault/inspect out of the real module, exactly
// as server.js does, so the page is pinned against its actual producer.
const VAULT = require("../broker-vault");

// A <select> as the mapper's own emitted markup describes it: the source
// column on data-src, and the option carrying `selected` as the value. pick()
// is what a broker doing the one thing this screen asks of them does.
function stubSelect(src, value) {
  const changed = [];
  return {
    value,
    getAttribute(a) { return a === "data-src" ? src : null; },
    addEventListener(t, fn) { if (t === "change") changed.push(fn); },
    pick(v) { this.value = v; changed.forEach((fn) => fn({})); },
  };
}
function parseSelects(html) {
  const out = [];
  const re = /<select data-src="([^"]*)">([\s\S]*?)<\/select>/g;
  let m;
  while ((m = re.exec(html))) {
    const sel = /<option value="([^"]*)" selected>/.exec(m[2]);
    out.push(stubSelect(m[1], sel ? sel[1] : ""));
  }
  return out;
}

// A generic auto-vivifying element: every id the page script touches gets a
// working stub with no need to enumerate them all up front.
//
// classList is REAL (backed by className) and listeners are recorded, because
// the mapper's behavior is expressed entirely in those two things: which
// sections are hidden, and what a click on Import or Cancel does.
function stubElement() {
  let cls = "", html = "", text = "", val = "", selects = null;
  const on = {};
  const has = (c) => cls.split(/\s+/).indexOf(c) >= 0;
  const classList = {
    contains: has,
    add(c) { if (!has(c)) cls = (cls ? cls + " " : "") + c; },
    remove(c) { cls = cls.split(/\s+/).filter((x) => x && x !== c).join(" "); },
    toggle(c, force) { (force === undefined ? has(c) : !force) ? classList.remove(c) : classList.add(c); },
  };
  return {
    get className() { return cls; }, set className(v) { cls = v; },
    get innerHTML() { return html; }, set innerHTML(v) { html = v; selects = null; },
    get textContent() { return text; }, set textContent(v) { text = v; },
    get value() { return val; }, set value(v) { val = v; },
    disabled: false,
    classList,
    addEventListener(t, fn) { (on[t] = on[t] || []).push(fn); },
    removeEventListener() {},
    // applyFirstRun relocates the one #covForm node between step 2 and the
    // leads section. This harness is an id-keyed bag with no notion of
    // position, so relocation is a no-op here on purpose — elements stay
    // reachable by id either way, which is all these tests read.
    appendChild() {},
    insertBefore() {},
    // What the browser would do when the broker clicks / picks a file.
    fire(t, ev) { (on[t] || []).forEach((fn) => fn(ev || {})); },
    querySelectorAll(sel) {
      if (sel !== "select") return [];
      if (!selects) selects = parseSelects(html);
      return selects;
    },
    click() {}, focus() {}, scrollIntoView() {},
    getAttribute() { return null; }, setAttribute() {},
    closest() { return null; },
  };
}

// The page reads the chosen file with FileReader before it posts anything.
function stubFileReader() {
  return function FakeFileReader() {
    this.readAsText = (file) => { this.result = file.text; if (this.onload) this.onload(); };
  };
}

// createElement("div") reproduces the ONE browser behavior esc() relies on:
// textContent -> innerHTML escapes &, < and > and deliberately leaves a
// literal " alone (matches the comment on escA in vault-page.js).
function stubDocument() {
  const byId = {};
  return {
    getElementById(id) { if (!byId[id]) byId[id] = stubElement(); return byId[id]; },
    createElement() {
      let t = "";
      return {
        set textContent(v) { t = v == null ? "" : String(v); },
        get textContent() { return t; },
        get innerHTML() { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); },
      };
    },
    addEventListener() {},
    querySelector() { return stubElement(); },
    querySelectorAll() { return []; },
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

// Runs the page's REAL emitted script (from the REAL renderVaultHTML output)
// against the stub DOM. fetch answers /api/broker/leads benignly (that route
// is not what this test is about) and /api/vault/benchmarks with whatever
// `benchResult()` returns — a function so a test can hand back a rejection
// for the degraded-fetch case.
// `upload` lets a test answer POST /api/vault/upload; every call the page
// makes is recorded, which is how "no mapping key was sent" and "no upload
// happened at all" are asserted. /api/vault/inspect answers through the REAL
// broker-vault.js, exactly as server.js does, so these tests pin the page
// against its actual producer rather than a hand-written fixture.
async function runPage(comps, benchResult, opts, identity) {
  opts = opts || {};
  const calls = [];
  const bootPayload = boot(comps, identity);
  const html = renderVaultHTML(bootPayload, CHROME);
  const script = pageScript(html);
  const doc = stubDocument();
  const win = { __VAULT_BOOT__: bootPayload };
  const fakeFetch = (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init && init.body ? JSON.parse(init.body) : null });
    if (u.indexOf("/api/broker/leads") === 0) {
      return Promise.resolve(jsonResponse(200, { coverage: [], leads: [] }));
    }
    if (u.indexOf("/api/vault/benchmarks") === 0) {
      return benchResult ? benchResult() : Promise.resolve(jsonResponse(200, { buckets: [] }));
    }
    if (u.indexOf("/api/vault/inspect") === 0) {
      const info = VAULT.inspectCsv(String(calls[calls.length - 1].body.csv || ""));
      if (!info.ok) return Promise.resolve(jsonResponse(400, { error: info.error }));
      return Promise.resolve(jsonResponse(200, Object.assign({}, info, {
        remembered: opts.remembered || null,
        targets: VAULT.MAPPABLE_TARGETS,
        required: VAULT.REQUIRED_TARGETS,
      })));
    }
    if (u.indexOf("/api/vault/upload") === 0) {
      return opts.upload ? opts.upload() : Promise.resolve(jsonResponse(200, { ok: true, imported: 1 }));
    }
    if (u.indexOf("/api/vault/publish") === 0) {
      return opts.publish
        ? opts.publish()
        : Promise.resolve(jsonResponse(200, { ok: true, published: true, creditedTo: "Hawkins Ridge CRE" }));
    }
    if (u.indexOf("/api/vault/identity") === 0) {
      return opts.identity
        ? opts.identity(init)
        : Promise.resolve(jsonResponse(200, {
            ok: true,
            identity: { display_name: "", company: "Hawkins Ridge CRE" },
            creditedTo: "Hawkins Ridge CRE",
          }));
    }
    if (u.indexOf("/api/vault/comp") === 0) {
      return opts.comp
        ? opts.comp(init, u)
        : Promise.resolve(jsonResponse(200, { ok: true, comp: {}, unpublished: false }));
    }
    if (u.indexOf("/api/vault?") === 0) return Promise.resolve(jsonResponse(200, bootPayload.j));
    return Promise.reject(new Error("unexpected fetch in test: " + u));
  };
  const fn = new Function("document", "window", "fetch", "GUTCHECK", "FileReader", script);
  fn(doc, win, fakeFetch, GUTCHECK, stubFileReader());
  // loadLeads and loadBenchmarks (and benchmarks' own re-render) are chained
  // Promise.then()s, i.e. microtasks only. Node drains the ENTIRE microtask
  // queue, however deeply chained, before running any macrotask callback —
  // so one setImmediate tick is enough to guarantee both have settled.
  await tick();
  return { doc, calls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Picking a file is the only way into the mapper, so the tests come in that
// way too: the change handler on the one <input type=file>.
async function chooseFile(doc, csv, name) {
  doc.getElementById("file").fire("change", {
    target: { files: [{ name: name || "book.csv", text: csv }], value: "x" },
  });
  await tick();
}
const selectsOf = (doc) => doc.getElementById("mapBody").querySelectorAll("select");
const selectFor = (doc, src) =>
  selectsOf(doc).filter((s) => s.getAttribute("data-src") === src)[0];

test("renderGutCheck renders real verdict cards and marks an outlier row, executed against the real gut-check.js", async () => {
  // Bucket A: two Boise/Industrial sales bracketing the benchmark band ->
  // in_line. Also carries cap rates so the cap line gets exercised.
  const a1 = comp({ id: "c1", address: "100 Main St", market: "Boise, ID", property_type: "Industrial",
    transaction: "sale", price_per_sqft: 98, cap_rate: 6.5, deal_date: "2026-01-05" });
  const a2 = comp({ id: "c2", address: "200 Second St", market: "Boise, ID", property_type: "Industrial",
    transaction: "sale", price_per_sqft: 102, cap_rate: 6.5, deal_date: "2026-02-10" });
  // Bucket B: one Dallas/Office sale priced well above the snapshot band ->
  // above, and it must trip the outlier flag on the row itself.
  const b1 = comp({ id: "c3", address: "300 Elm St", market: "Dallas, TX", property_type: "Office",
    transaction: "sale", price_per_sqft: 300, deal_date: "2026-03-01" });

  const buckets = [
    { market: "Boise, ID", type: "Industrial",
      corpus: { count: 5, q1_ppsf: 90, q3_ppsf: 110, newest_deal_date: "2026-01-15", cap_rate_median: 6.5 },
      snapshot: { ppsf: { low: 85, high: 115 }, cap_rate_low: 6, cap_rate_high: 7, generatedAt: "2026-07-01" } },
    { market: "Dallas, TX", type: "Office",
      corpus: null,
      snapshot: { ppsf: { low: 100, high: 150 }, generatedAt: "2026-06-01" } },
  ];

  const { doc } = await runPage([a1, a2, b1], () => Promise.resolve(jsonResponse(200, { buckets })));

  assert.equal(doc.getElementById("gutBox").className, "dbox",
    "the panel must unhide once real benchmark data lands");

  const cards = doc.getElementById("gutCards").innerHTML;
  assert.match(cards, /<span class="mk">Boise, ID<\/span>/, "the in_line bucket names its market");
  assert.match(cards, /In line with the market/, "the in_line bucket's verdict label");
  assert.match(cards, /class="gcv ok"/, "the in_line chip carries the calm 'ok' class");
  assert.match(cards, /Above the market band/, "the above bucket's verdict label");
  assert.match(cards, /\+100%/, "the above bucket's signed delta, computed by the real gutCheck()");
  assert.match(cards, /Public records: \$90–\$110\/SF · 5 comps · newest 2026-01-15/,
    "the corpus line reads corpusStats' real field names (count, q1_ppsf, q3_ppsf, newest_deal_date)");
  assert.match(cards, /Model market figures: \$85–\$115\/SF · 2026-07-01/,
    "the snapshot line reads snapshot.ppsf.low\\/high and generatedAt");
  assert.match(cards, /Cap rate: your median 6\.5% vs market 6–7%/, "the cap line's median/low/high");
  assert.match(cards, /\(records median 6\.5%\)/, "the cap line's corpus_median");

  const note = doc.getElementById("gutNote").textContent;
  assert.match(note, /untrended/i, "the untrended caveat must render");

  const tbody = doc.getElementById("tbody").innerHTML;
  assert.match(tbody, /class="gcOut" title="100% above the market band"/,
    "the outlier row is flagged with the real outliers[id].dir/pct gutCheck computed");
});

// ---- The reading strip (Vault Direction U, 2026-08-10) --------------------
// Three headline figures replacing three bordered panels above the table. The
// risk it carries is quoting a number that disagrees with the panel behind it,
// so these pin it against the SAME footer the table seals with, and against
// the real gut-check verdict rather than a restatement of it.
test("the reading strip quotes the table's own median and opens the panel behind each cell", async () => {
  const a1 = comp({ id: "c1", address: "100 Main St", market: "Boise, ID", property_type: "Industrial",
    transaction: "sale", price_per_sqft: 98, deal_date: "2025-01-05" });
  const a2 = comp({ id: "c2", address: "200 Second St", market: "Boise, ID", property_type: "Industrial",
    transaction: "sale", price_per_sqft: 102, deal_date: "2026-02-10" });
  const buckets = [{ market: "Boise, ID", type: "Industrial",
    corpus: { count: 5, q1_ppsf: 90, q3_ppsf: 110, newest_deal_date: "2026-01-15" },
    snapshot: { ppsf: { low: 85, high: 115 }, generatedAt: "2026-07-01" } }];

  const { doc } = await runPage([a1, a2], () => Promise.resolve(jsonResponse(200, { buckets })));
  const strip = doc.getElementById("readStrip");
  assert.equal(strip.className, "strip", "the strip unhides once there are rows");

  // $100 is the median of 98 and 102, and it is the figure the table's own
  // closing row states. One computation feeds both; a second would drift.
  assert.match(strip.innerHTML, /\$100/, "the strip states the median of the current view");
  assert.match(doc.getElementById("tblFoot").innerHTML, /\$100/,
    "and the closing row states the same one");

  // Two years of priced sales, so the chart has something to draw and its cell
  // becomes a control. The gut check found a bucket, so does its cell.
  assert.match(strip.innerHTML, /data-open="chartBox"/, "the median cell opens the year chart");
  assert.match(strip.innerHTML, /data-open="gutBox"/, "the verdict cell opens the gut check");
  assert.match(strip.innerHTML, /In line/, "one bucket in the band reads as a verdict, not a count");
  assert.match(strip.innerHTML, /class="sfig ok"/, "all-in-line is the one calm state that earns green");

  // No repeat properties in this book, so that cell has no panel behind it and
  // must NOT render as a button. An affordance over a hidden panel is a
  // control that does nothing.
  assert.doesNotMatch(strip.innerHTML, /data-open="repBox"/,
    "a cell with nothing behind it must not offer to open it");
  assert.equal(doc.getElementById("repBox").className, "dbox hide");
});

test("the reading strip hides itself rather than showing dashes over an empty table", async () => {
  const { doc } = await runPage([], () => Promise.resolve(jsonResponse(200, { buckets: [] })));
  assert.equal(doc.getElementById("readStrip").className, "strip hide");
  assert.equal(doc.getElementById("readStrip").innerHTML, "");
});

test("the gut check degrades to a one-line note when the benchmarks fetch fails, and the comps table still renders", async () => {
  const c1 = comp({ id: "c1", address: "100 Main St", market: "Boise, ID", property_type: "Industrial" });
  const { doc } = await runPage([c1], () => Promise.reject(new Error("network down")));

  assert.equal(doc.getElementById("gutBox").className, "dbox",
    "the panel unhides to show the failure note rather than staying blank");
  assert.equal(doc.getElementById("gutCards").innerHTML, "", "no cards render on a failed fetch");
  assert.match(doc.getElementById("gutNote").textContent, /unavailable/i);

  // The rest of the page is unaffected by the benchmarks failure: the comps
  // table renders from `comps` alone, which loadBenchmarks never touches.
  assert.match(doc.getElementById("tbody").innerHTML, /100 Main St/);
});

// ---------------------------------------------------------------------------
// The BOV tracker (v4 slice 2)
// ---------------------------------------------------------------------------

test("the BOV tracker section is present and first-run hides it", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.ok(html.includes('id="bovSec"'), "the tracker section is missing");
  // First run keys on comps AND uploads (the standing rule); the tracker
  // hides with everything else so the start page stays a two-step page.
  const js = pageScript(html);
  assert.match(js, /\$\("bovSec"\)\.className=first\?"hide":""/,
    "applyFirstRun does not hide the tracker");
});

test("the tracker's empty state is a sentence, not an empty table", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  // The table wrapper starts hidden and #noBovs exists: with zero rows the
  // section is prose plus the form, never a header row over nothing.
  assert.ok(html.includes('class="tw hide" id="bovTableWrap"'));
  assert.ok(html.includes('id="noBovs"'));
});

test("the emitted script still parses with the tracker in it", () => {
  assert.doesNotThrow(() => new Function(pageScript(renderVaultHTML(boot([]), CHROME))));
});

// ---------------------------------------------------------------------------
// The CSV column mapper (task 8)
// ---------------------------------------------------------------------------

test("the mapping panel is present and hidden on first paint", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.match(html, /id="mapSec"/);
  assert.match(html, /<div id="mapSec" class="mappanel hide">/,
    "it must not flash before a file is chosen");
});

test("the mapping panel names the ignored columns", () => {
  // Silent dropping is half of what this feature fixes, so the page has to
  // say which columns are being left out.
  assert.match(renderVaultHTML(boot([comp({})]), CHROME), /id="mapIgnored"/);
});

test("the emitted script still parses with the mapper in it", () => {
  // The whole page is one template literal, so a stray `${` or a
  // single-backslash escape yields a blank workspace rather than a loud
  // failure. This compiles what the browser would actually receive.
  assert.doesNotThrow(() =>
    new Function(pageScript(renderVaultHTML(boot([comp({})]), CHROME))));
});

// ---------------------------------------------------------------------------
// The mapper actually behaves (review follow-up)
//
// The three tests above only prove the markup exists and the emitted script
// COMPILES — the same gap the gut check had. Every finding of the final
// review lived in the mapper's ~155 lines of untested browser code, so these
// drive the REAL emitted script through the REAL file-picking path, with
// /api/vault/inspect answered by the REAL broker-vault.js, and assert on what
// a broker would actually read on screen.
// ---------------------------------------------------------------------------

// A broker's own export: one column we recognise, one that normalizes to
// nothing at all ("$" — the price), and one carrying markup.
const DIRTY_CSV =
  'Property Address,Deal,Closed,$,Broker <img src=x onerror=alert(1)>\n' +
  '1 Main St,Sale,2026-01-05,2450000,Jane\n';
// Everything required resolves through the alias table, so Import is live.
const MAPPABLE_CSV =
  "Property Address,Type,Deal Type,Sale Date,Sq Ft,Sale Price\n" +
  "1 Main St,Industrial,Sale,2026-01-05,10000,2450000\n";
// Already in our own column names: the screen must not appear at all.
const CLEAN_CSV =
  "address,property_type,transaction,deal_date\n" +
  "1 Main St,Industrial,sale,2026-01-05\n";

test("the ignored line names the broker's own headers, never our synthetic keys", async () => {
  // Live, this read "Will be ignored: deal, closed, column_4,
  // broker_img_srcx_onerroralert1". column_N is our internal name for a header
  // that normalizes away (here the "$" price column) and exists nowhere in the
  // broker's world; naming it is worse than naming nothing.
  const { doc } = await runPage([comp({})]);
  await chooseFile(doc, DIRTY_CSV);

  const ignored = doc.getElementById("mapIgnored").textContent;
  assert.match(ignored, /^Will be ignored: /);
  for (const raw of ["Deal", "Closed", "$", "Broker <img src=x onerror=alert(1)>"]) {
    assert.ok(ignored.indexOf(raw) >= 0, "the ignored line does not name " + raw);
  }
  assert.ok(ignored.indexOf("column_") < 0,
    "a synthetic column_N key reached the broker: " + ignored);
});

test("the target dropdown speaks English, not column names", async () => {
  const { doc } = await runPage([comp({})]);
  await chooseFile(doc, DIRTY_CSV);

  const body = doc.getElementById("mapBody").innerHTML;
  // The VALUE stays the served target — the list itself must keep coming from
  // the server — while the text a broker reads is a label.
  assert.match(body, /<option value="deal_date"[^>]*>Deal date<\/option>/);
  assert.match(body, /<option value="size_sqft"[^>]*>Size \(SF\)<\/option>/);
  assert.match(body, /<option value="beds_baths"[^>]*>Beds \/ baths<\/option>/);
  assert.ok(!/>deal_date</.test(body) && !/>size_sqft</.test(body),
    "raw snake_case identifiers are still being shown to the broker");
});

test("a missing required field is named in the broker's own vocabulary", async () => {
  const { doc } = await runPage([comp({})]);
  await chooseFile(doc, DIRTY_CSV);

  assert.equal(doc.getElementById("mapGo").disabled, true,
    "Import must stay disabled while a required field is unclaimed");
  const msg = doc.getElementById("mapMsg").textContent;
  assert.match(msg, /Still needed: .*Sale or lease/,
    "the missing field is named in the broker's vocabulary, not as `transaction`");
  assert.ok(msg.indexOf("transaction") < 0 && msg.indexOf("deal_date") < 0,
    "raw field names leaked into the message: " + msg);
});

test("no add-a-column advice while the broker still has an unmapped column", async () => {
  // The regression this pins. DIRTY_CSV has Deal ("Sale") and Closed (a date)
  // sitting unmapped in the table above, either of which satisfies a required
  // field in one click — our alias table simply does not recognise their
  // names. Keying the advice on "did WE guess a column" rather than "does the
  // BROKER have one left" told them to go edit a spreadsheet that was fine,
  // on exactly the common export this advice was written for.
  const { doc } = await runPage([comp({})]);
  await chooseFile(doc, DIRTY_CSV);

  const msg = doc.getElementById("mapMsg").textContent;
  assert.match(msg, /Still needed:/, "the missing fields must still be named");
  assert.ok(msg.indexOf("no column saying") < 0,
    "told the broker to add a deal-type column while an unmapped one was on screen: " + msg);
  assert.ok(msg.indexOf("Nothing in your file looks like") < 0,
    "told the broker to add a column while an unmapped one was on screen: " + msg);
});

test("a genuinely unclaimable required field says what to do about it", async () => {
  // The CoStar sale-comps case: no deal-type column, because every row is a
  // sale. Here every column the file HAS is mapped and `transaction` is still
  // missing, so no dropdown can rescue it and Cancel was the only exit.
  const { doc } = await runPage([comp({})]);
  await chooseFile(doc, "Property Address,Type,Sale Date\n1 Main St,Industrial,2026-01-05\n");

  assert.equal(doc.getElementById("mapIgnored").textContent, "Every column is mapped.",
    "this test only means something if the file has no spare column left");
  assert.equal(doc.getElementById("mapGo").disabled, true);
  const msg = doc.getElementById("mapMsg").textContent;
  assert.match(msg, /no column saying whether each deal was a sale or a lease/,
    "the dead end is not explained");
  assert.match(msg, /values Sale or Lease, then upload again/,
    "the explanation does not say what to do");
});

test("two columns claiming one field disables Import and names the clash", async () => {
  // refreshMapper used to mirror only ONE of validateMapping's three refusals,
  // so Import could be offered for a mapping the server would refuse — and
  // openMapper can produce that state on its own, since `suggested` and
  // `remembered` are each duplicate-free but their union is not.
  const { doc, calls } = await runPage([comp({})]);
  await chooseFile(doc, MAPPABLE_CSV);
  assert.equal(doc.getElementById("mapGo").disabled, false,
    "a complete mapping should start with Import enabled");

  selectFor(doc, "sq_ft").pick("price");

  assert.equal(doc.getElementById("mapGo").disabled, true,
    "Import stayed enabled for a mapping the server will refuse");
  const msg = doc.getElementById("mapMsg").textContent;
  assert.match(msg, /Sq Ft and Sale Price are both mapped to Price/);
  assert.match(msg, /Pick one/);
  assert.equal(calls.filter((c) => c.url.indexOf("/api/vault/upload") === 0).length, 0);
});

test("an ambiguous field is left blank and the screen says we left it", async () => {
  // suggestMapping deliberately breaks no ties. `ambiguous` was computed,
  // serialized and never read, so the blank looked like an oversight.
  const { doc } = await runPage([comp({})]);
  await chooseFile(doc, "Property Address,Type,Deal Type,Sale Date,Date\n1 Main St,Industrial,Sale,2026-01-05,2026-01-05\n");

  const amb = doc.getElementById("mapAmbig");
  assert.ok(!amb.classList.contains("hide"), "the ambiguity note stayed hidden");
  assert.match(amb.textContent, /More than one of your columns could be the deal date/);
  assert.equal(selectFor(doc, "sale_date").value, "", "a tie must not be broken for them");
  assert.equal(selectFor(doc, "date").value, "");
  // And no "add a column" advice here: they HAVE the column, they just have two.
  assert.ok(doc.getElementById("mapMsg").textContent.indexOf("Nothing in your file") < 0);
});

test("a file already in our own column names skips the screen and sends no mapping", async () => {
  const { doc, calls } = await runPage([comp({})]);
  await chooseFile(doc, CLEAN_CSV);

  assert.equal(doc.getElementById("mapBody").innerHTML, "",
    "the mapping screen was rendered for a clean template");
  const up = calls.filter((c) => c.url.indexOf("/api/vault/upload") === 0);
  assert.equal(up.length, 1, "the clean file did not import straight through");
  assert.ok(!("mapping" in up[0].body),
    "a `mapping` key reached the upload route; the no-mapping path must stay byte-identical");
});

test("Cancel restores the page it interrupted, and uploads nothing", async () => {
  // The first broker through this door is by definition a first-run broker,
  // where applyFirstRun has deliberately hidden #addSec (step 1 owns the
  // uploader). Cancel used to un-hide it unconditionally and leave #firstRun
  // hidden, i.e. both cards on screen at once until a reload.
  const { doc, calls } = await runPage([]);
  assert.equal(doc.getElementById("firstRun").className, "", "expected a first-run page");
  await chooseFile(doc, DIRTY_CSV);
  assert.ok(doc.getElementById("firstRun").classList.contains("hide"),
    "Start here must not sit above the panel that replaced it");

  doc.getElementById("mapCancel").fire("click");

  assert.ok(doc.getElementById("mapSec").classList.contains("hide"));
  assert.equal(doc.getElementById("firstRun").className, "", "Start here was not restored");
  assert.ok(doc.getElementById("addSec").classList.contains("hide"),
    "the uploader was un-hidden on a first run, so it now appears twice");
  assert.equal(calls.filter((c) => c.url.indexOf("/api/vault/upload") === 0).length, 0);
});

test("a failed import leaves the panel open with every selection intact", async () => {
  // parseUpload answers ok:false only when NOT ONE row survived — the
  // mismapped-column case exactly. Closing the panel first cost the broker the
  // file and all their dropdowns at the one moment they needed them.
  const { doc } = await runPage([], null, {
    upload: () => Promise.resolve(jsonResponse(400, {
      error: "Nothing in that file could be imported.",
      errors: ["Row 2: price is not a number."],
    })),
  });
  await chooseFile(doc, MAPPABLE_CSV);
  assert.equal(doc.getElementById("mapGo").disabled, false);

  doc.getElementById("mapGo").fire("click");
  await tick();

  assert.ok(!doc.getElementById("mapSec").classList.contains("hide"),
    "the mapping panel closed on a failed import");
  assert.ok(doc.getElementById("firstRun").classList.contains("hide"),
    "closeMapper ran anyway: the page behind the panel was restored");
  assert.equal(selectFor(doc, "sq_ft").value, "size_sqft", "the mapping was thrown away");
  assert.equal(selectFor(doc, "sale_price").value, "price");
  assert.equal(doc.getElementById("mapGo").disabled, false, "Import was left dead");
  assert.equal(doc.getElementById("mapGo").textContent, "Import");
  const msg = doc.getElementById("mapMsg");
  assert.ok(!msg.classList.contains("hide"), "the failure was never shown");
  assert.match(msg.innerHTML, /Nothing in that file could be imported/);
  assert.match(msg.innerHTML, /Row 2: price is not a number/,
    "the line-numbered errors must survive into the panel");
});

test("a successful import from the panel closes it and reports the result", async () => {
  const { doc, calls } = await runPage([], null, {
    upload: () => Promise.resolve(jsonResponse(200, { ok: true, imported: 1, skipped: 0 })),
    reloadComps: [comp({})],
  });
  await chooseFile(doc, MAPPABLE_CSV);
  doc.getElementById("mapGo").fire("click");
  await tick();

  assert.ok(doc.getElementById("mapSec").classList.contains("hide"),
    "the panel must close once the rows are actually stored");
  const up = calls.filter((c) => c.url.indexOf("/api/vault/upload") === 0);
  assert.equal(up.length, 1);
  assert.equal(up[0].body.mapping.sale_price, "price",
    "the confirmed mapping did not reach the server");
  assert.match(doc.getElementById("res").innerHTML, /Imported 1 comp/);
});

test("a mapper import's skips are SHOWN: the uploader panel opens for the summary", async () => {
  // #res lives inside #addSec, which ships closed, and the mapper path never
  // went through the setAddOpen(true) at the top of doImport — so "2 rows
  // skipped" plus its line-numbered reasons was written into a hidden panel
  // and the broker never learned two deals were dropped. The content
  // assertions above passed the whole time; this one pins the visibility.
  const { doc } = await runPage([], null, {
    upload: () => Promise.resolve(jsonResponse(200, {
      ok: true, imported: 9, skipped: 2, duplicates: 1,
      errors: ["Line 5: price: \"1.2M\" is not a plain number"],
    })),
  });
  await chooseFile(doc, MAPPABLE_CSV);
  doc.getElementById("mapGo").fire("click");
  await tick();

  assert.ok(!doc.getElementById("addSec").className.split(" ").includes("hide"),
    "the summary was written into a closed panel: className=" + doc.getElementById("addSec").className);
  // The stub document's attributes are no-ops, so aria-expanded can't be
  // read here — the toggle's label rides on the same setAddOpen call and
  // pins the same invariant: the deck action describes the open state.
  assert.equal(doc.getElementById("addToggle").textContent, "Close",
    "the deck action must describe the state the panel is in");
  const html = doc.getElementById("res").innerHTML;
  assert.match(html, /2 rows skipped/);
  assert.match(html, /Line 5/);
});

test("skipped # lines are reported, not dropped silently", async () => {
  // The template ships its rules as # lines, so this clause fires on the
  // ordinary path. It is here for the other one: a broker whose own export has
  // a row starting with # must see that it did not import.
  const { doc } = await runPage([], null, {
    upload: () => Promise.resolve(jsonResponse(200,
      { ok: true, imported: 3, skipped: 0, commented: 10 })),
  });
  await chooseFile(doc, MAPPABLE_CSV);
  doc.getElementById("mapGo").fire("click");
  await tick();

  const html = doc.getElementById("res").innerHTML;
  assert.match(html, /Imported 3 comps/);
  assert.match(html, /10 note lines ignored/);
  assert.ok(html.indexOf("msg ok") >= 0, "ignoring our own notes is not a failure");
});

// ---------------------------------------------------------------------------
// Row edit / delete (task 7)
// ---------------------------------------------------------------------------

test("each comp row offers an edit and a delete", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.ok(html.includes("data-edit"), "rows need an edit control");
  assert.ok(html.includes("data-del-comp"), "rows need a delete control");
});

test("deleting a comp is confirmed before it is sent", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.match(html, /Delete this comp/,
    "a hard delete with no undo must be confirmed by name");
});

test("row-action messages do not write into the closed uploader panel", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.ok(html.includes('id="compMsg"'),
    "#res lives inside #addSec, which ships closed, so a message written there is invisible");
});

test("the page says an edit unpublishes a published comp", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.match(html, /unpublish|withdrawn from the public/i,
    "a broker must not discover the retraction later");
});

test("the comps table footer still spans every column", () => {
  // The old version of this test asserted `heads >= 9` (true regardless of
  // the actions column) and located "the footer's colspan" with
  // /colspan="(\d+)"/ searched from the first "tblFoot" match onward — which
  // finds editRow's `colspan="10"` (an unrelated template literal that
  // happens to appear first in source order after that anchor), never the
  // footer's own `colspan="7"`. The two numbers were never actually compared.
  // This version reads the #tbl thead's real column count and the footer's
  // own template literal (anchored on text unique to it), so adding an
  // eleventh column without widening the footer fails here.
  const html = renderVaultHTML(boot([comp({})]), CHROME);

  const tblStart = html.indexOf('<table id="tbl">');
  assert.ok(tblStart >= 0, "the comps table should still exist");
  const theadStart = html.indexOf("<thead", tblStart);
  const theadEnd = html.indexOf("</thead>", theadStart);
  // (?=[ >]) so "<thead" itself (which starts with the literal text "<th")
  // is not counted as a column.
  const headCount = (html.slice(theadStart, theadEnd).match(/<th(?=[ >])/g) || []).length;

  // Anchored on the footer's OWN opening cell, not on "tblFoot" (which also
  // names the DOM id used elsewhere, including inside editRow's colspan).
  const footStart = html.indexOf('<td class="lab" colspan="');
  assert.ok(footStart >= 0, "the footer template should still declare its label cell");
  const footEnd = html.indexOf('</tr>"', footStart);
  assert.ok(footEnd >= 0, "the footer template should still close its row");
  const footLiteral = html.slice(footStart, footEnd);

  const colspanMatch = /colspan="(\d+)"/.exec(footLiteral);
  assert.ok(colspanMatch, "the footer's first cell should declare a colspan");
  const spanned = Number(colspanMatch[1]);
  // Every OTHER <td> in the footer row covers exactly one column. The
  // lookahead excludes the label cell matched above (the only one carrying
  // its own colspan), so this count needs no further adjustment.
  const otherTds = (footLiteral.match(/<td(?![^>]*colspan)/g) || []).length;

  assert.strictEqual(spanned + otherTds, headCount,
    `footer covers ${spanned + otherTds} column(s) but the header declares ${headCount}`);
});

// Proof this test can fail (per the fix-wave instructions): temporarily add
// an 11th <th> to #tbl's thead in vault-page.js with the footer untouched —
// this test fails (`footer covers 10 column(s) but the header declares 11`)
// — then revert. Verified both runs; see the fix report for the exact
// output. Left here as a comment rather than a skipped test because a real
// 11-column header does not exist to add permanently.

test("the emitted script still parses with the row actions in it", () => {
  assert.doesNotThrow(() => new Function(pageScript(renderVaultHTML(boot([comp({})]), CHROME))));
});

// ---- Row edit / delete actually behave (beyond markup + parsing) ----------
// The tests above only prove the controls exist and the script compiles —
// the same gap the gut check and mapper reviews found. These drive the REAL
// emitted script through Edit -> change a field -> Save, and through Delete,
// against a stubbed /api/vault/comp, with a stubbed global confirm() since
// the stub DOM has no window.confirm of its own.

// The stub DOM in this file does not parse rendered HTML into live elements
// (see stubDocument above) — getElementById auto-vivifies a blank stub the
// first time an id is touched, whatever markup was written to innerHTML. So
// "pre-filled" is checked against the rendered markup string itself, which
// is exactly what a real browser would parse into the input's initial
// .value, rather than through a stub .value that the harness cannot derive
// from HTML.
test("Edit reveals a form pre-filled from the comp already on the page, and Cancel restores the row", async () => {
  const c1 = comp({ id: "c1", address: "100 Main St", notes: "corner lot" });
  const { doc } = await runPage([c1]);

  doc.getElementById("tbody").fire("click", { target: { closest: (sel) => sel === 'button[data-edit]' ? { getAttribute: () => "c1" } : null } });
  await tick();

  const editHtml = doc.getElementById("tbody").innerHTML;
  assert.match(editHtml, /id="edit_address" value="100 Main St"/,
    "the form must be pre-filled from the comp the page already holds");
  assert.match(editHtml, /id="edit_notes" value="corner lot"/);

  doc.getElementById("tbody").fire("click", { target: { closest: (sel) => sel === 'button[data-cancel-edit]' ? { getAttribute: () => "1" } : null } });
  await tick();
  assert.match(doc.getElementById("tbody").innerHTML, /100 Main St/,
    "cancelling must put the ordinary row back");
  assert.ok(!doc.getElementById("tbody").innerHTML.includes('id="edit_address"'),
    "the edit form must not still be on screen after Cancel");
});

test("Save sends only the changed field, and reports the unpublish warning", async () => {
  const c1 = comp({ id: "c1", address: "100 Main St", published: true });
  let sentBody = null;
  const { doc } = await runPage([c1], null, {
    comp: (init) => {
      sentBody = JSON.parse(init.body);
      return Promise.resolve(jsonResponse(200, { ok: true, comp: {}, unpublished: true }));
    },
  });

  doc.getElementById("tbody").fire("click", { target: { closest: (sel) => sel === 'button[data-edit]' ? { getAttribute: () => "c1" } : null } });
  await tick();

  // Simulate what a real browser's initial-value parse of the rendered
  // markup already gave every input, since the stub DOM cannot derive it:
  // every field starts equal to the comp's own value, then exactly one is
  // touched. That is what makes "only the changed field travels" a real
  // assertion here, not an artifact of the stub starting blank.
  const EDIT_FIELDS = ["address", "property_type", "transaction", "deal_date",
    "price", "size_sqft", "cap_rate", "tenancy", "year_built", "notes"];
  EDIT_FIELDS.forEach((f) => {
    doc.getElementById("edit_" + f).value = c1[f] == null ? "" : String(c1[f]);
  });
  doc.getElementById("edit_notes").value = "updated note";

  doc.getElementById("tbody").fire("click", { target: { closest: (sel) => sel === 'button[data-save-edit]' ? { getAttribute: () => "c1" } : null } });
  await tick();

  assert.deepEqual(sentBody, { notes: "updated note" },
    "only the field that actually changed should travel in the PATCH body");
  assert.match(doc.getElementById("compMsg").textContent, /withdrawn from the public/i,
    "a broker must be told a published comp was retracted by the edit");
});

test("a 400 from the server shows every listed problem, not just the first", async () => {
  const c1 = comp({ id: "c1", address: "100 Main St" });
  const { doc } = await runPage([c1], null, {
    comp: () => Promise.resolve(jsonResponse(400, { error: "price is not a number; deal_date is required" })),
  });

  doc.getElementById("tbody").fire("click", { target: { closest: (sel) => sel === 'button[data-edit]' ? { getAttribute: () => "c1" } : null } });
  await tick();
  doc.getElementById("edit_price").value = "abc";

  doc.getElementById("tbody").fire("click", { target: { closest: (sel) => sel === 'button[data-save-edit]' ? { getAttribute: () => "c1" } : null } });
  await tick();

  assert.match(doc.getElementById("compMsg").textContent, /price is not a number; deal_date is required/,
    "the whole 400 error must render, not a generic fallback");
  assert.ok(doc.getElementById("tbody").innerHTML.includes('id="edit_price"'),
    "a failed save must not close the editor and lose the broker's in-progress edit");
});

test("Delete confirms, then sends DELETE and reports an ordinary removal", async () => {
  const c1 = comp({ id: "c1", address: "100 Main St", published: false });
  const calls = [];
  const realConfirm = global.confirm;
  global.confirm = (msg) => { calls.push(msg); return true; };
  try {
    const { doc } = await runPage([c1], null, {
      comp: () => Promise.resolve(jsonResponse(200, { ok: true, unpublished: false })),
    });
    doc.getElementById("tbody").fire("click", { target: { closest: (sel) => sel === 'button[data-del-comp]' ? { getAttribute: () => "c1" } : null } });
    await tick();

    assert.match(calls[0], /Delete this comp/, "the confirm text names the destructive action");
    assert.equal(doc.getElementById("compMsg").textContent, "Deleted.");
  } finally {
    global.confirm = realConfirm;
  }
});

// ---------------------------------------------------------------------------
// Task 8: add one comp by hand, and take the whole book with you
// ---------------------------------------------------------------------------

test("the page offers an add-one-comp form with the four required fields", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  for (const f of ["address", "property_type", "transaction", "deal_date"]) {
    assert.ok(html.includes("addComp_" + f), "the add form needs " + f);
  }
});

test("there is still exactly one file input on the page", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  const inputs = (html.match(/type=["']?file/g) || []).length;
  assert.equal(inputs, 1,
    "two inputs would mean two values and two change handlers");
});

test("the export button says it exports everything", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.ok(/Export all comps/.test(html),
    "the label must remove any ambiguity about the dashboard filter");
});

test("the export is a plain link, so it works without the page's script", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.ok(/href="\/api\/vault\/export\.csv"/.test(html),
    "a plain href lets the cookie ride along and the browser handle the download");
});

test("the emitted script still parses with the add form in it", () => {
  assert.doesNotThrow(() => new Function(pageScript(renderVaultHTML(boot([comp({})]), CHROME))));
});

test("the add-by-hand form's TYPE_FIELDS map has not drifted from broker-vault.js", () => {
  // TYPE_FIELDS is a fourth copy of the per-type field map (TYPE_COMP_FIELDS
  // in server.js is the source of truth; VAULT.PROPERTY_TYPES /
  // OPTIONAL_SPEC_COLUMNS are its vault-side mirror). Nothing fails the build
  // if this one falls behind: the next field added through the
  // add-comp-field skill would import, store, export and display correctly,
  // and simply never appear on this form. Extracted from the emitted script
  // text (a static object literal) rather than executed, since TYPE_FIELDS
  // lives inside the page's IIFE and is not exposed on window.
  const js = pageScript(renderVaultHTML(boot([comp({})]), CHROME));
  const m = /var TYPE_FIELDS=(\{[\s\S]*?\});/.exec(js);
  assert.ok(m, "could not find TYPE_FIELDS in the emitted script");
  const TYPE_FIELDS = new Function("return (" + m[1] + ");")();

  assert.deepStrictEqual(
    Object.keys(TYPE_FIELDS).sort(),
    [...VAULT.PROPERTY_TYPES].sort(),
    "TYPE_FIELDS' property types have drifted from VAULT.PROPERTY_TYPES");

  const union = [...new Set(Object.values(TYPE_FIELDS).flat())].sort();
  assert.deepStrictEqual(
    union,
    [...VAULT.OPTIONAL_SPEC_COLUMNS].sort(),
    "TYPE_FIELDS' fields have drifted from VAULT.OPTIONAL_SPEC_COLUMNS");
});

// ---- The add form actually behaves -----------------------------------
// Markup-and-parses tests, above, would not have caught a submit handler
// that reads the wrong field ids or never calls fetch at all — exactly the
// gap the row-edit and mapper reviews found elsewhere in this file. These
// drive the REAL emitted script through Add comp against a stubbed
// POST /api/vault/comp.

test("Add comp posts the base fields typed into the form, then clears them and reports success", async () => {
  let sentBody = null;
  const { doc } = await runPage([], null, {
    comp: (init) => {
      sentBody = JSON.parse(init.body);
      return Promise.resolve(jsonResponse(201, { ok: true, comp: {} }));
    },
  });

  doc.getElementById("addComp_address").value = "500 Elm St";
  doc.getElementById("addComp_property_type").value = "Industrial";
  doc.getElementById("addComp_transaction").value = "sale";
  doc.getElementById("addComp_deal_date").value = "2026-03-14";
  doc.getElementById("addComp_price").value = "1000000";
  doc.getElementById("addComp_size_sqft").value = "10000";

  doc.getElementById("addCompBtn").fire("click", {});
  await tick();

  assert.equal(sentBody.address, "500 Elm St");
  assert.equal(sentBody.property_type, "Industrial");
  assert.equal(sentBody.transaction, "sale");
  assert.equal(sentBody.deal_date, "2026-03-14");
  assert.equal(sentBody.price, "1000000");
  assert.equal(sentBody.size_sqft, "10000");
  // An untouched optional field must never travel as an empty string —
  // normalizeRow would then have to tell the difference between "left
  // blank" and "explicitly cleared", which the server side does not do.
  assert.ok(!("notes" in sentBody), "an empty field must be omitted, not sent as \"\"");

  assert.equal(doc.getElementById("addComp_address").value, "",
    "a successful add must clear the form for the next comp");
  // Its own message, not compMsg: see the placement/routing tests below for
  // why the two must not share a channel.
  assert.equal(doc.getElementById("addCompMsg").textContent, "Added.");
});

test("a 400 from adding a comp shows every listed problem, not just the first, and keeps the form filled", async () => {
  const { doc } = await runPage([], null, {
    comp: () => Promise.resolve(jsonResponse(400, { error: "price is not a number; deal_date is required" })),
  });

  doc.getElementById("addComp_address").value = "500 Elm St";
  doc.getElementById("addCompBtn").fire("click", {});
  await tick();

  assert.match(doc.getElementById("addCompMsg").textContent, /price is not a number; deal_date is required/,
    "the whole 400 error must render, not a generic fallback");
  assert.equal(doc.getElementById("addComp_address").value, "500 Elm St",
    "a failed add must not clear the broker's in-progress entry");
});

// ---- Fix round 1: the add-comp result must land where the broker can see
// it, not in #compMsg -------------------------------------------------------
//
// #compMsg sits at the top of #compsSec. The add form lives inside #addSec,
// well above it in document order, with #mapSec and #rollupSec (the market
// rollup cards, for any broker who already has a book) rendering in
// between. Reusing #compMsg for this form's result would leave it below the
// fold for exactly the broker "add one by hand" is for: no scroll, no focus
// move, nothing on screen to say the click did anything.

test("the add form's message element lives INSIDE the add panel, not in #compsSec", () => {
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  const panel = /<details class="dbox" id="addOneSec">[\s\S]*?<\/details>/.exec(html);
  assert.ok(panel, "could not find the add-one-comp panel");
  assert.match(panel[0], /id="addCompMsg"/,
    "the add form's own message element must be inside the panel, beside its button");
  assert.doesNotMatch(panel[0], /id="compMsg"/,
    "the row-actions message element belongs to #compsSec, not this panel");
});

test("adding a comp writes to #addCompMsg, and leaves #compMsg untouched", async () => {
  const { doc } = await runPage([], null, {
    comp: () => Promise.resolve(jsonResponse(400, { error: "deal_date is required" })),
  });

  doc.getElementById("addComp_address").value = "500 Elm St";
  doc.getElementById("addCompBtn").fire("click", {});
  await tick();

  assert.match(doc.getElementById("addCompMsg").textContent, /deal_date is required/,
    "the add form's failure must be visible right where the broker clicked");
  // The stub DOM does not parse rendered HTML into live elements (see
  // stubDocument above), so #compMsg's initial "msg hide" from the markup
  // is not reproduced here; what this harness CAN prove is that addComp()
  // never touches it, i.e. it is left exactly as the page's own JS left it
  // (never written), not reset to some failure state.
  assert.equal(doc.getElementById("compMsg").textContent, "",
    "the row-actions message must not be borrowed for the add form's result");
});

test("choosing a property type reveals that type's own fields, and switching types swaps them", async () => {
  const { doc } = await runPage([]);

  doc.getElementById("addComp_property_type").value = "Industrial";
  doc.getElementById("addComp_property_type").fire("change", {});
  await tick();
  assert.ok(doc.getElementById("addTypeFields").innerHTML.includes("addComp_clear_height"),
    "Industrial's own field must appear");
  assert.ok(!doc.getElementById("addTypeFields").innerHTML.includes("addComp_units"),
    "a Multifamily field must not appear for an Industrial comp");

  doc.getElementById("addComp_property_type").value = "Multifamily";
  doc.getElementById("addComp_property_type").fire("change", {});
  await tick();
  assert.ok(doc.getElementById("addTypeFields").innerHTML.includes("addComp_units"),
    "Multifamily's own field must appear once that type is chosen");
  assert.ok(!doc.getElementById("addTypeFields").innerHTML.includes("addComp_clear_height"),
    "the previous type's field must not linger after switching");
});

// ---------------------------------------------------------------------------
// The credit identity (2026-08-12)
//
// A published comp carries a public credit — "Verified · via <firm>" on every
// report it reaches. Until this shipped, a broker who never stated one had
// their comps credited to whatever they typed at signup, and could not have
// known it happened. These pin the two things that would silently regress:
// the page must SHOW the credit before a publish, and the refusal must open
// the form rather than send the broker looking for a screen that did not
// exist.
// ---------------------------------------------------------------------------

test("an unstated identity says so, and offers to fix it", async () => {
  const { doc } = await runPage([comp({})]);
  const line = doc.getElementById("creditLine").innerHTML;
  assert.match(line, /need a name to credit/i);
  assert.match(line, /id="idEdit"/, "there must be a control to state one");
});

test("the identity form ships closed in the markup", () => {
  // Asserted on the HTML, not through the stub DOM: the stub fabricates
  // elements on demand, so an initial class set in the markup is invisible
  // to it. Same reason the empty-vault test reads the html string.
  const html = renderVaultHTML(boot([comp({})]), CHROME);
  assert.match(html, /<div id="idForm" class="hide">/,
    "the form must not greet every broker who opens their book");
});

test("a stated identity names the credit before anything is published", async () => {
  const { doc } = await runPage([comp({})], null, {}, {
    display_name: "Chuck Hawkins", company: "Hawkins Ridge CRE", creditedTo: "Hawkins Ridge CRE",
  });
  const line = doc.getElementById("creditLine").innerHTML;
  assert.match(line, /Hawkins Ridge CRE/);
  assert.match(line, /credited to/i);
});

test("the page never recomputes the credit — it prints the server's answer", async () => {
  // creditName() prefers company over display_name. If the page reimplemented
  // that rule it could drift from the publish route and promise a name the
  // write would not produce, so it must print creditedTo verbatim even when
  // that disagrees with the two fields beside it.
  const { doc } = await runPage([comp({})], null, {}, {
    display_name: "Chuck Hawkins", company: "Hawkins Ridge CRE", creditedTo: "Something Else Entirely",
  });
  assert.match(doc.getElementById("creditLine").innerHTML, /Something Else Entirely/);
});

test("a publish refused for a missing credit opens the form", async () => {
  const realConfirm = global.confirm;
  global.confirm = () => true;
  try {
  const { doc } = await runPage([comp({})], null, {
    publish: () => Promise.resolve(jsonResponse(400, {
      error: "Add your firm or display name before publishing — published comps are credited to it.",
      code: "needs_credit_name",
    })),
  });
  doc.getElementById("tbody").fire("click", {
    target: { closest: (sel) => sel === "button[data-pub]"
      ? { getAttribute: () => "c1", classList: { contains: () => false }, disabled: false, textContent: "Publish" }
      : null },
  });
  await tick();
  assert.equal(doc.getElementById("idForm").className, "",
    "the one refusal a broker can fix in place must open the field that fixes it");
  } finally { global.confirm = realConfirm; }
});

test("an empty vault asks for no benchmarks, and does not latch the flag", async () => {
  // The first-run bug this guards: loadBenchmarks is asked PER BUCKET, so an
  // empty vault has nothing to ask about and returns early — but the caller
  // used to set benchLoaded=true anyway, so the gut check stayed empty for
  // the rest of the session and only appeared if the broker happened to
  // reload. Found on a clean-slate run against the real corpus (2026-08-12),
  // and it is why the panel looked like it was failing in thin markets when
  // the benchmarks were fine.
  //
  // Only the first half is asserted here: the stub DOM cannot walk an
  // empty-boot -> import -> populated-reload sequence (the reload is answered
  // from the boot payload), so the re-fetch itself is verified in a real
  // browser rather than pretended at here. What this pins is the guard's
  // shape — no call while empty, and the condition that keeps it retryable.
  const { calls } = await runPage([]);
  assert.equal(calls.filter((c) => c.url.indexOf("/api/vault/benchmarks") === 0).length, 0,
    "an empty vault has no bucket to ask about");

  const js = pageScript(renderVaultHTML(boot([]), CHROME));
  assert.match(js, /if\(!benchLoaded\s*&&\s*comps\.length\)/,
    "the benchmarks flag must stay false until there is a bucket, or the first import never loads them");
});

test("a re-uploaded book says what was stored, not what was read", async () => {
  // The server counts what the database actually took (the insert asks for
  // ids back rather than return=minimal). The page must then say so: this
  // used to read "Imported 16 comps" after storing none, which is the
  // reassuring direction to be wrong in — a broker told their deals landed
  // does not go looking for them.
  const { doc } = await runPage([], null, {
    upload: () => Promise.resolve(jsonResponse(200,
      { ok: true, imported: 0, already: 16, skipped: 0 })),
  });
  await chooseFile(doc, CLEAN_CSV);
  const html = doc.getElementById("res").innerHTML;
  assert.match(html, /Imported 0 comps/);
  assert.match(html, /16 were already in your vault/);
});

test("a partly-new book counts both halves separately", async () => {
  const { doc } = await runPage([], null, {
    upload: () => Promise.resolve(jsonResponse(200,
      { ok: true, imported: 4, already: 1, skipped: 0, duplicates: 2 })),
  });
  await chooseFile(doc, CLEAN_CSV);
  const html = doc.getElementById("res").innerHTML;
  assert.match(html, /Imported 4 comps/);
  assert.match(html, /1 was already in your vault/, "singular reads correctly");
  // `already` (the vault had it) and `duplicates` (the file repeated it) are
  // different facts and must not be collapsed into one number.
  assert.match(html, /2 duplicates in the file/);
});

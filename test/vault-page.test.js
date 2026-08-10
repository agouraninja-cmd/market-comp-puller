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
function boot(comps) {
  return { s: 200, j: {
    comps, uploads: [],
    counts: { returned: comps.length, published: comps.filter((c) => c.published).length },
    markets: [...new Set(comps.map((c) => c.market))],
    types: [...new Set(comps.map((c) => c.property_type))],
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
  assert.match(html, /id="chartBox"[^>]*class="panel chart hide"|class="panel chart hide" id="chartBox"/);
  assert.match(html, /id="repBox"[^>]*class="panel hide"|class="panel hide" id="repBox"/);
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
  assert.match(html, /id="gutBox"[^>]*class="panel hide"|class="panel hide" id="gutBox"/);
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
async function runPage(comps, benchResult, opts) {
  opts = opts || {};
  const calls = [];
  const bootPayload = boot(comps);
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

  assert.equal(doc.getElementById("gutBox").className, "panel",
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

test("the gut check degrades to a one-line note when the benchmarks fetch fails, and the comps table still renders", async () => {
  const c1 = comp({ id: "c1", address: "100 Main St", market: "Boise, ID", property_type: "Industrial" });
  const { doc } = await runPage([c1], () => Promise.reject(new Error("network down")));

  assert.equal(doc.getElementById("gutBox").className, "panel",
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
  assert.match(html, /<section id="mapSec" class="hide">/,
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

test("a required field with no column to claim it says what to do about it", async () => {
  // The CoStar sale-comps case: no deal-type column, because every row is a
  // sale. Import can never be enabled, and before this the whole explanation
  // was "Still needed: transaction".
  const { doc } = await runPage([comp({})]);
  await chooseFile(doc, DIRTY_CSV);

  assert.equal(doc.getElementById("mapGo").disabled, true,
    "Import must stay disabled while a required field is unclaimed");
  const msg = doc.getElementById("mapMsg").textContent;
  assert.match(msg, /Still needed: .*Sale or lease/,
    "the missing field is named in the broker's vocabulary, not as `transaction`");
  assert.ok(msg.indexOf("transaction") < 0 && msg.indexOf("deal_date") < 0,
    "raw field names leaked into the message: " + msg);
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

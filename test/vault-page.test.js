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

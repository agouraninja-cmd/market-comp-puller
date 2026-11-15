const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const shared = require("./helpers/boot");
const SEC = require("../security-headers");

// The security headers, and that every kind of response actually carries them.
//
// Until 2026-11-14 the live site answered with none of these. server.js writes
// responses from hundreds of separate res.writeHead calls, so the headers are
// set once at the top of the request handler (security-headers.js) and merged
// in by Node. The pure half below pins what they say; the route half boots the
// real server and asks for a page, an API route, a static file, a redirect, a
// 404 and a POST, because "set once for everything" is a claim about wiring
// and only a real response can prove it.

test("the base headers say what the module's header comment promises", () => {
  const h = SEC.securityHeaders({});
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["x-frame-options"], "SAMEORIGIN");
  assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(h["content-security-policy"], /frame-ancestors 'self'/);
  assert.match(h["content-security-policy"], /base-uri 'self'/);
  assert.match(h["content-security-policy"], /object-src 'none'/);
  assert.match(h["permissions-policy"], /camera=\(\)/);
});

// Every page here runs inline scripts and styles. A script-src or style-src
// (or a default-src, which implies both) without a nonce on each of them
// blanks the whole app, the way a failed /valuation.js does. Adding one is a
// change of its own, made with the nonces; this fails the build if one slips
// in beside an unrelated edit.
test("the policy carries no script or style directive until the pages have nonces", () => {
  for (const d of ["script-src", "style-src", "default-src"]) {
    assert.ok(!SEC.CONTENT_SECURITY_POLICY.includes(d),
      `${d} would block every inline script or style on the site; see security-headers.js`);
  }
});

test("HSTS is sent only for a request that arrived over HTTPS", () => {
  assert.equal(SEC.securityHeaders({})["strict-transport-security"], undefined,
    "a local server must never teach a browser to refuse http://localhost");
  assert.equal(SEC.securityHeaders({ "x-forwarded-proto": "http" })["strict-transport-security"], undefined);
  const hsts = SEC.securityHeaders({ "x-forwarded-proto": "https" })["strict-transport-security"];
  assert.equal(hsts, `max-age=${SEC.HSTS_MAX_AGE_SEC}`);
  assert.ok(!/includeSubDomains|preload/i.test(hsts),
    "neither is sent on purpose: both bind hostnames this code knows nothing about");
  // The first value is the hop the visitor made.
  assert.equal(SEC.arrivedOverHttps({ "x-forwarded-proto": "https, http" }), true);
  assert.equal(SEC.arrivedOverHttps({ "x-forwarded-proto": "http, https" }), false);
  assert.equal(SEC.arrivedOverHttps({ "x-forwarded-proto": ["HTTPS"] }), true);
  assert.equal(SEC.arrivedOverHttps(undefined), false);
});

test("each call returns its own object, and the base set cannot be edited", () => {
  const a = SEC.securityHeaders({});
  a["x-frame-options"] = "ALLOWALL";
  assert.equal(SEC.securityHeaders({})["x-frame-options"], "SAMEORIGIN");
  assert.ok(Object.isFrozen(SEC.BASE_HEADERS));
});

test("applying them never throws and never touches a response already sent", () => {
  assert.doesNotThrow(() => SEC.applySecurityHeaders(null, null));
  assert.doesNotThrow(() => SEC.applySecurityHeaders({}, {}));
  const set = {};
  SEC.applySecurityHeaders({ headers: {} }, { headersSent: true, setHeader: (k, v) => { set[k] = v; } });
  assert.deepEqual(set, {});
  SEC.applySecurityHeaders({ headers: {} }, { setHeader: () => { throw new Error("boom"); } });
});

// nosniff's one cost: a browser now refuses a script that is not served as
// JavaScript and a stylesheet that is not served as text/css. Every static
// asset already declares its real type; this keeps a new one honest.
test("every static script and stylesheet is served with its real type", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("const STATIC_FILES = {");
  assert.ok(start > 0, "STATIC_FILES moved; point this test at it");
  const block = src.slice(start, src.indexOf("\n  };", start));
  const entries = [...block.matchAll(/"(\/[^"]+)":\s*\{\s*file:\s*"[^"]+",\s*type:\s*"([^"]+)"/g)];
  assert.ok(entries.length > 20, "the allowlist was not parsed");
  for (const [, url, type] of entries) {
    if (url.endsWith(".js")) assert.match(type, /^text\/javascript/, `${url} must be served as JavaScript`);
    if (url.endsWith(".css")) assert.match(type, /^text\/css/, `${url} must be served as text/css`);
  }
});

test("every kind of response carries the headers", async (t) => {
  const srv = await shared.boot({ ACCOUNT_WALL: "on", SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "" });
  t.after(() => srv.stop());

  const expectHeaders = (r, what) => {
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", `${what}: nosniff`);
    assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN", `${what}: framing`);
    assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin", `${what}: referrer`);
    assert.equal(r.headers.get("content-security-policy"), SEC.CONTENT_SECURITY_POLICY, `${what}: CSP`);
    assert.ok(r.headers.get("permissions-policy"), `${what}: permissions`);
  };

  const cases = [
    ["the home page", "/", {}],
    ["a server-rendered page", "/how-it-works", {}],
    ["a JSON route", "/api/config", {}],
    ["the health check", "/healthz", {}],
    ["a static script", "/valuation.js", {}],
    ["the stylesheet", "/tailwind.css", {}],
    ["an image", "/favicon.png", {}],
    ["a redirect", "/desk", { redirect: "manual" }],
    ["a page that does not exist", "/no-such-page-anywhere", {}],
    ["a refused POST", "/api/vault/publish", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }],
  ];
  for (const [what, url, init] of cases) {
    const r = await fetch(srv.base + url, init);
    await r.arrayBuffer();
    expectHeaders(r, `${what} (${url}, ${r.status})`);
    assert.equal(r.headers.get("strict-transport-security"), null,
      `${what}: no HSTS on a plain-HTTP request`);
  }

  // The content types nosniff now holds the browser to.
  const js = await fetch(srv.base + "/valuation.js");
  assert.match(js.headers.get("content-type"), /^text\/javascript/);
  const css = await fetch(srv.base + "/tailwind.css");
  assert.match(css.headers.get("content-type"), /^text\/css/);

  // Behind the proxy, over HTTPS: the same response also carries HSTS.
  const https = await fetch(srv.base + "/", { headers: { "x-forwarded-proto": "https" } });
  await https.arrayBuffer();
  expectHeaders(https, "the home page over HTTPS");
  assert.equal(https.headers.get("strict-transport-security"), `max-age=${SEC.HSTS_MAX_AGE_SEC}`);
});

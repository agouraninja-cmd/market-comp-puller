const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const shared = require("./helpers/boot");
const { servedApp, APP_SCRIPT_TAG } = require("./helpers/served-app");
const APPPAGE = require("../app-page");

// The app's script, served as its own cacheable file.
//
// index.html carries about a megabyte of inline script and is served
// no-store, so that megabyte was downloaded again on every page view. Since
// 2026-11-14 the server hands the page out with the script at
// /app.<hash>.js instead (app-page.js). index.html on disk is unchanged.
//
// What has to hold, and what each block below is for:
//   - the split is lossless and only ever takes the one big plain script;
//   - every marker server.js fills at serve time is in the PAGE half, or the
//     rewrite would silently stop happening;
//   - the address is the content, cached for a year only when it matches;
//   - the document the browser assembles is byte for byte the page it got
//     before, which is the claim "nothing changed" rests on.

const INDEX = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const big = (n) => "/*" + "x".repeat(n) + "*/";

test("the split takes the one big plain inline script and nothing else", () => {
  const html = "<head><script>var small=1</script><script src=\"/a.js\"></script></head>" +
    "<body><p>hi</p><script>" + big(APPPAGE.MIN_SCRIPT_BYTES) + "</script><i>tail</i></body>";
  const parts = APPPAGE.splitMainScript(html);
  assert.ok(parts);
  assert.equal(parts.script, big(APPPAGE.MIN_SCRIPT_BYTES));
  assert.ok(parts.before.includes("var small=1"), "the small inline script stays in the page");
  assert.ok(parts.before.includes('src="/a.js"'));
  assert.equal(parts.after, "<i>tail</i></body>");
  assert.equal(parts.before + "<script>" + parts.script + "</script>" + parts.after, html, "lossless");
});

test("anything unexpected leaves the page alone", () => {
  assert.equal(APPPAGE.splitMainScript("<script>var a=1</script>"), null, "too small to be worth a request");
  assert.equal(APPPAGE.splitMainScript(""), null);
  assert.equal(APPPAGE.splitMainScript(null), null);
  assert.equal(APPPAGE.splitMainScript("<p>no script at all</p>"), null);
  // A type, a nonce, defer: an external copy would not run the same way.
  for (const attrs of ['type="module"', "defer", 'nonce="abc"', 'id="main"']) {
    assert.equal(APPPAGE.splitMainScript(`<script ${attrs}>` + big(APPPAGE.MIN_SCRIPT_BYTES) + "</script>"), null,
      `a <script ${attrs}> must not be moved`);
  }
  assert.equal(APPPAGE.externalize("<script>var a=1</script>"), null);
});

test("the address is the content", () => {
  const html = "<head></head><body><script>" + big(APPPAGE.MIN_SCRIPT_BYTES) + "</script></body>";
  const ext = APPPAGE.externalize(html);
  const want = crypto.createHash("sha256").update(ext.script).digest("hex").slice(0, 16);
  assert.equal(ext.hash, want);
  assert.equal(ext.url, `/app.${want}.js`);
  assert.equal(APPPAGE.hashFromPath(ext.url), want);
  assert.ok(ext.html.includes(`<script src="${ext.url}"></script>`));
  assert.ok(!ext.html.includes(big(APPPAGE.MIN_SCRIPT_BYTES)), "the script left the page");
  // One more byte of script is a different address.
  const other = APPPAGE.externalize(html.replace("*/</script>", "*/;</script>"));
  assert.notEqual(other.hash, ext.hash);
  // What the caller rewrites in the script is part of the address.
  const moved = APPPAGE.externalize(html, { transformScript: (s) => s + "//x" });
  assert.notEqual(moved.hash, ext.hash);
  assert.ok(moved.script.endsWith("//x"));
});

test("the script is asked for from the head, once, and only where a head ends", () => {
  const html = "<head><title>t</title></head><body><script>" + big(APPPAGE.MIN_SCRIPT_BYTES) + "</script></body>";
  const ext = APPPAGE.externalize(html);
  const link = `<link rel="preload" as="script" href="${ext.url}">`;
  assert.equal(ext.html.split(link).length - 1, 1);
  assert.ok(ext.html.indexOf(link) < ext.html.indexOf("</head>"));
  // No head, or a "</head>" that is not the end of one: no hint, same page.
  const headless = APPPAGE.externalize("<body><script>" + big(APPPAGE.MIN_SCRIPT_BYTES) + "</script></body>");
  assert.ok(!headless.html.includes("preload"));
  const odd = APPPAGE.externalize("<body><p></head></p><script>" + big(APPPAGE.MIN_SCRIPT_BYTES) + "</script></body>");
  assert.ok(!odd.html.includes("preload"));
});

test("only an address of exactly our shape is ours", () => {
  assert.equal(APPPAGE.hashFromPath("/app.0123456789abcdef.js"), "0123456789abcdef");
  for (const p of ["/app.js", "/app.0123456789abcde.js", "/app.0123456789abcdefg.js", "/app.0123456789ABCDEF.js",
    "/app.0123456789abcdef.js.map", "/x/app.0123456789abcdef.js", "/app.0123456789abcdef.css", "", null]) {
    assert.equal(APPPAGE.hashFromPath(p), null, `${p} is not an app script address`);
  }
});

test("a year for the address that is this content, nothing for any other", () => {
  assert.equal(APPPAGE.scriptCacheControl("aaaa", "aaaa"), "public, max-age=31536000, immutable");
  assert.equal(APPPAGE.scriptCacheControl("aaaa", "bbbb"), "no-store",
    "a mismatched pairing must never be remembered by a browser or the edge");
  assert.equal(APPPAGE.scriptCacheControl("", ""), "no-store");
  assert.equal(APPPAGE.scriptCacheControl(null, "bbbb"), "no-store");
});

// --- the real page ---------------------------------------------------------

test("index.html splits losslessly, and the script is most of it", () => {
  const parts = APPPAGE.splitMainScript(INDEX);
  assert.ok(parts, "index.html no longer has a plain inline script big enough to move");
  assert.equal(parts.before + "<script>" + parts.script + "</script>" + parts.after, INDEX);
  assert.ok(Buffer.byteLength(parts.script) > Buffer.byteLength(INDEX) / 2,
    "the moved script should be the bulk of the file");
  assert.match(parts.after, /^\s*<\/body>\s*<\/html>\s*$/, "nothing but the closing tags follows it");
  assert.ok(!parts.script.includes("</script"), "a closing tag inside the script would cut it short");
});

// server.js fills these at serve time with String.replace, which rewrites
// the FIRST occurrence. All of them are in the page today. If one ever
// appeared only in the script, the page would go out with it unfilled and the
// script would go out, cached for a year, with a per-visitor value baked in.
test("every marker the server fills at serve time is in the page, never in the script", () => {
  const { before, script } = APPPAGE.splitMainScript(INDEX);
  const markers = [
    "<!--NAV_LINKS-->", "<!--INAPP_BOOT-->", "<!--COMPONENT_CSS-->", "<!--TESTER_BADGE-->",
    "<!--AUTH_BOOT-->", "<!--DESK_BOOT-->", "<!--INSTANT_NAV-->", "<!--BULK_RUN-->",
    'href="/tailwind.css"', 'placeholder="e.g. industrial Ontario, CA"',
  ];
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  for (const mk of markers) {
    assert.ok(server.includes(JSON.stringify(mk)) || server.includes("'" + mk + "'"),
      `${mk} is no longer a marker in server.js; update this list`);
    assert.ok(before.includes(mk), `${mk} is not in the page half`);
    assert.ok(!script.includes(mk), `${mk} appears inside the script, where no per-request rewrite can reach it`);
  }
  // The default origin is rewritten everywhere when SITE_URL is set; in the
  // script that happens before hashing (loadAppPage), so it may appear there.
});

// --- the real server -------------------------------------------------------

test("the served app points at its script, and the script is cacheable for a year", async (t) => {
  const srv = await shared.boot({ ACCOUNT_WALL: "off", MARKET_EXAMPLE: "e.g. office Dallas, TX" });
  t.after(() => srv.stop());

  const res = await fetch(srv.base + "/");
  const page = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store", "the page itself is still never cached");
  const tag = APP_SCRIPT_TAG.exec(page);
  assert.ok(tag, "the served page does not point at /app.<hash>.js");
  assert.ok(Buffer.byteLength(page) < 700 * 1024,
    `the page is still carrying the script: ${Buffer.byteLength(page)} bytes`);
  assert.equal(page.split(`<link rel="preload" as="script" href="${tag[1]}">`).length - 1, 1);

  const js = await fetch(srv.base + tag[1]);
  const body = await js.text();
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /^text\/javascript/);
  assert.equal(js.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(js.headers.get("x-content-type-options"), "nosniff");
  assert.equal(crypto.createHash("sha256").update(body).digest("hex").slice(0, 16),
    APPPAGE.hashFromPath(tag[1]), "the address must be the hash of what is served there");
  assert.ok(Buffer.byteLength(body) > 500 * 1024);

  // A hash that is not the current one (a page from before a deploy): the
  // current script, and nothing that lets anybody cache the mismatch.
  const stale = await fetch(srv.base + "/app.0000000000000000.js");
  assert.equal(stale.status, 200, "a 404 here is a page that looks fine and does nothing");
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.equal(await stale.text(), body);

  const head = await fetch(srv.base + tag[1], { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  // Every door into index.html gets the same script address.
  for (const door of ["/run-report", "/index.html", "/?auth=signin"]) {
    const other = await (await fetch(srv.base + door)).text();
    assert.equal((APP_SCRIPT_TAG.exec(other) || [])[1], tag[1], `${door} points somewhere else`);
  }
});

// The claim "nothing changed for the visitor" rests on this: put the script
// back where the tag is, take out the one preload hint, and the document is
// byte for byte what the server hands out with the feature switched off.
test("page plus script is exactly the page as it was served before", async (t) => {
  const env = { ACCOUNT_WALL: "off", MARKET_EXAMPLE: "e.g. office Dallas, TX" };
  const on = await shared.boot(env);
  t.after(() => on.stop());
  const off = await shared.boot({ ...env, EXTERNAL_APP_SCRIPT: "off" });
  t.after(() => off.stop());

  const whole = await (await fetch(off.base + "/")).text();
  assert.equal(APP_SCRIPT_TAG.exec(whole), null, "switched off, the script stays inline");
  assert.ok(Buffer.byteLength(whole) > 1000 * 1024);
  const gone = await fetch(off.base + "/app.0000000000000000.js");
  assert.equal(gone.status, 404, "switched off, no page points at the script route");
  await gone.text();

  const assembled = (await servedApp(on.base, "/"))
    .replace(/<link rel="preload" as="script" href="\/app\.[0-9a-f]{16}\.js">\n/, "");
  // The stylesheet's version stamp is identical (same file); nothing else in
  // the page varies between two anonymous loads with the example pinned.
  assert.equal(assembled.length, whole.length);
  assert.ok(assembled === whole, "the assembled document differs from the page served whole");
});

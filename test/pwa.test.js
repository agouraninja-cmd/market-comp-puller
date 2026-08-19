// The installable-app (PWA) contract, checked without booting anything.
//
// Route wiring for these assets lives in test/routes.test.js, on a server
// that suite already boots. What is here instead is the part no single file
// can check about itself: sw.js and server.js each hold half of a rule, and
// the failure when they disagree is invisible in review and near-invisible in
// production.
//
// Run: npm test

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const sw = read("sw.js");
const server = read("server.js");
const html = read("index.html");

// Lift a plain string-array literal out of a source file. Deliberately dumb:
// these are flat lists of quoted paths, and anything cleverer would start
// evaluating the file it is supposed to be auditing.
function stringArray(src, name) {
  const decl = "const " + name + " = [";
  const at = src.indexOf(decl);
  assert.ok(at >= 0, "could not find a " + name + " array literal -- did it get renamed?");
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  assert.ok(close > open, name + " has no closing bracket");
  const body = src.slice(open + 1, close).replace(/,\s*$/, "");
  const parsed = JSON.parse("[" + body + "]");
  assert.ok(parsed.length > 0, name + " is empty, so every check against it would pass vacuously");
  return parsed;
}

// Every STATIC_FILES entry server.js deliberately serves with maxAge: 0.
function zeroCacheAssets() {
  const found = [];
  const re = /"(\/[^"]+)":\s*\{[^}]*maxAge:\s*0\s*\}/g;
  let m;
  while ((m = re.exec(server))) found.push(m[1]);
  return found;
}

// --- The rule that spans the two files -------------------------------------

// server.js serves /valuation.js, /gut-check.js and /explore-query.js with
// maxAge: 0 because a copy of any of them that is stale relative to the HTML
// aborts the whole front end — index.html's inline script destructures
// VALUATION as its first statement, so the page still paints and simply does
// nothing. A service worker is the one layer that can keep serving a stale
// copy across the deploy that fixed it, which makes "cache this too" a
// plausible-looking edit with a catastrophic, silent result.
test("the service worker never caches an asset server.js pins at maxAge: 0", () => {
  const zero = zeroCacheAssets();
  assert.ok(zero.length >= 3, "expected several maxAge: 0 assets, found " + zero.length);

  const cacheable = stringArray(sw, "CACHEABLE");
  const prefix = sw.match(/const CACHEABLE_PREFIX = "([^"]+)"/);
  assert.ok(prefix, "CACHEABLE_PREFIX went missing");

  for (const asset of zero) {
    assert.ok(
      !cacheable.includes(asset),
      asset + " is served with maxAge: 0 but is in the service worker's CACHEABLE list"
    );
    assert.ok(
      !asset.startsWith(prefix[1]),
      asset + " is served with maxAge: 0 but sits under the cacheable prefix " + prefix[1]
    );
  }
});

test("the three front-end-critical scripts are named in NEVER_CACHE", () => {
  const never = stringArray(sw, "NEVER_CACHE");
  for (const f of ["/valuation.js", "/gut-check.js", "/explore-query.js"]) {
    assert.ok(never.includes(f), f + " must be in the service worker's NEVER_CACHE list");
  }
});

// The service worker caches by allowlist rather than denylist because this
// app serves private data — the broker vault, shared reports, My Desk — off
// ordinary-looking paths. A rule that stored "anything static-looking" is one
// route away from writing a broker's book into a cache on a shared device.
test("nothing the service worker may cache is a private or API surface", () => {
  const cacheable = stringArray(sw, "CACHEABLE");
  const banned = ["/api/", "/vault", "/desk", "/r/", "/admin", "/dev", "/hq", "/contacts", "/broker"];
  for (const entry of cacheable) {
    for (const b of banned) {
      assert.ok(!entry.startsWith(b), "service worker would cache the private surface " + entry);
    }
  }
});

// --- The offline page ------------------------------------------------------

// It is shown precisely when the network is unreachable, so anything it has
// to fetch is a hole in the middle of it. Apple's guideline 4.2 reviewers
// reject a wrapper that shows a white screen with no connection, and a
// stylesheet that never arrives is how that happens.
test("the offline page depends on nothing it would have to fetch", () => {
  const off = read("offline.html");
  assert.doesNotMatch(off, /https?:\/\//, "offline.html references an external URL");
  assert.doesNotMatch(off, /<link[^>]+stylesheet/i, "offline.html links a stylesheet it cannot load offline");
  assert.doesNotMatch(off, /<script[^>]+\bsrc=/i, "offline.html loads an external script");
  assert.doesNotMatch(off, /<img\b/i, "offline.html uses an <img> where inline SVG would always render");
  assert.match(off, /<svg/i, "offline.html should still show the mark");
});

test("the service worker precaches the offline page", () => {
  const m = sw.match(/const OFFLINE_URL = "([^"]+)"/);
  assert.ok(m, "OFFLINE_URL went missing");
  assert.ok(
    fs.existsSync(path.join(root, m[1].replace(/^\//, ""))),
    "OFFLINE_URL points at " + m[1] + ", which is not a file in the repo"
  );
  assert.match(sw, /const PRECACHE = \[[^\]]*OFFLINE_URL/, "the offline page must be precached, not fetched on demand");
});

// --- The manifest ----------------------------------------------------------

test("the manifest describes an app rather than a bookmark", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.display, "standalone");
  assert.ok(m.name && m.short_name, "both a full and a short name are needed");
  assert.ok(m.short_name.length <= 12, "iOS truncates a home-screen label past ~12 characters");
  assert.ok(m.start_url.startsWith(m.scope), "start_url sits outside the manifest scope");
  assert.ok(
    m.icons.some((i) => (i.purpose || "").split(/\s+/).includes("maskable")),
    "without a maskable icon Android crops the mark inside a white square"
  );
  assert.ok(
    m.icons.some((i) => i.sizes === "512x512"),
    "512px is the floor for an install prompt"
  );
});

test("every icon file the manifest names exists and is a PNG", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  const srcs = new Set(m.icons.map((i) => i.src));
  for (const sc of m.shortcuts || []) for (const i of sc.icons || []) srcs.add(i.src);
  for (const src of srcs) {
    const file = path.join(root, src.replace(/^\//, ""));
    assert.ok(fs.existsSync(file), src + " is named by the manifest but is not in the repo");
    const head = fs.readFileSync(file).subarray(0, 8);
    assert.equal(head.toString("hex"), "89504e470d0a1a0a", src + " is not a PNG");
  }
});

// --- index.html's half ------------------------------------------------------

test("index.html links the manifest and registers the service worker", () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
});

// The registration has to survive the front end failing to boot: a missing
// /valuation.js aborts the main block at its first statement, and offline
// handling is exactly what should still work on a bad connection. Keeping it
// in its own element is what buys that, so the separation is pinned.
test("the service worker registration is not inside the main script block", () => {
  const idx = html.indexOf('navigator.serviceWorker.register("/sw.js")');
  assert.ok(idx > 0);
  const before = html.slice(0, idx);
  const opens = (before.match(/<script\b/gi) || []).length;
  const closes = (before.match(/<\/script>/gi) || []).length;
  assert.equal(opens - closes, 1, "registration should sit in a script element of its own");
  assert.ok(
    before.lastIndexOf("VALUATION") < before.lastIndexOf("<script"),
    "registration must not share a block with the VALUATION destructure"
  );
});

// --- The worker itself ------------------------------------------------------

// It is served to browsers, never required by Node, so nothing else in the
// suite would notice if it stopped parsing. Compile-only: this needs no
// service-worker globals because it is never run.
test("sw.js parses as valid JavaScript", () => {
  new vm.Script(sw, { filename: "sw.js" });
});

test("the service worker leaves API traffic completely alone", () => {
  assert.match(
    sw,
    /url\.pathname\.startsWith\("\/api\/"\)\)\s*return;/,
    "the /api/ early return is what keeps report and vault responses out of any cache"
  );
});

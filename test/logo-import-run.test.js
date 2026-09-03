const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const http = require("node:http");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

// Importing a logo from a firm's website, actually run: a stub site on
// loopback, the real server fetching it, the real candidate order, the real
// byte sniff. LOGO_IMPORT_ALLOW_PRIVATE is the test-only door past the
// private-address guard (RESEND_API_URL's precedent); the last test boots a
// server WITHOUT it to prove the guard refuses a loopback address at all.

const DAY = 86400000;
const TOKEN = "test-session-token";
const TOKEN_HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");
const as = (init = {}) => ({ ...init, headers: { "content-type": "application/json", cookie: "cn_session=" + TOKEN, ...(init.headers || {}) } });

function tables() {
  return {
    users: [{ id: "u1", email: "broker@example.com", name: "Brad" }],
    sessions: [{ id: "s1", user_id: "u1", token_hash: TOKEN_HASH, expires_at: new Date(Date.now() + 30 * DAY).toISOString() }],
    branding_profiles: [], analytics_events: [],
  };
}
function png(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([sig, ihdr, Buffer.alloc(200)]);
}

// A stub firm website. Paths:
//   /                 declares a touch icon, an .ico and an og:image
//   /ico-only/        declares only a .ico; /apple-touch-icon.png 404s
//   /big/             declares only a picture over the byte cap
//   /go               302 to / (same host) — the common http->www hop
function startSite() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    const html = (body) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><head>" + body + "</head><body>x</body></html>"); };
    if (req.url === "/") return html('<link rel="apple-touch-icon" sizes="180x180" href="/touch.png"><link rel="shortcut icon" href="/favicon.ico"><meta property="og:image" content="/banner.jpg">');
    if (req.url === "/ico-only/") return html('<link rel="shortcut icon" href="/favicon.ico">');
    if (req.url === "/big/") return html('<link rel="apple-touch-icon" href="/huge.png">');
    if (req.url === "/go") { res.writeHead(302, { location: "/" }); return res.end(); }
    if (req.url === "/touch.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(png(180, 180)); }
    if (req.url === "/banner.jpg") { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])); }
    if (req.url === "/huge.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.concat([png(400, 400), Buffer.alloc(3 * 1024 * 1024)])); }
    res.writeHead(404); res.end("no");
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve({
    url: "http://127.0.0.1:" + srv.address().port, hits, stop: () => new Promise((r) => srv.close(r)),
  })));
}

test("a logo is read off the firm's website", async (t) => {
  const site = await startSite();
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key", LOGO_IMPORT_ALLOW_PRIVATE: "1" });
  t.after(async () => { srv.stop(); await db.stop(); await site.stop(); });
  const post = (url, init) => fetch(srv.base + "/api/branding/logo-from-site", as({ method: "POST", body: JSON.stringify({ url }), ...(init || {}) }));

  await t.test("the declared touch icon wins, and comes back as a data URI", async () => {
    const r = await post(site.url + "/");
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.match(j.logo, /^data:image\/png;base64,iVBOR/);
    assert.equal(j.kind, "apple-touch-icon");
    assert.equal(j.source, site.url + "/touch.png");
    assert.ok(!site.hits.includes("/favicon.ico"), ".ico is never even fetched");
    assert.ok(!site.hits.includes("/banner.jpg"), "the first usable candidate ends the search");
    assert.equal(db.tables ? (db.tables.branding_profiles || []).length : 0, 0, "nothing is stored by importing");
  });

  await t.test("a redirect on the same host is followed, by hand", async () => {
    const r = await post(site.url + "/go");
    assert.equal(r.status, 200, await r.text());
    assert.ok(site.hits.includes("/go") && site.hits.includes("/"));
  });

  await t.test("a site with only an .ico, or only a picture over the cap, is a clear 404 that names the fix", async () => {
    let r = await post(site.url + "/ico-only/");
    assert.equal(r.status, 404);
    assert.match((await r.json()).error, /Choose a file instead/);
    assert.ok(site.hits.includes("/apple-touch-icon.png"), "the undeclared convention was tried before giving up");
    r = await post(site.url + "/big/");
    assert.equal(r.status, 404, "an over-cap picture is skipped, not served");
  });

  await t.test("an unreachable site is a 502, a bad address a 400, a stranger a 401", async () => {
    const dead = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    assert.equal((await post("http://127.0.0.1:" + dead + "/")).status, 502);
    assert.equal((await post("")).status, 400);
    assert.equal((await post("ftp://x.example")).status, 400);
    assert.equal((await fetch(srv.base + "/api/branding/logo-from-site", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: site.url }) })).status, 401);
  });
});

test("without the test-only door, a loopback address is refused before anything is fetched", async (t) => {
  const site = await startSite();
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({ ACCOUNT_WALL: "off", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key" });
  t.after(async () => { srv.stop(); await db.stop(); await site.stop(); });
  const r = await fetch(srv.base + "/api/branding/logo-from-site", as({ method: "POST", body: JSON.stringify({ url: site.url + "/" }) }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /public web address/);
  assert.equal(site.hits.length, 0, "the guard is before the fetch, not after it");
});

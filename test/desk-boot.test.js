// The browser half of the workspace's serve-time payload (2026-09-04):
// bootFetch in index.html, and the pins that keep it in step with server.js's
// DESK_BOOT_URLS. The server half runs in test/desk-boot-run.test.js.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const BOOT_RE = /  function bootFetch\(url, init\) \{[\s\S]*?\n  \}/;

function load(store) {
  const src = html.match(BOOT_RE);
  assert.ok(src, "index.html must define bootFetch(url, init)");
  const calls = [];
  const ctx = vm.createContext({
    window: { DESK_BOOT: store },
    fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true, status: 200, live: true, json: async () => ({ live: true }) }); },
    Promise, Object, String,
  });
  new vm.Script(src[0] + "\nthis.bootFetch = bootFetch;", { filename: "index.html" }).runInContext(ctx);
  ctx.calls = calls;
  return ctx;
}

test("an entry is handed out once, to the first GET, and the URL fetches live after that", async () => {
  const c = load({ "/api/shares": { status: 200, body: { mine: [1] } } });
  const first = await c.bootFetch("/api/shares");
  assert.equal(first.ok, true);
  assert.equal(first.status, 200);
  assert.deepStrictEqual(await first.json(), { mine: [1] });
  assert.equal(first.headers.get("Content-Type"), "application/json");
  assert.equal(c.calls.length, 0, "the first read never touches the network");
  const second = await c.bootFetch("/api/shares");
  assert.equal(second.live, true, "the second read is a real fetch — a repaint after a save must see the save");
  assert.equal(c.calls.length, 1);
});

test("only a GET may take an entry; a POST to the same URL goes to the network", async () => {
  const c = load({ "/api/org": { status: 200, body: { orgs: [] } } });
  const posted = await c.bootFetch("/api/org", { method: "POST", body: "{}" });
  assert.equal(posted.live, true);
  assert.deepStrictEqual(c.calls[0].init, { method: "POST", body: "{}" }, "init passes through untouched");
  const got = await c.bootFetch("/api/org", { cache: "no-store" });
  assert.deepStrictEqual(await got.json(), { orgs: [] }, "a GET with options still takes the entry");
});

test("a URL not in the payload, or no payload at all, is an ordinary fetch", async () => {
  const c = load({ "/api/shares": { status: 200, body: {} } });
  assert.equal((await c.bootFetch("/api/hubs")).live, true);
  const none = load(undefined);
  assert.equal((await none.bootFetch("/api/shares")).live, true);
  assert.equal(none.calls.length, 1);
});

test("a non-200 entry reads as not ok, so a caller's error path runs as it would live", async () => {
  const c = load({ "/api/broker/leads": { status: 403, body: { error: "no" } } });
  const r = await c.bootFetch("/api/broker/leads");
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("every URL the server embeds is one the page asks for through bootFetch, and vice versa", () => {
  const list = server.match(/const DESK_BOOT_URLS = \[([\s\S]*?)\];/);
  assert.ok(list, "server.js must declare DESK_BOOT_URLS");
  const urls = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length >= 10, "the base list should name the desk's reads");
  for (const url of urls) {
    const direct = html.includes(`bootFetch("${url}"`);
    const viaAcct = html.includes(`acctApi("GET", "${url}")`);
    assert.ok(direct || viaAcct, `${url} is embedded by the server but nothing in index.html asks for it through bootFetch`);
  }
  // acctApi routes its own fetch through bootFetch, which is what makes the
  // viaAcct branch above true.
  const acct = html.slice(html.indexOf("async function acctApi("), html.indexOf("async function acctApi(") + 300);
  assert.ok(acct.includes("await bootFetch(url, {"), "acctApi must read through bootFetch");
  // The firm-scoped six, built with the same encodeURIComponent on both sides.
  const orgList = server.match(/const DESK_BOOT_ORG_URLS = \(id\) => \[([\s\S]*?)\];/);
  assert.ok(orgList);
  for (const seg of ["members", "buildings", "board", "shelf", "contacts"]) {
    assert.ok(orgList[1].includes(`/api/org/${seg}?id=\${id}`), `server embeds /api/org/${seg}`);
    assert.ok(html.includes(`bootFetch(\`/api/org/${seg}?id=\${encodeURIComponent(firm.id)}\`)`),
      `index.html reads /api/org/${seg} through bootFetch with the same key shape`);
  }
  assert.ok(orgList[1].includes('"/api/messages"') && html.includes('bootFetch("/api/messages",'));
  // And the reverse: a desk read that went back to bare fetch would cost a
  // round trip on every member's first paint with nothing failing.
  for (const bare of ['fetch("/api/shares")', 'fetch("/api/org")', 'fetch("/api/hubs")', 'const r = await fetch("/api/config")',
    'const r = await fetch("/api/account/me"']) {
    assert.ok(!html.includes(bare), `${bare} must go through bootFetch`);
  }
});

test("the marker sits in <head> right after the auth hint, and the payload script is escaped", () => {
  const auth = html.indexOf("<!--AUTH_BOOT-->");
  const desk = html.indexOf("<!--DESK_BOOT-->");
  assert.ok(auth > 0 && desk > auth && desk < html.indexOf("</head>"), "DESK_BOOT follows AUTH_BOOT in <head>");
  assert.equal((html.match(/<!--DESK_BOOT-->/g) || []).length, 1);
  const fn = server.slice(server.indexOf("function deskBootScript("), server.indexOf("function deskBootScript(") + 400);
  assert.ok(fn.includes('.replace(/</g, "\\\\u003c")'), "`<` is escaped so a body cannot close the script");
  assert.ok(fn.includes("/\\u2028/g") && fn.includes("/\\u2029/g"), "line separators are escaped");
});

test("initGate no longer refills the desk: the boot's second, identical fill is gone", () => {
  const at = html.indexOf("async function initGate()");
  const fn = html.slice(at, html.indexOf("if (!cfg.authRequired) return;", at));
  assert.ok(!fn.includes("renderMyDesk()"), "initGate must not call renderMyDesk — refreshAccountUI's call fills the desk");
  // The checkout-return repaint stays where the flag really changes the desk.
  const rp = html.slice(html.indexOf("async function refreshProConfig()"), html.indexOf("function showCheckoutNotice("));
  assert.ok(rp.includes("renderMyDesk()"), "refreshProConfig keeps its repaint");
});

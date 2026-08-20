// The From-address admin routes (migration 034) — the gate and the wiring,
// not the rules.
//
// sender-email.test.js already proves the DECISIONS are right (what a valid
// address is, which one wins, that an invalid override falls back to
// EMAIL_FROM). Nothing there proves any of it is WIRED: that the routes are
// admin-gated at all, that the write refuses rather than degrading without a
// database, and — the one that would be worst to get wrong — that the sending
// path actually consults the override instead of the environment variable it
// replaced.
//
// Cost: zero. Nothing here calls Supabase, Resend or a model. The bare server
// has no database, which is the state most of these assert on.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");

const KEY = "admin-key-for-tests";

test("the sender routes are ADMIN_KEY-gated", async (t) => {
  const srv = await boot({ ADMIN_KEY: KEY, EMAIL_FROM: "CompNinja <reports@compninja.co>" });
  t.after(() => srv.stop());

  await t.test("without the key: 401, on every method", async () => {
    for (const [method, url] of [
      ["GET", "/api/admin/sender"],
      ["PUT", "/api/admin/sender"],
      ["DELETE", "/api/admin/sender"],
      ["POST", "/api/admin/sender/test"],
    ]) {
      const r = await fetch(srv.base + url, { method, body: method === "GET" ? undefined : "{}" });
      assert.equal(r.status, 401, `${method} ${url}`);
    }
  });

  await t.test("GET reports the live address and where it came from", async () => {
    const r = await fetch(srv.base + "/api/admin/sender", { headers: { "x-admin-key": KEY } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.effective, "CompNinja <reports@compninja.co>");
    assert.equal(j.source, "env", "with no database there can be no override");
    assert.equal(j.db, false);
    // An address is not mail: the suite boots with no RESEND_API_KEY.
    assert.equal(j.live, false);
    // The card shows where a test send would go, so nobody has to guess
    // whether pressing it mails a customer.
    assert.ok(j.testTo, "the test recipient must be stated");
  });

  await t.test("a GET never sends anything, and never writes", async () => {
    // The digest card's rule, restated for this one: opening /admin must not
    // mail anybody. Two GETs in a row must report the same thing.
    const a = await (await fetch(srv.base + "/api/admin/sender", { headers: { "x-admin-key": KEY } })).json();
    const b = await (await fetch(srv.base + "/api/admin/sender", { headers: { "x-admin-key": KEY } })).json();
    assert.deepEqual(a, b);
  });
});

test("the WRITE refuses without a database rather than degrading to a file", async (t) => {
  // The vault's stance, for the vault's reason: Render wipes its disk on every
  // deploy, so an override saved to a file would silently revert days later
  // and mail would go out from the old address with nothing saying so — the
  // exact silent-revert failure this feature exists to remove.
  const srv = await boot({ ADMIN_KEY: KEY });
  t.after(() => srv.stop());

  for (const method of ["PUT", "DELETE"]) {
    const r = await fetch(srv.base + "/api/admin/sender", {
      method,
      headers: { "x-admin-key": KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: "CompNinja <reports@compninja.co>" }),
    });
    assert.equal(r.status, 503, `${method} should refuse`);
    const j = await r.json();
    // Naming the way to do it anyway is the whole point of the refusal.
    assert.match(j.error, /EMAIL_FROM/, `${method} must name the environment variable`);
  }
});

test("the routes do not exist at all when ADMIN_KEY is unset", async (t) => {
  // 404, not 401: the same treatment /api/stats and /api/accuracy get. An
  // unconfigured deployment should not advertise a settings surface.
  const srv = await boot({ ADMIN_KEY: "" });
  t.after(() => srv.stop());
  for (const [method, url] of [
    ["GET", "/api/admin/sender"],
    ["PUT", "/api/admin/sender"],
    ["POST", "/api/admin/sender/test"],
  ]) {
    const r = await fetch(srv.base + url, { method, body: method === "GET" ? undefined : "{}" });
    assert.equal(r.status, 404, `${method} ${url}`);
  }
});

test("the test send refuses when there is nothing to send with", async (t) => {
  // Rather than reporting a cheerful success for mail that went nowhere. The
  // suite boots without RESEND_API_KEY, which is the first of the two.
  const srv = await boot({ ADMIN_KEY: KEY, EMAIL_FROM: "CompNinja <reports@compninja.co>" });
  t.after(() => srv.stop());
  const r = await fetch(srv.base + "/api/admin/sender/test", {
    method: "POST",
    headers: { "x-admin-key": KEY, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /RESEND_API_KEY/);
});

// --- The wiring that matters most ------------------------------------------

test("the SENDING path reads the override, not EMAIL_FROM", () => {
  // This is the assertion the whole feature rests on. Every one of the routes
  // above can be perfect while mail still goes out as the environment
  // variable, and nothing at runtime would say so — outbound sends are
  // fire-and-forget, so the wrong From address fails into somebody's inbox
  // looking exactly like a success.
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  const fn = src.match(/function sendOutboundEmail[\s\S]*?\n\}/)[0];
  assert.match(fn, /const from = senderFrom\(\)/,
    "sendOutboundEmail must resolve the From through senderFrom()");
  assert.ok(!/from: EMAIL_FROM/.test(fn),
    "sendOutboundEmail must not send as EMAIL_FROM directly — the override would never apply");

  // The gate the callers ask, so a deployment with an override but no
  // EMAIL_FROM really does mail invitations rather than reporting them dark.
  assert.match(src, /const OUTBOUND_EMAIL_LIVE = \(\) => Boolean\(RESEND_API_KEY && senderFrom\(\)\)/);

  // The two callers that used to test the env var themselves. A stray
  // `EMAIL_FROM && RESEND_API_KEY` is how half the app would keep answering
  // the old question after the other half moved on.
  assert.ok(!/EMAIL_FROM && RESEND_API_KEY/.test(src),
    "no caller may re-derive the outbound gate from EMAIL_FROM — ask OUTBOUND_EMAIL_LIVE()");
});

test("an unreadable settings table costs the override, never the mail", () => {
  // Rule 1 of sender-email.js, at the wiring level: the refresh swallows its
  // error and keeps the last known value, so a settings table that is missing
  // (migration 034 not run yet) or briefly unreachable leaves every send
  // working as EMAIL_FROM. Password resets ride this path.
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const fn = src.match(/function refreshSenderOverride[\s\S]*?\n\}/)[0];
  assert.match(fn, /\.catch\(/, "the refresh must not be able to throw into a send");
  assert.ok(!/SENDER_OVERRIDE\.value = ""/.test(fn),
    "a failed read must not clear a known-good override");
  // Synchronous readers only: sendOutboundEmail is called from handlers that
  // have already answered and cannot await a database read.
  assert.match(src, /function senderFrom\(\)\s*\{[\s\S]*?SENDER\.effectiveSender\(SENDER_OVERRIDE\.value, EMAIL_FROM\)/);
});

test("the /admin page's script parses at all", async (t) => {
  // /admin is a ~700-line browser script built inside ONE template literal in
  // server.js, and it had no test of this kind — the same hazard
  // test/vault-page.test.js exists for, on a page that had never been given
  // the same guard. A single-backslash escape does not fail anywhere: the
  // page still serves 200 and still looks like a dashboard, while the whole
  // script dies on the first line and every card stays empty.
  //
  // It bit immediately: `value=\"…\"` in the new sender card emitted
  // `value=""…""` and took the entire dashboard down with it. Caught by
  // compiling what the page emits, which is the only thing that catches it.
  const srv = await boot({ ADMIN_KEY: KEY });
  t.after(() => srv.stop());

  const html = await (await fetch(srv.base + "/admin")).text();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length, "the dashboard should ship a script");
  for (const s of scripts) {
    // new Function compiles without running: no DOM needed.
    assert.doesNotThrow(() => new Function(s), "the emitted /admin script must parse");
  }

  // And the card is actually on the page, wired to the loader that fills it.
  assert.match(html, /<div id="sender"/);
  assert.match(html, /loadSender\(key\)/);
  // The field's value is assigned through the DOM rather than written into
  // the markup — see the comment at that line for why.
  assert.match(html, /input\.value=s\.override\|\|""/);
});

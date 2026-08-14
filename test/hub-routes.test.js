// Messaging hub route wiring — the gates and the routing, not the rules.
//
// hub-access.test.js already proves the DECISIONS are right. Nothing there
// proves they are WIRED: that /hub/<id> really renders for a visitor with no
// account (the whole tenant-access decision), that every /api/hub* route
// really 503s with no database rather than degrading, and that creating a hub
// really needs a broker. A gate guarding a broker's private deals grows holes
// at the wiring, not at the rule.
//
// Spec: docs/superpowers/specs/2026-08-13-messaging-hub-design.md
//
// Cost: zero. Nothing here calls Supabase, Anthropic or Stripe. The bare
// server has no database, which is exactly the state most of these assert on.

const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");

test("hub routes on a bare server (no database)", async (t) => {
  // ACCOUNT_WALL left ON, deliberately: the tenant-access decision is that a
  // hub link opens without an account, and the wall is the thing that would
  // break it. Testing this with the wall off would prove nothing.
  const srv = await shared.boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("/hub/<id> renders for a visitor with no account, wall and all", async () => {
    const r = await fetch(srv.base + "/hub/abc123def");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /text\/html/);
    const html = await r.text();
    // The page itself, not the wall's landing page. Discriminating on content
    // rather than on the 200, because since 2026-08-08 the wall answers 200 too.
    assert.match(html, /Comps in this hub/);
    assert.doesNotMatch(html, /How it works/);
  });

  await t.test("the hub page is noindex, like every other signed-in surface", async () => {
    const r = await fetch(srv.base + "/hub/abc123def");
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    assert.match(await r.text(), /name="robots" content="noindex/);
  });

  await t.test("the hub page ships NO hub data, because the token is in the fragment", async () => {
    // If this ever fails, someone has server-rendered a hub's contents into a
    // page the server cannot authenticate the reader of.
    const html = await (await fetch(srv.base + "/hub/abc123def")).text();
    assert.doesNotMatch(html, /snapshot":/);
    assert.doesNotMatch(html, /"messages":/);
  });

  await t.test("the page's own script is not nested inside the shared nav's script", async () => {
    // ACCOUNT_NAV_JS is a COMPLETE <script>…</script> block, not raw JS. The
    // first draft interpolated it inside this page's own <script>, which
    // closed the tag early and dumped the entire hub script onto the screen as
    // visible text. It rendered 200, served valid HTML, and passed every other
    // assertion in this file, so only looking at it (or this) catches it.
    const html = await (await fetch(srv.base + "/hub/abc123def")).text();
    const i = html.indexOf("var HUB_ID");
    assert.ok(i > 0, "the hub script should be on the page");
    assert.ok(html.lastIndexOf("<script>", i) > html.lastIndexOf("</script>", i),
      "the hub's script must open after every prior script closes");
  });

  await t.test("a malformed hub id is not the hub page", async () => {
    for (const p of ["/hub/short", "/hub/", "/hub/way-too-long-to-be-a-hub-id-by-any-measure"]) {
      const r = await fetch(srv.base + p);
      assert.notEqual(r.status, 200, p + " should not render a hub");
    }
  });

  await t.test("every hub API route 503s with no database, never a degraded answer", async () => {
    // The vault's rule and 018's rule: an access-control list in a JSON file
    // on an ephemeral disk is not one, so this refuses rather than falling back.
    const calls = [
      ["GET", "/api/hubs", null],
      ["POST", "/api/hubs", { title: "x" }],
      ["GET", "/api/hub?id=abc123def", null],
      ["POST", "/api/hub/access", { id: "abc123def", token: "nope" }],
      ["POST", "/api/hub/items", { id: "abc123def", items: [] }],
      ["PATCH", "/api/hub/item", { id: "abc123def", itemId: "x", removed: true }],
      ["POST", "/api/hub/message", { id: "abc123def", body: "hi" }],
      ["PUT", "/api/hub/participants", { id: "abc123def", emails: [] }],
      ["POST", "/api/hub/close", { id: "abc123def" }],
    ];
    for (const [method, path, body] of calls) {
      const r = await fetch(srv.base + path, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(r.status, 503, `${method} ${path} should 503 with no database`);
      const j = await r.json();
      assert.match(j.error || "", /unavailable/i, `${method} ${path} should say so plainly`);
    }
  });

  await t.test("an unknown /api/hub/* path 404s rather than falling through to the app", async () => {
    const r = await fetch(srv.base + "/api/hub/nonsense", { method: "POST" });
    // 503 is the correct answer here too: the database check sits above the
    // path dispatch on purpose, so a bare server never reveals which hub
    // sub-routes exist. Either refusal is fine; serving HTML is not.
    assert.ok(r.status === 404 || r.status === 503, "should be a refusal, got " + r.status);
    assert.doesNotMatch(r.headers.get("content-type") || "", /text\/html/);
  });

  await t.test("the hub page is not reachable at the connection hub's URL", async () => {
    // /brokers is the connection hub and predates this feature by weeks.
    // If these two ever collide, the naming warning stopped being enough.
    const r = await fetch(srv.base + "/brokers");
    const html = await r.text();
    assert.doesNotMatch(html, /Comps in this hub/);
  });
});

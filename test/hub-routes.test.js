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
    // /brokers-firms is the connection hub and predates this feature by weeks.
    // If these two ever collide, the naming warning stopped being enough.
    const r = await fetch(srv.base + "/brokers-firms");
    const html = await r.text();
    assert.doesNotMatch(html, /Comps in this hub/);
  });
});

// --- the off switch for note emails (migration 040) -----------------------
//
// Modelled on the watchlist unsubscribe tests in routes.test.js, with one
// difference that is the whole reason this feature has its own switch: the
// token is keyed on an EMAIL ADDRESS, not a user id, because a tenant reads a
// hub on an invite token and may have no account to key anything on. An
// unsubscribe that required signing in would be offering the off switch to
// everybody except the people who need it.
test("hub note email unsubscribe", async (t) => {
  // SUPABASE_SERVICE_KEY without SUPABASE_URL: DB_CONFIGURED stays false (it
  // needs both), but the token HMAC is keyed on the service key alone, so the
  // link half is testable with no database.
  const SERVICE = "service-key-for-token-hmac";
  const crypto = require("node:crypto");
  const macFor = (email) => crypto.createHmac("sha256", SERVICE)
    .update(`hub-note-emails-unsubscribe:${email}`).digest("hex").slice(0, 32);
  const WHO = "tenant@acme.com";
  const PATH = "/hub/notes/unsubscribe";

  await t.test("a wrong, missing, or cross-feature token is refused", async () => {
    const srv = await shared.boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    const watchlistMac = crypto.createHmac("sha256", SERVICE)
      .update(`watchlist-digest-unsubscribe:${WHO}`).digest("hex").slice(0, 32);
    const bad = [
      `?e=${encodeURIComponent(WHO)}`,
      `?e=${encodeURIComponent(WHO)}&t=nope`,
      `?e=&t=${macFor("")}`,
      // Domain separation, asserted rather than assumed: a watchlist token
      // must not unsubscribe somebody from hub mail or the reverse.
      `?e=${encodeURIComponent(WHO)}&t=${watchlistMac}`,
      // The token covers the NORMALIZED address, so a token minted for one
      // person cannot be replayed against another.
      `?e=${encodeURIComponent("someone@else.com")}&t=${macFor(WHO)}`,
    ];
    for (const q of bad) {
      const r = await fetch(srv.base + PATH + q);
      assert.equal(r.status, 400, "unexpectedly accepted " + q);
    }
  });

  await t.test("a valid link CONFIRMS rather than acting, and is noindex", async () => {
    const srv = await shared.boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + `${PATH}?e=${encodeURIComponent(WHO)}&t=${macFor(WHO)}`);
    assert.equal(r.status, 200);
    const html = await r.text();
    // The second click is not politeness. Corporate mail scanners and
    // link-preview bots fetch every URL in an email, so a GET that
    // unsubscribed would opt people out of mail they never opened.
    assert.match(html, /<form method="POST"/,
      "the GET must only offer a form — a prefetching mail scanner must not be able to unsubscribe anyone");
    assert.match(html, /Turn off note emails\?/);
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
  });

  await t.test("it promises that nothing else changes, because nothing else does", async () => {
    // Turning the mail off must not read as leaving the hub. The route only
    // writes hub_email_prefs; access is hub_participants and is untouched.
    const srv = await shared.boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + `${PATH}?e=${encodeURIComponent(WHO)}&t=${macFor(WHO)}`);
    assert.match(await r.text(), /stays open to you/);
  });

  await t.test("the way back on is reachable from the same link", async () => {
    // A one-way off switch with no way back is a support ticket.
    const srv = await shared.boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + `${PATH}?e=${encodeURIComponent(WHO)}&t=${macFor(WHO)}&on=1`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Turn note emails back on\?/);
    assert.match(html, /<form method="POST"/);
  });

  await t.test("with no database the POST refuses instead of claiming it saved", async () => {
    // The failure mode this guards: somebody believes they unsubscribed, keeps
    // getting mail, and has no reason to try the link again.
    const srv = await shared.boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + `${PATH}?e=${encodeURIComponent(WHO)}&t=${macFor(WHO)}`, { method: "POST" });
    assert.equal(r.status, 503);
    const html = await r.text();
    assert.doesNotMatch(html, /That&rsquo;s done/);
    assert.match(html, /could not save that/i);
  });

  await t.test("the path does not shadow a hub, and a hub does not shadow it", async () => {
    // /hub/unsubscribe WOULD have collided: the page route matches
    // /hub/<id> where an id is 6 to 32 characters of [A-Za-z0-9_-], and
    // "unsubscribe" is eleven of them. The third segment is what settles it,
    // so both halves are pinned here.
    const srv = await shared.boot({ SUPABASE_SERVICE_KEY: SERVICE, ACCOUNT_WALL: "on" });
    t.after(() => srv.stop());

    const unsub = await fetch(srv.base + `${PATH}?e=${encodeURIComponent(WHO)}&t=${macFor(WHO)}`);
    assert.doesNotMatch(await unsub.text(), /Comps in this hub/,
      "the unsubscribe path rendered the hub page instead");

    const page = await fetch(srv.base + "/hub/abc123def");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Comps in this hub/,
      "the hub page stopped rendering");
  });
});

// The account wall — routing and the forced guest limit.
//
// Run: npm test
//
// Cost: zero. Nothing here calls Anthropic, Stripe or Supabase. One test boots
// with a FAKE api key so that /api/comps reaches the guest gate at all (see
// FAKE_KEY below); the gate refuses before any upstream call, so a passing run
// spends nothing and a failing one dies on an invalid key rather than a bill.
//
// Coverage gap: the wall-OFF state only proves PRESENTATION here (/api/config
// reports no wall and the configured limit). It does not prove enforcement —
// that a disabled wall really lets a guest search reach /api/comps — because
// that route checks for a missing ANTHROPIC_API_KEY before it ever reaches the
// guest gate (see the note on FAKE_KEY below), so a bare environment can't
// observe "passed the gate" without either a real network call or reordering
// the route. Left uncovered rather than faked.
//
// Spec: docs/superpowers/specs/2026-08-05-account-wall-and-how-it-works-landing-design.md

const test = require("node:test");
const assert = require("node:assert");
const { boot } = require("./helpers/boot");

// --- The lever ------------------------------------------------------------

// The POST /api/comps handler in server.js checks for a missing
// ANTHROPIC_API_KEY (the `if (!API_KEY)` guard right after the address/type
// validation) BEFORE it calls guestGateFor(), so a bare environment answers
// 500 and the gate is never observed. A syntactically plausible fake key gets
// past that check; the gate then returns 403 before any Anthropic call, so a
// passing test still costs nothing and touches no network. If the gate ever
// regresses, the request fails upstream on an invalid key rather than
// spending anything — which is the failure mode you want in a test suite.
const FAKE_KEY = "sk-ant-not-a-real-key";

test("the wall forces the guest search limit to zero", async (t) => {
  // GUEST_SEARCH_LIMIT deliberately set to something generous: the point is
  // that the wall overrides it rather than trusting two env vars to agree.
  const srv = await boot({ ACCOUNT_WALL: "on", GUEST_SEARCH_LIMIT: "5", ANTHROPIC_API_KEY: FAKE_KEY });
  t.after(() => srv.stop());

  await t.test("/api/config reports the wall and a zero limit", async () => {
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.accountWall, true);
    assert.equal(cfg.guestSearch.limit, 0, "GUEST_SEARCH_LIMIT=5 must not survive the wall");
  });

  await t.test("an anonymous report search is refused", async () => {
    const r = await fetch(srv.base + "/api/comps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "123 Main St, Boise, ID", type: "Industrial" }),
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    // The client keys off this flag, never off the status code.
    assert.equal(j.signin_required, true);
  });
});

test("the rollback lever restores the configured guest limit", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "5" });
  t.after(() => srv.stop());

  await t.test("/api/config reports no wall and the real limit", async () => {
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.accountWall, false);
    assert.equal(cfg.guestSearch.limit, 5);
  });
});

// --- Routing --------------------------------------------------------------

// The routing layer decides on cookie PRESENCE, never on a validated session:
// getSessionUser() reads the database and this route runs on every page view.
const FAKE_SESSION = { cookie: "cn_session=not-a-real-token" };

test("the wall serves the landing page at the root", async (t) => {
  // Fake key for the same reason as above: the forged-cookie subtest below
  // needs /api/comps to get past its missing-key check and reach the gate.
  const srv = await boot({ ACCOUNT_WALL: "on", ANTHROPIC_API_KEY: FAKE_KEY });
  t.after(() => srv.stop());

  const get = (p, headers) =>
    fetch(srv.base + p, { redirect: "manual", headers: headers || {} });

  // What tells the two HTML bodies apart: only the app carries the comp form,
  // only the landing page carries the signup hero CTA.
  const isApp = (html) => html.includes('id="compForm"');
  const isLanding = (html) => html.includes('class="heroCta"');

  await t.test("/ answers 200 with the landing content, not a redirect", async () => {
    // The root domain is the site's strongest URL, and Search Console showed
    // Google never crawled the 302's target — so the wall RENDERS here now.
    for (const p of ["/", "/index.html", "/?utm_source=newsletter"]) {
      const r = await get(p);
      assert.equal(r.status, 200, p + " must be a real page for an anonymous visitor");
      const html = await r.text();
      assert.ok(isLanding(html), p + " should carry the landing content");
      assert.ok(!isApp(html), p + " must not leak the app to an anonymous visitor");
      // What lives at / depends on auth state; a cached copy would survive
      // the visitor signing in.
      assert.match(r.headers.get("cache-control") || "", /no-store/, p + " must not be cached");
    }
  });

  await t.test("the anonymous root canonicalizes to itself and carries the product's structured data", async () => {
    const html = await (await get("/")).text();
    assert.match(html, /<link rel="canonical" href="[^"]*\/"\/>/, "canonical must be the bare root");
    assert.match(html, /"@type":"WebApplication"/, "the crawler-facing product entity now lives at /");
  });

  await t.test("/how-it-works canonicalizes to / while the wall is up", async () => {
    // Same content at two URLs; the signals must consolidate on ONE.
    const html = await (await get("/how-it-works")).text();
    assert.match(html, /<link rel="canonical" href="[^"]*\/"\/>/,
      "under the wall this page is a duplicate of / and must say so");
  });

  await t.test("/desk still redirects, to the front door at /", async () => {
    for (const p of ["/desk", "/desk?checkout=success"]) {
      const r = await get(p);
      assert.equal(r.status, 302, p + " is a personal workspace with no anonymous rendering");
      assert.equal(r.headers.get("location"), "/", p + " should land on the front door");
      assert.match(r.headers.get("cache-control") || "", /no-store/, p + " redirect must not be cached");
    }
  });

  await t.test("shared reports stay public", async () => {
    const r = await get("/r/abc123");
    assert.equal(r.status, 200, "a shared link is the whole point of the share feature");
    assert.ok(isApp(await r.text()), "a shared link renders in the app, not the landing page");
  });

  await t.test("the auth door serves the app", async () => {
    // Without this the signup buttons on the landing page point straight back
    // at it, and there is no way to reach the account modal.
    for (const p of ["/?auth=signup", "/?auth=signin"]) {
      const r = await get(p);
      assert.equal(r.status, 200, p + " must serve index.html");
      assert.ok(isApp(await r.text()), p + " must serve the APP — a 200 alone no longer proves that");
    }
    // Anything else in that parameter is not a door.
    const r = await get("/?auth=whatever");
    assert.equal(r.status, 200);
    assert.ok(isLanding(await r.text()), "a junk auth value gets the landing page, not the app");
  });

  await t.test("a session cookie is enough to reach the app", async () => {
    const r = await get("/", FAKE_SESSION);
    assert.equal(r.status, 200);
    assert.ok(isApp(await r.text()));
  });

  await t.test("but a forged cookie still cannot search", async () => {
    // Presentation versus enforcement: the routing layer is deliberately
    // cheap and fooled by any cookie; /api/comps is where the wall is real.
    const r = await fetch(srv.base + "/api/comps", {
      method: "POST",
      headers: { "content-type": "application/json", ...FAKE_SESSION },
      body: JSON.stringify({ address: "123 Main St, Boise, ID", type: "Industrial" }),
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).signin_required, true);
  });

  await t.test("the public pages are untouched", async () => {
    for (const p of ["/how-it-works", "/markets", "/brokers", "/terms", "/privacy", "/healthz"]) {
      assert.equal((await get(p)).status, 200, p + " must stay public");
    }
  });

  await t.test("the sitemap lists / and not its duplicate", async () => {
    const xml = await (await fetch(srv.base + "/sitemap.xml")).text();
    assert.match(xml, /<loc>[^<]*\/<\/loc>/, "/ is a real 200 now and the strongest URL the site has");
    assert.ok(!/how-it-works/.test(xml),
      "under the wall /how-it-works canonicalizes to /; listing a self-declared duplicate is a soft error");
  });
});

test("with the wall off the app is open again", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());

  await t.test("/ serves the app to an anonymous visitor", async () => {
    const r = await fetch(srv.base + "/", { redirect: "manual" });
    assert.equal(r.status, 200);
  });

  await t.test("the sitemap lists both / and /how-it-works again", async () => {
    const xml = await (await fetch(srv.base + "/sitemap.xml")).text();
    assert.match(xml, /<loc>[^<]*\/<\/loc>/, "with no wall, / is the app's landing page again");
    assert.match(xml, /how-it-works/, "with no wall, /how-it-works is its own page again");
  });

  await t.test("/how-it-works canonicalizes to itself again", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    assert.match(html, /<link rel="canonical" href="[^"]*\/how-it-works"\/>/,
      "with / serving the app, this page is no duplicate and keeps its own canonical");
  });
});

// --- The front door -------------------------------------------------------

// --- Signed-in visitors ----------------------------------------------------

// /how-it-works is linked from inside the signed-in app (header nav, footer),
// and it used to render the same signed-out chrome for everyone — "Log in" /
// "Create account" — which read as having been logged out mid-session. The
// page now swaps its auth chrome on cookie PRESENCE, the wall's own rule:
// cheap, no DB read, and a forged cookie buys the sight of different buttons
// and nothing else.
test("/how-it-works does not read as logged out to a signed-in visitor", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("a session cookie swaps the signup chrome for app links", async () => {
    const html = await (await fetch(srv.base + "/how-it-works", { headers: FAKE_SESSION })).text();
    assert.ok(!/href="\/\?auth=signup"/.test(html), "a signed-in visitor must not be told to create an account");
    assert.ok(!/href="\/\?auth=signin"/.test(html), "nor to log in — that chrome is what read as being logged out");
    assert.match(html, /href="\/desk"/, "the header should lead back into the app instead");
  });

  await t.test("the signed-in variant is never cached", async () => {
    const r = await fetch(srv.base + "/how-it-works", { headers: FAKE_SESSION });
    assert.match(r.headers.get("cache-control") || "", /no-store/,
      "a cached signed-in copy would outlive a sign-out");
  });

  await t.test("the anonymous variant still caches, but varies on the cookie", async () => {
    const r = await fetch(srv.base + "/how-it-works");
    assert.match(r.headers.get("cache-control") || "", /max-age/, "the SEO-facing page keeps its hour cache");
    assert.match((r.headers.get("vary") || "").toLowerCase(), /cookie/,
      "without this, the hour-old signed-out copy survives signing in");
  });
});

test("/how-it-works carries the signup controls", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("both auth doors are linked", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    assert.match(html, /href="\/\?auth=signup"/, "a visitor sent here must be able to create an account");
    assert.match(html, /href="\/\?auth=signin"/, "and an existing customer must be able to log in");
  });

  await t.test("nothing on the page links back into a redirect", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    // The closing CTA used to point at "/", which under the wall bounces the
    // visitor straight back to the page they are standing on.
    assert.ok(!/class="btn"\s+href="\/"/.test(html), "no button may point at the walled app root");
    assert.ok(!/Run a free report/.test(html), "the old CTA copy is gone with it");
  });

  await t.test("the redundant top kicker is gone", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    assert.ok(!/class="kicker">How it works</.test(html), "the page IS the front door; it need not label itself");
    assert.match(html, /class="kicker">Method</, "the other section kickers stay");
  });

  await t.test("it carries the product's structured data", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    // It moved off index.html, which no crawler reaches under the wall.
    assert.match(html, /"@type":"WebApplication"/);
    assert.match(html, /"@type":"FAQPage"/, "the FAQ markup that was already here must survive");
  });
});

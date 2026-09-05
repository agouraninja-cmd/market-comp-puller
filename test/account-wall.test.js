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

// These boots pin SEARCH_PROVIDER explicitly rather than riding the default.
// The default is gemini as of 2026-08-10, and the missing-key guard now names
// whichever provider is active, so a bare ANTHROPIC_API_KEY would no longer get
// past it. Pinning the provider keeps the fake key meaningful and keeps these
// tests independent of a default that is a product decision, not their subject.

test("the wall forces the guest search limit to zero", async (t) => {
  // GUEST_SEARCH_LIMIT deliberately set to something generous: the point is
  // that the wall overrides it rather than trusting two env vars to agree.
  const srv = await boot({ ACCOUNT_WALL: "on", GUEST_SEARCH_LIMIT: "5", SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_KEY });
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
  const srv = await boot({ ACCOUNT_WALL: "on", SEARCH_PROVIDER: "anthropic", ANTHROPIC_API_KEY: FAKE_KEY });
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

  // RETIRED 2026-09-02. This subtest has now been rewritten twice for the same
  // URL and the history is worth keeping: /how-it-works canonicalized to `/`
  // for the whole life of the wall (they were one render), then to itself on
  // 2026-09-01 when `/` became design 3a, and now it is gone. What replaces
  // the canonical question is a REDIRECT question — the URL is in the wild
  // and must keep resolving to something.
  await t.test("/how-it-works is a permanent redirect, not a page and not a 404", async () => {
    const res = await get("/how-it-works");   // the helper never follows redirects
    assert.equal(res.status, 301, "301 so the ranking it earned transfers");
    assert.equal(res.headers.get("location"), "/brokers-firms",
      "it lands on the audience page that absorbed it");
    // And it is really gone, not merely relabelled: the page it points at must
    // not be a second copy of the home page either.
    const home = await (await get("/")).text();
    assert.ok(isLanding(home), "/ is the home page");
  });

  // The header's Home link (2026-08-28) must not point at the page drawing it.
  // `/` is the only page that rule reaches now: until 2026-09-01 /how-it-works
  // WAS this render, so it was a self-link there too, and it no longer is.
  await t.test("the anonymous root offers no Home link back to itself", async () => {
    const html = await (await get("/")).text();
    assert.ok(!html.includes(`<a href="/">Home</a>`),
      "/ is the home page under the wall and must not link back to it");
    // The link is not simply missing everywhere: a page that is not home has it.
    const markets = await (await get("/markets")).text();
    assert.ok(markets.includes(`<nav><a href="/">Home</a><details>`),
      "/markets is where a walled visitor most needs the way back");
  });

  // The wall's sixth door (2026-09-04). Unlike ?auth=, ?submit=comp,
  // ?pricing=1 and ?settings=1 this one is a PATH, and it is the only door the
  // chrome itself links: /run-report is a row in the signed-out Tools menu, so
  // a stranger is invited through it. Answering "Run a report" with the page
  // that argues you should run reports is the /desk-to-marketing-copy mistake
  // of 2026-08-13 pointed the other way.
  await t.test("/run-report is a door through the wall, not a bounce to the landing page", async () => {
    const r = await get("/run-report");
    assert.equal(r.status, 200, "the door must not redirect");
    const html = await r.text();
    assert.ok(isApp(html), "a stranger who clicked Run a report is owed the app, not the pitch");
    assert.ok(!isLanding(html), "the landing page is what this door exists to avoid");
    // And the door is a door, not a hole. The app's own account-wall card is
    // what stands where the form is; ENFORCEMENT never moved (the wall forces
    // GUEST_SEARCH_LIMIT to 0 and /api/comps still refuses), so the assertion
    // that matters is that the card SHIPS, which is what applySearchLock
    // reveals for a visitor with no session.
    assert.match(html, /id="searchLock"/,
      "the app arrived with no wall card, so an anonymous visitor is shown a form that cannot run");
    // A second copy of the home page's bytes at a second URL, and index.html
    // declares its canonical as `/`. Left indexable that is a self-declared
    // duplicate, the soft error the sitemap comment names.
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/,
      "/run-report is index.html at a second URL and must not be offered to a crawler");
  });

  // The finder's URL was a Tools row for one day and the owner took it out the
  // same evening (2026-09-04): Bulk valuation is the comp-report tool, and a
  // second "Run a report" door was two doors to one act. The route above
  // stays (bulk-page.js links it as the full single-property form), but NO
  // nav points at it — asked of a server-rendered page because index.html has
  // no dropdown of its own, and of the whole nav rather than the menus alone
  // so a row cannot come back either.
  await t.test("Run a report is no longer a Tools entry; the door stays unadvertised", async () => {
    const html = await (await get("/markets")).text();
    const nav = (html.match(/<nav[\s\S]*?<\/nav>/) || [""])[0];
    assert.ok(!/run-report/.test(nav),
      "a /run-report link is back in the nav — Bulk valuation is the comp-report tool");
    const menus = (nav.match(/<div class="dd">[\s\S]*?<\/div>/g) || []).join("");
    // [^>]* because on /markets itself the row carries class="on" aria-current.
    assert.match(menus, /<a href="\/markets"[^>]*>Market explorer<\/a>/,
      "the stranger's Tools menu still opens on Market explorer");
  });

  // This pair of assertions moved to /brokers-firms on 2026-09-02, when
  // /how-it-works was retired. The rule is unchanged and is worth keeping
  // under test on SOME page that is neither `/` nor the workspace: an
  // anonymous visitor is owed the way back to the home page, and a member is
  // owed Workspace in its place (the 2026-08-28 bug was a member left with
  // neither).
  await t.test("a visitor gets Home on a public page, a member gets Workspace", async () => {
    const anon = await (await get("/brokers-firms")).text();
    assert.ok(anon.includes(`<nav><a href="/">Home</a><details>`),
      "a public page is not `/`, so a visitor is owed the way back to it");

    const member = await (await get("/brokers-firms", FAKE_SESSION)).text();
    assert.ok(!member.includes(`<a href="/">Home</a>`),
      "a member's / is the workspace, and the nav carries Workspace instead");
    assert.match(member, /<a href="\/desk">Workspace<\/a>/,
      "the member is not left without a way back — that was the 2026-08-28 bug");
  });

  await t.test("/desk still redirects, to the sign-in door", async () => {
    // The wall's rule is that a personal workspace never renders anonymously,
    // and that has not changed. Where it sends them did (2026-08-13): asking
    // for /desk is asking for your own account, so the answer is the sign-in
    // modal, not the marketing page. It used to be "/", which told somebody
    // who already had an account to go read about the product — visible the
    // moment the watchlist digest started linking to /desk from email.
    //
    // ?auth=signin is not a new door: the case below proves it serves the app
    // so the account modal has somewhere to live.
    for (const p of ["/desk", "/desk?checkout=success"]) {
      const r = await get(p);
      assert.equal(r.status, 302, p + " is a personal workspace with no anonymous rendering");
      assert.equal(r.headers.get("location"), "/?auth=signin", p + " should land on the sign-in door");
      assert.match(r.headers.get("cache-control") || "", /no-store/, p + " redirect must not be cached");
    }
  });

  await t.test("that redirect target actually serves the app", async () => {
    // The two halves are only correct together: a redirect to a door that
    // bounced back to the landing page would be a loop, and the loop would
    // look exactly like the bug this replaced.
    const r = await get("/?auth=signin");
    assert.equal(r.status, 200);
    assert.ok(isApp(await r.text()), "the sign-in door must serve the app, not the landing page");
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
    for (const p of ["/markets", "/brokers-firms", "/terms", "/privacy", "/healthz", "/faq", "/pricing"]) {
      assert.equal((await get(p)).status, 200, p + " must stay public");
    }
    // /how-it-works left this list on 2026-09-02 — retired, and a 301 rather
    // than a 200. It must still be reachable WITHOUT a session, though: the
    // wall exempting a page and then the redirect target sitting behind it
    // would be a redirect to a lock screen for every old inbound link.
    const gone = await get("/how-it-works");
    assert.equal(gone.status, 301, "the retired page redirects for a stranger too");
    assert.equal((await get(gone.headers.get("location"))).status, 200,
      "and the page it redirects to is itself public");
  });

  // /how-it-works was listed here for exactly one day. It was omitted for the
  // wall's whole life (it canonicalized to `/`, and a self-declared duplicate
  // in a sitemap is a Search Console soft error), listed on 2026-09-01 when it
  // became its own document, and REMOVED on 2026-09-02 when it was retired —
  // a sitemap must never list a URL that redirects, the rule /brokers and
  // /firms came out under the day before.
  await t.test("the sitemap lists the pages that exist, and not the retired one", async () => {
    const xml = await (await fetch(srv.base + "/sitemap.xml")).text();
    assert.match(xml, /<loc>[^<]*\/<\/loc>/, "/ is a real 200 now and the strongest URL the site has");
    assert.match(xml, /<loc>[^<]*\/faq<\/loc>/, "and so is the FAQ");
    assert.ok(!/how-it-works/.test(xml), "a sitemap must not list a URL that 301s");
  });
});

test("with the wall off the app is open again", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "off" });
  t.after(() => srv.stop());

  await t.test("/ serves the app to an anonymous visitor", async () => {
    const r = await fetch(srv.base + "/", { redirect: "manual" });
    assert.equal(r.status, 200);
  });

  await t.test("the sitemap is the same list with the wall off", async () => {
    const xml = await (await fetch(srv.base + "/sitemap.xml")).text();
    assert.match(xml, /<loc>[^<]*\/<\/loc>/, "with no wall, / is the app's landing page again");
    assert.ok(!/how-it-works/.test(xml), "the retired page stays out in both wall states");
  });

  await t.test("the retired page redirects in both wall states", async () => {
    // The wall used to decide what /how-it-works WAS; it must not decide
    // whether the redirect happens. An old inbound link has to land the same
    // way whichever state the deployment is in.
    const r = await fetch(srv.base + "/how-it-works", { redirect: "manual" });
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "/brokers-firms");
  });
});

// --- The front door -------------------------------------------------------

// --- Signed-in visitors ----------------------------------------------------

// The /how-it-works chrome-swap suite lived here until 2026-09-02. It pinned
// three things about that page: that a signed-in visitor got app chrome
// instead of signup buttons, that the signed-in variant was `no-store`, and
// that the anonymous one carried `vary: cookie` alongside its hour cache.
// The page was RETIRED and 301s to /brokers-firms, so there is nothing left
// to swap. The rule itself is not lost: every surviving server-rendered page
// goes through marketShell, and test/routes.test.js pins the same chrome swap
// across all of them. If a second hand-rolled shell ever appears, restore
// this suite from git history — the `vary: cookie` half is the one that is
// easy to forget, and its absence re-serves an hour-old signed-out page to
// somebody who has just created an account.

// The signup-controls suite for that page went with it on the same day.


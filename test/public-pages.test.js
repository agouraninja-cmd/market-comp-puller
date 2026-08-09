// The public, server-rendered pages: their shared chrome, their conversion
// paths, and the copy that has to agree with what the product actually sells.
//
// Run: npm test
//
// Cost: zero. Every server here boots with no Anthropic key, no Supabase and
// no Stripe; each route under test is a pure render with no upstream call.
//
// These four behaviors were each a live defect on compninja.co on 2026-08-08,
// found by auditing the deployment rather than the code, which is why the
// assertions are written against what a VISITOR receives (links, copy,
// headers) and not against internal helpers.

const test = require("node:test");
const assert = require("node:assert");
const { boot } = require("./helpers/boot");

// The shared chrome is served to logged-out and logged-in visitors alike, so
// both states have to be exercised on every page that carries it. Presence is
// the whole rule (see CLAUDE.md on /how-it-works): the routing layer never
// validates the token, it only looks.
const SESSION = { cookie: "cn_session=not-a-real-token" };

// The market page under test must come from the COMMITTED market-seed.json,
// never from a slug that happens to exist on the dev machine. The original
// hardcoded industrial-boise-id, which lives only in the git-ignored
// market-pages-dynamic.json on the machine that wrote the test — so the suite
// passed locally and failed on Render's fresh disk, which (deploy-gated on
// the tests) blocked every deploy behind it. Deriving the slug from the seed
// keeps the fixture hermetic; the CTA test below also needs it industrial.
const MARKET_SLUG = Object.keys(require("../market-seed.json")).find((s) => s.startsWith("industrial-"));
const MARKET_PAGE = "/market/" + MARKET_SLUG;

// Every page that renders through marketShell(). /broker/<slug> is omitted: it
// needs a database to resolve a profile and 404s without one.
const SHELL_PAGES = ["/markets", MARKET_PAGE, "/brokers", "/1031-exchange", "/terms", "/privacy"];

test("the public pages let a visitor sign in", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  const get = (p, headers) => fetch(srv.base + p, { headers: headers || {} });

  await t.test("every shell page offers both auth doors to an anonymous visitor", async () => {
    // These pages ARE the site's entry points from Google. Before this, none
    // of them carried a single sign-in control, so a returning customer who
    // landed on a market page had nowhere to click.
    for (const p of SHELL_PAGES) {
      const html = await (await get(p)).text();
      assert.match(html, /href="\/\?auth=signin"/, p + " must let a returning customer log in");
      assert.match(html, /href="\/\?auth=signup"/, p + " must let a new visitor create an account");
    }
  });

  await t.test("a signed-in visitor is never told to create an account", async () => {
    // The /how-it-works bug, which lives in the shared bar too: static signup
    // chrome shown to a member reads as having been logged out mid-session.
    for (const p of SHELL_PAGES) {
      const html = await (await get(p, SESSION)).text();
      assert.ok(!/href="\/\?auth=signup"/.test(html), p + " must not push signup at a member");
      assert.ok(!/href="\/\?auth=signin"/.test(html), p + " must not push sign-in at a member");
      assert.match(html, /href="\/desk"/, p + " should lead a member back into the app");
    }
  });

  await t.test("the caching keeps the two variants honest", async () => {
    // Exactly the rule CLAUDE.md records for /how-it-works. The `vary` looks
    // redundant on a static body and is not: without it the hour-old
    // signed-out copy is re-served after signing in, so the people who just
    // created an account are the ones still told to create one.
    for (const p of SHELL_PAGES) {
      const anon = await get(p);
      assert.match(anon.headers.get("cache-control") || "", /max-age/, p + " stays cacheable for crawlers");
      assert.match((anon.headers.get("vary") || "").toLowerCase(), /cookie/, p + " must vary on the cookie");

      const member = await get(p, SESSION);
      assert.match(member.headers.get("cache-control") || "", /no-store/,
        p + " signed-in variant must not outlive a sign-out");
    }
  });
});

test("the broker contribution path is not a dead end", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("/brokers points its CTA at a door the wall actually opens", async () => {
    // It used to link /#submit-comp. Under the wall an anonymous visitor at /
    // gets the landing page, which has no comp-submission modal and no such
    // anchor, so the broker page's single most important button did nothing
    // at all. Broker-contributed comps are the whole verified-comp layer.
    const html = await (await fetch(srv.base + "/brokers")).text();
    assert.ok(!/href="\/#submit-comp"/.test(html),
      "a bare hash link cannot survive the wall, which decides before the fragment is ever sent");
    assert.match(html, /href="\/\?submit=comp"/, "the CTA needs a query the wall can see");
  });

  await t.test("that door serves the app, not the landing page", async () => {
    const r = await fetch(srv.base + "/?submit=comp", { redirect: "manual" });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /id="compForm"/, "the comp-submission modal lives only in index.html");
    assert.ok(!/class="heroCta"/.test(html), "serving the landing page here is the bug, not the fix");
  });

  await t.test("an unrecognized submit value is not a door", async () => {
    // Same discipline as ?auth=: the exemption is an allowlist of one value,
    // never "any submit parameter", or it becomes a way around the wall.
    const html = await (await fetch(srv.base + "/?submit=whatever")).text();
    assert.match(html, /class="heroCta"/, "junk gets the landing page");
    assert.ok(!/id="compForm"/.test(html), "and must not leak the app");
  });
});

test("the cost answer matches what the product actually sells", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  // HOW_FAQ feeds BOTH the visible accordions and the FAQPage JSON-LD, so a
  // stale answer here is not merely on-page copy: Google can serve it as the
  // answer about this product. It claimed "there is no subscription" while
  // $129/mo Pro, a $990/yr founding plan and a $20 report unlock were all
  // live and buyable.
  const pages = ["/", "/how-it-works"];

  await t.test("it no longer denies the subscription that exists", async () => {
    for (const p of pages) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(!/there is no subscription/i.test(html), p + " must not deny a plan that is on sale");
      assert.ok(!/We only ask for your contact details when you export/i.test(html),
        p + " must not promise anonymity the account wall does not allow");
    }
  });

  await t.test("it still leads with the free tier, because that is true", async () => {
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    assert.match(html, /free/i, "reports genuinely are free with an account; that is the offer");
  });

  await t.test("the answer is carried into the FAQ structured data too", async () => {
    // One array, two surfaces. If they ever diverge, the invisible one is the
    // one that reaches search results.
    const html = await (await fetch(srv.base + "/how-it-works")).text();
    const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    assert.ok(ld, "the page must still emit structured data");
    const graph = JSON.parse(ld[1])["@graph"];
    const faq = graph.find((n) => n["@type"] === "FAQPage");
    assert.ok(faq, "FAQPage node must survive the copy edit");
    const costQ = faq.mainEntity.find((q) => /cost/i.test(q.name));
    assert.ok(costQ, "the cost question must still be answered");
    assert.ok(!/no subscription/i.test(costQ.acceptedAnswer.text),
      "the structured-data copy is the half that reaches Google");
  });
});

test("the market page CTA carries the market a visitor is reading", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("the primary button is at least as smart as the link below it", async () => {
    // The loudest CTA was a bare href="/", which under the wall answers with
    // a generic explainer: the visitor asks to value their building and gets
    // another marketing page. The secondary link beneath it already carried
    // the market and type, so the pattern existed and the big button ignored
    // it.
    const html = await (await fetch(srv.base + MARKET_PAGE)).text();
    const ctas = [...html.matchAll(/<a class="btn" href="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(ctas.length > 0, "the market page must still have a primary CTA");
    for (const href of ctas) {
      assert.ok(href !== "/", "a bare / bounces an anonymous visitor back into marketing");
      assert.match(href, /auth=signup/, "the CTA must open a door the wall honors");
      assert.match(href, /type=Industrial/, "and must carry the type the visitor was reading about");
    }
  });

  await t.test("a signed-in visitor is not shown a signup CTA either", async () => {
    const html = await (await fetch(srv.base + MARKET_PAGE, { headers: SESSION })).text();
    const ctas = [...html.matchAll(/<a class="btn" href="([^"]*)"/g)].map((m) => m[1]);
    for (const href of ctas) {
      assert.ok(!/auth=signup/.test(href), "a member already has an account: " + href);
    }
  });
});

test("a lost visitor gets a page, not a bare string", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  // Market slugs are indexed and explorer-generated pages come and go, so a
  // stale Google result is a normal arrival, not an edge case. It used to be
  // answered with text/plain "Market not found" — an unbranded white page
  // with no way anywhere.
  await t.test("a dead market slug still answers 404, but as a branded page", async () => {
    const r = await fetch(srv.base + "/market/industrial-nowhere-zz");
    assert.equal(r.status, 404, "the status code is load-bearing for crawlers; never soften it");
    assert.match(r.headers.get("content-type") || "", /text\/html/);
    const html = await r.text();
    assert.match(html, /CompNinja/, "the page should still look like the site");
    assert.match(html, /href="\/markets"/, "a dead market page should point at the live ones");
    assert.match(html, /noindex/, "a 404 page must never be indexed");
  });

  await t.test("the catch-all serves the same page for lost GETs", async () => {
    const r = await fetch(srv.base + "/definitely-not-a-page");
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") || "", /text\/html/);
    assert.match(await r.text(), /href="\/"/, "there must be a way home");
  });

  await t.test("machine surfaces stay plain", async () => {
    // API callers parse bodies; an HTML page where an error string used to be
    // is a regression for them. POSTs and /api/* keep the old shape.
    const api = await fetch(srv.base + "/api/definitely-not-a-route");
    assert.match(api.headers.get("content-type") || "", /text\/plain/, "/api/* stays text");
    const post = await fetch(srv.base + "/definitely-not-a-page", { method: "POST" });
    assert.equal(post.status, 404);
    assert.match(post.headers.get("content-type") || "", /text\/plain/, "non-GET stays text");
  });

  await t.test("admin endpoints still deny their own existence", async () => {
    // The camouflage rule from routes.test.js, re-checked here because THIS
    // change is the one most likely to break it: with no ADMIN_KEY, gated
    // routes answer a plain 404 indistinguishable from a missing route.
    const r = await fetch(srv.base + "/api/stats");
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type") || "", /text\/plain/);
  });
});

test("the landing stats tell the truth in both directions", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  // "3–6 cited comps" undersold the product (the model is asked for up to 12
  // and dense markets deliver them), and "~40s" oversold it (the model alone
  // spends 40–70s writing; a full search runs longer). A first search that
  // takes double the promised time costs trust at the exact moment the
  // product is proving itself.
  await t.test("the old numbers are gone from both pages", async () => {
    for (const p of ["/", "/how-it-works"]) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(!/3&ndash;6/.test(html), p + " must not undersell the comp count");
      assert.ok(!/~40s/.test(html), p + " must not promise a 40-second report");
    }
  });

  await t.test("the replacements match what the product does", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.match(html, /Up to 12/, "the comp ask is 12; say so");
    assert.match(html, /minute/i, "a minute is the honest unit for a live search");
  });
});

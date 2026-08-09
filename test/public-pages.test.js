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

// Every page that renders through marketShell(). /broker/<slug> is omitted: it
// needs a database to resolve a profile and 404s without one.
const SHELL_PAGES = ["/markets", "/market/industrial-boise-id", "/brokers", "/1031-exchange", "/terms", "/privacy"];

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
    const html = await (await fetch(srv.base + "/market/industrial-boise-id")).text();
    const ctas = [...html.matchAll(/<a class="btn" href="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(ctas.length > 0, "the market page must still have a primary CTA");
    for (const href of ctas) {
      assert.ok(href !== "/", "a bare / bounces an anonymous visitor back into marketing");
      assert.match(href, /auth=signup/, "the CTA must open a door the wall honors");
      assert.match(href, /type=Industrial/, "and must carry the type the visitor was reading about");
    }
  });

  await t.test("a signed-in visitor is not shown a signup CTA either", async () => {
    const html = await (await fetch(srv.base + "/market/industrial-boise-id", { headers: SESSION })).text();
    const ctas = [...html.matchAll(/<a class="btn" href="([^"]*)"/g)].map((m) => m[1]);
    for (const href of ctas) {
      assert.ok(!/auth=signup/.test(href), "a member already has an account: " + href);
    }
  });
});

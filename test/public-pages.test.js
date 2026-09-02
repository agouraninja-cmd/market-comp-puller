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
const MARKETHERO = require("../market-hero");

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
const MARKET = require("../market-seed.json")[MARKET_SLUG];

// Every page that renders through marketShell(). /broker/<slug> is omitted: it
// needs a database to resolve a profile and 404s without one.
const SHELL_PAGES = ["/markets", MARKET_PAGE, "/brokers-firms", "/1031-exchange", "/terms", "/privacy"];

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

  await t.test("/brokers-firms points its submit door at a door the wall opens", async () => {
    // It used to link /#submit-comp. Under the wall an anonymous visitor at /
    // gets the landing page, which has no comp-submission modal and no such
    // anchor, so the broker page's single most important link did nothing at
    // all. Broker-contributed comps are the whole verified-comp layer.
    //
    // The door SURVIVED the 2026-09-01 merge on purpose. Design 4a drew no
    // submission link, and /brokers-firms is the only public page that offers
    // one, so implementing the design literally would have retired the
    // funnel's only public entrance. It moved into the closing band instead
    // (owner's call) — smaller, but present.
    const html = await (await fetch(srv.base + "/brokers-firms")).text();
    assert.ok(!/href="\/#submit-comp"/.test(html),
      "a bare hash link cannot survive the wall, which decides before the fragment is ever sent");
    assert.match(html, /href="\/\?submit=comp"/, "the door needs a query the wall can see");
    assert.equal((html.match(/href="\/\?submit=comp"/g) || []).length, 1,
      "exactly one Submit door");
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

  // faq-page.js's FAQ feeds BOTH the visible blocks and the FAQPage JSON-LD,
  // so a stale answer here is not merely on-page copy: Google can serve it as
  // the answer about this product. It claimed "there is no subscription"
  // while $129/mo Pro, a $990/yr founding plan and a $20 report unlock were
  // all live and buyable.
  //
  // The pages under test moved on 2026-09-01. This used to read `/` and
  // /how-it-works, which were one render carrying nine accordions; the
  // questions are /faq now and neither of those pages shows an FAQ. Every
  // assertion below is unchanged in what it protects — only the URL moved.
  const pages = ["/faq"];

  await t.test("it no longer denies the subscription that exists", async () => {
    for (const p of pages) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(!/there is no subscription/i.test(html), p + " must not deny a plan that is on sale");
      assert.ok(!/We only ask for your contact details when you export/i.test(html),
        p + " must not promise anonymity the account wall does not allow");
    }
  });

  // The same failure mode from the other direction: on 2026-08-21 the free
  // tier went to every-comp and the $20 one-off was retired, and this page —
  // the landing page under the wall, whose answers Google serves as facts —
  // spent the day still selling both. The price answer must never promise a
  // free comp limit that no longer exists or a product that cannot be bought.
  await t.test("it no longer sells the retired $20 unlock or a free comp limit", async () => {
    for (const p of pages) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(!/itemizes ten comps/i.test(html),
        p + " must not claim a ten-comp free limit; FREE_MAX_COMPS is \"all\"");
      assert.ok(!/unlocks on its own for \$20/i.test(html) && !/single report unlocks/i.test(html),
        p + " must not sell the single-report unlock; it was retired 2026-08-21");
      // The wording moved again on 2026-09-02, when ten answers became six and
      // "What exactly do I get from a report?" was folded away. What is pinned
      // is the same thing it always was, and deliberately not one phrasing of
      // it: the page must say what the free tier ACTUALLY is rather than going
      // vague, and it must name the free window, because both are what stop
      // this answer drifting back into a promise the code does not keep.
      assert.ok(/runs a full report on any commercial address/i.test(html),
        p + " should state the real free tier, not go vague about it");
      assert.ok(/three[- ]year lookback|three years back/i.test(html),
        p + " should name the free lookback; FREE_MAX_LOOKBACK_MONTHS is 36");
    }
  });

  // The third time this answer has needed pinning against reality, and the
  // first about the PRICE. PRO-BILLING-SETUP.md has warned since 2026-07-31
  // that the monthly figure is hard-coded in the pricing modal while the
  // actual charge comes from a Stripe price ID, so "nothing catches a drift"
  // — and on 2026-08-25 the price moved $129 -> $100, which meant editing the
  // modal, the compare table and this answer in one go.
  //
  // Stripe cannot be reached from here, so this pins the two IN-REPO copies to
  // each other: whatever the modal's Pro tile charges per month, the FAQ
  // answer Google serves as a fact about this product must say the same. It
  // cannot catch both being wrong together; it does catch the likelier
  // failure, which is one being edited and the other forgotten.
  await t.test("the FAQ's monthly price is the pricing modal's monthly price", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

    // The Pro tile: the figure immediately followed by "per month".
    const tile = page.match(/<div class="pr-fig">\$([\d,]+)<\/div>\s*<div class="pr-per">per month/);
    assert.ok(tile, "the pricing modal's Pro monthly tile is gone or restructured — this pin is blind");

    for (const p of pages) {
      const html = await (await fetch(srv.base + p)).text();
      const said = html.match(/Individual Pro is \$([\d,]+) a month/);
      assert.ok(said, p + " no longer states a monthly price in the cost answer");
      assert.equal(said[1], tile[1],
        p + " quotes $" + said[1] + " a month while the pricing modal charges $" + tile[1]);
    }
  });

  // The 2026-08-12 rule, restated for where the pages went (2026-09-01).
  //
  // The original: a broker arriving at the landing page met one FAQ answer
  // and a link inside a closed dropdown, and the owner's read is that broker
  // relationships beat SEO as an acquisition lever, so the page every visitor
  // lands on should say what a professional gets and where to go.
  //
  // Design 3a keeps that and changes who it addresses: the home page's third
  // band is For firms rather than For brokers, and it closes on a link to
  // /brokers-firms — which since design 2a landed (2026-09-01) is the ONE page
  // both audiences share, so that link is the broker path as well as the firm
  // one. The 08-12 concern is answered by the band being in the body of the
  // page rather than only in a closed dropdown.
  //
  // The two concrete promises it pinned are both still public and both still
  // pinned below: the privacy trade in /faq's answer, and the Verified credit
  // on /brokers-firms and in the home page's own tile.
  await t.test("a professional arriving at the home page has a path, not just a dropdown", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.match(html, /For firms — Pro version/, "the home page should address a firm directly");
    assert.match(html, /href="\/brokers-firms"/, "and link to the page that sells to one");
    assert.match(html, /class="hmvault"/, "showing the vault it is selling, not only naming it");
  });

  await t.test("the privacy trade and the credit are still stated in public", async () => {
    const faq = await (await fetch(srv.base + "/faq")).text();
    assert.match(faq, /visible only to you[\s\S]{0,80}publish/i,
      "/faq should state the privacy trade plainly");
    // Wording changed with design 4a (2026-09-01) — /brokers and /firms merged
    // into /brokers-firms, which states the credit as one of exactly two exits
    // from the vault rather than as a ledger row. The PROMISE is the same and
    // is what is pinned: a published comp carries the green badge and the
    // firm's name on every report that uses it.
    const brokers = await (await fetch(srv.base + "/brokers-firms")).text();
    assert.match(brokers, /badge with your firm\S{0,6}s name on every report/i,
      "/brokers-firms should name the credit a broker actually receives");
    const home = await (await fetch(srv.base + "/")).text();
    assert.match(home, /carries your firm\S{0,6}s name on every report/i,
      "and the home page's Verified credit tile says the same thing");
  });

  // What is left of the old "brokers is not a Method clone" pin, which has now
  // outlived the page it was about. Method's three-up lived on
  // /how-it-works; that page was retired on 2026-09-02 and its stylesheet
  // deleted with it, so `.steps` exists nowhere. The half of the assertion
  // that still means something is the negative one — no public page may grow
  // a three-up-of-steps band, which is the layout every one of these pages has
  // been talked out of reusing at least once.
  await t.test("no public page reuses the retired Method three-up", async () => {
    const how = await fetch(srv.base + "/how-it-works", { redirect: "manual" });
    assert.equal(how.status, 301, "the methodology page is retired, not restyled");
    for (const p of ["/", "/faq", "/brokers-firms", "/pricing"]) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(!/class="steps"/.test(html), p + " must not reuse Method's three-up");
    }
  });

  await t.test("it still leads with the free tier, because that is true", async () => {
    const html = await (await fetch(srv.base + "/faq")).text();
    assert.match(html, /free/i, "reports genuinely are free with an account; that is the offer");
  });

  await t.test("the answer is carried into the FAQ structured data too", async () => {
    // One array, two surfaces. If they ever diverge, the invisible one is the
    // one that reaches search results.
    const html = await (await fetch(srv.base + "/faq")).text();
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

  // Every CTA door off a market page: primary <a class="btn"> links AND the
  // "value a property here" form (2026-08-20), whose data-dest is the URL it
  // navigates to after stashing the typed address for the search form.
  const ctaDoors = (html) => [
    ...[...html.matchAll(/<a class="btn" href="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<form class="vform" data-dest="([^"]*)"/g)].map((m) => m[1]),
  ];

  await t.test("the primary button is at least as smart as the link below it", async () => {
    // The loudest CTA was a bare href="/", which under the wall answers with
    // a generic explainer: the visitor asks to value their building and gets
    // another marketing page. The secondary link beneath it already carried
    // the market and type, so the pattern existed and the big button ignored
    // it. Since 2026-08-20 the loudest CTA is the vform, which carries the
    // ADDRESS as well — the same rules hold for its destination.
    const html = await (await fetch(srv.base + MARKET_PAGE)).text();
    const ctas = ctaDoors(html);
    assert.ok(ctas.length > 0, "the market page must still have a primary CTA");
    for (const href of ctas) {
      assert.ok(href !== "/", "a bare / bounces an anonymous visitor back into marketing");
      assert.match(href, /auth=signup/, "the CTA must open a door the wall honors");
      assert.match(href, /type=Industrial/, "and must carry the type the visitor was reading about");
    }
  });

  await t.test("a signed-in visitor is not shown a signup CTA either", async () => {
    const html = await (await fetch(srv.base + MARKET_PAGE, { headers: SESSION })).text();
    const ctas = ctaDoors(html);
    for (const href of ctas) {
      assert.ok(!/auth=signup/.test(href), "a member already has an account: " + href);
    }
    // The member's value-a-property door still carries the type it was read on.
    assert.match(html, /<form class="vform" data-dest="\/\?type=Industrial"/,
      "a member's vform lands straight on the prefilled search");
  });

  await t.test("the comps table is a research set, not only a teaser", async () => {
    const html = await (await fetch(srv.base + MARKET_PAGE)).text();
    assert.match(html, /id="mktComps"/, "the table must be addressable for sort/filter");
    const comps = MARKET.comps || [];
    const nSale = comps.filter((c) => !String(c.transaction || "").toLowerCase().startsWith("lease")).length;
    const nLease = comps.length - nSale;
    if (nSale && nLease) {
      assert.match(html, /id="mktTxBar"/, "a mixed sale/lease snapshot must offer a type filter");
    }
    const pricedLeases = comps.filter((c) =>
      String(c.transaction || "").toLowerCase().startsWith("lease") &&
      parseFloat(String(c.price_per_sqft || "").replace(/[^0-9.]/g, "")) > 0);
    if (pricedLeases.length >= 2) {
      assert.match(html, /Typical rent/, "two priced leases earn a rent cell without a regeneration");
    }
    const hasCap = comps.some((c) => String(c.cap_rate || "").trim());
    if (!hasCap) {
      assert.ok(!/data-k="cap_rate"/.test(html), "empty columns stay dropped");
    }
    assert.ok(!/id="mktWatch"/.test(html), "Watch is signed-in chrome, not on the cached SEO body");
    assert.ok(!/id="mktCsv"/.test(html), "CSV is signed-in chrome, not on the cached SEO body");
    assert.match(html, /Get my free valuation/, "anonymous visitors still get the owner CTA");
  });

  await t.test("a signed-in visitor gets Watch and CSV instead of the owner CTA", async () => {
    const html = await (await fetch(srv.base + MARKET_PAGE, { headers: SESSION })).text();
    assert.match(html, /id="mktWatch"/);
    assert.match(html, new RegExp(`data-market="${MARKET.city}, ${MARKET.state}"`));
    assert.match(html, /data-type="Industrial"/);
    assert.match(html, /id="mktCsv"/);
    assert.ok(!/Get my free valuation/.test(html), "the owner funnel is for anonymous SEO traffic");
    assert.match(html, /href="\/\?explore=/, "members skip the signup door on the Address Explorer link");
    assert.ok(!/javascript:/i.test(html), "no model-supplied script URL may land in the HTML");
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

test("the home page names the real search cost without a stat strip", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  // `/` and /how-it-works were one render until 2026-09-01 and this suite
  // asserted on both. They are two documents now, and the numbers below are
  // wrong on either of them, so both are still swept.
  await t.test("the old numbers are gone from both pages", async () => {
    for (const p of ["/", "/how-it-works"]) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(!/3&ndash;6/.test(html), p + " must not undersell the comp count");
      assert.ok(!/~40s/.test(html), p + " must not promise a 40-second report");
      assert.ok(!/Up to 12/.test(html), p + " must not cap the table at 12; nearby deals join it");
    }
  });

  await t.test("the replacements match what the product does", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.match(html, /minute/i, "a minute is the honest unit for a live search");
    assert.match(html, /source on every line/i, "name the citation without inventing a count");
  });

  await t.test("there is no stat strip and no To start hedge", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.ok(!/class="stats"/.test(html), "the four-cell strip is gone");
    assert.ok(!/To start/.test(html), "Free / To start was a hedge, not a number");
  });
});

test("the home page is a product page, not two copies of a methodology exhibit", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("exactly one sample report, plus an address field that is not the app form", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    // Selectors moved with the rebuild (design 3a, 2026-09-01): .exhibit ->
    // .hmcard, #landingAddress -> #homeAddress. What each line protects is
    // unchanged; the mini-plus-full exhibit pair was a real bug and the
    // count is what caught it.
    assert.equal((html.match(/class="hmcard"/g) || []).length, 1,
      "one sample report; the mini + full pair is the bug");
    assert.match(html, /id="homeAddress"/, "the page still asks for a building");
    assert.match(html, /class="heroCta"/, "account-wall tests still have to recognise this page");
    assert.ok(!/id="compForm"/.test(html), "the real search form lives only in index.html");
    assert.ok(
      !/<input[^>]*id="homeAddress"[^>]*\bname\s*=/i.test(html),
      "a named input would put the street address on GET /?auth=signup"
    );
    assert.match(html, /pendingLandingAddress\.v1/, "the form must hand off through sessionStorage");
    assert.match(html, /Run a report/, "the button names the product, not the gate");
  });

  // The type picker is new with design 3a, and its whole contract is that it
  // does NOT default. A plain first <option> would submit Industrial for
  // everybody who never touched it, which is a wrong report rather than a
  // missing preference — and index.html would have no way to know.
  await t.test("the property type submits nothing until one is chosen", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.match(html, /<option value="">Property type<\/option>/,
      "the placeholder option must carry an empty value");
    for (const type of ["Industrial", "Office", "Retail", "Multifamily", "Land", "Residential"]) {
      assert.ok(html.includes(`<option value="${type}">${type}</option>`),
        type + " is missing from the home page's type picker");
    }
    // Both halves of the handoff, pinned against the key index.html reads.
    assert.match(html, /pendingLandingType\.v1/, "the chosen type must ride to the app");
    const fs = require("node:fs");
    const path = require("node:path");
    const app = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.match(app, /pendingLandingType\.v1/,
      "index.html must pick the type up; a rename on one side alone drops it silently");
  });
});

// The 2026-09-01 rebuild (design 3a). The owner's order, top to bottom:
// what the company is, the thing the product does, proof it did it, the firm
// pitch, the closing CTA. The suite it replaces pinned the 2026-08-29 order
// (vault first, search below Method) for the same reason — nothing pinned the
// arrangement, so nothing stopped it drifting back.
test("the home page follows the owner's band order", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("intro, then the comp finder, then proof, then the firm pitch", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    const at = (needle) => {
      const i = html.indexOf(needle);
      assert.ok(i > -1, "the home page is missing " + needle);
      return i;
    };
    const intro = at("Enterprise software for commercial real estate");
    const finder = at("Market comp finder");
    const addr = at('id="homeAddress"');
    const report = at('class="hmcard"');
    const firms = at("For firms — Pro version");
    const closing = at('class="hmclose"');
    assert.ok(intro < finder, "the intro band opens the page");
    assert.ok(finder < report, "the comp finder comes before the sample it produces");
    assert.ok(addr < report, "the address field is in the finder band, above the sample");
    assert.ok(report < firms, "proof comes before the firm pitch");
    assert.ok(firms < closing, "the closing band is last, and is its own section");
  });

  // Explicit, because it is the one thing the design says twice: the FAQ
  // moved to a page of its own and must not come back here.
  await t.test("the FAQ is not on the home page", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.ok(!/class="q"/.test(html), "no FAQ accordions on the home page");
    assert.ok(!/"@type":"FAQPage"/.test(html), "and no FAQ structured data either");
    assert.match(html, /href="\/faq"/, "but the Explore menu must reach the page they went to");
  });

  await t.test("the vault chip is ownership, never provenance", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.match(html, /class="badge bv">Your vault</,
      "the home page should show the chip a broker meets inside their own report");
    // "Verified" is a word the SERVER awards when a named broker vouches.
    // A private row has not earned it, and the two must never be conflated
    // in the one place a broker is being told what the vault is.
    assert.ok(!/[Vv]erified[^<]{0,24}vault/.test(html),
      "the home page must never describe a vault comp as verified");
  });

  await t.test("it states what leaves the vault, in full", async () => {
    for (const p of ["/", "/faq"]) {
      const html = await (await fetch(srv.base + p)).text();
      assert.match(html, /no address, no total price, no notes/i,
        p + " should say exactly what a shared comp keeps");
      // "no price" would be false: $/SF x size implies it, which is the
      // trade-off comp-gate.js names when it builds a locked_basis row.
      assert.ok(!/no address, no price\b/i.test(html),
        p + " must not claim the price is withheld; the basis implies it");
    }
  });

  // BRAND.md §4 protects this sentence, and it had never been asserted on the
  // page it most needs to be on. It is the line most likely to be lost to a
  // future layout tidy-up. Case-insensitive since 2026-09-01: design 3a runs
  // it mid-sentence in the finder caption rather than as its own line.
  await t.test("the appraisal disclaimer survives the layout", async () => {
    for (const p of ["/", "/faq", "/how-it-works"]) {
      const html = await (await fetch(srv.base + p)).text();
      assert.match(html, /an automated estimate, not an appraisal/i,
        p + " must carry the disclaimer");
    }
  });

  // Archive-first retrieval floors the web-search budget when a broker's own
  // vault is strong -- but it is gated on PROVIDER.capabilities.searchBudget,
  // and the default provider (Gemini) takes no max_uses, so it is INERT in
  // production. Selling it would be selling something that does not happen.
  await t.test("it does not sell the search saving, which is inert in production", async () => {
    const forbidden = [/cheaper search/i, /fewer searches/i, /without spending a search/i,
                       /costs? (you )?less to search/i, /skips? the search/i];
    for (const p of ["/", "/faq", "/how-it-works"]) {
      const html = await (await fetch(srv.base + p)).text();
      for (const bad of forbidden) {
        assert.ok(!bad.test(html), p + " must not claim the archive cheapens a search: " + bad);
      }
    }
  });

  // deal-board.js is explicit that it counts CONTRIBUTION to the firm, not
  // closings. A page that promised otherwise would be selling surveillance
  // the product deliberately does not do.
  //
  // The NEGATION is stripped before the sweep, because the honest sentence
  // and the dishonest one share their last five words. Design 3a's
  // deal-board tile phrases it "Counts what each member contributed to the
  // shelf — not who is closing what", where the landing page it replaces
  // said "It does not report who is closing what."
  await t.test("the firm band does not promise a closings leaderboard", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    const stripped = html.replace(/not who is closing what/g, "");
    assert.ok(!/who (is|are) closing what/i.test(stripped),
      "the home page must not offer a record of who is closing what");
    assert.match(html, /not who is closing what/i,
      "the deal-board tile should say plainly what the board is not");
  });
});

// ---------------------------------------------------------------------------
// The BOV promise and the broker directory are the same fact, said twice.
//
// `brokersCard` renders nothing when nobody covers a market, which is every
// market today — while the CTA under it promised "a no-cost Broker Opinion of
// Value from a licensed local broker" on all 38 pages. Those two cannot be
// allowed to disagree: the card is the evidence for the sentence.
// ---------------------------------------------------------------------------

test("a market page with no brokers does not promise a Broker Opinion of Value", async (t) => {
  // No database here, so brokersCoveringMarket() answers with nobody — the
  // live state of every market page on 2026-08-13.
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  const html = await (await fetch(srv.base + MARKET_PAGE)).text();
  assert.ok(!/Broker Opinion of Value/.test(html),
    "with no broker covering this market, the page must not promise one");
  assert.match(html, /with the source cited on every one/,
    "the fallback should sell the report, which is the thing that exists");
  // The hand-raise itself is unaffected: the CTA (the value-a-property form
  // since 2026-08-20) still opens the app through the wall-honored door.
  assert.match(html, /<form class="vform" data-dest="[^"]*auth=signup/,
    "the primary CTA must still be there");
});

test("the BOV promise is governed by the same list the broker card renders", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("const brokerList = Array.isArray(opts.brokers)");
  assert.ok(start >= 0, "brokerList should still be how the page learns who covers it");
  const end = src.indexOf("return marketShell({", start);
  assert.ok(end > start, "could not bound the market page body");
  const body = src.slice(start, end);

  const promises = [...body.matchAll(/Broker Opinion of Value/g)];
  assert.equal(promises.length, 1, "there should be exactly one BOV promise in the page body");

  // It has to sit on the true side of a brokerList test. A promise written
  // outside that conditional is the bug this exists to prevent, and it reads
  // identically on the page when the list happens to be non-empty.
  const guarded = /brokerList\.length[\s\S]{0,200}Broker Opinion of Value/.test(body);
  assert.ok(guarded, "the BOV sentence must be conditional on a broker actually covering the market");
});

test("the BOV lead band is governed by the same broker list, and never renders on a preview", () => {
  // The band makes the strongest promise on the page and puts it ABOVE the
  // data. Two ways that goes wrong, both invisible on a page with no brokers:
  // it renders where nobody covers the market, or it renders on a thin-data
  // Explorer preview, which is noindex, expires in 30 minutes, and is the one
  // page whose own banner tells the reader not to rely on it.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("const bovLead = ");
  assert.ok(start >= 0, "the BOV lead band should still exist");
  const end = src.indexOf("const body =", start);
  assert.ok(end > start, "could not bound the band");
  const band = src.slice(start, end);

  assert.match(band, /!signedIn && brokerList\.length && !opts\.preview/,
    "the band must require an anonymous visitor, a covering broker, AND a real published page");
  assert.equal(/contact|phone|email/i.test(band), false,
    "the band names a broker but must never carry contact details (routing is owner-mediated)");
  assert.match(band, /auth=signup/, "its CTA must open a door the account wall honors");
});

test("a market page with no brokers renders no lead band at all", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + MARKET_PAGE)).text();
  assert.ok(!/cta lead/.test(html), "no broker covers this market, so there is nothing to lead with");
});

test("a market page header is a photograph of that city, or a satellite aerial if the file failed QA", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + MARKET_PAGE)).text();
  assert.equal(MARKETHERO.cityKey(MARKET.city, MARKET.state), "ontario, ca",
    "this fixture is Ontario, CA — the city whose Commons file is too small");
  const live = MARKETHERO.heroFor(MARKET.city, MARKET.state, { skipFiles: ["ontario-ca.jpg"] });
  assert.ok(live, "the seeded fixture city must still have a header picture");
  assert.match(html, /class="mkt-hero"/);
  assert.match(html, /class="mkt-hero-img"/);
  assert.match(html, /srcset="/);
  assert.match(html, /sizes="100vw"/);
  assert.match(html, new RegExp(`width="${MARKETHERO.HERO_WIDTH}"`));
  assert.match(html, new RegExp(`height="${MARKETHERO.HERO_HEIGHT}"`));
  assert.match(html, new RegExp(`<h1>${MARKET.type} Comps in ${MARKET.city}, ${MARKET.state}</h1>`));
  assert.equal((html.match(/<h1>/g) || []).length, 1);

  // The committed industrial fixture is Ontario, CA: its Commons file is too
  // small, so the live header must be Esri of Ontario, CA — not the blurry JPEG.
  assert.equal(live.kind, "satellite");
  assert.match(html, /World_Imagery/);
  assert.match(html, /Esri, Maxar/);
  assert.doesNotMatch(html, /\/market-heroes\/ontario-ca\.jpg/);
  assert.match(html, /og:image" content="[^"]*og-image\.png"/);

  const img = await fetch(srv.base + "/market-heroes/dallas-tx.jpg");
  assert.equal(img.status, 200);
  assert.match(img.headers.get("content-type") || "", /image\/jpeg/);
  const bytes = Buffer.from(await img.arrayBuffer());
  assert.ok(bytes.length > 20 * 1024, "hero JPEG looks empty");
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);

  const img1x = await fetch(srv.base + "/market-heroes/dallas-tx-1920.jpg");
  assert.equal(img1x.status, 200, "1920w sibling must be served");
  const bytes1x = Buffer.from(await img1x.arrayBuffer());
  assert.ok(bytes1x.length > 10 * 1024, "1920w JPEG looks empty");

  const sneak = await fetch(srv.base + "/market-heroes/../server.js");
  assert.equal(sneak.status, 404);
});

test("the settings door, for a visitor with no account menu to reach it from", async (t) => {
  // The theme switch went back into the settings panel on 2026-08-30 and out
  // of every nav, which took the only theme control a SIGNED-OUT visitor had.
  // The panel lives in index.html and its door is the account menu, which
  // they do not have — so a browser that stored "dark" would have had no way
  // back to light. ?settings=1 is that way back: the fifth wall exemption,
  // deliberately unadvertised (nothing in the chrome links to it).
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("/?settings=1 serves the app, not the landing page", async () => {
    const r = await fetch(srv.base + "/?settings=1", { redirect: "manual" });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /id="settingsModal"/, "the settings panel lives only in index.html");
    assert.match(html, /id="themeToggleApp"/, "and the theme switch lives only in that panel");
    assert.ok(!/class="heroCta"/.test(html), "serving the landing page here is the bug, not the fix");
  });

  await t.test("/desk?settings=1 still redirects — a workspace is not a door", async () => {
    // The signed-in account menu links THERE, and the wall's rule about
    // personal workspaces does not bend for a query string. Narrower than
    // ?auth= / ?submit=comp / ?pricing=1 by exactly this one path.
    const r = await fetch(srv.base + "/desk?settings=1", { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/?auth=signin");
  });

  await t.test("an unrecognized settings value is not a door", async () => {
    const html = await (await fetch(srv.base + "/?settings=whatever")).text();
    assert.match(html, /class="heroCta"/, "junk gets the landing page");
    assert.ok(!/id="settingsModal"/.test(html), "and must not leak the app");
  });
});

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
const MARKET = require("../market-seed.json")[MARKET_SLUG];

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

  await t.test("/brokers is two stacked ledgers, not two cards", async () => {
    // Spec: docs/superpowers/specs/2026-08-13-brokers-page-ledger-design.md
    // Contribute vs Pro must stay two statements. One list makes the vault
    // look like it comes with a submitted comp.
    const html = await (await fetch(srv.base + "/brokers")).text();
    const offer = html.split("<h1>")[1].split('class="cta"')[0];
    assert.equal((offer.match(/class="bk"/g) || []).length, 2,
      "/brokers should show two ledgers");
    const contribute = offer.split("For submitting a comp.")[1].split("With Pro.")[0];
    const pro = offer.split("With Pro.")[1];
    assert.ok(contribute && pro, "both ledger headings must exist");
    assert.equal((contribute.match(/class="bkrow"/g) || []).length, 3,
      "contribute ledger is three trades");
    assert.match(contribute, /class="bklag">CREDIT</);
    assert.match(contribute, /class="bklag">INTROS</);
    assert.match(contribute, /class="bklag">PROFILE</);
    assert.equal((contribute.match(/Verified &middot; via Your Firm/g) || []).length, 1,
      "the credit chip is shown on Credit, once");
    assert.ok(!/class="badge v"/.test(contribute),
      "MARKET_CSS .v collides with .tile .v; the chip stays inline-styled");
    assert.equal((pro.match(/class="bkrow"/g) || []).length, 3,
      "Pro ledger is three trades");
    assert.match(pro, /class="bklag">BOOK</);
    assert.match(pro, /class="bklag">PIPELINE</);
    assert.match(pro, /class="bklag">PRIVATE</);
    assert.ok(!/Verified &middot; via Your Firm/.test(pro),
      "the chip belongs on Credit, not on the vault");
    assert.equal((html.match(/href="\/\?submit=comp"/g) || []).length, 1,
      "exactly one Submit door");
    assert.ok(!/class="steps"/.test(html), "do not reuse Method's 3-up");
    assert.ok(!/class="grid"/.test(offer), "the offer is not a two-card grid");
    assert.match(html, /Working a 1031 exchange\?/);
    assert.match(html, /CompNinja is not a licensed brokerage/);
    assert.match(html, /id="upgradeProLink"/);
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

  await t.test("brokers have a path off the landing page, not just an FAQ row", async () => {
    // Until 2026-08-12 a broker arriving here met one FAQ answer and a link
    // inside the Explore dropdown. The owner's own read is that broker
    // relationships are the better acquisition lever than SEO, so the page
    // that every visitor lands on should say what a broker gets and where to
    // go. Asserted on both surfaces because `/` and /how-it-works serve the
    // same bytes while the wall is up.
    for (const p of pages) {
      const html = await (await fetch(srv.base + p)).text();
      assert.match(html, /What brokers get/, p + " should address brokers directly");
      assert.match(html, /href="\/brokers"/, p + " should link to the broker page");
      // The three concrete trades, not a pitch. Matched around the
      // apostrophes, which escHtml turns into &#39; on the way out.
      assert.match(html, /public records unless you choose to publish/i,
        p + " should state the privacy trade plainly");
      assert.match(html, /Verified badge and your firm\S{0,6}s name/i,
        p + " should name the credit a broker actually receives");
    }
  });

  await t.test("the brokers trades are a ledger, not a paragraph or a Method clone", async () => {
    // Homepage-look collapsed this to one .sub paragraph, which still named
    // the three trades but read as Method's leftover. The trades are not a
    // sequence: they are a statement, drawn as hairline rows like the report
    // ledger, with the Verified chip shown on Credit rather than described.
    for (const p of pages) {
      const html = await (await fetch(srv.base + p)).text();
      const chunk = html.split('kicker">Brokers')[1];
      assert.ok(chunk, p + " must still have a Brokers kicker");
      const brokers = chunk.split("See it on your own building")[0];
      assert.equal((brokers.match(/class="bkrow"/g) || []).length, 3,
        p + " should show three trades as rows");
      assert.match(brokers, /class="bklag">Private</, p + " should label the privacy trade");
      assert.match(brokers, /class="bklag">Credit</, p + " should label the credit trade");
      assert.match(brokers, /class="bklag">Leads</, p + " should label the leads trade");
      assert.match(brokers, /Verified &middot; via Your Firm/,
        p + " should show the credit chip, not only describe it");
      assert.ok(!/class="steps"/.test(brokers),
        p + " must not reuse Method's three-up");
    }
    const html = await (await fetch(srv.base + "/")).text();
    assert.match(html, /class="steps"/, "Method still uses .steps");
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

test("the landing names the real search cost without a stat strip", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

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

  await t.test("there is no stat strip and no To start hedge", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    assert.ok(!/class="stats"/.test(html), "the four-cell strip is gone");
    assert.ok(!/To start/.test(html), "Free / To start was a hedge, not a number");
  });
});

test("the landing is a product page, not two copies of a methodology exhibit", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  await t.test("exactly one sample exhibit, plus an address field that is not the app form", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    const exhibits = html.match(/class="exhibit\b/g) || [];
    assert.equal(exhibits.length, 1, "one sample report; the mini + full pair is the bug");
    assert.match(html, /id="landingAddress"/, "the hero asks for a building");
    assert.match(html, /class="heroCta"/, "account-wall tests still have to recognise the landing");
    assert.ok(!/id="compForm"/.test(html), "the real search form lives only in index.html");
    assert.ok(
      !/<input[^>]*id="landingAddress"[^>]*\bname\s*=/i.test(html),
      "a named input would put the street address on GET /?auth=signup"
    );
    assert.match(html, /pendingLandingAddress\.v1/, "the form must hand off through sessionStorage");
    assert.ok(!/Here is exactly how that gets built/.test(html), "that line is how-it-works voice");
    assert.match(html, /Run a report/, "the button names the product, not the gate");
  });

  await t.test("brokers is one block, not a second Method 3-up", async () => {
    const html = await (await fetch(srv.base + "/")).text();
    const afterBrokers = html.split(/kicker">Brokers/)[1];
    assert.ok(afterBrokers, "the Brokers kicker stays");
    const brokersBlock = afterBrokers.split(/class="cta/)[0];
    assert.ok(!/class="steps"/.test(brokersBlock), "do not reuse Method's 3-up for brokers");
    assert.match(html, /kicker">Method[\s\S]*?class="steps"/, "Method still has its steps");
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
  // The hand-raise itself is unaffected: the CTA still opens the app.
  assert.match(html, /<a class="btn" href="[^"]*auth=signup/,
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

  assert.match(band, /brokerList\.length && !opts\.preview/,
    "the band must require a covering broker AND a real published page");
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

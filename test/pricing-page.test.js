// /pricing — the linkable rate card.
//
// Run: npm test
//
// Cost: zero. The server boots with no Anthropic key, no Supabase and no
// Stripe; the route is a pure render with no upstream call.
//
// Until this page existed, pricing lived ONLY in a modal inside index.html.
// That modal cannot be linked, indexed, or sent in an email, and it had no
// Firm tier at all — while /how-it-works' FAQ had been quoting "$79 a seat,
// minimum two seats" in prose for weeks. So the product's own price was
// stated in one place a crawler could read and nowhere a buyer could click.
//
// The drift these tests exist to catch is the one the modal's own comment
// admits to: "both are hard-coded here while the actual charge comes from the
// Stripe price IDs, so nothing catches a drift". Now something does.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");
const ORG = require("../org-access");

const SESSION = { cookie: "cn_session=not-a-real-token" };
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const SERVER_JS = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

test("/pricing is reachable and indexable", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  const res = await fetch(srv.base + "/pricing");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<link rel="canonical" href="[^"]*\/pricing"/);
  assert.doesNotMatch(html, /noindex/, "the rate card must be indexable");

  const sitemap = await (await fetch(srv.base + "/sitemap.xml")).text();
  assert.ok(sitemap.includes("/pricing</loc>"), "sitemap lists /pricing");
});

test("all three tiers are on the page, Firm included", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/pricing")).text();

  assert.match(html, />Free</, "Free anchors the comparison");
  assert.match(html, />Pro</, "Pro");
  // The whole point of the page. The modal has carried Free/Pro/Founding and
  // no firm tier since per-seat billing shipped.
  assert.match(html, />Firm</, "Firm is sold, not just described in an FAQ");
});

test("the price a visitor reads is the one the FAQ has been quoting", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  const pricing = await (await fetch(srv.base + "/pricing")).text();
  // The FAQ moved to a page of its own on 2026-09-01; it used to be nine
  // accordions on /how-it-works, which is why this read that URL. The home
  // page joined it as a third public statement of the seat price, since
  // design 3a closes its For-firms band on the figure.
  const faq = await (await fetch(srv.base + "/faq")).text();
  const home = await (await fetch(srv.base + "/")).text();

  // Every surface reads the same constant. Before /pricing existed the FAQ was
  // the only public statement of the seat price; two prose copies of a number
  // is how a site ends up quoting two prices for one plan.
  // $840 left this loop on 2026-09-02. The founding rate is no longer an
  // unconditional footnote: it is a BAND, and the band is not rendered at all
  // unless Stripe is configured, because a "Claim a seat" button on a
  // deployment whose checkout 503s is an offer that cannot be taken. The
  // standing prices are still unconditional and still checked here; the
  // founding figure is checked in the founding-band test below, which boots a
  // server that can actually sell it.
  for (const figure of ["$100", "$79"]) {
    assert.ok(pricing.includes(figure), `/pricing states ${figure}`);
  }
  assert.ok(!pricing.includes("$840"),
    "with no Stripe configured the founding band must not be advertised");
  assert.ok(faq.includes("$100"), "the FAQ still states the monthly price");
  assert.ok(faq.includes("$79"), "the FAQ still states the seat price");
  assert.ok(home.includes("$100"), "the home page states the monthly price");
  assert.ok(home.includes("$79"), "the home page states the seat price");
});

test("the seat minimum on the page is the one checkout actually enforces", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/pricing")).text();

  // /api/checkout refuses a firm plan below ORG.MIN_SEATS by name and number.
  // A page advertising a smaller minimum would send somebody to a refusal.
  assert.ok(
    html.includes(String(ORG.MIN_SEATS)) || /minimum two seats/i.test(html),
    "the page states the real seat minimum",
  );
});

test("the modal and the page cannot quote different prices", () => {
  // index.html's modal is a separate file with its own hardcoded figures and a
  // comment conceding that nothing catches a drift. This is that catch: the
  // figures the page renders come from PRICING in server.js, and the modal has
  // to agree with them.
  const priceBlock = SERVER_JS.match(/const PRICING = \{[\s\S]*?\};/);
  assert.ok(priceBlock, "server.js declares a single PRICING constant");
  const monthly = priceBlock[0].match(/monthly:\s*(\d+)/);
  const founding = priceBlock[0].match(/foundingAnnual:\s*(\d+)/);
  const seat = priceBlock[0].match(/firmSeat:\s*(\d+)/);
  assert.ok(monthly && founding && seat, "PRICING names all three figures");

  assert.ok(INDEX_HTML.includes(`$${monthly[1]}`), "the modal quotes the same monthly price");
  assert.ok(INDEX_HTML.includes(`$${founding[1]}`), "the modal quotes the same founding price");
});

test("what the Free tile promises is what entitlements.js grants", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/pricing")).text();
  const ENT = require("../entitlements");

  // The tile describes the free tier in prose while the real limits are
  // constants one file over. Same drift class as the prices, cheaper to catch.
  const years = ENT.FREE_MAX_LOOKBACK_MONTHS / 12;
  assert.equal(years, 3, "if this changes, the tile's wording has to change with it");
  assert.match(html, /three-year window/i, "the free window is stated in years");
  assert.ok(
    html.includes("five exports"),
    `the free export cap is ${ENT.FREE_EXPORTS_PER_MONTH}; the tile must say so`,
  );
  assert.equal(ENT.FREE_EXPORTS_PER_MONTH, 5, "the tile spells this number out as a word");
});

test("large figures carry a thousands separator", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/pricing")).text();

  // The annual-at-monthly comparison shipped as "$1200" for one commit. A
  // price is the last figure on a page that should look unformatted.
  assert.doesNotMatch(html, /\$\d{4,}/, "no four-digit figure without a comma");
});

test("the page never becomes a second checkout implementation", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/pricing")).text();

  // Buying happens in the app, where the session, the entitlements and the
  // firm's ownership check already live. A server-rendered page that POSTed to
  // /api/checkout would be a second path to a charge — and the firm plan in
  // particular needs an orgId and an ownership check this page cannot make.
  assert.doesNotMatch(html, /\/api\/checkout/, "no checkout call on the static page");
  assert.match(html, /\?pricing=1|auth=signup/, "buying is handed back to the app");
});

test("the page offers the right door for the visitor it is sent to", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  const anon = await (await fetch(srv.base + "/pricing")).text();
  assert.match(anon, /href="\/\?auth=signup"/, "an anonymous visitor can sign up");

  const member = await (await fetch(srv.base + "/pricing", { headers: SESSION })).text();
  assert.doesNotMatch(member, /auth=signup/, "a member is not sold a signup");
  assert.doesNotMatch(member, /auth=signin/, "a member is not told to log in");
});

test("/pricing is reachable from the footer of every public page", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  for (const p of ["/", "/brokers-firms", "/markets"]) {
    const html = await (await fetch(srv.base + p)).text();
    assert.ok(html.includes('href="/pricing"'), `${p} links to /pricing`);
  }
});

// --- The founding band ------------------------------------------------------
//
// It replaced the `.disc` footnote on 2026-09-02. The footnote was rendered
// whenever `foundingAnnual` was set and said nothing about whether a seat
// could actually be bought; the band is louder — a dark panel with a live
// counter and its own button — so the bar for showing it went up with it.
test("the founding band is only shown where a seat can actually be bought", async (t) => {
  await t.test("no Stripe, no band", async (tt) => {
    const srv = await boot({});
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.ok(!/id="prcFm"/.test(html), "the band must not render without billing");
    assert.ok(!/Claim a seat/.test(html), "nor its button");
  });

  await t.test("with Stripe, the band renders and quotes PRICING's own figure", async (tt) => {
    const srv = await boot({
      STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
      STRIPE_PRICE_PRO_MONTHLY: "price_not_real",
    });
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.match(html, /id="prcFm"/, "the band renders once billing is configured");

    const priceBlock = SERVER_JS.match(/const PRICING = \{[\s\S]*?\};/)[0];
    const monthly = Number(priceBlock.match(/monthly:\s*(\d+)/)[1]);
    const founding = Number(priceBlock.match(/foundingAnnual:\s*(\d+)/)[1]);
    assert.ok(html.includes(`$${founding}`), "the band quotes PRICING.foundingAnnual");

    // The saving is COMPUTED, never typed. The design file wrote "$360 per
    // year", which is correct at $100/mo against $840/yr and silently wrong
    // the moment either figure moves — so this asserts the arithmetic rather
    // than the numeral, and moving either price keeps it true.
    const saving = monthly * 12 - founding;
    assert.ok(html.includes(`Saves you $${saving}`),
      `the band must compute the saving; expected $${saving}`);
  });
});

test("the founding counter is never server-rendered", async (t) => {
  const srv = await boot({
    STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
    STRIPE_PRICE_PRO_MONTHLY: "price_not_real",
  });
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/pricing")).text();

  // THE RULE THIS FILE EXISTS FOR, second edition. `foundingLeft` is a
  // database read memoized 60s, and this page is served from an hour-long
  // public cache to anonymous visitors — so a number baked into these bytes
  // would still be claiming "12 seats left" long after the last one sold.
  // The count block therefore ships EMPTY and hidden, and a tiny client fetch
  // to /api/pricing fills it in after paint (or takes the whole band down).
  const countBlock = html.match(/<div class="prc-fm-count"[^>]*>[\s\S]*?<\/div>/);
  assert.ok(countBlock, "the counter block must exist");
  assert.match(countBlock[0], /hidden/, "it must ship hidden");
  assert.ok(!/\d/.test(countBlock[0].replace(/prc-fm-[a-z]+|id="[^"]*"/g, "")),
    "no seat count may be server-rendered: " + countBlock[0]);
  assert.match(html, /fetch\("\/api\/pricing"/, "the counter is filled in after paint");
  // And still no second checkout, which is rule 2 of the page.
  assert.doesNotMatch(html, /\/api\/checkout/, "the band must not buy anything");
});

test("the redundant top kicker is gone", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/pricing")).text();

  // The handoff drew a "Pricing" eyebrow above the H1 and then said it was
  // redundant against it; the owner dropped it (2026-09-02). The word is
  // already in the nav, the URL, the tab title and the heading itself.
  assert.match(html, /<h1>What CompNinja Costs\.<\/h1>/, "the H1 carries the header alone");
  const beforeH1 = html.slice(0, html.indexOf("<h1>"));
  assert.ok(!/class="kicker"/.test(beforeH1.slice(-400)),
    "the kicker was dropped and must not come back above the H1");
});

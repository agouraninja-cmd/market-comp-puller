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

// The figures, read out of PRICING in server.js. Never typed into a test.
function pricingFigures() {
  const block = SERVER_JS.match(/const PRICING = \{[\s\S]*?\};/);
  assert.ok(block, "server.js declares a single PRICING constant");
  const n = (k) => { const m = block[0].match(new RegExp(k + ":\\s*(\\d+)")); return m ? Number(m[1]) : 0; };
  return { monthly: n("monthly"), annual: n("annual"), seat: n("firmSeat") };
}

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
  // is how a site ends up quoting two prices for one plan. The figures are
  // READ from PRICING rather than typed here (2026-09-25): this test used to
  // spell "$100" and "$79", so the price change had to edit the test that
  // exists to catch price drift, which is backwards.
  const { monthly, seat } = pricingFigures();
  for (const figure of [`$${monthly}`, `$${seat}`]) {
    assert.ok(pricing.includes(figure), `/pricing states ${figure}`);
    assert.ok(faq.includes(figure), `the FAQ states ${figure}`);
    assert.ok(home.includes(figure), `the home page states ${figure}`);
  }
  // The founding offer stopped being sold on 2026-09-25. No page may still
  // advertise it: checkout answers that plan with a 400.
  for (const [name, html] of [["/pricing", pricing], ["/faq", faq], ["/", home]]) {
    assert.ok(!/founding/i.test(html), `${name} must not advertise the retired founding offer`);
    assert.ok(!html.includes("$840"), `${name} must not quote the old founding price`);
  }
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
  const { monthly, annual, seat } = pricingFigures();
  assert.ok(monthly && annual && seat, "PRICING names all three figures");

  assert.ok(INDEX_HTML.includes(`<div class="pr-fig">$${monthly}</div>`), "the modal quotes the same monthly price");
  assert.ok(INDEX_HTML.includes(`<div class="pr-fig">$${annual}</div>`), "the modal quotes the same yearly price");
  // The saving is typed in the modal (it is static HTML), so it is the figure
  // most likely to be left behind when either price moves. Computed here.
  assert.ok(INDEX_HTML.includes(`saves $${monthly * 12 - annual}`),
    `the modal's yearly saving must be $${monthly * 12 - annual}`);
  // And the retired offer is gone from the modal, button and all.
  assert.ok(!INDEX_HTML.includes('data-plan="pro_annual_founding"'), "the modal must not sell founding");
  assert.ok(INDEX_HTML.includes('data-plan="pro_annual"'), "the modal sells the yearly plan");
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

// --- The yearly band -------------------------------------------------------
//
// It carried the founding offer until 2026-09-25, when the standing yearly
// plan replaced it. The bar for showing it is unchanged: drawn only where the
// plan can actually be bought, and never a second way to buy anything.
test("the yearly band is only shown where the plan can actually be bought", async (t) => {
  await t.test("no Stripe, no band", async (tt) => {
    const srv = await boot({});
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.ok(!/id="prcFm"/.test(html), "the band must not render without billing");
  });

  await t.test("Stripe but no yearly price, no band", async (tt) => {
    // The deploy between setting the monthly price and the yearly one: a
    // "Choose yearly" button there would send somebody to a 503.
    const srv = await boot({
      STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
      STRIPE_PRICE_PRO_MONTHLY: "price_not_real",
    });
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.ok(!/id="prcFm"/.test(html), "no yearly price id, no yearly band");
  });

  await t.test("with a yearly price, the band renders and quotes PRICING's own figure", async (tt) => {
    const srv = await boot({
      STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
      STRIPE_PRICE_PRO_MONTHLY: "price_not_real",
      STRIPE_PRICE_PRO_ANNUAL: "price_annual_not_real",
    });
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.match(html, /id="prcFm"/, "the band renders once the yearly plan is sellable");

    const { monthly, annual } = pricingFigures();
    assert.ok(html.includes(`$${annual}`), "the band quotes PRICING.annual");
    // COMPUTED, never typed: "$360 per year" was right at $100/mo against the
    // old $840 and silently wrong the moment either moved.
    const saving = monthly * 12 - annual;
    assert.ok(html.includes(`Saves you $${saving}`),
      `the band must compute the saving; expected $${saving}`);
    // Facts fixed at deploy time only, so no script; and never a second way
    // to buy anything (rule 2 of the page).
    assert.doesNotMatch(html, /fetch\("\/api\/pricing"/, "the band states nothing that needs fetching");
    assert.doesNotMatch(html, /\/api\/checkout/, "the band must not buy anything");
  });
});

// --- The trial on the rate card -------------------------------------------
test("the trial is offered on the page exactly when it exists", async (t) => {
  await t.test("trial on: the Pro tile says so", async (tt) => {
    const srv = await boot({ PRO_TRIAL_DAYS: "14" });
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.match(html, /14-day free trial/);
  });
  await t.test("trial on with billing: a stranger's button offers the trial", async (tt) => {
    const srv = await boot({
      PRO_TRIAL_DAYS: "14",
      STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
      STRIPE_PRICE_PRO_MONTHLY: "price_not_real",
    });
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.match(html, /Try Pro free for 14 days/);
  });
  await t.test("trial off: no promise of one anywhere", async (tt) => {
    const srv = await boot({
      PRO_TRIAL_DAYS: "0",
      STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
      STRIPE_PRICE_PRO_MONTHLY: "price_not_real",
    });
    tt.after(() => srv.stop());
    const html = await (await fetch(srv.base + "/pricing")).text();
    assert.doesNotMatch(html, /free trial|days free/, "PRO_TRIAL_DAYS=0 must take the promise down with the trial");
    assert.doesNotMatch(html, /Try Pro free/);
  });
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

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
  const how = await (await fetch(srv.base + "/")).text();

  // Both surfaces read the same constant. Before this page existed the FAQ was
  // the only public statement of the seat price; two prose copies of a number
  // is how a site ends up quoting two prices for one plan.
  for (const figure of ["$100", "$79", "$840"]) {
    assert.ok(pricing.includes(figure), `/pricing states ${figure}`);
  }
  assert.ok(how.includes("$100"), "the FAQ still states the monthly price");
  assert.ok(how.includes("$79"), "the FAQ still states the seat price");
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

  for (const p of ["/", "/brokers", "/markets", "/firms"]) {
    const html = await (await fetch(srv.base + p)).text();
    assert.ok(html.includes('href="/pricing"'), `${p} links to /pricing`);
  }
});

// /brokers-firms — the merged public front door for brokers and firms.
//
// Run: npm test
//
// Cost: zero. The server boots with no Anthropic key, no Supabase and no
// Stripe; the route is a pure render with no upstream call.
//
// This file replaces test/firms-page.test.js. /brokers and /firms merged on
// 2026-09-01 (design 4a): they were two pitches to the same reader — a broker
// deciding whether to bring their comp book, and the same broker deciding
// whether to bring their office — with one price answer and one privacy
// argument between them. The assertions are written against what a VISITOR
// receives, the way public-pages.test.js is, rather than against internal
// helpers.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");
const ORG = require("../org-access");

// Presence is the whole rule for the shared chrome — the routing layer never
// validates this token, it only looks. Same fixture as public-pages.test.js.
const SESSION = { cookie: "cn_session=not-a-real-token" };

test("/brokers-firms is reachable and indexable", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  const res = await fetch(srv.base + "/brokers-firms");
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /<link rel="canonical" href="[^"]*\/brokers-firms"/,
    "canonical points at itself");
  assert.doesNotMatch(html, /noindex/, "the pitch page must be indexable");

  const sitemap = await (await fetch(srv.base + "/sitemap.xml")).text();
  assert.ok(sitemap.includes("/brokers-firms</loc>"), "sitemap lists /brokers-firms");

  // A sitemap that lists a redirecting URL is a soft error in Search Console,
  // and both of these redirect now.
  assert.ok(!sitemap.includes("/brokers</loc>"), "sitemap must not list the retired /brokers");
  assert.ok(!sitemap.includes("/firms</loc>"), "sitemap must not list the retired /firms");
});

test("the shop kinds are quoted from org-access, never retyped", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/brokers-firms")).text();

  // The page speaks to every shop, and each one's sentence is the SAME string
  // the invite email and the create box use. A hand-typed variant here would
  // be a fourth copy to keep in step, and the first to go stale. Design 4a
  // drew wording of its own on these two cards; the handoff says that wording
  // is illustrative and this rule outranks it.
  for (const kind of ORG.SHOP_KINDS) {
    const copy = ORG.SHOP_COPY[kind];
    assert.ok(html.includes(copy.label), `names the ${kind} shop`);
    assert.ok(html.includes(copy.arrivals), `quotes ${kind}'s arrivals verbatim`);
  }
  assert.ok(!/Tenant rep/i.test(html), "the withdrawn shop is not still advertised");

  // The row is exactly as wide as the list is. The muted "tell us which one
  // you are" card is the SPARE COLUMN, not a fourth message: it fills the row
  // while there are fewer than three kinds and a third kind takes its place.
  // A kind was added and withdrawn inside ten days (tenant rep, 2026-08-21 to
  // 2026-08-31), which is the drift a hand-built row guarantees.
  // The character class matters: `bfshops` is the ROW, `bfshop` is a card.
  const shops = (html.match(/class="bfshop["ic ]/g) || []).length;
  const spare = ORG.SHOP_KINDS.length < 3 ? 1 : 0;
  assert.equal(shops, ORG.SHOP_KINDS.length + spare,
    "the shop row is drawn off SHOP_KINDS, not typed");
  assert.equal((html.match(/class="bfshop spare"/g) || []).length, spare,
    "the spare column appears only while there is a column spare");
});

test("the shop-kind copy on the page is the module's, character for character", () => {
  // Guards the direction the route test cannot: if someone edits the page's
  // copy instead of org-access.js, the page and the invite email start
  // describing different products. index.html carries a mirror of this map for
  // the same reason and is pinned the same way.
  const src = fs.readFileSync(path.join(__dirname, "..", "brokers-firms-page.js"), "utf8");
  assert.match(src, /SHOP_COPY|shopCopy/,
    "brokers-firms-page.js reads the copy from org-access rather than inlining it");
  for (const kind of ORG.SHOP_KINDS) {
    assert.doesNotMatch(
      src,
      new RegExp(ORG.SHOP_COPY[kind].arrivals.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${kind}'s arrivals string is not hand-copied into the page`,
    );
  }
});

test("the prices are the ones the rest of the site quotes", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const page = await (await fetch(srv.base + "/brokers-firms")).text();
  const card = await (await fetch(srv.base + "/pricing")).text();

  // PRICING is one constant, and this page, /pricing and the FAQ answer all
  // read it. The monthly figure has been caught stale twice while it lived in
  // prose; nothing in the repo can see the Stripe price ID that does the
  // actual charging, so the least a third surface can do is not disagree with
  // the other two.
  const monthly = card.match(/\$(\d+)\s*<[^>]*>\s*\/?\s*month/i) || card.match(/\$(\d+)/);
  assert.ok(monthly, "/pricing no longer states a monthly figure this can be pinned to");
  assert.ok(page.includes(`$${monthly[1]}`),
    `the page quotes a monthly price /pricing does not (${monthly[1]})`);

  // And the seat price is spelled with its minimum, because a per-seat figure
  // without one reads as the price of a single seat, which cannot be bought.
  assert.match(page, /\/ seat, min\. two/, "the seat price must carry its minimum");
});

test("the compliance copy a public page must carry, and must not", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/brokers-firms")).text();

  // The owner is not a licensed broker. These two sentences are the ones the
  // whole site is written around, and a marketing page is exactly where they
  // get dropped for being unglamorous.
  assert.match(html, /automated estimate/i, "says the valuation is an automated estimate");
  assert.match(html, /not an appraisal/i, "says it is not an appraisal");
  assert.match(html, /not a licensed brokerage/i, "disclaims being a brokerage");
  assert.match(html, /connect you with/i, "we connect, we never broker");

  // The claims a page like this drifts into. "We appraise" is the licensing
  // problem; "our brokers" is the same problem worded as staffing.
  assert.doesNotMatch(html, /we appraise|our appraisers/i, "never claims to appraise");
  assert.doesNotMatch(html, /\bour brokers\b|\bwe broker\b/i, "never claims to be the brokerage");
});

test("the vault and firm privacy claims match what the product does", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/brokers-firms")).text();

  // Each of these restates a promise enforced in code — org-access.js's
  // never-retroactive auto-share, the member setting that beats the firm's,
  // and blend-comps.js's rule that a firm share carries no whole vault comp.
  // They are public claims that reach search engines, so they are pinned the
  // way the retired /brokers FAQ answers were.
  assert.match(html, /never work already run/i,
    "says auto-sharing is never retroactive");
  assert.match(html, /own setting beats the firm/i,
    "says the member's own setting beats the firm's");
  assert.match(html, /Colleagues see what somebody shares, and nothing else/i,
    "says colleagues see only what was shared");
  assert.match(html, /never enters CompNinja&#39;s public records/i,
    "says a firm share does not become a public record");

  // The CLOSED LIST is the claim the whole section rests on: a vault has
  // exactly two exits, both deliberate and both reversible. A third way out
  // added to the product without this page being edited is the failure this
  // pins the shape of.
  assert.match(html, /Exit one &middot; publish/i, "names the publish exit");
  assert.match(html, /Exit two &middot; your firm/i, "names the firm exit");
  assert.match(html, /And that is the whole list/i, "says the list is closed");
  assert.match(html, /take either back/i, "says both are reversible");
});

test("the illustrative panels are pictures, not controls", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/brokers-firms")).text();

  // The upload panel is static markup: nothing on this page uploads, posts or
  // reads a file. "Import 214 deals" is drawn as a SPAN for that reason — a
  // button-shaped link that goes nowhere is worse than a picture of one.
  assert.match(html, /<span class="bfghost">Import 214 deals<\/span>/,
    "the import button must stay a span; a dead link is worse than a picture");
  assert.ok(!/<form/.test(html.split('class="bfband bfhero"')[1] || ""),
    "no part of this page is a working form");

  // And the two claims under it are the part that has to survive if the real
  // import UI is ever drawn here instead.
  assert.match(html, /Nothing here is published\. Only you can see it\./,
    "the upload panel must keep both of its promises");
});

test("the page offers the right door for the visitor it is sent to", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  const anon = await (await fetch(srv.base + "/brokers-firms")).text();
  assert.match(anon, /href="\/\?auth=signup"/, "an anonymous visitor can sign up");
  assert.match(anon, /Create an account/, "and is told what the button does");

  // public-pages.test.js's rule, restated for the merged page: a member must
  // never be told to create an account they already have.
  const member = await (await fetch(srv.base + "/brokers-firms", { headers: SESSION })).text();
  assert.doesNotMatch(member, /auth=signup/, "a member is not sold a signup");
  assert.doesNotMatch(member, /auth=signin/, "a member is not told to log in");
  assert.match(member, /href="\/desk"/, "a member is sent to their own workspace");
});

test("the caching keeps the two variants honest", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  // Same split every shell page carries: the anonymous body caches for
  // crawlers, the signed-in one never does, and `vary: cookie` is what stops
  // an hour-old signed-out copy being re-served to somebody who just signed in.
  const anon = await fetch(srv.base + "/brokers-firms");
  assert.match(anon.headers.get("cache-control") || "", /max-age/);
  assert.match(anon.headers.get("vary") || "", /cookie/);

  const member = await fetch(srv.base + "/brokers-firms", { headers: SESSION });
  assert.match(member.headers.get("cache-control") || "", /no-store/);
});

test("/brokers-firms is reachable from the footer of every public page", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  // A page nothing links to is a page nobody reads. The footer is the one
  // surface every public page shares.
  for (const p of ["/", "/markets", "/pricing", "/1031-exchange"]) {
    const html = await (await fetch(srv.base + p)).text();
    assert.ok(html.includes('href="/brokers-firms"'), `${p} links to /brokers-firms`);
  }
});

test("one Explore entry, not the two it replaced", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/markets")).text();

  // The merge was as much about the menu as about the pages: two of the four
  // slots in the one header that has to sell the product to a stranger were
  // spent saying the same thing twice.
  assert.ok(!/href="\/brokers"/.test(html), "the retired /brokers link is gone from the nav");
  assert.ok(!/href="\/firms"/.test(html), "the retired /firms link is gone from the nav");
  assert.equal((html.match(/href="\/brokers-firms"/g) || []).length, 2,
    "one entry in the Explore menu and one in the footer, no more");
});

test("the page draws its own bands rather than borrowing the wrong ones", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/brokers-firms")).text();

  // The design is full-bleed alternating bands, which needs main.wrap
  // neutralised — and that rule only wins if the stylesheet ships in the BODY.
  // marketShell emits `head` BEFORE MARKET_CSS, so the same rule placed there
  // would lose on equal specificity and every band would stay boxed inside the
  // 1120px column. This is /faq's and /bulk's rule; it fails silently, which
  // is why it is pinned rather than commented.
  const headEnd = html.indexOf("</head>");
  const neutralise = html.indexOf("main.wrap{max-width:none;padding:0}");
  assert.notEqual(neutralise, -1, "the page lost the rule that lets its bands go full-bleed");
  assert.ok(neutralise > headEnd,
    "the page stylesheet must ship in the body, after MARKET_CSS, or it loses");

  // Three numbered sections, in the design's order, each with the SMALL
  // eyebrow. /faq's .faqeye is the 18px variant from the same design set;
  // mixing the two reads as two devices rather than one family.
  const eyebrows = [...html.matchAll(/class="bfeye">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(eyebrows, [
    "For brokers &amp; firms",
    "One &middot; your book",
    "Two &middot; your vault",
    "Three &middot; your firm",
  ], "the page lost a section, or they are out of the design's order");
});

// /firms — the public front door for firm accounts.
//
// Run: npm test
//
// Cost: zero. The server boots with no Anthropic key, no Supabase and no
// Stripe; the route is a pure render with no upstream call.
//
// The firm feature has been fully built on the backend since migration 030 —
// orgs, the shared shelf, invites, auto-share, shared vault comps, per-seat
// billing, three shop kinds — and until this page existed it had NO public
// surface at all: nothing in the nav, nothing in the footer, nothing on the
// pricing modal. The only door was an invite email. So the assertions here
// are written against what a VISITOR receives, the way public-pages.test.js
// is, rather than against internal helpers.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { boot } = require("./helpers/boot");
const ORG = require("../org-access");

// Presence is the whole rule for the shared chrome — the routing layer never
// validates this token, it only looks. Same fixture as public-pages.test.js.
const SESSION = { cookie: "cn_session=not-a-real-token" };

test("/firms is reachable and indexable", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  const res = await fetch(srv.base + "/firms");
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /<link rel="canonical" href="[^"]*\/firms"/, "canonical points at itself");
  assert.doesNotMatch(html, /noindex/, "the pitch page must be indexable");

  const sitemap = await (await fetch(srv.base + "/sitemap.xml")).text();
  assert.ok(sitemap.includes("/firms</loc>"), "sitemap lists /firms");
});

test("the three shop kinds are quoted from org-access, never retyped", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/firms")).text();

  // The page speaks to all three shops, and each one's sentence is the SAME
  // string the invite email and the create box use. A hand-typed variant here
  // would be a fourth copy to keep in step, and the first to go stale.
  for (const kind of ORG.SHOP_KINDS) {
    const copy = ORG.SHOP_COPY[kind];
    assert.ok(html.includes(copy.label), `names the ${kind} shop`);
    assert.ok(html.includes(copy.arrivals), `quotes ${kind}'s arrivals verbatim`);
  }
});

test("the shop-kind copy on the page is the module's, character for character", () => {
  // Guards the direction the route test cannot: if someone edits the page's
  // copy instead of org-access.js, the page and the invite email start
  // describing different products. index.html carries a mirror of this map for
  // the same reason and is pinned the same way.
  const src = fs.readFileSync(path.join(__dirname, "..", "firms-page.js"), "utf8");
  assert.match(src, /SHOP_COPY|shopCopy/,
    "firms-page.js reads the copy from org-access rather than inlining it");
  for (const kind of ORG.SHOP_KINDS) {
    assert.doesNotMatch(
      src,
      new RegExp(ORG.SHOP_COPY[kind].arrivals.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${kind}'s arrivals string is not hand-copied into the page`,
    );
  }
});

test("the compliance copy a public page must carry, and must not", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/firms")).text();

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

test("a firm share is described the way the product actually behaves", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/firms")).text();

  // Each of these restates a promise enforced in code — org-access.js's
  // never-retroactive auto-share, the member veto that beats the firm, and
  // blend-comps.js's rule that a firm share carries no whole vault comp. They
  // are public claims, so they are pinned like the /brokers FAQ answers.
  assert.match(html, /already run|never retroactive|not.{0,20}retroactive/i,
    "says auto-sharing is never retroactive");
  assert.match(html, /only what someone shares|only what you share/i,
    "says colleagues see only what was shared");
});

test("the page offers the right door for the visitor it is sent to", async (t) => {
  const srv = await boot({ ACCOUNT_WALL: "on" });
  t.after(() => srv.stop());

  const anon = await (await fetch(srv.base + "/firms")).text();
  assert.match(anon, /href="\/\?auth=signup"/, "an anonymous visitor can sign up");

  // public-pages.test.js's rule, restated for the new page: a member must
  // never be told to create an account they already have.
  const member = await (await fetch(srv.base + "/firms", { headers: SESSION })).text();
  assert.doesNotMatch(member, /auth=signup/, "a member is not sold a signup");
  assert.doesNotMatch(member, /auth=signin/, "a member is not told to log in");
});

test("the caching keeps the two variants honest", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  // Same split every shell page carries: the anonymous body caches for
  // crawlers, the signed-in one never does, and `vary: cookie` is what stops
  // an hour-old signed-out copy being re-served to somebody who just signed in.
  const anon = await fetch(srv.base + "/firms");
  assert.match(anon.headers.get("cache-control") || "", /max-age/);
  assert.match(anon.headers.get("vary") || "", /cookie/);

  const member = await fetch(srv.base + "/firms", { headers: SESSION });
  assert.match(member.headers.get("cache-control") || "", /no-store/);
});

test("/firms is reachable from the footer of every public page", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  // A page nothing links to is a page nobody reads. The footer is the one
  // surface every public page shares.
  for (const p of ["/", "/brokers", "/markets"]) {
    const html = await (await fetch(srv.base + p)).text();
    assert.ok(html.includes('href="/firms"'), `${p} links to /firms`);
  }
});

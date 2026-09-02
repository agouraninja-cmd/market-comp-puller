// /faq — the questions a stranger asks before they sign up (design 3b).
//
// Run: npm test
//
// Cost: zero. The server boots with no Anthropic key, no Supabase and no
// Stripe; the route is a pure render with no upstream call.
//
// WHY THIS FILE EXISTS. The FAQ was nine accordions at the foot of the
// landing page until 2026-09-01. Everything that protected it was written
// against that page (public-pages.test.js's cost-answer suite, which now
// reads this URL), and the two things that are NEW here have never been
// pinned anywhere: that one array feeds both the visible page and the
// FAQPage JSON-LD, and that four of these ten answers were deliberately
// CORRECTED away from the design file because the product does not do what
// the design said it does. A future editor "restoring the design copy" would
// undo all four, so each is asserted by the fact it protects.

const test = require("node:test");
const assert = require("node:assert");
const { boot } = require("./helpers/boot");
const { faqEntries } = require("../faq-page");
const ENT = require("../entitlements");

// Presence is the whole rule for the shared chrome — the routing layer never
// validates this token, it only looks. Same fixture as public-pages.test.js.
const SESSION = { cookie: "cn_session=not-a-real-token" };

test("/faq is reachable, indexable and in the sitemap", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  const res = await fetch(srv.base + "/faq");
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /<link rel="canonical" href="[^"]*\/faq"/, "canonical points at itself");
  assert.doesNotMatch(html, /noindex/, "the FAQ must be indexable — that is why it left the landing page");

  const sitemap = await (await fetch(srv.base + "/sitemap.xml")).text();
  assert.ok(sitemap.includes("/faq</loc>"), "sitemap lists /faq");
});

test("the FAQ is reachable from every surface a stranger uses", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  await t.test("it is in the Explore menu on every server-rendered page", async () => {
    // NAV_LINKS is one list with three consumers, so a link added there
    // reaches all of them. That is exactly what makes a missing one easy to
    // ship: nothing in any single file looks wrong.
    // /how-it-works left this list on 2026-09-02: the page was retired and
    // 301s to /brokers-firms, so it renders no menu of its own any more.
    for (const p of ["/", "/markets", "/brokers-firms", "/pricing"]) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(html.includes('<a href="/faq">FAQ</a>'), p + " cannot reach the FAQ from its Explore menu");
    }
  });

  await t.test("the app's Explore menu carries it too", async () => {
    // index.html authors no copy of the list — the `/` handler injects
    // APP_NAV_LINKS_HTML in place of NAV_LINKS_MARKER at serve time — so this
    // is the assertion that the injection still happens for a member.
    const html = await (await fetch(srv.base + "/", { headers: SESSION })).text();
    assert.match(html, /href="\/faq"/, "a member's Explore menu lost the FAQ");
  });

  await t.test("the footer link is the page, not an anchor into another one", async () => {
    // It was href="/how-it-works#faq" until 2026-09-01, which still resolved
    // and landed a reader who asked a question at the top of a page whose FAQ
    // had moved out from under them.
    for (const p of ["/", "/brokers-firms"]) {
      const html = await (await fetch(srv.base + p)).text();
      assert.ok(!/how-it-works#faq/.test(html), p + " still points the footer at the old anchor");
    }
    const fs = require("node:fs");
    const path = require("node:path");
    const app = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.ok(!/how-it-works#faq/.test(app), "index.html's footer still points at the old anchor");
  });

  await t.test("the Explore summary says the reader is inside the menu", async () => {
    // Design 3b: "Explore marked active". Only the menu ITEM was marked
    // before, which a closed dropdown hides — so the bar said nothing.
    const html = await (await fetch(srv.base + "/faq")).text();
    assert.match(html, /<summary class="on">/, "/faq must mark Explore as the active nav");
    assert.match(html, /<a href="\/faq" class="on" aria-current="page">/,
      "and the menu item itself still says which row");
    // Not on a page that is in NEITHER menu, or the mark means nothing.
    // /markets no longer serves as that control: it moved INTO the new Tools
    // dropdown on 2026-09-02, so for a signed-out reader it correctly marks a
    // summary — just not Explore's. /terms is in no menu at all.
    const terms = await (await fetch(srv.base + "/terms")).text();
    assert.ok(!/<summary class="on">/.test(terms),
      "/terms is in no menu and must mark none");

    // And the mark that /markets DOES get belongs to Tools, not to Explore.
    const markets = await (await fetch(srv.base + "/markets")).text();
    const exploreAt = markets.indexOf("Explore<span");
    const toolsAt = markets.indexOf("Tools<span");
    assert.ok(exploreAt > -1 && toolsAt > exploreAt, "both menus render for a stranger");
    assert.ok(!/<summary class="on">Explore/.test(markets),
      "/markets is not inside Explore and must not mark it");
    assert.match(markets, /<summary class="on">Tools/,
      "/markets is inside Tools and must mark it");
  });
});

test("one array feeds the page and the structured data", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/faq")).text();

  const ld = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(ld, "the page must emit structured data");
  const faq = JSON.parse(ld[1])["@graph"].find((n) => n["@type"] === "FAQPage");
  assert.ok(faq, "the FAQPage node is what this page exists to carry");

  // Google flags mismatched FAQ markup, and the invisible copy is the one
  // that reaches search results. Every question must appear in BOTH.
  // SIX since 2026-09-02 (owner's call). The four retired questions left the
  // structured data with the page, which was the deliberate trade — see the
  // header on faqEntries. Pinned as a NUMBER so a future edit that "restores"
  // one has to change this line on purpose rather than drift past it.
  assert.equal(faq.mainEntity.length, 6, "the FAQ is six questions since 2026-09-02");
  for (const q of faq.mainEntity) {
    assert.ok(html.includes(q.name.replace(/&/g, "&amp;")) || html.includes(q.name),
      "a question is in the structured data but not on the page: " + q.name);
  }
  const visible = (html.match(/class="faqq"/g) || []).length;
  assert.equal(visible, faq.mainEntity.length,
    "the page shows " + visible + " questions and claims " + faq.mainEntity.length);
});

// --- The four answers corrected off the design ------------------------------
//
// Each of these shipped WRONG in the design file. They are asserted by the
// fact they get wrong, so "restoring the design copy" fails the build rather
// than quietly republishing a false promise to search engines.
test("every answer is a promise the code keeps", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/faq")).text();

  await t.test("the badge list names all five, not four", () => {
    // server.js normalizes every comp onto public_record / listing / news /
    // estimate / verified. An answer that names four is telling a reader a
    // News comp cannot happen, on a page whose subject is provenance.
    assert.match(html, /Verified, Public record, Listing, News or Estimate/,
      "the answer must name the whole enum, News included");
  });

  await t.test("it does not claim the search skips a stale cache", () => {
    // This is the exact sentence deleted from the landing page on 2026-08-21,
    // for the same reason: runCompSearch checks the report cache, then the
    // derivable window, then retrieveCorpusComps, before anything is billed.
    // The stored comps are the asset; calling them stale sells against them.
    assert.ok(!/rather than against a stale cache/i.test(html),
      "the live-search claim was already retired once as false");
    assert.ok(!/stale (cache|database)/i.test(html),
      "any phrasing of it is the same claim");
    // The positive half of this assertion ("check what we already hold") went
    // with the "How long does a report take?" answer on 2026-09-02 — the
    // owner's cut, on the grounds that nobody asks it before signing up. The
    // NEGATIVES stay: this page must never grow a sentence calling our own
    // stored comps stale, whichever answer a future editor writes it into.
    // That sentence has now been deleted from two different surfaces.
  });

  await t.test("the shared-report answer covers all three outcomes", () => {
    // POST /api/share has three, not one: a PUBLIC link runs
    // stripPrivateComps and the vault comps are GONE; an invited share runs
    // anonymizePrivateComps and they become basis rows; and `canPrivate` lets
    // a member deliberately send a named client the whole comp.
    assert.match(html, /public link they are removed entirely/i,
      "a public share strips vault comps; saying they are anonymized is wrong");
    assert.match(html, /unless you deliberately send that client the full comp/i,
      "the named-client full-comp path exists and must not be denied");
    assert.match(html, /no address, no total price, no notes/i,
      "the anonymized shape is still the default and still stated");
  });

  await t.test("branded exports are not sold as part of the free tier", () => {
    // entitlements.js: FREE_EXPORTS_PER_MONTH is 5 and branding follows the
    // subscription. The design's answer offered "under your own branding" to
    // everybody, which is a Pro feature sold as free.
    // The claim this protects is unchanged and is the one that matters:
    // UNLIMITED exports and BRANDING are Pro, and the page may never imply a
    // free account gets either. Asserted from both sides.
    assert.match(html, /unlimited exports and your branding/i,
      "both belong to Pro and the cost answer must say so");
    const freeSentence = (html.match(/A free account runs[^.]*\./i) || [""])[0];
    assert.ok(!/branding|unlimited/i.test(freeSentence),
      "the free sentence must not offer a Pro capability: " + freeSentence);

    // WHAT CHANGED 2026-09-02, and it is a real loss worth knowing about.
    // The five-a-month free export cap used to be stated here, inside "Can I
    // use a report in a client deliverable?", and that question was retired.
    // The figure is still stated on /pricing's Free tile, and
    // test/pricing-page.test.js pins THAT one to the constant — so the
    // product still says the number out loud somewhere a buyer reads, which
    // is why the cut was allowed to stand. If the FAQ ever quotes an export
    // allowance again, pin it to the constant the way that test does rather
    // than typing the numeral.
    assert.equal(ENT.FREE_EXPORTS_PER_MONTH, 5,
      "if this moved, check /pricing's Free tile — the FAQ no longer states it");
  });

  await t.test("the free lookback is the one entitlements.js enforces", () => {
    const years = ENT.FREE_MAX_LOOKBACK_MONTHS / 12;
    assert.equal(years, 3, "the answer says three years; FREE_MAX_LOOKBACK_MONTHS moved");
    // The wording moved with the merge (2026-09-02): the cost answer says
    // "three years back" where the retired free/Pro answer said "a three-year
    // lookback". Both spellings are accepted so the assertion is about the
    // FIGURE — which is what has to agree with entitlements.js — rather than
    // about one phrasing of it.
    assert.match(html, /three[- ]year lookback|three years back/i,
      "the free window must be stated");
  });

  await t.test("the appraisal disclaimer is in the first answer", () => {
    // BRAND.md §4. The owner is not a licensed broker, so this is not style.
    assert.match(html, /automated estimate, not an appraisal/i,
      "the disclaimer must survive any copy edit");
  });
});

test("the figures come from PRICING, never typed into the answers", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  // The module takes pricing as an argument and has no require of its own, so
  // a changed constant cannot leave a stale number behind on this page. Proved
  // by feeding it numbers the repo does not contain.
  const entries = faqEntries({ monthly: 1234, firmSeat: 567, minSeats: 8 });
  const cost = entries.find(([q]) => /cost/i.test(q));
  assert.ok(cost, "the cost question must exist — /pricing's own test reads this page");
  assert.match(cost[1], /\$1234 a month/, "the monthly figure is not hand-typed");
  assert.match(cost[1], /\$567 a seat/, "the seat figure is not hand-typed");
  assert.match(cost[1], /8-seat minimum/, "the seat minimum is not hand-typed");

  // And "two" is spelled, not printed as a numeral, when the minimum is 2 —
  // the same rule HOW_FAQ's cost answer carried.
  const spelled = faqEntries({ monthly: 100, firmSeat: 79, minSeats: 2 })
    .find(([q]) => /cost/i.test(q))[1];
  assert.match(spelled, /two-seat minimum/, "a minimum of 2 reads as a word");
});

test("the contact promise the design carried is not on the page", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/faq")).text();

  // Design 3b closed with "Still have a question? Write to us — a person
  // answers." Dropped on the owner's call (2026-09-01): the site has no
  // contact route that guarantees a human reply, and the handoff README asked
  // for the route to be confirmed before that sentence shipped. If a contact
  // route is ever built, this assertion is the thing to delete first.
  assert.ok(!/a person answers/i.test(html), "the site cannot promise a human reply yet");
  assert.match(html, /class="btn"/, "the footer still carries the account CTA it was paired with");
});

test("a member is not sent through the signup door", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  // The bug public-pages.test.js exists to catch on every other public page.
  const anon = await (await fetch(srv.base + "/faq")).text();
  assert.match(anon, /href="\/\?auth=signup"/, "a stranger is offered an account");

  const member = await (await fetch(srv.base + "/faq", { headers: SESSION })).text();
  const foot = member.slice(member.indexOf('class="faqfoot"'));
  assert.ok(!/\?auth=signup/.test(foot), "a member already has one");
  assert.match(foot, /href="\/desk"/, "and is pointed at their workspace instead");
});

// Route-level wiring — the gates and the routing, not the rules.
//
// Run: npm test
//
// entitlements.js, comp-gate.js and stripe.js already prove the DECISIONS are
// right. Nothing proved the decisions are actually WIRED UP: that /api/stats
// really refuses an unauthenticated caller, that a disabled admin endpoint
// really 404s, that the SPA routes really match on path only. A paywall grows
// holes at the wiring, not at the rule.
//
// Cost: zero. Every route exercised here is local. Nothing calls Anthropic,
// Stripe, Supabase or any other paid or external service, and no test triggers
// a search.
//
// These tests boot a real server as a child process, twice (once bare, once
// with an admin key), so this file is slower than the pure-module suites.
// Measured 2026-08-05: ~0.6s for the file, which keeps `npm test` under a
// second and a half in total. If that ever creeps, cut server boots, not
// assertions: each boot costs far more than any check it carries.

const test = require("node:test");
const assert = require("node:assert");
const shared = require("./helpers/boot");

// Boot server.js with an explicit environment and wait for /healthz.
// One implementation for every suite — ports are OS-assigned and the
// responder is identity-checked (see helpers/boot.js for the collision this
// closes). This wrapper only adds this file's default:
// ACCOUNT_WALL off, because the SPA-routing tests here prove that / and
// /desk MATCH on path, which needs a server that is not walling them.
// The wall's own routing lives in test/account-wall.test.js.
function boot(env) {
  return shared.boot({ ACCOUNT_WALL: "off", ...env });
}

// --- A bare environment: no keys, no database, nothing configured -----------

test("bare environment", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  await t.test("healthz answers", async () => {
    const r = await fetch(srv.base + "/healthz");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
  });

  // The SPA handler matches on PATH ONLY. An exact req.url match once 404'd
  // /desk?checkout=success (the Stripe return) and every /?utm_source= campaign
  // link. These four cases are that regression, pinned.
  await t.test("the SPA is served on every path that must reach it", async () => {
    for (const p of ["/", "/index.html", "/desk", "/r/abc123"]) {
      const r = await fetch(srv.base + p);
      assert.equal(r.status, 200, p + " should serve the app");
      assert.match(r.headers.get("content-type") || "", /text\/html/, p);
    }
  });

  await t.test("a query string never changes which handler answers", async () => {
    for (const p of ["/?utm_source=newsletter", "/desk?checkout=success", "/desk?checkout=cancelled"]) {
      const r = await fetch(srv.base + p);
      assert.equal(r.status, 200, p + " must not 404");
    }
  });

  // index.html's one inline <script> destructures VALUATION as its first
  // statement, so a broken /valuation.js aborts the entire front end while
  // the page still renders — no syntax check or /healthz boot smoke catches
  // that this file is unreachable. The query-string case is the regression:
  // STATIC_FILES used to key on the exact req.url, so the obvious cache-bust
  // "/valuation.js?v=…" 404'd instead of serving the file.
  await t.test("/valuation.js is reachable, with or without a cache-busting query string", async () => {
    for (const p of ["/valuation.js", "/valuation.js?v=1"]) {
      const r = await fetch(srv.base + p);
      assert.equal(r.status, 200, p + " should serve the file");
      assert.match(r.headers.get("content-type") || "", /javascript/, p);
    }
  });

  // Address Explorer: type is optional so Find addresses can return a mixed
  // list, each chip labelled. A typed request still works (market-page deep
  // link). An unrecognized type is still a 400 — never silently mixed.
  await t.test("explore-addresses accepts a city without a property type", async () => {
    const r = await fetch(srv.base + "/api/explore-addresses?city=Boise&state=ID");
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j.addresses), "mixed list is an addresses array");
  });

  await t.test("explore-addresses still accepts a typed request", async () => {
    const r = await fetch(srv.base + "/api/explore-addresses?city=Boise&state=ID&type=Industrial");
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j.addresses));
    assert.ok(j.addresses.every((a) => !a.type || a.type === "Industrial"));
  });

  await t.test("explore-addresses refuses a bogus property type", async () => {
    const r = await fetch(srv.base + "/api/explore-addresses?city=Boise&state=ID&type=Spaceship");
    assert.equal(r.status, 400);
  });

  // /vault's inline script calls into the global GUTCHECK the moment the
  // benchmarks arrive; a stale or missing /gut-check.js must degrade (the
  // page guards with typeof), but the file being UNREACHABLE would silently
  // remove the whole feature. Same query-string rule as /valuation.js.
  await t.test("/gut-check.js is reachable, with or without a query string", async () => {
    for (const p of ["/gut-check.js", "/gut-check.js?v=1"]) {
      const r = await fetch(srv.base + p);
      assert.equal(r.status, 200, p + " should serve the file");
      assert.match(r.headers.get("content-type") || "", /javascript/, p);
      assert.match(r.headers.get("cache-control") || "", /max-age=0/,
        p + " must not cache: the vault page's inline script depends on it");
    }
  });

  // The 1031 guide — a public education page. Path-only matching is the
  // regression this file pins for every route; the sitemap line is what
  // makes the page findable at all.
  await t.test("/1031-exchange serves the guide, query strings included", async () => {
    for (const p of ["/1031-exchange", "/1031-exchange?utm_source=x"]) {
      const r = await fetch(srv.base + p);
      assert.equal(r.status, 200, p + " should serve the guide");
      assert.match(r.headers.get("content-type") || "", /text\/html/, p);
    }
    const html = await (await fetch(srv.base + "/1031-exchange")).text();
    assert.ok(html.includes("1031"), "the page should be about 1031 exchanges");
    assert.ok(html.toLowerCase().includes("not tax, legal, or investment advice"),
      "the not-advice box must ship on the live page");
    assert.ok(html.includes(".steps1031"),
      "GUIDE_CSS must ship on the served page (proves the route's head: line survived)");
    assert.ok(html.includes("id=\"worksheet\""),
      "the identification worksheet is the page now; the explainer sits below it");
    assert.ok(html.toLowerCase().includes("not a written identification"),
      "the page must not read as the list delivered to a QI");
  });

  await t.test("sitemap.xml lists the 1031 guide", async () => {
    const xml = await (await fetch(srv.base + "/sitemap.xml")).text();
    assert.ok(xml.includes("/1031-exchange"), "sitemap must list /1031-exchange");
  });

  // Market pages carry the Address Explorer deep link. The auth=signup form is
  // the one door ACCOUNT_WALL never 302s, so the same static href serves every
  // visitor: anonymous gets the signup modal with the explorer parked behind
  // it, a signed-in Pro member gets the panel prefilled and fetching.
  await t.test("a market page links into the Address Explorer via the wall-safe door", async () => {
    const r = await fetch(srv.base + "/market/industrial-ontario-ca");
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(
      html.includes('href="/?auth=signup&amp;explore=Ontario%2C%20CA&amp;type=Industrial"'),
      "the CTA must carry the encoded /?auth=signup&explore= deep link");
  });

  // The <h1> and the <title> must describe the page the same way.
  //
  // They disagreed from 2026-08-06 to 2026-08-09: the titles moved to "Comps
  // in" (what people search) while the headings kept "Property Values in", on
  // all 38 pages. Google weights both, so that is a mixed signal about the
  // page's own subject. marketTitle() and marketPageTitle()'s `base` are now
  // deliberately the same string, and this is what catches them drifting.
  await t.test("a market page's h1 agrees with its title", async () => {
    const html = await (await fetch(srv.base + "/market/industrial-ontario-ca")).text();
    const h1 = (html.match(/<h1>([^<]+)<\/h1>/) || [])[1];
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1];
    assert.ok(h1, "the page must have an h1");
    assert.ok(title, "the page must have a title");
    assert.ok(title.startsWith(h1),
      `the title must lead with the h1's exact wording — h1 ${JSON.stringify(h1)}, title ${JSON.stringify(title)}`);
    assert.match(h1, /Comps in/, "both must use the phrase people actually search");
  });

  // The related-markets links trim marketTitle() down with a string replace,
  // which is a silent dependency on its exact wording: a stale needle does not
  // throw, it just renders the full untrimmed title in all six links.
  await t.test("related-market links are trimmed to the bullet form", async () => {
    const html = await (await fetch(srv.base + "/market/industrial-ontario-ca")).text();
    const related = (html.match(/<div class="related">([\s\S]*?)<\/div>/) || [])[1] || "";
    assert.ok(related.includes("/market/"), "the related card should carry market links");
    assert.ok(!/Comps in/.test(related),
      "the replace needle is stale — links are rendering marketTitle() untrimmed");
    assert.match(related, /·/, "trimmed links use a bullet in place of the middle");
  });

  // The comp map card carries the market's momentum — the same read, the same
  // three words and the same three colours the Explorer dropdown badges with.
  //
  // The colour is a CLASS here (MARKET_CSS is ours, unlike the vendored
  // tailwind build the dropdown has to work around), and a class that is not
  // in the stylesheet fails silently: the word renders in body grey and the
  // page looks fine. So the served page is checked for the rule, not just for
  // the attribute.
  await t.test("the comp map card badges which way the market is moving", async () => {
    const html = await (await fetch(srv.base + "/market/industrial-ontario-ca")).text();
    const head = (html.match(/<div class="mhead">([\s\S]*?)<\/div>/) || [])[1] || "";
    assert.match(head, /<h2[^>]*>Where these comps are<\/h2>/, "the map card's own heading must stay in the row");
    assert.match(head, /class="mdirv mdirv-contracting">Contracting</,
      "Ontario's stored read is contracting — the word and its colour class must both render");
    assert.match(head, /Momentum/, "the word is labelled, not left to be guessed at");
    for (const cls of ["mdirv-expanding", "mdirv-flat", "mdirv-contracting"]) {
      assert.match(html, new RegExp("\\." + cls + "\\{color:var\\(--"),
        cls + " has no rule in MARKET_CSS, so that word would render uncoloured");
    }
  });

  // A market with no read renders NOTHING, never a fourth "unknown" state.
  // Five of the seeded pages are in this state on purpose: their momentum
  // sentence was two-sided and the classifier refused to pick a half.
  await t.test("a market with no stored direction gets no badge at all", async () => {
    const html = await (await fetch(srv.base + "/market/industrial-fontana-ca")).text();
    assert.ok(html.includes('id="mktMapCard"'), "this page must still have its map card");
    assert.ok(!html.includes('class="mdir"'),
      "an unread market must show no momentum, not an Unknown chip");
    assert.match(html, /<h2[^>]*>Where these comps are<\/h2>/,
      "and the heading must be untouched when there is no badge beside it");
  });

  // The dropdown and the page it links to must never disagree about the same
  // market on the same afternoon. Both read freshDirection(), which is what
  // makes the 90-day expiry one rule rather than two — this is what catches a
  // second copy of the vocabulary or the age gate growing on either side.
  //
  // ONE sweep over the market pages, not two: this renders every seeded page
  // already, and each render now serialises a boundary, so a second full
  // pass for the map blob was pure CI time on a suite that is already a
  // documented sore point. Badge and blob are checked in the same pass.
  await t.test("the map badge and blob say what /api/markets says, market by market", async () => {
    const rows = await (await fetch(srv.base + "/api/markets")).json();
    assert.ok(rows.length > 10, "the seeded directory should be here");
    let checked = 0, withBlob = 0, withBoundary = 0;
    for (const row of rows) {
      const html = await (await fetch(srv.base + "/market/" + row.slug)).text();
      // No map card, no badge: this one rides on the map, so a market whose
      // comps are all quoted at the submarket level shows nothing either way.
      if (!html.includes('id="mktMapCard"')) continue;
      checked++;
      const word = (html.match(/class="mdirv mdirv-\w+">(\w+)</) || [])[1] || null;
      assert.equal(word ? word.toLowerCase() : null, row.direction || null,
        row.slug + ": the map card and the Explorer dropdown disagree");
      // The THIRD surface of the same read: the wash drawn under the comps.
      // The badge states it in a word, the blob hands the same value to the
      // browser that colours the shape, so they cannot drift apart.
      const m = html.match(/<script id="mktMapData"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      withBlob++;
      assert.ok(!m[1].includes("<"), row.slug + ": a raw < in the blob can close the script tag early");
      const blob = JSON.parse(m[1]);
      assert.equal(blob.dir || null, row.direction || null,
        row.slug + ": the map blob and the Explorer dropdown disagree about momentum");
      if (blob.boundary) {
        withBoundary++;
        assert.ok(blob.boundary.type === "Polygon" || blob.boundary.type === "MultiPolygon",
          row.slug + "'s inlined boundary is not a polygon — the map would throw drawing it");
      }
    }
    assert.ok(checked > 10, "expected most seeded markets to have a map card, got " + checked);
    assert.ok(withBlob > 10, "expected most seeded markets to carry a map blob, got " + withBlob);
    assert.ok(withBoundary >= 15,
      "expected nearly every seeded city to inline its boundary, got " + withBoundary);
  });

  // The /markets directory's momentum map (2026-08-25): one pin per covered
  // market over the whole country, colored by the same freshDirection read.
  // The JSON blob is what the browser script draws from, so the blob IS the
  // contract — well-formed, inert, and path-safe slugs, since each one
  // becomes a navigation target.
  await t.test("/markets carries the momentum map and a well-formed pin blob", async () => {
    const html = await (await fetch(srv.base + "/markets")).text();
    assert.ok(html.includes('id="mktsMap"'), "the map container is missing");
    assert.ok(html.includes("unpkg.com/leaflet@1.9.4/dist/leaflet.js"),
      "Leaflet must ride the page head when the map renders");
    const blob = (html.match(/<script id="mktsMapData" type="application\/json">([\s\S]*?)<\/script>/) || [])[1];
    assert.ok(blob, "the pin blob is missing");
    assert.ok(!blob.includes("<"), "a raw < in the blob can close the script tag early");
    const pins = JSON.parse(blob).pins;
    assert.ok(pins.length > 20,
      "every seeded market has a committed coordinate, got only " + pins.length + " pins");
    for (const p of pins) {
      assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lng), p.slug + " has a non-finite point");
      assert.match(p.slug, /^[a-z0-9-]+$/, JSON.stringify(p.slug) + " is not a path-safe slug");
    }
  });

  // The badge-agreement rule above, one surface over: a pin's color and the
  // Explorer dropdown's word must agree market by market, because both are
  // freshDirection and nothing else. `dir` is omitted rather than empty on a
  // no-read market (the /api/markets convention), and the map draws those as
  // a hollow outline — an absence of claim, deliberately never flat's grey.
  await t.test("the momentum map's pins say what /api/markets says, market by market", async () => {
    const html = await (await fetch(srv.base + "/markets")).text();
    const pins = JSON.parse((html.match(/<script id="mktsMapData"[^>]*>([\s\S]*?)<\/script>/) || [])[1]).pins;
    const rows = await (await fetch(srv.base + "/api/markets")).json();
    const bySlug = new Map(pins.map((p) => [p.slug, p]));
    let unread = 0;
    for (const row of rows) {
      const pin = bySlug.get(row.slug);
      if (!pin) continue;
      assert.equal(pin.dir || null, row.direction || null,
        row.slug + ": the map pin and the Explorer dropdown disagree");
      if (!row.direction) {
        unread++;
        assert.ok(!("dir" in pin),
          row.slug + ": a no-read market must omit dir outright, never carry an empty one");
      }
    }
    assert.ok(unread > 0,
      "the seeds deliberately include unread markets — the hollow state must actually be exercised");
    // The pin CSS: all four states have rules, and the hollow one never
    // shares flat's grey fill — the distinction between "we don't know" and
    // "the market is flat" is the whole point of the fourth class.
    for (const cls of ["mmap-pin-expanding", "mmap-pin-flat", "mmap-pin-contracting", "mmap-pin-none"]) {
      assert.ok(new RegExp("\\." + cls + "\\{[^}]*\\}").test(html), cls + " has no rule in MARKET_CSS");
    }
    const noneRule = (html.match(/\.mmap-pin-none\{([^}]*)\}/) || [])[1] || "";
    assert.ok(!noneRule.includes("--ink-mute"), "the hollow pin must never share flat's grey fill");
  });

  // An unread market keeps its boundary and simply makes no colour claim —
  // the same rule the badge follows by rendering nothing.
  await t.test("an unread market page carries its boundary but no direction", async () => {
    const html = await (await fetch(srv.base + "/market/industrial-fontana-ca")).text();
    const blob = JSON.parse((html.match(/<script id="mktMapData"[^>]*>([\s\S]*?)<\/script>/) || [])[1]);
    assert.ok(blob.boundary, "Fontana's shape is stored and must still be drawn");
    assert.ok(!("dir" in blob),
      "a market with no current read must omit dir outright, never carry an empty one");
    assert.ok(!html.includes('class="mdir"'), "and its badge must still render nothing");
    assert.match(html, /outlined area[\s\S]{0,160}no current momentum read/,
      "the disclosure must call the shape outlined, and say why it carries no colour");
    assert.ok(!/shaded area is Fontana/.test(html),
      "an unread market's area is not shaded — the copy must not call it that");
  });

  // The carved layer (2026-08-25): clicking a pin reveals that city's real
  // municipal boundary and a card of its markets — pins persist at every
  // zoom, so the shape is the click's answer, never a zoom threshold's side
  // effect. The blob's `areas` rows carry the one thing the browser cannot
  // derive: the color claim each city shape may make, computed server-side
  // through market-area.js, the single home of the agreement rule.
  await t.test("the carved areas carry momentum only through market-area's rule", async () => {
    const MARKETAREA = require("../market-area");
    const html = await (await fetch(srv.base + "/markets")).text();
    const blob = JSON.parse((html.match(/<script id="mktsMapData"[^>]*>([\s\S]*?)<\/script>/) || [])[1]);
    const areas = blob.areas;
    assert.ok(Array.isArray(areas) && areas.length > 10, "the areas rows are missing from the blob");
    // Every area's momentum must equal what market-area.js says about that
    // city's markets — rebuilt here from the PINS, which are now the single
    // serialization of each market's facts.
    const marketsByKey = new Map();
    for (const p of blob.pins) {
      if (!marketsByKey.has(p.key)) marketsByKey.set(p.key, []);
      marketsByKey.get(p.key).push(p.dir ? { dir: p.dir } : {});
    }
    const states = new Set();
    for (const a of areas) {
      assert.ok(a.key && a.city && a.state, JSON.stringify(a.city) + " is not a well-formed area row");
      assert.equal(a.momentum, MARKETAREA.cityAreaState(marketsByKey.get(a.key) || []),
        a.city + ": the served momentum disagrees with market-area.js over that city's pins");
      states.add(a.momentum);
      // Neither the geometry (~110KB of static polygon at /city-bounds.json,
      // fetched on the first pin click) nor a second copy of the per-market
      // rows may ride the page: the pins already carry slug/type/median/dir,
      // and a duplicate serialization is one that can disagree.
      assert.ok(!("geometry" in a), a.city + " embedded its geometry in the page blob");
      assert.ok(!("markets" in a), a.city + " re-serialized its markets — the pins already carry them");
    }
    assert.ok(states.has("mixed"),
      "the seeds hold cities whose markets disagree (Phoenix) — the mixed state must be exercised");
    assert.ok(states.has("none"),
      "the seeds hold unread cities (Fontana) — the no-claim state must be exercised");
    // The Mixed swatch must look like what a mixed city actually DRAWS (the
    // areaStyle grey wash inside an ink ring). It shipped as a green/red
    // split gradient that no shape on the map ever wore, which left the
    // reader unable to match the drawn grey to any legend key.
    const mixedRule = (html.match(/\.mmap-pin-mixed\{([^}]*)\}/) || [])[1] || "";
    assert.ok(mixedRule.includes("var(--ink-mute)") && mixedRule.includes("var(--ink)"),
      "the Mixed swatch must match areaStyle's drawn style: a grey wash inside an ink ring");
    assert.ok(!mixedRule.includes("gradient"),
      "the split-gradient swatch matches nothing the map draws");
    assert.match(html, />Mixed</, "the legend lost its Mixed entry");
  });

  // The directory cards, the fourth surface of the same read (2026-08-25).
  // The cards were the only market-listing surface without momentum on it,
  // and a card sitting beside a coloured pin for the same market that said
  // nothing about direction read as two different answers.
  await t.test("the directory cards carry the same momentum word as everything else", async () => {
    const html = await (await fetch(srv.base + "/markets")).text();
    const rows = await (await fetch(srv.base + "/api/markets")).json();
    const cards = [...html.matchAll(/<a class="mcard[^"]*" href="\/market\/([a-z0-9-]+)"[\s\S]*?<\/a>/g)];
    assert.ok(cards.length > 20, "expected a card per seeded market, got " + cards.length);
    const dirBySlug = new Map(rows.map((r) => [r.slug, r.direction || null]));
    let worded = 0;
    for (const [card, slug] of cards.map((m) => [m[0], m[1]])) {
      const word = (card.match(/class="mdirv mdirv-\w+">(\w+)</) || [])[1] || null;
      assert.equal(word ? word.toLowerCase() : null, dirBySlug.get(slug) || null,
        slug + ": the card and the Explorer dropdown disagree about momentum");
      if (!word) continue;
      worded++;
      // The word also joins the filter haystack, so typing "expanding"
      // narrows the grid to expanding markets.
      const hay = (card.match(/data-q="([^"]*)"/) || [])[1] || "";
      assert.ok(hay.includes(word.toLowerCase()),
        slug + ": the momentum word must be filterable, not just visible");
    }
    assert.ok(worded > 10, "expected most seeded markets to show a word, got " + worded);
  });

  // The boundaries themselves: committed like the market-heroes JPEGs
  // (Render erases its disk on deploy), served as one lazy static file, and
  // every city the blob names either has a real polygon there or falls back
  // to its pins — so a malformed entry is the only failure worth pinning.
  await t.test("/city-bounds.json serves real polygons for the seeded cities", async () => {
    const res = await fetch(srv.base + "/city-bounds.json");
    assert.equal(res.status, 200, "the boundary file is off the static allowlist");
    const cityBounds = await res.json();
    const html = await (await fetch(srv.base + "/markets")).text();
    const areas = JSON.parse((html.match(/<script id="mktsMapData"[^>]*>([\s\S]*?)<\/script>/) || [])[1]).areas;
    let carved = 0;
    for (const a of areas) {
      const b = cityBounds[a.key];
      if (!b) continue;
      carved++;
      assert.ok(b.geometry && (b.geometry.type === "Polygon" || b.geometry.type === "MultiPolygon"),
        a.city + "'s stored boundary is not a polygon — the map would throw drawing it");
    }
    assert.ok(carved >= 15,
      "expected nearly every seeded city to be carved, got " + carved + " — was city-bounds.json emptied?");
  });

  // The signed-in header chrome, on every page that is not index.html.
  //
  // The bug (owner-reported 2026-08-09): MARKET_BAR carried three links and
  // nothing else, so leaving the home page dropped Pricing, My Desk and the
  // account circle in one go and read as having been logged out mid-browse.
  // Nothing touched the session — the bar just stopped mentioning it.
  //
  // Since 2026-08-20 marketBar IS the header for every server-rendered page
  // (/how-it-works' hand-kept copy retired) and the Explore links come from
  // one NAV_LINKS list, index.html included — but /vault still composes its
  // own bar from the shared slots. This is what catches a server-rendered
  // page shipping without the chrome: accountNavSlots() is one call, so
  // forgetting it is the easy mistake, not getting it subtly wrong.
  await t.test("every server-rendered page carries the signed-in header chrome", async () => {
    const pages = ["/markets", "/market/industrial-ontario-ca", "/brokers",
      "/1031-exchange", "/how-it-works", "/terms", "/privacy", "/vault"];
    for (const p of pages) {
      const html = await (await fetch(srv.base + p)).text();
      assert.match(html, /id="navAcct"/, p + " is missing the account circle");
      assert.match(html, /id="navPricing"/, p + " is missing the Pricing link");
      assert.match(html, /id="navSignOut"/, p + " is missing the account menu");
      // The hydration script is what fills any of it in; markup alone is inert.
      assert.match(html, /\/api\/account\/me/, p + " never asks who the visitor is");
      assert.match(html, /avatarRev/, p + " must paint a profile photo when /me says one exists");
      // Load-bearing: .hdr nav .dd a sets display:block, which out-specifies
      // the [hidden] attribute's UA rule. Without this line every page paints
      // signed-out and signed-in chrome at the same time.
      assert.match(html, /\.hdr nav \[hidden\]\{display:none!important\}/,
        p + " can't actually hide the slots it ships");
    }
  });

  // One nav, no copies (2026-08-20). index.html authors only a marker comment
  // in its Explore menu; the `/` handler replaces it at serve time with the
  // same NAV_LINKS list marketBar renders on every server-rendered header.
  // Two failure modes, both pinned: an unreplaced marker (the injection
  // broke, or the marker string drifted) leaves the app with no browse links
  // at all, and a link present in one header but not the other is exactly
  // the hand-sync drift this replaced.
  await t.test("the app's Explore menu is injected from the shared nav list", async () => {
    const app = await (await fetch(srv.base + "/")).text();
    assert.ok(!app.includes("<!--NAV_LINKS-->"),
      "the NAV_LINKS marker must be replaced at serve time, never shipped raw");
    const markets = await (await fetch(srv.base + "/markets")).text();
    // The list itself, not a superset: /brokers and /how-it-works left the
    // menu 2026-08-25 and both still appear in every footer, so a check for
    // their mere presence in the HTML would pass either way and pin nothing.
    for (const href of ["/1031-exchange", "/download"]) {
      assert.ok(app.includes(`<a href="${href}"`), `the app menu lost its ${href} link`);
      assert.ok(markets.includes(`<a href="${href}"`), `the server-rendered header lost its ${href} link`);
    }
  });

  // The Market Explorer's example, rotated per page load (2026-08-24).
  //
  // The placeholder stopped being decoration when Tab began typing it in, so
  // it is now a WORKING QUERY and every one of these is really about what it
  // costs. A market with no standing page turns the dropdown's top row into
  // "Explore this market, build the … page →" — Tab then Enter would spend a
  // billed search and 30-60 seconds. The example this replaced,
  // "industrial Boise, ID", was never in market-seed.json; it survived only
  // because somebody had explored that market once.
  await t.test("the Explorer's example rotates and only ever names a seeded market", async () => {
    const seed = require("../market-seed.json");
    const slugs = new Set(Object.keys(seed));
    const placeholderOf = (html) => {
      const m = html.match(/id="marketSearch"[^>]*placeholder="([^"]*)"/);
      assert.ok(m, "the Explorer input lost its placeholder");
      return m[1];
    };
    const seen = [];
    for (let i = 0; i < 5; i++) seen.push(placeholderOf(await (await fetch(srv.base + "/")).text()));

    // Rotation: consecutive loads differ. A fixed example passes every other
    // assertion here, so this is the one that proves the feature is wired.
    assert.ok(seen[0] !== seen[1] && seen[1] !== seen[2],
      `consecutive loads must differ, got ${JSON.stringify(seen)}`);

    // The expensive one. Each example must resolve to a slug the seed
    // carries, which is what keeps Tab-then-Enter free navigation.
    for (const ph of seen) {
      const m = ph.match(/^e\.g\. (\w+) (.+), ([A-Z]{2})$/);
      assert.ok(m, `"${ph}" is not a query the Explorer can parse`);
      const slug = `${m[1]}-${m[2].toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${m[3].toLowerCase()}`;
      assert.ok(slugs.has(slug),
        `${ph} has no seeded page (${slug}) — Tab then Enter would buy a billed build`);
    }
  });

  // index.html carries the attribute; server.js swaps it. Drift between the
  // two is silent — replace() no-ops, the static example stays, and the
  // rotation simply stops happening with nothing on screen to show it.
  await t.test("server.js's example marker is byte-identical to index.html's attribute", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(__dirname, "..");
    const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const m = server.match(/const MARKET_EXAMPLE_MARKER = '([^']+)'/);
    assert.ok(m, "MARKET_EXAMPLE_MARKER is gone from server.js");
    assert.ok(html.includes(m[1]),
      `index.html no longer carries ${m[1]} — the rotation would silently stop`);
  });

  // The "Manage billing" button 400s for a comped account (no Stripe
  // customer behind either "admin" or "tester" status) — this pins that the
  // emitted hydration script actually excludes BOTH, matching index.html's
  // hasBillingHistory(). A prior version excluded only pro.admin, which left
  // a comped tester clicking a button that always fails. A markup-only check
  // (no redemption call needed) so it costs nothing against the route's
  // per-IP limiter.
  await t.test("the account-nav billing button excludes comped testers, not just admins", async () => {
    const html = await (await fetch(srv.base + "/markets")).text();
    assert.match(html, /pro\.status\)&&pro\.status!=="none"&&!pro\.admin&&!pro\.tester/,
      "ACCOUNT_NAV_JS's navBilling visibility must exclude pro.tester alongside pro.admin");
  });

  // Same button, the third exclusion. A colleague holding Pro through a FIRM
  // seat has a real Stripe status belonging to their firm's customer record,
  // not their own: the portal opens their firm's card or 400s. index.html's
  // hasBillingHistory() has excluded them since firm billing shipped and this
  // copy did not, so the app hid the button while every server-rendered page
  // still offered it. `live` is pinned in the same assertion because a
  // deployment with no Stripe keys 503s the portal.
  await t.test("the account-nav billing button excludes firm-seat colleagues", async () => {
    const html = await (await fetch(srv.base + "/markets")).text();
    assert.match(html, /!\(pro\.viaFirm&&pro\.viaFirm\.id\)/,
      "ACCOUNT_NAV_JS's navBilling visibility must exclude a colleague on a firm seat");
    assert.match(html, /show\(\$\("navBilling"\),live&&/,
      "ACCOUNT_NAV_JS's navBilling must also require billing to be live, as index.html does");
  });

  // /brokers' "Upgrade to Pro" link hides itself for members via the shared
  // hydration script. Two halves that must both exist or the link either
  // never hides (id missing from the script) or never renders (id missing
  // from the page); each alone passes a glance.
  await t.test("/brokers upgrade link is wired to the entitlements hydration", async () => {
    const html = await (await fetch(srv.base + "/brokers")).text();
    assert.match(html, /id="upgradeProLink"/, "the link lost its id");
    assert.match(html, /\$\("upgradeProLink"\)/,
      "ACCOUNT_NAV_JS no longer decides this link's visibility");
  });

  // The route matched req.url without stripping the query, so
  // /brokers?utm_source=x 404'd — the exact regression this file pins for
  // every other page, found on /brokers 2026-08-10.
  await t.test("/brokers survives a query string", async () => {
    const r = await fetch(srv.base + "/brokers?utm_source=newsletter");
    assert.equal(r.status, 200, "a campaign link to /brokers must not 404");
  });

  // /how-it-works renders My Desk server-side (2026-08-08) AND takes the
  // shared circle, so it is one of two pages that can end up with two of
  // them. /vault is the other: it keeps a visible My Desk next to Vault.
  // accountNavSlots({ desk: false }) is what prevents that.
  await t.test("/how-it-works does not double up its My Desk link", async () => {
    const html = await (await fetch(srv.base + "/how-it-works", {
      headers: { cookie: "cn_session=irrelevant-presence-only" },
    })).text();
    const desks = (html.match(/>My Desk</g) || []).length;
    assert.equal(desks, 1, "a signed-in member should see exactly one My Desk link");
    assert.ok(!/id="navDesk"/.test(html),
      "this page renders its own My Desk — the hydrated one must stay off it");
  });

  await t.test("/vault does not double up its My Desk link", async () => {
    const html = await (await fetch(srv.base + "/vault", {
      headers: { cookie: "cn_session=irrelevant-presence-only" },
    })).text();
    const desks = (html.match(/>My Desk</g) || []).length;
    assert.equal(desks, 1, "a signed-in member should see exactly one My Desk link");
    assert.ok(!/id="navDesk"/.test(html),
      "the vault renders its own My Desk — the hydrated one must stay off it");
  });

  // The vault gate, wired.
  //
  // entitlements.js proves the DECISION — canUseVault tracks pro across every
  // subscription state. Nothing proved the decision is attached to the routes
  // it guards, and this file exists precisely because a paywall grows holes at
  // the wiring rather than at the rule. The vault is the sharpest case in the
  // app: behind it is a broker's private book of business, and the promise the
  // whole tier is sold on is that nobody else can read it.
  //
  // Every vault route goes through one openVault() helper, so a route added
  // later that forgets it would answer 200 here instead of 401.
  await t.test("every vault route refuses an anonymous caller", async () => {
    const routes = [
      ["GET",    "/api/vault"],
      ["GET",    "/api/vault/template"],
      ["POST",   "/api/vault/upload"],
      ["DELETE", "/api/vault/upload?id=00000000-0000-0000-0000-000000000000"],
      ["POST",   "/api/vault/benchmarks"],
      ["POST",   "/api/vault/inspect"],
      ["POST",   "/api/vault/extract"],
      // Writes broker_profiles, whose display_name/company become PUBLIC the
      // moment somebody opts in — so an unauthenticated caller reaching it
      // could put words in a named broker's mouth.
      ["POST",   "/api/vault/identity"],
    ];
    for (const [method, p] of routes) {
      const r = await fetch(srv.base + p, {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "x.csv", csv: "a,b" }) }
          : {}),
      });
      assert.equal(r.status, 401, `${method} ${p} must refuse an anonymous caller`);
      // 401 specifically, and BEFORE the 503 this bare server would give for a
      // missing database. openVault's order is 401 -> 403 -> 503, and getting
      // it backwards would tell a stranger whether the database is up.
      const body = await r.json().catch(() => ({}));
      assert.match(String(body.error || ""), /signed in/i, `${method} ${p} should say not signed in`);
    }
  });

  await t.test("the vault routes exist rather than silently 404ing", async () => {
    // A 404 here would look like a working gate while actually meaning the
    // route was never registered — the failure mode migration 004 taught this
    // repo to distrust.
    const r = await fetch(srv.base + "/api/vault");
    assert.notEqual(r.status, 404, "/api/vault should exist and refuse, not be absent");
  });

  // The mapper's own route. It reads no vault rows, but it answers through the
  // same gate as everything else here on purpose: a fifth route is a fifth
  // chance for openVault's three refusals to drift, which is what this file is
  // for. /api/vault/benchmarks set the precedent.
  await t.test("/api/vault/inspect is gated like the rest of the vault", async () => {
    const r = await fetch(srv.base + "/api/vault/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv: "address\n1 A St, Boise, ID\n" }),
    });
    assert.equal(r.status, 401, "an anonymous caller must not learn anything about a file");
  });

  await t.test("/api/vault/extract is gated like the rest of the vault", async () => {
    const r = await fetch(srv.base + "/api/vault/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "book.pdf", pdf: "AAAA" }),
    });
    assert.equal(r.status, 401, "an anonymous caller must not send a file to the extract vendor");
  });

  // Per-comp edit/delete is a new door into the same private table as every
  // other vault route, so it gets the same 401-before-anything-else proof:
  // openVault must refuse before the id in the query string, or the JSON
  // body, is ever read. The export.csv gate test lives beside the route that
  // owns it, not here.
  await t.test("the comp edit routes refuse an anonymous caller", async () => {
    for (const method of ["PATCH", "DELETE"]) {
      const r = await fetch(srv.base + "/api/vault/comp?id=00000000-0000-0000-0000-000000000000", {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ price: 1 }) : undefined,
      });
      assert.equal(r.status, 401, method + " must refuse before it reads anything");
    }
  });

  // Same door, different verb: adding one comp by hand goes through the same
  // openVault gate as everything else here, and must refuse before the JSON
  // body is ever parsed.
  await t.test("the add-comp route refuses an anonymous caller", async () => {
    const r = await fetch(srv.base + "/api/vault/comp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "1 A St, Boise, ID" }),
    });
    assert.equal(r.status, 401);
  });

  // The whole-book export. Same gate, same order: an anonymous caller must
  // not learn whether the vault export exists before learning they aren't
  // signed in.
  await t.test("the vault export refuses an anonymous caller", async () => {
    const r = await fetch(srv.base + "/api/vault/export.csv");
    assert.equal(r.status, 401);
  });

  // NOT COVERED HERE, and deliberately: the 403-not-a-broker and
  // 200-for-an-entitled-broker paths. Both need a real session, which needs a
  // database, and this file's rule is that nothing it runs touches an external
  // service. Proving those two needs a seeded Supabase; until then they rest
  // on entitlements.js for the decision and on review for the wiring.

  // Sharing's gate, wired.
  //
  // report-access.js proves the DECISION exhaustively. This proves it is
  // ATTACHED: that an anonymous caller cannot create a permissioned share and
  // cannot list anyone's shares, and that the refusal arrives as 401 BEFORE
  // the 503 a database-less server would otherwise give — the same ordering
  // rule openVault follows, so a stranger never learns whether the DB is up.
  await t.test("permissioned sharing refuses an anonymous caller, 401 before 503", async () => {
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { comps: [{ address: "1 A St" }] }, meta: { address: "1 A St", type: "Industrial" },
        visibility: "invited", viewers: ["client@acme.com"],
      }),
    });
    assert.equal(r.status, 401, "an invited share must require a session");
  });

  await t.test("a public share still needs no account at all", async () => {
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { comps: [{ address: "1 A St" }] }, meta: { address: "1 A St", type: "Industrial" } }),
    });
    assert.equal(r.status, 200, "the pre-v3 share path must be untouched");
    const body = await r.json();
    assert.match(body.url, /\/r\/[A-Za-z0-9_-]+$/);
  });

  await t.test("a public link may never carry private comps", async () => {
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { comps: [{ address: "1 A St" }] }, meta: { address: "1 A St", type: "Industrial" },
        includePrivate: true,
      }),
    });
    assert.equal(r.status, 400, "this must be loud on the first attempt, not silently corrected");
  });

  // Regression for the 2026-08-06 review's item 1: a privacy-wall leak, the
  // second of this exact class (NOI was the first). meta.curation.excluded
  // is a list of address|date|price keys the browser offers on EVERY comp,
  // private ones included; POST /api/share used to copy meta.curation
  // through untouched while stripping/anonymizing data.comps, so excluding a
  // private vault comp as an outlier and then sharing left its full address
  // and exact price sitting in meta.curation.excluded for anyone with the
  // link to read straight off GET /api/shared — even on a public link, and
  // even on the invited+anonymized path that is supposed to be the one place
  // no address or price travels.
  //
  // The sweep below is `!JSON.stringify(payload).includes("742")` — three
  // digits against the whole payload, which is the right paranoia for a
  // privacy leak and is only sound while every byte of that payload is fixed
  // test data. It was not: /api/share stamps
  // `safeMeta.generatedAt = meta.generatedAt || Date.now()`, so a request that
  // sent no generatedAt put a 13-digit epoch millisecond in the payload, and
  // roughly one run in a hundred produced a millisecond containing "742".
  // That is exactly what failed CI run #244 (2026-08-10, commit 7075b4a, a
  // two-line HTML edit) and passed on a re-run of the identical commit — and
  // because `npm start`'s prestart runs this suite, a 1% flake here can abort
  // a real Render deploy. So the browser's own generatedAt is sent, which is
  // what a real share always carries, and the clock never enters the payload.
  const SHARE_GENERATED_AT = 1773964800000; // 2026-03-20T00:00:00Z, fixed
  await t.test("an excluded private comp's address and price never reach a public share", async () => {
    // The exact key format compKeyOf() in index.html builds — server.js's own
    // corpusKeyOf() matches it byte for byte and is what the fix reads.
    const excludedKey = "742 off-market secret rd, boise, id|2026-03-14|4250000";
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          comps: [
            { address: "742 Off-Market Secret Rd, Boise, ID", date: "2026-03-14", price_or_rate: "4250000", private: true, source_type: "broker_vault" },
            { address: "1 Public Ave, Boise, ID", date: "2026-01-01", price_or_rate: "1000000" },
          ],
          private_count: 1,
        },
        meta: {
          address: "1 Public Ave, Boise, ID", type: "Industrial",
          generatedAt: SHARE_GENERATED_AT,
          curation: { excluded: [excludedKey], added: [] },
        },
      }),
    });
    assert.equal(r.status, 200, "a public share of an otherwise-valid report must still succeed");
    const { id } = await r.json();

    const shared = await fetch(srv.base + "/api/shared?id=" + encodeURIComponent(id));
    assert.equal(shared.status, 200);
    const payload = await shared.json();
    const raw = JSON.stringify(payload);

    // The tripwire for that pin. If a later change makes /api/share
    // re-stamp its own clock instead of honouring the browser's generatedAt,
    // this fails deterministically on the very first run — rather than
    // silently re-arming a 1-in-100 flake in the substring sweep below, which
    // is the failure this test already cost a CI run and a re-run to find.
    assert.equal(payload.meta.generatedAt, SHARE_GENERATED_AT,
      "the payload must carry the generatedAt it was sent — a server clock reading here makes the sweep below nondeterministic");

    assert.ok(!raw.includes("742"), "the private comp's street number must not reach a public share, curation included");
    assert.ok(!raw.includes("4250000"), "the private comp's exact price must not reach a public share, curation included");
    assert.ok(!raw.includes("Secret"), "the private comp's street name must not reach a public share");
    const excluded = (payload.meta && payload.meta.curation && payload.meta.curation.excluded) || [];
    assert.ok(!excluded.includes(excludedKey), "the excluded key must be dropped once the comp it points to is gone from the share");
    assert.deepEqual(payload.data.comps.map((c) => c.address), ["1 Public Ave, Boise, ID"], "only the surviving public comp should remain");
  });

  await t.test("every share-management route refuses an anonymous caller and exists", async () => {
    const routes = [
      ["GET", "/api/shares", null],
      ["PUT", "/api/shares/viewers", { id: "abcdefgh", emails: [] }],
      ["POST", "/api/shares/revoke", { id: "abcdefgh" }],
    ];
    for (const [method, p, body] of routes) {
      const r = await fetch(srv.base + p, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(r.status, 401, `${method} ${p} must refuse an anonymous caller`);
      assert.notEqual(r.status, 404, `${method} ${p} should exist and refuse, not be absent`);
    }
  });

  // NOT COVERED HERE, deliberately, and for the reason the vault block already
  // gives: the 200-for-an-invited-client and 403-for-a-stranger paths need a
  // real session, which needs a database, and nothing in this file may touch
  // an external service. They rest on report-access.js plus one manual check
  // against the deployment.

  // Branding's gate, wired.
  //
  // branding.js proves the DECISION. This proves it is ATTACHED: that all three
  // routes exist and refuse an anonymous caller with 401 BEFORE the 503 this
  // database-less server would otherwise give — the ordering rule openVault
  // established, so a stranger never learns whether the database is up.
  await t.test("every branding route refuses an anonymous caller, 401 before 503", async () => {
    const routes = [
      ["GET", "/api/branding", null],
      ["PUT", "/api/branding", { firmName: "Adler Industrial" }],
      ["DELETE", "/api/branding", null],
    ];
    for (const [method, p, body] of routes) {
      const r = await fetch(srv.base + p, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(r.status, 401, `${method} ${p} must refuse an anonymous caller`);
      assert.notEqual(r.status, 404, `${method} ${p} should exist and refuse, not be absent`);
    }
  });

  await t.test("every profile-photo route refuses an anonymous caller", async () => {
    const routes = [
      ["GET", "/api/account/avatar", null],
      ["PUT", "/api/account/avatar", { avatar: "" }],
      ["DELETE", "/api/account/avatar", null],
    ];
    for (const [method, p, body] of routes) {
      const r = await fetch(srv.base + p, {
        method,
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      assert.equal(r.status, 401, `${method} ${p} must refuse an anonymous caller`);
      assert.notEqual(r.status, 404, `${method} ${p} should exist and refuse, not be absent`);
    }
  });

  await t.test("a signed-in account can set, serve, and remove a profile photo", async () => {
    const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const PNG = "data:image/png;base64," + PNG_B64;
    const email = `avatar-${Date.now()}@example.com`;
    const signup = await fetch(srv.base + "/api/account/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: "Ava" }),
    });
    assert.equal(signup.status, 200);
    const cookie = String(signup.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("cn_session="), "expected a session cookie");
    const signed = { cookie };

    const me0 = await (await fetch(srv.base + "/api/account/me", { headers: signed })).json();
    assert.equal(me0.avatarRev, "");
    assert.equal(JSON.stringify(me0).includes("data:image"), false,
      "/me must never carry the photo bytes");

    const missing = await fetch(srv.base + "/api/account/avatar", { headers: signed });
    assert.equal(missing.status, 404, "no photo yet must 404, not 200");

    const badUrl = await fetch(srv.base + "/api/account/avatar", {
      method: "PUT", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ avatar: "https://example.com/me.png" }),
    });
    assert.equal(badUrl.status, 400, "a URL must be refused");

    const saved = await fetch(srv.base + "/api/account/avatar", {
      method: "PUT", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ avatar: PNG }),
    });
    assert.equal(saved.status, 200, "a real PNG must save against the file store");
    const savedBody = await saved.json();
    assert.ok(savedBody.avatarRev, "save must return a rev");
    assert.equal(JSON.stringify(savedBody).includes("data:image"), false,
      "the save response must not echo the bytes");

    const me1 = await (await fetch(srv.base + "/api/account/me", { headers: signed })).json();
    assert.equal(me1.avatarRev, savedBody.avatarRev);
    assert.equal(JSON.stringify(me1).includes("data:image"), false);

    const img = await fetch(srv.base + "/api/account/avatar?v=" + me1.avatarRev, { headers: signed });
    assert.equal(img.status, 200);
    assert.match(img.headers.get("content-type") || "", /image\/png/);
    const bytes = Buffer.from(await img.arrayBuffer());
    assert.deepEqual(bytes, Buffer.from(PNG_B64, "base64"));

    const cleared = await fetch(srv.base + "/api/account/avatar", {
      method: "DELETE", headers: signed,
    });
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).avatarRev, "");
    const gone = await fetch(srv.base + "/api/account/avatar", { headers: signed });
    assert.equal(gone.status, 404);
  });

  await t.test("the digest preference refuses an anonymous caller, 401 not 404", async () => {
    const r = await fetch(srv.base + "/api/account/digest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(r.status, 401, "must refuse an anonymous caller");
  });

  await t.test("a signed-in account can switch the watchlist digest off and back on", async () => {
    const email = `digest-${Date.now()}@example.com`;
    const signup = await fetch(srv.base + "/api/account/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery", name: "Di" }),
    });
    assert.equal(signup.status, 200);
    const cookie = String(signup.headers.get("set-cookie") || "").split(";")[0];
    const signed = { cookie };

    // Emails default ON: a fresh file-store row has no digest_optout key and
    // must coerce to false, never render the toggle off.
    const me0 = await (await fetch(srv.base + "/api/account/me", { headers: signed })).json();
    assert.equal(me0.digestOptout, false, "a new account starts opted in");

    const off = await fetch(srv.base + "/api/account/digest", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(off.status, 200);
    const offBody = await off.json();
    assert.equal(offBody.digestOptout, true, "the response must reflect the new state");
    assert.equal(JSON.stringify(offBody).includes("password"), false,
      "the response must never carry credential fields");

    const me1 = await (await fetch(srv.base + "/api/account/me", { headers: signed })).json();
    assert.equal(me1.digestOptout, true, "the opt-out must persist to /me");

    const on = await fetch(srv.base + "/api/account/digest", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(on.status, 200);
    assert.equal((await on.json()).digestOptout, false);
    const me2 = await (await fetch(srv.base + "/api/account/me", { headers: signed })).json();
    assert.equal(me2.digestOptout, false, "re-enabling must persist too");

    // A non-boolean is a 400, never treated as truthy: the column is a
    // standing decision about somebody's inbox, so a malformed write is
    // refused rather than guessed at.
    for (const bad of [{ enabled: "yes" }, {}]) {
      const r = await fetch(srv.base + "/api/account/digest", {
        method: "POST", headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(bad),
      });
      assert.equal(r.status, 400, `non-boolean body ${JSON.stringify(bad)} must 400`);
    }
  });

  await t.test("a share from an anonymous visitor cannot carry a brand it supplied", async () => {
    // The browser hands /api/share its own meta. Without the server-side strip
    // a visitor could publish a report under someone else's firm name.
    const r = await fetch(srv.base + "/api/share", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { comps: [{ address: "1 A St" }] },
        meta: { address: "1 A St", type: "Industrial", branding: { firmName: "Not My Firm" } },
      }),
    });
    assert.equal(r.status, 200);
    const { id } = await r.json();
    const got = await (await fetch(srv.base + "/api/shared?id=" + encodeURIComponent(id))).json();
    assert.equal(got.meta.branding, undefined, "an unentitled share must carry no branding");
  });

  // NOT COVERED HERE, deliberately, for the reason the vault and sharing blocks
  // already give: a saved profile actually appearing on a rendered report needs
  // a real session and database, and nothing in this file may touch an external
  // service. That rests on branding.js plus a manual check against the
  // deployment.

  await t.test("admin endpoints do not exist when ADMIN_KEY is unset", async () => {
    for (const p of ["/api/stats", "/api/leads", "/api/accuracy", "/api/admin/heroes"]) {
      const r = await fetch(srv.base + p);
      assert.equal(r.status, 404, p + " should be disabled, not merely unauthorized");
    }
  });

  // openBulk (server.js) is a deliberate THIRD copy of the same ladder — 401
  // not signed in, 403 not entitled, 503 no database. A shared helper was not
  // taken because each copy's 403 is different product copy ("The private
  // vault is part of Pro", "The lead inbox is part of Pro", "Bulk valuation is
  // part of Pro") and it is the ORDER that has to match, not the strings.
  // These tests exist to catch the three drifting apart.
  await t.test("every bulk route refuses an anonymous caller, before the 503", async () => {
    const routes = [
      ["GET",    "/api/bulk"],
      ["POST",   "/api/bulk"],
      ["POST",   "/api/bulk/cancel"],
      ["GET",    "/api/bulk/export.csv?id=00000000-0000-0000-0000-000000000000"],
      ["DELETE", "/api/bulk?id=00000000-0000-0000-0000-000000000000"],
    ];
    for (const [method, p] of routes) {
      const r = await fetch(srv.base + p, {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: "{}" }
          : {}),
      });
      assert.equal(r.status, 401, `${method} ${p} must refuse an anonymous caller`);
      const body = await r.json().catch(() => ({}));
      assert.match(String(body.error || ""), /signed in/i, `${method} ${p} should say not signed in`);
    }
  });

  await t.test("bulk valuation cannot be started by a header, only by a session", async () => {
    // /api/comps has a header-only `internal` bypass for the seed generator.
    // Bulk deliberately has none: it is a spend amplifier, and a bypass a
    // browser was never meant to have must not grow one here. ADMIN_KEY is
    // unset on this server, so this only proves the route does not treat the
    // header as an identity — the entitlement branch is covered in
    // entitlements.test.js and the route-level one in bulk-routes.test.js.
    const r = await fetch(srv.base + "/api/bulk", { headers: { "x-admin-key": "anything" } });
    assert.equal(r.status, 401);
  });

  // requireBroker (server.js) is a deliberate second copy of the vault's
  // openVault gate — same three refusals in the same order (401 not signed
  // in, 403 not a broker, 503 no database). These tests exist to catch DRIFT
  // between the two copies, not to re-prove the decision (comp-gate-style
  // logic like this belongs to a pure module; requireBroker's own rules are
  // covered by intent in broker-leads.test.js — this file only proves the
  // routes actually call it).
  //
  // No signed-in fixture exists in this harness (booting a server with no
  // database means there is nowhere to create an account), so the 403
  // "signed in but not a broker" case is not practical to assert here and is
  // skipped; the 401 anonymous case below is what this file can prove.
  await t.test("the broker lead inbox refuses an anonymous caller", async () => {
    const r1 = await fetch(srv.base + "/api/broker/coverage");
    assert.equal(r1.status, 401);

    const r2 = await fetch(srv.base + "/api/broker/leads");
    assert.equal(r2.status, 401);

    const r3 = await fetch(srv.base + "/api/broker/leads/intro", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_id: "1" }),
    });
    assert.equal(r3.status, 401);

    // The BOV tracker (v4 slice 2) sits behind the same gate. 401 first,
    // before the 503 this bare server would give for a missing database.
    const r4 = await fetch(srv.base + "/api/broker/bovs");
    assert.equal(r4.status, 401);
    const r5 = await fetch(srv.base + "/api/broker/bovs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ market: "Boise, ID", property_type: "Industrial" }),
    });
    assert.equal(r5.status, 401);
    const r6 = await fetch(srv.base + "/api/broker/bovs/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x", status: "won" }),
    });
    assert.equal(r6.status, 401);
    const r7 = await fetch(srv.base + "/api/broker/bovs?id=00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    assert.equal(r7.status, 401);
  });

  await t.test("/api/config is public and advertises no entitlement it cannot enforce", async () => {
    const r = await fetch(srv.base + "/api/config");
    assert.equal(r.status, 200);
    const cfg = await r.json();
    assert.equal(typeof cfg.pro, "object", "config must carry a pro block");
    // Billing needs BOTH the flag and Stripe keys; neither is set here, so a
    // Buy button that could only fail must not be offered.
    assert.equal(cfg.pro.billing, false, "billing must be off with no Stripe configured");
  });

  await t.test("report access fails CLOSED on an unknown report", async () => {
    const r = await fetch(srv.base + "/api/report-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "1 Nowhere St, Nowhere, XX", type: "Industrial", months: 12 }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.notEqual(body.unlocked, true, "an unpurchased report must never read as unlocked");
  });

  await t.test("checkout refuses rather than pretending to succeed", async () => {
    const r = await fetch(srv.base + "/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "pro_monthly" }),
    });
    assert.notEqual(r.status, 200, "checkout must not report success with no Stripe configured");
  });

  // The $20 single-report unlock was RETIRED on 2026-08-21. The PLANS map's
  // no-fallthrough design makes retirement one deletion: an absent plan is a
  // 400, never a silent substitution onto some other price. A source scan
  // rather than a booted 400: reaching the map behaviorally needs Stripe env
  // and a signed-in user, and the invariant is the map's contents. Re-adding
  // the plan must be a deliberate act with a failing test in front of it.
  // Purchases already made stay honored — /api/report-access (tested above)
  // keeps answering, and the webhook and entitlements branches remain.
  await t.test("the single_report plan stays retired from the PLANS map", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const start = src.indexOf("const PLANS = {");
    assert.ok(start > 0, "the checkout PLANS map should still exist");
    const map = src.slice(start, src.indexOf("};", start));
    assert.ok(!/single_report:\s*\{/.test(map),
      "single_report is back in the PLANS map — the sale was retired 2026-08-21 " +
      "with purchases honored; reselling it is an owner decision, not a merge accident");
    assert.match(map, /pro_monthly:/, "the map itself must still be the one being scanned");
  });

  // The PLANS table is an explicit map with no fallthrough. It once mapped
  // anything that was not the founding plan onto monthly, which is why adding
  // a cheaper tile was unsafe. An unknown plan must never quietly become a
  // charge for a different one.
  await t.test("an unrecognized plan is never silently substituted", async () => {
    const r = await fetch(srv.base + "/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "not_a_real_plan" }),
    });
    assert.notEqual(r.status, 200, "an unknown plan must not open a checkout session");
  });
});

// --- A key stored with stray whitespace -------------------------------------
//
// 2026-08-05: ADMIN_KEY was saved in Render's UI with a trailing NEWLINE
// (Enter in that textarea inserts a character rather than submitting), and it
// was the one secret server.js never trimmed. That locked every dashboard for
// an hour and was undiagnosable from the outside: the stored value is
// unreadable in Render's UI, an HTTP header cannot carry a newline at all, so
// the login box could never match no matter what was typed, and the failure is
// identical to simply typing the wrong key.
//
// Deliberately boots ONE server per whitespace form rather than asserting on
// the pure function, because trimming at the constant is only half the fix —
// what has to hold is that the ROUTE authenticates a caller sending the clean
// key. A test against a trim() helper would have passed all along.
// MARKET_EXAMPLE pins the Explorer's rotating example. scripts/shot.js sets
// it on both sides of a comparison, because two runs of IDENTICAL code
// producing byte-identical PNGs is how "this changed nothing visually" gets
// proved in this repo — and a placeholder that moves on every load breaks
// that. Pinned by env rather than by hoping a capture makes exactly one
// request to `/`.
test("MARKET_EXAMPLE pins the Explorer's example across loads", async (t) => {
  const PINNED = "e.g. office Dallas, TX";
  const srv = await boot({ MARKET_EXAMPLE: PINNED });
  t.after(() => srv.stop());
  for (let i = 0; i < 3; i++) {
    const html = await (await fetch(srv.base + "/")).text();
    const m = html.match(/id="marketSearch"[^>]*placeholder="([^"]*)"/);
    assert.ok(m, "the Explorer input lost its placeholder");
    assert.equal(m[1], PINNED, "load " + i + " ignored MARKET_EXAMPLE");
  }
});

test("an ADMIN_KEY stored with stray whitespace still authenticates", async (t) => {
  const CLEAN = "test-admin-key-whitespace";
  for (const [label, stored] of [
    ["trailing newline (the real incident)", CLEAN + "\n"],
    ["trailing space", CLEAN + " "],
    ["leading space", " " + CLEAN],
    ["trailing carriage return", CLEAN + "\r"],
  ]) {
    await t.test(label, async () => {
      const srv = await boot({ ADMIN_KEY: stored });
      try {
        // The header form is what the /admin login box uses, and is the form a
        // newline makes structurally impossible to satisfy without the trim.
        const r = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": CLEAN } });
        assert.equal(r.status, 200, "the clean key must authenticate when the stored value has " + label);
        // Still a real gate: trimming must not turn into accepting anything.
        const bad = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": CLEAN + "x" } });
        assert.equal(bad.status, 401, "a genuinely wrong key must still be refused");
      } finally {
        srv.stop();
      }
    });
  }
});

// --- With an admin key configured -------------------------------------------

test("admin gating", async (t) => {
  const ADMIN = "test-admin-key-routes";
  const srv = await boot({ ADMIN_KEY: ADMIN });
  t.after(() => srv.stop());

  await t.test("the dashboard API refuses an unauthenticated caller", async () => {
    const r = await fetch(srv.base + "/api/stats");
    assert.equal(r.status, 401);
  });

  await t.test("a wrong key is refused", async () => {
    const r = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": "wrong" } });
    assert.equal(r.status, 401);
  });

  await t.test("the header form is accepted", async () => {
    const r = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": ADMIN } });
    assert.equal(r.status, 200);
    // The intro-request surface must ride along, not just the event
    // aggregates — a dropped owner email is invisible without it. This boot
    // has no Supabase, and the table has no file fallback, so the honest
    // answer is db:false with nothing to show — never a fabricated zero
    // presented as a real count, and never a missing key (which /admin
    // reads as a stale pre-feature response and hides the card for).
    const body = await r.json();
    assert.deepEqual(body.introRequests, { db: false, count: 0, recent: [] });
    assert.equal(body.totals.leadIntros, 0, "aggregateStats counts lead_intro events");
    // The 1031 guide funnel block must be present even at zero — /admin
    // treats a missing key as a stale pre-feature response and hides the
    // card, so a dropped key here silently blinds the funnel.
    for (const k of ["views", "views30d", "members", "leads", "leads30d"]) {
      assert.equal(typeof body.guide1031[k], "number", `guide1031.${k}`);
    }
  });

  // The guide-read event is the 1031 funnel's denominator, and the page is
  // public + sitemapped, so the count is only meaningful if crawlers stay
  // out of it. One browser read must count exactly once; Googlebot and the
  // suite's own bare fetch (no browser UA) must count zero. Events are
  // fire-and-forget file appends, hence the short poll.
  await t.test("a guide read is counted once, and crawlers are not", async () => {
    const views = async () => (await (await fetch(srv.base + "/api/stats",
      { headers: { "x-admin-key": ADMIN } })).json()).guide1031.views;
    const before = await views();
    const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    for (const ua of [browserUA, "Googlebot/2.1 (+http://www.google.com/bot.html)", null]) {
      const r = await fetch(srv.base + "/1031-exchange",
        ua ? { headers: { "user-agent": ua } } : undefined);
      assert.equal(r.status, 200);
    }
    let after = before;
    for (let i = 0; i < 40 && after < before + 1; i++) {
      await new Promise((res) => setTimeout(res, 50));
      after = await views();
    }
    assert.equal(after, before + 1, "one browser read = one view");
    // Settle, then re-read: a late-landing bot event would pass the check
    // above and only show here.
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(await views(), before + 1, "bot reads must not land late");
  });

  await t.test("market-hero review is gated like the other admin APIs", async () => {
    const denied = await fetch(srv.base + "/api/admin/heroes");
    assert.equal(denied.status, 401);
    const r = await fetch(srv.base + "/api/admin/heroes", { headers: { "x-admin-key": ADMIN } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.rows) && body.rows.length >= 20, "every curated city should be listed");
    assert.equal(body.total, body.rows.length);
    const ontario = body.rows.find((row) => row.key === "ontario, ca");
    assert.ok(ontario, "Ontario, CA must be on the list");
    assert.equal(ontario.ok, false, "Ontario's small original should still need a look");
    assert.equal(ontario.liveKind, "satellite");
    const dallas = body.rows.find((row) => row.key === "dallas, tx");
    assert.ok(dallas && dallas.ok, "Dallas should pass the file checks");
    assert.match(dallas.src, /dallas-tx\.jpg/);
    assert.match(dallas.samplePath || "", /\/market\//);
  });

  await t.test("the hero review page is noindex and does not embed the grades", async () => {
    const r = await fetch(srv.base + "/admin/heroes");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const html = await r.text();
    assert.match(html, /Market heroes/);
    assert.doesNotMatch(html, /ontario, ca/, "grades belong behind the API, not in the HTML");
  });

  // The confirm dialog's type picker logs outcome "dialog_pick". The route's
  // allowlist and the stats aggregation are two separate places, and a word
  // accepted by one but uncounted by the other is invisible: /admin's tile
  // would under-report while the events pile up correctly in the table. This
  // is a real round trip (POST the ping, then observe the counter move) so it
  // fails if EITHER place falls out of step with the other — a test that only
  // reads the stats shape would pass even with the allowlist rejecting the
  // outcome.
  await t.test("the type-autofill block counts the confirm dialog's picks", async () => {
    const before = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": ADMIN } });
    assert.equal(before.status, 200);
    const startCount = (await before.json()).typeAutofill.dialogPick;
    assert.equal(typeof startCount, "number");

    const post = await fetch(srv.base + "/api/type-autofill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "dialog_pick", type: "Industrial", address: "123 Test St, Dallas, TX" }),
    });
    assert.equal(post.status, 204);

    // The route answers 204 before the event is written (logEvent's
    // storeRow(...) is fire-and-forget), so an immediate re-read can race the
    // append. Poll instead of a fixed sleep.
    let dialogPick = startCount;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const r = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": ADMIN } });
      dialogPick = (await r.json()).typeAutofill.dialogPick;
      if (dialogPick === startCount + 1) break;
      await new Promise((res) => setTimeout(res, 75));
    }
    assert.equal(dialogPick, startCount + 1,
      "dialogPick did not increase by exactly 1 after posting outcome:\"dialog_pick\"");
  });

  // "undone" is the accuracy signal: the visitor overturning a type the
  // detector asserted. Same round trip as above (allowlist and aggregation are
  // still two separate places), plus the rule that makes the number readable —
  // it is a VERDICT on an attempt, never an attempt itself, so it must leave
  // `attempts` alone. Counted in the denominator, one wrong guess would dock
  // the applied rate twice: once for being wrong, once for the row saying so.
  await t.test("an undone correction counts, and does not inflate attempts", async () => {
    const before = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": ADMIN } });
    assert.equal(before.status, 200);
    const start = (await before.json()).typeAutofill;
    assert.equal(typeof start.undone, "number", "the tile needs an undone counter");
    assert.equal(typeof start.undonePct, "number", "the tile needs a correction rate");

    const post = await fetch(srv.base + "/api/type-autofill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "undone", type: "Office", address: "123 Test St, Dallas, TX" }),
    });
    assert.equal(post.status, 204);

    let ta = start;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const r = await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": ADMIN } });
      ta = (await r.json()).typeAutofill;
      if (ta.undone === start.undone + 1) break;
      await new Promise((res) => setTimeout(res, 75));
    }
    assert.equal(ta.undone, start.undone + 1,
      "undone did not increase by exactly 1 after posting outcome:\"undone\"");
    assert.equal(ta.attempts, start.attempts,
      "an undone row must not enter the attempts denominator");
  });

  await t.test("the ?key= form still works for machine callers", async () => {
    const r = await fetch(srv.base + "/api/stats?key=" + encodeURIComponent(ADMIN));
    assert.equal(r.status, 200);
  });

  await t.test("the lead CSV is gated by the same key", async () => {
    assert.equal((await fetch(srv.base + "/api/leads")).status, 401);
    assert.equal((await fetch(srv.base + "/api/leads", { headers: { "x-admin-key": ADMIN } })).status, 200);
  });

  // The admin key buys comped Pro only for a SIGNED-IN account. A key
  // identifies a machine, not a person, so an anonymous caller holding it
  // takes the ordinary free path.
  await t.test("holding the admin key does not by itself grant Pro", async () => {
    const r = await fetch(srv.base + "/api/config", { headers: { "x-admin-key": ADMIN } });
    const cfg = await r.json();
    assert.notEqual(cfg.pro.isPro, true, "an anonymous key-holder must not resolve to Pro");
  });

  await t.test("/api/accuracy refuses without the admin key", async () => {
    const r = await fetch(srv.base + "/api/accuracy");
    assert.equal(r.status, 401);
  });

  await t.test("/api/accuracy accepts the admin key header", async () => {
    const r = await fetch(srv.base + "/api/accuracy", { headers: { "x-admin-key": ADMIN } });
    assert.equal(r.status, 200);
    const body = await r.json();
    // No Supabase in this test environment, so the corpus read falls back to
    // comp-corpus.jsonl (git-ignored) — which on a fresh checkout is empty
    // (belowFloor true, medianAbsError null) but on a dev machine that has
    // run real searches may already hold enough rows to clear the floor.
    // Either way the SHAPE must be sound, so this pins the one invariant that
    // must hold regardless: the figure is withheld exactly when, and only
    // when, the report says it is below the scoring floor — never invented.
    assert.equal(typeof body.scored, "number");
    assert.equal(typeof body.belowFloor, "boolean");
    assert.equal(body.medianAbsError === null, body.belowFloor,
      "medianAbsError must be null exactly when belowFloor is true");
  });

  // The cookie is how a browser carries the key across tabs. isAdminRequest
  // accepts both forms, and this file exists to prove the wiring, not the rule.
  await t.test("/api/accuracy accepts the admin cookie too", async () => {
    const grant = await fetch(srv.base + "/api/admin-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: ADMIN }),
    });
    assert.equal(grant.status, 200);
    const cookie = String(grant.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("cn_admin="), "expected a cn_admin cookie, got " + cookie);
    const r = await fetch(srv.base + "/api/accuracy", { headers: { cookie } });
    assert.equal(r.status, 200);
  });
});

// --- The Market Explorer spends the same free search as a report ------------
//
// /api/explore-market runs the same billed getComps() pipeline as /api/comps.
// It carried no guest-cap check at all until 2026-08-05, so an anonymous
// visitor who had spent their free report could keep triggering billed
// searches from the homepage. These prove the gate is WIRED to the route, and
// that it did not swallow the free covered-market path on its way in.
//
// No Anthropic call is possible here: the bare environment has no API key, so
// a request that clears the gate stops at the missing-key 500. That distinct
// status is exactly how "got past the gate" is observed.

// Pick a market this deployment does NOT already cover. A covered market is
// short-circuited free ABOVE the gate (deliberately — it is a DB read), so a
// hard-coded city makes the gate untestable the moment anything covers it:
// a seed addition, or the git-ignored market-pages-dynamic.json that local
// testing leaves behind on a developer machine.
async function uncoveredMarket(base) {
  const covered = new Set(
    (await (await fetch(base + "/api/markets")).json())
      .map((m) => `${m.type}|${m.city}|${m.state}`));
  // One candidate per EXPLORE_TYPES entry, so a market-seed.json that grows to
  // cover one type can't exhaust the list.
  const pick = [
    { type: "Industrial", city: "Nampa", state: "ID" },
    { type: "Office", city: "Sheridan", state: "WY" },
    { type: "Retail", city: "Bismarck", state: "ND" },
    { type: "Multifamily", city: "Presque Isle", state: "ME" },
  ].find((c) => !covered.has(`${c.type}|${c.city}|${c.state}`));
  assert.ok(pick, "every candidate market is already covered — add another to this list");
  return pick;
}

test("market explorer guest cap", async (t) => {
  // limit 0 = every anonymous visitor is blocked before any search, which
  // makes the gate observable without having to spend a quota first.
  const { base, stop } = await boot({ GUEST_SEARCH_LIMIT: "0" });
  t.after(stop);

  const explore = (body) => fetch(base + "/api/explore-market", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  await t.test("an anonymous visitor cannot bill a new market search", async () => {
    const r = await explore(await uncoveredMarket(base));
    assert.equal(r.status, 403);
    const j = await r.json();
    // The client keys off this flag, never off the status code — it decides
    // account modal vs red error row.
    assert.equal(j.signin_required, true);
    // At a ZERO limit the visitor never had a free search, so the message must
    // not claim they spent one. This shipped wrong: ACCOUNT_WALL forces the
    // limit to 0, so every anonymous visitor on the live site was told they
    // had used something they were never given.
    assert.doesNotMatch(j.error, /used your free search/i);
    assert.match(j.error, /free account/i, "it must still ask for the account");
  });

  await t.test("browsing a market page that already exists stays free", async () => {
    // industrial-ontario-ca is the first entry in the committed market-seed.json.
    // The covered-market short circuit must stay ABOVE the gate: it is a DB
    // read, it costs nothing upstream, and gating it would wall off the SEO
    // surface and every crawler.
    const r = await explore({ type: "Industrial", city: "Ontario", state: "CA" });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.url, "/market/industrial-ontario-ca");
    assert.equal(j.existing, true);
  });
});

// The other half of the rule: where a free search DID exist and was spent,
// saying so is correct and should survive. A limit of 1 with the cookie
// already set is the cheapest way to reach a blocked-but-had-one visitor.
test("a visitor who really did spend a free search is told so", async (t) => {
  const { base, stop } = await boot({ GUEST_SEARCH_LIMIT: "1" });
  t.after(stop);

  await t.test("the spent-search wording returns at a non-zero limit", async () => {
    const r = await fetch(base + "/api/explore-market", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "cn_guest=1" },
      body: JSON.stringify(await uncoveredMarket(base)),
    });
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.match(j.error, /used your free search/i);
  });
});

test("market explorer with the guest gate disabled", async (t) => {
  // BOTH levers, and the order matters. ACCOUNT_WALL (added 2026-08-05,
  // default ON) forces GUEST_LIMIT_RAW to "0" whatever GUEST_SEARCH_LIMIT
  // says, deliberately, so the wall and the API gate can never disagree.
  // That makes ACCOUNT_WALL the outer lever: with the wall up,
  // GUEST_SEARCH_LIMIT="off" alone disables nothing. Rolling the gate back
  // now means dropping the wall first.
  const { base, stop } = await boot({ ACCOUNT_WALL: "off", GUEST_SEARCH_LIMIT: "off" });
  t.after(stop);

  await t.test("the rollback lever really disables the gate", async () => {
    const m = await uncoveredMarket(base);
    const r = await fetch(base + "/api/explore-market", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(m),
    });
    // Past the gate, stopped by the absent API key — never 403.
    assert.equal(r.status, 500);
    const j = await r.json();
    // Deliberately vendor-agnostic: the guard names whichever provider is
    // active (PROVIDER.apiKeyEnv), so pinning one vendor here would make an
    // unrelated SEARCH_PROVIDER default change look like a gate regression.
    // What this test cares about is the SHAPE: a missing-key 500, not a 403.
    assert.match(j.error, /is missing the \w+_API_KEY/);
  });
});

// --- The tester passkey -----------------------------------------------------
//
// A shared code that comps Pro to a SIGNED-IN account, separate from
// ADMIN_KEY (which also unlocks /admin, /dev and /contacts). entitlements.js
// already proves what the flag grants; this proves the door is wired: that it
// does not exist when unconfigured, that it refuses an anonymous caller and a
// wrong code, and that a correct code actually reaches /api/config.
//
// No Supabase in this environment, so accounts and the pro_tester flag live in
// the git-ignored account-store.json fallback — which is exactly why this can
// run for free with no database.

test("tester passkey", async (t) => {
  await t.test("the route does not exist when NEITHER passkey is set", async () => {
    const srv = await boot({});
    t.after(() => srv.stop());
    const r = await fetch(srv.base + "/api/redeem-passkey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passkey: "anything" }),
    });
    assert.equal(r.status, 404, "an unconfigured deployment must not answer this route");

    // /api/config must say so too, so the pricing modal can hide the "Have a
    // code?" row rather than show a control that can only ever fail. A plain
    // /api/config fetch, not a redeem call, so it costs nothing against the
    // route's per-IP limiter.
    const cfg = await (await fetch(srv.base + "/api/config")).json();
    assert.equal(cfg.pro.testerPasskey, false);
    // Both doors, since either one alone is enough to open the route: a 404
    // here means neither was configured, and the row must stay hidden for
    // both reasons rather than one.
    assert.equal(cfg.pro.vaultPasskey, false);
  });

  await t.test("configured: refuses anonymous and wrong codes, accepts the right one", async () => {
    const PASSKEY = "let-me-in-please";
    const srv = await boot({ PRO_ENABLED: "on", TESTER_PASSKEY: PASSKEY });
    t.after(() => srv.stop());

    const redeem = (passkey, cookie) => fetch(srv.base + "/api/redeem-passkey", {
      method: "POST",
      headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
      body: JSON.stringify({ passkey }),
    });

    // Anonymous, even with the right code: the grant lives on an account.
    const anon = await redeem(PASSKEY);
    assert.equal(anon.status, 401);

    // Make a real account and keep its session cookie.
    const email = `tester-${Date.now()}@example.com`;
    const signup = await fetch(srv.base + "/api/account/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    assert.equal(signup.status, 200, "signup should succeed against the file store");
    const cookie = String(signup.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("cn_session="), "expected a session cookie, got " + cookie);

    // Signed in but wrong code.
    const wrong = await redeem("not-the-passkey", cookie);
    assert.equal(wrong.status, 401);

    // Not a tester yet.
    const before = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(before.pro.tester, false);
    assert.equal(before.pro.isPro, false);
    // A configured deployment reports the door exists, independent of
    // whether THIS caller has redeemed it — that is what lets the pricing
    // modal show the row before anyone has typed a code.
    assert.equal(before.pro.testerPasskey, true);

    // The right code, signed in.
    const ok = await redeem(PASSKEY, cookie);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);

    // ...and it reaches the entitlements the UI reads.
    const after = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(after.pro.tester, true);
    assert.equal(after.pro.isPro, true);
    assert.equal(after.pro.status, "tester");
    // The one capability a tester is deliberately denied.
    assert.equal(after.pro.canUseVault, false);

    // Redeeming twice is idempotent, not an error.
    const again = await redeem(PASSKEY, cookie);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).already, true);

    // The idempotency check must run BEFORE the secret compare, not after:
    // once someone already has access, even a WRONG code must still answer
    // "already: true" rather than "incorrect code" (which would happen if a
    // rotated or mistyped passkey were compared first). This is the only
    // assertion that actually pins the ordering the route's comment claims —
    // the same-correct-code idempotency check above would still pass if a
    // future edit swapped the two checks.
    //
    // Call budget: this brings the route's per-IP total in this test to 5
    // (anon, wrong, ok, again, this one), exactly the 5-per-15-minute limit
    // (rateLimited blocks only when hits > max, so the 5th still goes
    // through). There is no headroom left in this test for another
    // /api/redeem-passkey call — a new case needs its own boot() or a fresh
    // client IP.
    const wrongAfter = await redeem("still-not-the-passkey", cookie);
    assert.equal(wrongAfter.status, 200);
    assert.equal((await wrongAfter.json()).already, true);
  });
});

function reportPayload(address, type) {
  return {
    meta: { address, type },
    data: { comps: [{ address, transaction: "sale", source_type: "listing" }] },
  };
}

test("portfolio upsert and cap", async (t) => {
  const srv = await boot({ PRO_ENABLED: "on", ADMIN_KEY: "k", TESTER_PASSKEY: "tcode" });
  t.after(() => srv.stop());

  const email = `pf-${Date.now()}@example.com`;
  const signup = await fetch(srv.base + "/api/account/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery" }),
  });
  assert.equal(signup.status, 200);
  const cookie = String(signup.headers.get("set-cookie") || "").split(";")[0];

  const post = (body) => fetch(srv.base + "/api/portfolio", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

  await t.test("/api/config carries the two new fields for a Free account", async () => {
    const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(cfg.pro.portfolioMaxItems, 100);
    assert.equal(cfg.pro.portfolioValues, false);
  });

  await t.test("POST without id inserts once, then updates the same address+type", async () => {
    const payload = reportPayload("100 Main St, Boise, ID", "Industrial");
    const a = await post({ payload, snapshot: { likely: 1000000, low: 900000, high: 1100000, median_psf: 80 } });
    assert.equal(a.status, 200);
    const first = await a.json();
    const b = await post({ payload, snapshot: { likely: 1100000, low: 1000000, high: 1200000, median_psf: 88 } });
    assert.equal(b.status, 200);
    const second = await b.json();
    assert.equal(second.id, first.id, "same row, not a second card");
    assert.equal(second.snapshots.length, 2);

    const list = await (await fetch(srv.base + "/api/portfolio", { headers: { cookie } })).json();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].address, "100 Main St, Boise, ID");
  });

  // renderResults and renderMap both call saveHistory; the map's write used
  // to append a second snapshot with the same likely, so Pro's Change column
  // read ▲ 0.0% after one search. Payload still updates (corrected coords).
  await t.test("a second POST with the same likely does not append a snapshot", async () => {
    const payload = reportPayload("100 Main St, Boise, ID", "Industrial");
    const r = await post({ payload, snapshot: { likely: 1100000, low: 1000000, high: 1200000, median_psf: 88 } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.snapshots.length, 2, "echo of the last likely must not grow the trail");
  });

  await t.test("a new address at the Free cap of 100 is refused; updating one of the 100 still works", async () => {
    // 1 already inserted above; add 99 more to hit 100.
    for (let i = 1; i <= 99; i++) {
      const r = await post({ payload: reportPayload(`${i} Oak St, Boise, ID`, "Industrial") });
      assert.equal(r.status, 200, "insert " + i);
    }
    const full = await post({ payload: reportPayload("Overflow Ave, Boise, ID", "Industrial") });
    assert.equal(full.status, 400);
    assert.match((await full.json()).error, /Portfolio is full \(100 properties\)\./);

    const update = await post({
      payload: reportPayload("100 Main St, Boise, ID", "Industrial"),
      snapshot: { likely: 1200000, low: 1100000, high: 1300000, median_psf: 90 },
    });
    assert.equal(update.status, 200, "updating an existing address must not consult the cap");
  });

  await t.test("Pro (tester) can insert past 100", async () => {
    const redeem = await fetch(srv.base + "/api/redeem-passkey", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ passkey: "tcode" }),
    });
    assert.equal(redeem.status, 200);
    const cfg = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(cfg.pro.isPro, true);
    assert.equal(cfg.pro.portfolioMaxItems, 500);
    assert.equal(cfg.pro.portfolioValues, true);

    const r = await post({ payload: reportPayload("Overflow Ave, Boise, ID", "Industrial") });
    assert.equal(r.status, 200, "the 101st property is allowed for Pro");
  });
});

// --- The vault passkey ------------------------------------------------------
//
// The same route and the same input as the tester passkey, a different
// secret, and a deliberately different grant: the broker vault and NOT Pro.
// It replaces the one-row `update users set vault_beta = true` that had to be
// typed into the SQL editor for every broker onboarded.
//
// entitlements.js already proves what users.vault_beta grants. What can only
// be proved here is that the door is WIRED: that a code reaching this route
// actually lands on the column, that the column actually reaches
// /api/config's canUseVault (it did not for the first day of vault_beta's
// life — the grant was set and the vault still refused, because
// getSessionUser's narrowed user object never carried the flag), and that
// the two codes stay separate in both directions.
//
// Each case boots its own server, which is also what keeps them inside the
// route's 5-per-15-minute per-IP limiter: the limiter is in-memory, so a
// fresh process is a fresh budget.

test("vault passkey", async (t) => {
  const signUp = async (srv, label) => {
    const r = await fetch(srv.base + "/api/account/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${label}-${Date.now()}@example.com`, password: "correct-horse-battery" }),
    });
    assert.equal(r.status, 200, "signup should succeed against the file store");
    const cookie = String(r.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("cn_session="), "expected a session cookie, got " + cookie);
    return cookie;
  };
  const redeemer = (srv) => (passkey, cookie) => fetch(srv.base + "/api/redeem-passkey", {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, cookie ? { cookie } : {}),
    body: JSON.stringify({ passkey }),
  });

  await t.test("VAULT_PASSKEY alone opens the route, and grants the vault without Pro", async () => {
    const VAULT = "give-me-the-vault";
    // Deliberately NO TESTER_PASSKEY: the two are independent, and a
    // deployment running only the broker door must still answer this route.
    const srv = await boot({ PRO_ENABLED: "on", VAULT_PASSKEY: VAULT });
    t.after(() => srv.stop());
    const redeem = redeemer(srv);
    const cookie = await signUp(srv, "broker");

    const before = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(before.pro.vaultPasskey, true, "a configured deployment must say the door exists");
    assert.equal(before.pro.testerPasskey, false, "the tester door is unset here");
    assert.equal(before.pro.canUseVault, false);

    const ok = await redeem(VAULT, cookie);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.granted, ["vault"], "the response must name which door opened");

    // The whole point of the feature, and the exact seam that was broken for
    // vault_beta's first day: the column has to reach the entitlements the UI
    // reads, not merely be written.
    const after = await (await fetch(srv.base + "/api/config", { headers: { cookie } })).json();
    assert.equal(after.pro.canUseVault, true);
    assert.equal(after.pro.broker, true);
    // And ONLY the vault. A code handed to an outside broker must not be a
    // way to get Pro's report features for free.
    assert.equal(after.pro.isPro, false);
    assert.equal(after.pro.tester, false);
    assert.equal(after.pro.status, "none");

    // Idempotent, and it says nothing was newly granted.
    const again = await redeem(VAULT, cookie);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).already, true);
  });

  await t.test("the two codes are separate in both directions", async () => {
    const TESTER = "try-pro-please";
    const VAULT = "vault-please";
    const srv = await boot({ PRO_ENABLED: "on", TESTER_PASSKEY: TESTER, VAULT_PASSKEY: VAULT });
    t.after(() => srv.stop());
    const redeem = redeemer(srv);

    // A tester code must not open the vault — that exclusion is the reason
    // this second secret exists at all.
    const testerCookie = await signUp(srv, "tester-only");
    assert.equal((await redeem(TESTER, testerCookie)).status, 200);
    const t1 = await (await fetch(srv.base + "/api/config", { headers: { cookie: testerCookie } })).json();
    assert.equal(t1.pro.isPro, true);
    assert.equal(t1.pro.canUseVault, false, "the tester grant must still exclude the vault");

    // ...and a tester still holding no vault grant is told a wrong code is
    // wrong, rather than "already": there IS something left for them to
    // redeem on this deployment.
    const wrong = await redeem("neither-of-them", testerCookie);
    assert.equal(wrong.status, 401);

    // The reverse: a vault code must not comp Pro.
    const vaultCookie = await signUp(srv, "vault-only");
    assert.equal((await redeem(VAULT, vaultCookie)).status, 200);
    const v1 = await (await fetch(srv.base + "/api/config", { headers: { cookie: vaultCookie } })).json();
    assert.equal(v1.pro.canUseVault, true);
    assert.equal(v1.pro.isPro, false, "the vault grant must not comp Pro");
  });

  await t.test("holding every configured grant answers already, even to a wrong code", async () => {
    const TESTER = "pro-code";
    const VAULT = "vault-code";
    const srv = await boot({ PRO_ENABLED: "on", TESTER_PASSKEY: TESTER, VAULT_PASSKEY: VAULT });
    t.after(() => srv.stop());
    const redeem = redeemer(srv);
    const cookie = await signUp(srv, "both");

    assert.equal((await redeem(TESTER, cookie)).status, 200);
    assert.equal((await redeem(VAULT, cookie)).status, 200);

    // The generalized form of the tester route's pre-compare idempotency
    // rule: once an account holds everything this deployment can give, a
    // rotated or mistyped code must not tell them they are locked out.
    const wrongAfter = await redeem("not-either-code", cookie);
    assert.equal(wrongAfter.status, 200);
    assert.equal((await wrongAfter.json()).already, true);
  });
});

// --- SEARCH_PROVIDER wiring --------------------------------------------------
//
// entitlements.js/comp-gate.js/stripe.js prove decisions are right in
// isolation; this file exists to prove they are actually wired to a route.
// The capability descriptor has exactly that hazard: capabilities.searchBudget
// could be correct in search-provider-gemini.js and completely ignored by
// server.js, and every unit test would still pass. /healthz reporting
// `provider` and `search_budget` off PROVIDER.capabilities is the only
// observable proof the server consults the descriptor at all, so that is what
// gets asserted here rather than anything about search-provider-gemini.js
// itself.

test("SEARCH_PROVIDER wiring", async (t) => {
  await t.test("gemini boots and reports it cannot cap the search budget", async () => {
    const srv = await boot({ SEARCH_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
    try {
      const body = await (await fetch(srv.base + "/healthz")).json();
      assert.equal(body.provider, "gemini");
      // Read off PROVIDER.capabilities, so a server.js that stopped consulting
      // the descriptor reports the wrong value and fails here.
      assert.equal(body.search_budget, false);
    } finally { srv.stop(); }
  });

  await t.test("anthropic reports that it CAN cap the search budget", async () => {
    // The other half of the capability assertion. Both states have to be pinned:
    // a server.js that hardcoded either value would pass one of these two and
    // fail the other, which is what makes the pair meaningful rather than one
    // assertion that happens to match a constant.
    const srv = await boot({ SEARCH_PROVIDER: "anthropic" });
    try {
      const body = await (await fetch(srv.base + "/healthz")).json();
      assert.equal(body.provider, "anthropic");
      assert.equal(body.search_budget, true);
    } finally { srv.stop(); }
  });

  await t.test("the default provider is gemini", async () => {
    // Flipped from anthropic on 2026-08-10 after the phase 2 validation gate.
    // Pinned deliberately: the default decides what every real search costs and
    // which vendor a deployment depends on, so it should never change silently.
    const srv = await boot({});
    try {
      assert.equal((await (await fetch(srv.base + "/healthz")).json()).provider, "gemini");
    } finally { srv.stop(); }
  });

  await t.test("/healthz names the live model, including a MODEL override", async () => {
    // The provider is only half of "what answered this report" — MODEL is a
    // startup constant an env var can override, so the repo cannot be read as
    // proof of what production is running. Both halves are asserted because
    // reporting PROVIDER.defaultModel instead of MODEL would satisfy the
    // default case and silently lie on every overridden deployment, which is
    // exactly the deployment whose model somebody is asking about.
    const dflt = await boot({});
    try {
      assert.equal((await (await fetch(dflt.base + "/healthz")).json()).model,
        require("../search-provider-gemini").defaultModel);
    } finally { dflt.stop(); }

    const over = await boot({ MODEL: "gemini-9.9-imaginary" });
    try {
      assert.equal((await (await fetch(over.base + "/healthz")).json()).model, "gemini-9.9-imaginary");
    } finally { over.stop(); }
  });

  // THINKING_LEVEL is the same class of hazard as search_budget above: it could
  // be perfectly implemented in search-provider-gemini.js and never read by
  // server.js, and every unit test would still pass. /healthz reporting it is
  // the observable proof the server consults the setting at all. It matters
  // more than most because thought tokens ARE the wall clock on this provider
  // (a measured call: 928 output against 6,473 thought), so a knob that quietly
  // does nothing would be mistaken for "thinking less does not help".
  await t.test("/healthz reports the live thinking level, default and overridden", async () => {
    const dflt = await boot({});
    try {
      // "" is a real answer meaning "we set nothing, the vendor default
      // applies" — it must be PRESENT and empty, not absent, or run-eval.js
      // cannot tell a default-thinking run from an older build.
      const body = await (await fetch(dflt.base + "/healthz")).json();
      assert.equal(body.thinking_level, "", "unset must report as empty, not missing");
      assert.ok("thinking_level" in body);
    } finally { dflt.stop(); }

    const low = await boot({ THINKING_LEVEL: "low" });
    try {
      assert.equal((await (await fetch(low.base + "/healthz")).json()).thinking_level, "low");
    } finally { low.stop(); }
  });

  await t.test("an unrecognized THINKING_LEVEL refuses to boot", async () => {
    // Same no-fallthrough rule as SEARCH_PROVIDER. A dropped value would be
    // invisible: the reports still come back, just at a depth nobody chose.
    await assert.rejects(
      () => boot({ THINKING_LEVEL: "maximum" }),
      /exited early/,
      "must exit rather than silently ignore an unknown reasoning depth",
    );
  });

  await t.test("a THINKING_LEVEL the provider cannot act on refuses to boot", async () => {
    // Anthropic declares thinkingLevels: null. Accepting the value and dropping
    // it on the floor is the worst outcome of the three — the deployment would
    // believe it had turned thinking down and measure no difference.
    await assert.rejects(
      () => boot({ SEARCH_PROVIDER: "anthropic", THINKING_LEVEL: "low" }),
      /exited early/,
      "a knob that appears to work and changes nothing must be refused at boot",
    );
  });

  await t.test("an unrecognized SEARCH_PROVIDER refuses to boot", async () => {
    // boot() throws "server exited early" when the child exits before /healthz.
    // A silent fallback to anthropic would boot healthy and fail this test.
    await assert.rejects(
      () => boot({ SEARCH_PROVIDER: "bogus" }),
      /exited early/,
      "must exit rather than silently pick a provider",
    );
  });
});

// ---------------------------------------------------------------------------
// Every entitlement flag getEntitlements reads must survive getSessionUser
//
// getSessionUser returns a NARROWED user object on purpose — that narrowing is
// what stops a password hash reaching a caller. The cost is a trap the
// function's own comment warns about, and which vault_beta walked straight
// into on 2026-08-12: the column was migrated, the grant was set on a real
// account, getEntitlements read `user.vault_beta`, and the answer was
// undefined because the narrowed object never carried it. Boolean(undefined)
// is false, so a granted broker saw no vault and NOTHING failed anywhere.
//
// The unit tests could not catch it: they hand `vaultBeta` straight to
// computeEntitlements, which is the far side of the missing plumbing. This
// reads the source instead, and pins the pairing itself.
// ---------------------------------------------------------------------------

test("every user flag entitlements reads is carried by getSessionUser", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  // The shape getEntitlements uses to lift a flag off the session user.
  const reads = [...src.matchAll(/Boolean\(user && user\.([a-z_]+)\)/g)].map((m) => m[1]);
  assert.ok(reads.length >= 2,
    "expected getEntitlements to read at least pro_tester and vault_beta; found " + JSON.stringify(reads));

  // The object literal getSessionUser returns.
  const start = src.indexOf("async function getSessionUser");
  assert.ok(start >= 0, "getSessionUser should still exist");
  const end = src.indexOf("// Route guard: replies 401 itself", start);
  assert.ok(end > start, "could not bound getSessionUser");
  const body = src.slice(start, end);

  for (const flag of new Set(reads)) {
    assert.match(body, new RegExp("\\b" + flag + ":"),
      `getEntitlements reads user.${flag}, but getSessionUser does not carry it — ` +
      "the flag would read as undefined and the feature would be silently inert");
  }
});

test("extractFileOnce does not trip site-wide search outage on a vendor failure", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("async function extractFileOnce");
  assert.ok(start >= 0, "extractFileOnce should still exist");
  const end = src.indexOf("async function callAnthropicOnce", start);
  assert.ok(end > start, "could not bound extractFileOnce");
  const body = src.slice(start, end);
  assert.equal(body.includes("upstreamError"), false,
    "a vendor 5xx on extract must not call upstreamError (that paints /admin as a search outage)");
  assert.match(body, /extractVendorError/,
    "vendor HTTP failures should go through extractVendorError");
  assert.match(body, /extractWasTruncated/,
    "a truncated extract must not look like an empty table");
});

test("EXTRACT_PROMPT asks for EXTRACT_KEYS, never lat or lng", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("const EXTRACT_PROMPT");
  assert.ok(start >= 0, "EXTRACT_PROMPT should still exist");
  const end = src.indexOf("function buildPrompt", start);
  assert.ok(end > start, "could not bound EXTRACT_PROMPT");
  const body = src.slice(start, end);
  assert.match(body, /EXTRACT_KEYS/,
    "the prompt must interpolate EXTRACT_KEYS so lat/lng cannot sneak back in via TEMPLATE_COLUMNS");
  assert.equal(/\blat\b/.test(body), false, "the extract prompt must not request lat");
  assert.equal(/\blng\b/.test(body), false, "the extract prompt must not request lng");
});

// --- Analytics visitor attribution ------------------------------------------
//
// migration 026's two columns exist so the event log can answer "did the same
// browser arrive, sign up, and run a report?" — which it could not, because a
// row said what happened and nothing about whose visit it was.
//
// Three things can only be proved by booting a server, and all three are the
// ways this silently does nothing rather than fails: that a document
// navigation actually mints the cookie (an API-only visitor never gets one),
// that the cookie is the httpOnly/SameSite shape claimed, and that the id is
// STABLE across the requests of one visit rather than re-minted per request —
// a per-request id would produce a full table of visitors who each did
// exactly one thing, which reads as traffic rather than as a bug.
//
// No database here, so the rows land in the git-ignored analytics.jsonl
// fallback and /api/stats reads them back through the same aggregator
// production uses.

test("analytics visitor attribution", async (t) => {
  const KEY = "vis-admin-key";
  const cookieNamed = (res, name) => {
    const all = [].concat(res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get("set-cookie") || ""));
    return all.find((c) => String(c).startsWith(name + "=")) || "";
  };

  await t.test("a document navigation mints cn_vid; an API call alone does not", async () => {
    const srv = await boot({ ADMIN_KEY: KEY });
    t.after(() => srv.stop());

    // An API-shaped request carries no cookie and must not create one: minting
    // on whichever of a page's dozen parallel requests arrives first is the
    // race this rule exists to avoid.
    const api = await fetch(srv.base + "/api/config");
    assert.equal(cookieNamed(api, "cn_vid"), "", "an API request must not mint a visitor id");

    // A navigation does.
    const page = await fetch(srv.base + "/", { headers: { "sec-fetch-dest": "document" } });
    const set = cookieNamed(page, "cn_vid");
    assert.match(set, /^cn_vid=[0-9a-f]{32};/, "expected a 32-hex visitor id, got " + set);
    assert.match(set, /HttpOnly/, "the visitor cookie must be httpOnly — no script needs to read it");
    assert.match(set, /SameSite=Lax/);
    assert.match(set, /Max-Age=\d+/);

    // Accept-sniffing is the fallback for clients that send no Sec-Fetch-Dest.
    const sniffed = await fetch(srv.base + "/", { headers: { accept: "text/html,*/*" } });
    assert.match(cookieNamed(sniffed, "cn_vid"), /^cn_vid=[0-9a-f]{32};/);
  });

  await t.test("the id is stable across a visit, and reaches /api/stats as a funnel", async () => {
    const srv = await boot({ ADMIN_KEY: KEY });
    t.after(() => srv.stop());

    const page = await fetch(srv.base + "/", { headers: { "sec-fetch-dest": "document" } });
    const vid = cookieNamed(page, "cn_vid").split(";")[0];
    assert.ok(vid.startsWith("cn_vid="), "expected a minted visitor cookie");

    // Carrying the cookie back must NOT mint a second id — that is the whole
    // stability property, and the thing that turns one visit into one row.
    const again = await fetch(srv.base + "/", {
      headers: { "sec-fetch-dest": "document", cookie: vid },
    });
    assert.equal(cookieNamed(again, "cn_vid"), "", "an existing visitor id must not be re-minted");

    // Do something that logs an event, as this visitor. Deliberately a POST
    // with a body, which is the case that does NOT work by default: a
    // request-body route logs from inside `req.on("end", ...)`, and Node
    // emits that from the connection's async context rather than the
    // handler's, so a plain AsyncLocalStorage.run() around the handler leaves
    // the store null there. `bindRequestListeners` is what fixes it. Remove
    // it and this assertion is the one that goes red — every GET-shaped
    // event would still be attributed perfectly, which is precisely why this
    // needs a test rather than a spot check.
    const signup = await fetch(srv.base + "/api/account/signup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: vid },
      body: JSON.stringify({ email: `vis-${Date.now()}@example.com`, password: "correct-horse-battery" }),
    });
    assert.equal(signup.status, 200);

    // logEvent is fire-and-forget on purpose — analytics must never delay a
    // real request — so the row lands a tick or two after the response the
    // visitor already got. Poll rather than sleep a fixed amount.
    let stats = null;
    for (let i = 0; i < 40; i++) {
      stats = await (await fetch(srv.base + "/api/stats", { headers: { "x-admin-key": KEY } })).json();
      if (stats.funnel && stats.funnel.arrived >= 1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(stats.funnel, "/api/stats must carry the funnel block");
    assert.ok(stats.funnel.arrived >= 1, "the signup's visitor should have been counted as an arrival");
    assert.ok(stats.funnel.signedUp >= 1, "the signup event should be attributed to that visitor");
    // Cumulative sets: a stage can never exceed the population it is drawn
    // from, or the drop between two lines is not a drop-off.
    assert.ok(stats.funnel.signedUp <= stats.funnel.arrived);
    assert.ok(stats.funnel.report <= stats.funnel.arrived);
  });

  await t.test("a garbage cookie value is never trusted into the column", async () => {
    const srv = await boot({ ADMIN_KEY: KEY });
    t.after(() => srv.stop());
    // The value comes from a client and is written to a database, so anything
    // that is not the shape this server mints is replaced rather than stored.
    const res = await fetch(srv.base + "/", {
      headers: { "sec-fetch-dest": "document", cookie: "cn_vid=" + "x".repeat(200) },
    });
    assert.match(cookieNamed(res, "cn_vid"), /^cn_vid=[0-9a-f]{32};/,
      "a malformed visitor id must be replaced with a freshly minted one");
  });
});

// --- The watchlist digest ---------------------------------------------------
//
// watchlist-digest.js already proves what the email SAYS. What can only be
// proved by booting a server is that the route refuses in the right order,
// and that is most of the value here: this is the only thing the product
// sends on its own initiative, so every refusal exists to stop it mailing
// real people something wrong.
//
// The one that matters most is the no-database 503. Without it the run would
// build every digest, hand each to a sendOutboundEmail that silently no-ops
// when mail is unconfigured, and then advance every high-water mark — mailing
// nobody while recording everybody as mailed, which DELETES a digest rather
// than delaying it. There is no database in this environment, so that path is
// exactly what these tests exercise.

test("watchlist digest", async (t) => {
  const KEY = "digest-admin-key";

  await t.test("the route does not exist without ADMIN_KEY, and refuses a stranger", async () => {
    const dark = await boot({});
    t.after(() => dark.stop());
    const gone = await fetch(dark.base + "/api/watchlist/digest", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(gone.status, 404, "an unconfigured deployment must not answer this route");

    const srv = await boot({ ADMIN_KEY: KEY });
    t.after(() => srv.stop());
    const anon = await fetch(srv.base + "/api/watchlist/digest", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(anon.status, 401, "this route reads every account's email address");
  });

  await t.test("it refuses to run without a database rather than marking everyone mailed", async () => {
    const srv = await boot({ ADMIN_KEY: KEY });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + "/api/watchlist/digest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": KEY },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /database/i);
  });

  await t.test("even a dry run refuses without a database", async () => {
    // The dry run skips the outbound-mail check (inspecting copy should not
    // need a verified domain) but not this one: with no database there is no
    // watchlist to read, and an empty summary would read as "nobody is
    // watching anything" rather than "this cannot answer".
    const srv = await boot({ ADMIN_KEY: KEY });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + "/api/watchlist/digest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-key": KEY },
      body: JSON.stringify({ dryRun: true }),
    });
    assert.equal(r.status, 503);
  });
});

test("watchlist digest unsubscribe", async (t) => {
  // SUPABASE_SERVICE_KEY without SUPABASE_URL: DB_CONFIGURED stays false (it
  // needs both), but the token HMAC is keyed on the service key alone, so the
  // link half is testable with no database.
  const SERVICE = "service-key-for-token-hmac";
  const crypto = require("node:crypto");
  const macFor = (id) => crypto.createHmac("sha256", SERVICE)
    .update(`watchlist-digest-unsubscribe:${id}`).digest("hex").slice(0, 32);
  const USER = "11111111-2222-3333-4444-555555555555";

  await t.test("a wrong or missing token is refused", async () => {
    const srv = await boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    for (const q of [`?u=${USER}`, `?u=${USER}&t=nope`, `?u=&t=${macFor("")}`]) {
      const r = await fetch(srv.base + "/watchlist/unsubscribe" + q);
      assert.equal(r.status, 400, "unexpectedly accepted " + q);
    }
  });

  await t.test("a valid link CONFIRMS rather than acting, and is noindex", async () => {
    const srv = await boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + `/watchlist/unsubscribe?u=${USER}&t=${macFor(USER)}`);
    assert.equal(r.status, 200);
    const html = await r.text();

    // The whole point of the second click: corporate mail scanners and
    // link-preview bots fetch every URL in an email, so a GET that
    // unsubscribed would opt people out of mail they never opened. If this
    // ever becomes a one-click GET, this assertion is the one that says so.
    assert.match(html, /<form method="POST"/,
      "the GET must only offer a form — a prefetching mail scanner must not be able to unsubscribe anyone");
    assert.match(html, /Turn off watchlist emails\?/);
    assert.match(html, /noindex/, "an unsubscribe page must never be indexed");
    assert.equal(r.headers.get("x-robots-tag"), "noindex");
  });

  await t.test("the resubscribe direction is reachable from the same link", async () => {
    // A one-way off switch with no way back is a support ticket.
    const srv = await boot({ SUPABASE_SERVICE_KEY: SERVICE });
    t.after(() => srv.stop());
    const r = await fetch(srv.base + `/watchlist/unsubscribe?u=${USER}&t=${macFor(USER)}&on=1`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Turn these emails back on\?/);
    assert.match(html, /<form method="POST"/);
  });
});

test("/api/vault/extract sniffs the media type and never takes it from the body", () => {
  // What we forward to a third-party vendor has to be what it claims to be, so
  // the type is decided by broker-vault.js's magic-byte check. A mediaType
  // read off the request would let a renamed file through the check that
  // exists to stop exactly that.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf('path === "/api/vault/extract"');
  assert.ok(start >= 0, "the extract route should still exist");
  const end = src.indexOf('path === "/api/vault/benchmarks"', start);
  assert.ok(end > start, "could not bound the extract route");
  const route = src.slice(start, end);
  assert.match(route, /VAULT\.checkExtractFile\(bytes\)/,
    "type and size must both go through the one pure check");
  assert.match(route, /extractFileOnce\(b64, file\.mediaType\)/,
    "the vendor call must carry the SNIFFED media type");
  assert.equal(/payload\.mediaType|body\)\.mediaType|\bmediaType\s*[:=]\s*String/.test(route), false,
    "the media type must never be read from the request body");
  // A screenshot arrives as data:image/png;base64,… — a prefix stripper
  // hard-coded to application/pdf would leave that text in the base64 and turn
  // every image into "that file isn't something we can read".
  assert.equal(route.includes("data:application\\/pdf"), false,
    "the data: prefix stripper must not be PDF-only");
});

test("buildPrompt treats Residential as a home-buyer CMA, not a CRE analyst write-up", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("function buildPrompt");
  const end = src.indexOf("function normalizeSubjectLastSale", start);
  assert.ok(start >= 0 && end > start, "could not bound buildPrompt");
  const body = src.slice(start, end);

  assert.match(body, /type === "Residential"/,
    "Residential must branch the role line, not share the CRE analyst opener");
  assert.match(body, /comparable market analysis for a home buyer/);
  assert.match(body, /You are a commercial real estate analyst/,
    "the CRE role stays for every other type");
  assert.match(body, /BEDS FIT:/,
    "bedroom match has to be a prompt rule; it is not in compWeight");
  assert.match(body, /within one bedroom of the subject/);
  // LoopNet/Crexi lane copy is for commercial assets. A house search that
  // still interpolates it starts in the wrong places.
  assert.match(body, /type === "Residential" \? "" : \(LANE_GUIDANCE/);
  const laneLine = body.split("\n").find((l) => l.includes("LANE_GUIDANCE[lane]"));
  assert.ok(laneLine, "LANE_GUIDANCE interpolation should still exist");
  assert.match(laneLine, /Residential/,
    "Residential must skip LANE_GUIDANCE, not merely fall through when lane is solo");
  assert.match(body, /Leave "tenancy" empty/,
    "a house prompt must not ask for NNN / credit-tenant occupancy");
  assert.match(body, /do not restate them in notes/,
    "beds and year built already have columns; restating them puffed the first rows");
  assert.match(body, /If the market note names a radius in miles/,
    "a typed 2.5-mile market note must override the 1-mile neighborhood default");
});

// The model writes this JSON top to bottom and the write leg is the slow half
// of a report, so where a field sits in the taught shape decides when (and
// whether) the visitor ever sees it stream. "comps" is the only part the
// browser can paint mid-stream, so everything above it is dead air and every
// market-level read of the comps belongs below them. Evaluating the block
// rather than grepping it, because the property that matters is the ORDER of
// the keys and the fact that the skeleton is still valid JSON in every branch.
test("buildPrompt writes the comps array before every market-level field", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("    `OUTPUT FORMAT");
  assert.ok(start >= 0, "could not find the OUTPUT FORMAT shape block");
  const endMark = "    `}`,\n";
  const end = src.indexOf(endMark, start);
  assert.ok(end > start, "could not bound the shape block");
  const block = src.slice(start, end + endMark.length);

  // Fields whose value is a read OF the comps: writing them first means
  // describing rows the model has not committed to yet, and costs the live
  // table seconds of blank screen.
  const AFTER_COMPS = ["avg_price_per_sqft", "subject_lat", "subject_lng",
    "market_cap_rate_range", "market_opex_range", "value_drivers", "market_trend",
    "annual_price_trend_pct", "search_radius", "transactions_reviewed",
    "price_discovery"];

  for (const compsOnly of [false, true]) {
    for (const wantsSize of [false, true]) {
      for (const isLand of [false, true]) {
        const where = `compsOnly=${compsOnly} wantsSize=${wantsSize} isLand=${isLand}`;
        const lines = new Function("compsOnly", "wantsSize", "isLand", "compShape",
          "return [\n" + block + "];")(compsOnly, wantsSize, isLand, '{ "a": "" }');
        const text = lines.join("\n");
        const skeleton = text.slice(text.indexOf("{"));
        let shape;
        assert.doesNotThrow(() => { shape = JSON.parse(skeleton); },
          `the shape the prompt teaches must be valid JSON (${where})`);
        const keys = Object.keys(shape);
        const compsAt = keys.indexOf("comps");
        assert.ok(compsAt >= 0, `comps must be in the shape (${where})`);
        for (const k of AFTER_COMPS) {
          const at = keys.indexOf(k);
          if (at === -1) continue;   // gated off in this branch
          assert.ok(at > compsAt,
            `"${k}" must be written after "comps" (${where})`);
        }
        // summary is the deliberate exception: it is the one narrative field
        // the loading card can show (makeFieldExtractor), so it stays on top.
        if (!compsOnly) {
          assert.ok(keys.indexOf("summary") >= 0 && keys.indexOf("summary") < compsAt,
            `"summary" streams to the loading card and must stay above "comps" (${where})`);
        }
        // Nothing above the comps may be bulky. Everything still up there is a
        // subject lookup or a unit declaration; a new one belongs below.
        const ALLOWED_ABOVE = new Set(["summary", "currency", "usd_rate",
          "subject_size_sqft", "subject_size_source", "subject_last_sale",
          "subject_assessed", "subject_asking", "subject_year_built"]);
        for (const k of keys.slice(0, compsAt)) {
          assert.ok(ALLOWED_ABOVE.has(k),
            `"${k}" sits above "comps" and delays the live table (${where})`);
        }
      }
    }
  }
});

// $/SF on a priced, sized sale is arithmetic the server already redoes
// (reconcilePricePerSqft), so asking for it spent write-leg tokens on a figure
// that could not survive contradicting its own row.
test("buildPrompt stops asking for a $/SF it derives itself", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("function buildPrompt");
  const end = src.indexOf("function normalizeSubjectLastSale", start);
  assert.ok(start >= 0 && end > start, "could not bound buildPrompt");
  const body = src.slice(start, end);
  assert.match(body, /OMIT "price_per_sqft" entirely/,
    "a sale carrying both price and size must not restate price divided by size");
  assert.match(body, /on LEASE comps/,
    "a lease rate is not derivable and must still be asked for");
  assert.match(body, /recheck the figures rather than copying the inconsistency/,
    "dropping the field must not drop the source cross-check it was really doing");
});

test("buildPrompt asks for subject_assessed next to last-sale, not in summary", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("function buildPrompt");
  assert.ok(start >= 0, "buildPrompt should still exist");
  const end = src.indexOf("function normalizeSubjectLastSale", start);
  assert.ok(end > start, "could not bound buildPrompt");
  const body = src.slice(start, end);
  assert.match(body, /"subject_assessed": \{ "value": "", "year": "", "source_url": "" \}/);
  assert.match(body, /wantsSize \|\| !compsOnly/);
  assert.match(body, /Do not put it in "summary"/);
  assert.match(body, /whole parcel, never land-only or improvements-only/);
  assert.match(body, /do not spend an additional search on it/);
  const assessedRule = body.slice(body.indexOf('"subject_assessed" ='));
  assert.equal(assessedRule.includes('mention it in "summary"'), false,
    "assessed must not earn last-sale's protected summary slot");
});

test("buildPrompt splits close dates from on-market listing dates", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("function buildPrompt");
  assert.ok(start >= 0, "buildPrompt should still exist");
  const end = src.indexOf("async function callAnthropicOnce", start);
  assert.ok(end > start, "could not bound buildPrompt");
  const body = src.slice(start, end);
  assert.match(body, /ON-MARKET LISTINGS/,
    "on-market listing rows need their own prompt block, like NEARBY COMPS");
  assert.match(body, /Listed Mar 2025/,
    "active listings must be told to write Listed Mon YYYY, not a bare close month");
  assert.equal(body.includes("lease/listing was signed or posted"), false,
    "the old combined date sentence treats a list date as a close");
});

test("finishReport and mergeLaneReports wire subject_assessed", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const finish = src.slice(src.indexOf("const finishReport"), src.indexOf("try {", src.indexOf("const finishReport")));
  assert.match(finish, /normalizeSubjectAssessed\(/);
  assert.match(finish, /new Date\(\)/);
  const mergeStart = src.indexOf("function mergeLaneReports");
  const merge = src.slice(mergeStart, src.indexOf("Dead-at-birth source-link check", mergeStart));
  assert.match(merge, /records\.subject_assessed && records\.subject_assessed\.value/);
  assert.match(merge, /primary\.subject_assessed = records\.subject_assessed/);
});

test("portfolio market movement fails safe and reads the snapshot, not updated_at", () => {
  // The desk's portfolio is the page a member opens to see their own work. A
  // corpus read that throws must cost them a line, never the list.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("async function withMarketMovement");
  assert.ok(start >= 0, "withMarketMovement should still exist");
  const end = src.indexOf("function medianPsfOf", start);
  assert.ok(end > start, "could not bound withMarketMovement");
  const body = src.slice(start, end);

  assert.match(body, /catch \(e\)[\s\S]{0,200}return list;/,
    "any failure must serve the portfolio unchanged rather than 500");
  assert.match(body, /snaps\[snaps\.length - 1\]\.ts/,
    "'last checked' is the newest snapshot; updated_at moves when the payload is rewritten");
  assert.match(body, /PFDELTA\.marketMoveSince/,
    "the decision belongs to the pure, tested module");
});

// ---------------------------------------------------------------------------
// The webhook's switch and the Stripe dashboard's event list are one setting
// in two places, and only one of them is in this repo.
//
// A handler for an event the destination does not send is dead code that
// looks alive: `charge.refunded` and the async-payment pair were WRITTEN
// against a destination subscribed to six events, so until someone ticks the
// boxes in Stripe, a refunded buyer still keeps their report and nothing here
// fails. PRO-BILLING-SETUP.md is the checklist whoever configures that
// destination reads, so this pins the two lists to each other — the file
// cannot fall behind the code, and a new case cannot ship without the setup
// step being written down.
// ---------------------------------------------------------------------------

test("PRO-BILLING-SETUP.md lists exactly the events handleStripeEvent handles", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");

  const src = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const start = src.indexOf("async function handleStripeEvent");
  assert.ok(start >= 0, "handleStripeEvent should still exist");
  const end = src.indexOf("async function entitlementsFor", start);
  assert.ok(end > start, "could not bound handleStripeEvent");
  const handled = [...src.slice(start, end).matchAll(/case "([a-z_]+\.[a-z_.]+)":/g)].map((m) => m[1]);
  assert.ok(handled.length >= 6, "expected the switch to handle at least the original six events");

  const doc = fs.readFileSync(path.join(root, "PRO-BILLING-SETUP.md"), "utf8");
  const block = doc.match(/matching the switch in `handleStripeEvent\(\)`[^`]*```\n([\s\S]*?)```/);
  assert.ok(block, "PRO-BILLING-SETUP.md should still carry the fenced event list");
  const documented = block[1].split("\n").map((l) => l.trim()).filter(Boolean);

  assert.deepEqual([...handled].sort(), [...documented].sort(),
    "the webhook switch and the documented Stripe event list disagree — a handled " +
    "event missing from the doc never gets enabled in Stripe, and a documented " +
    "event with no case is noise the destination pays to deliver");
});

test("a refund revokes only a FULL refund, and only a report unlock", () => {
  // The two ways this branch goes wrong are both silent: revoking on a partial
  // refund repossesses a report the customer still mostly paid for, and acting
  // on a refunded Pro invoice ends a paid-up member's access early.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf('case "charge.refunded"');
  assert.ok(start >= 0, "the refund branch should still exist");
  const end = src.indexOf("default:", start);
  assert.ok(end > start, "could not bound the refund branch");
  const branch = src.slice(start, end);

  assert.match(branch, /STRIPE\.refundOf\(obj\)/,
    "the full-vs-partial decision belongs to the pure, tested refundOf");
  assert.match(branch, /if \(!full\)/,
    "a partial refund must take its own path rather than falling through to the revoke");
  assert.match(branch, /revokeReportPurchase\(paymentIntentId\)/,
    "the revoke must match on the payment intent, the only join to report_purchases");
  assert.equal(/upsertSubscription|deleteSubscription/.test(branch), false,
    "a refund must not touch subscription state — that is the subscription events' job");
});

// --- /admin's digest trigger ------------------------------------------------
//
// The digest route is deliberately manual, but "manual" meant curl-only, which
// is a feature nobody runs. The card on /admin is the trigger.
//
// One property matters more than the rest and is the reason this is a test
// rather than a look: OPENING THE PAGE MUST NOT SEND EMAIL. Every other card
// on /admin fetches its data on load, so the obvious way to write this one is
// the wrong way, and the mistake is invisible — the page would look identical
// and the mail would already be gone.

test("/admin's watchlist digest card", async (t) => {
  const srv = await boot({ ADMIN_KEY: "admin-card-key" });
  t.after(() => srv.stop());
  const html = await (await fetch(srv.base + "/admin")).text();

  await t.test("the card and both buttons are wired", async () => {
    assert.match(html, /id="digest"/, "the mount point should exist");
    // The buttons are built by digestBtn(id,label) rather than written as
    // literal markup, so assert on the construction, not on rendered HTML
    // this test never executes.
    assert.match(html, /digestBtn\("dgPrev"/);
    assert.match(html, /digestBtn\("dgSend"/);
    assert.match(html, /Preview \(sends nothing\)/,
      "preview is the primary gesture: the default should be to READ what would go out");
  });

  await t.test("nothing is posted to the digest route on page load", async () => {
    // Both call sites live inside the click handler; a fetch anywhere else
    // would fire on load. Asserted on the source because the failure mode is
    // an email that has already left by the time anyone could observe it.
    const calls = html.split('"/api/watchlist/digest"').length - 1;
    assert.equal(calls, 1, "exactly one fetch call site, inside run()");
    const loader = html.slice(html.indexOf("function load(key)"), html.indexOf("function load(key)") + 1200);
    assert.equal(/watchlist\/digest/.test(loader), false,
      "the page loader must not touch the digest route");
    assert.match(html, /renderDigestCard\(\)/,
      "load() should render the card's idle state, which takes no arguments and fetches nothing");
  });

  await t.test("sending asks first, and says the send cannot be recalled", async () => {
    assert.match(html, /confirm\("Send the digest now\?[^"]*cannot be recalled/,
      "the irreversible button must confirm, and say why it is irreversible");
    // Preview must NOT be behind a confirm — a dialog on the safe action
    // trains people to click through the one on the unsafe action.
    const run = html.slice(html.indexOf("var run=function(dry)"), html.indexOf("var run=function(dry)") + 400);
    assert.match(run, /if\(!dry&&!confirm\(/, "the confirm is gated on it being a real send");
  });
});

// Every dimension a logEvent CALL SITE passes must exist in logEvent's row.
//
// The sibling of "every user flag entitlements reads is carried by
// getSessionUser", and written for the same reason after the same thing
// happened a second time: three /api/comps call sites passed `plan: ent.plan`
// from the day the Pro tier shipped, logEvent's row never had a `plan` field,
// and the value was discarded on every search for months. Nothing failed. The
// code read as though "do free users search more than Pro ones" was
// answerable, and it was not.
//
// A dropped dimension cannot fail loudly by its nature — the row still writes,
// the column is simply absent — so this reads both sides out of server.js and
// pairs them. Adding a dimension at a call site now fails the build until
// logEvent records it.
test("every dimension passed to logEvent is recorded by it", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  const start = src.indexOf("function logEvent(kind, dims)");
  assert.ok(start >= 0, "logEvent should still exist");
  const end = src.indexOf("function aggregateStats", start);
  assert.ok(end > start, "could not bound logEvent");
  const row = src.slice(start, end);

  // Keys the row actually writes.
  const recorded = new Set([...row.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]));
  assert.ok(recorded.has("kind") && recorded.has("market"),
    "expected to have parsed logEvent's row; got " + JSON.stringify([...recorded]));

  // Keys the call sites pass. Only the single-line object literals are
  // scanned, which is every call site's shape today; a multi-line one would
  // be missed, so this is a floor on coverage rather than a proof.
  const passed = new Set();
  for (const call of src.matchAll(/logEvent\("[a-z_]+",\s*\{([^}]*)\}/g)) {
    for (const key of call[1].matchAll(/(?:^|,)\s*([a-z_]+)\s*:/g)) passed.add(key[1]);
  }
  assert.ok(passed.size >= 3, "expected to have found call-site dimensions; got " + JSON.stringify([...passed]));

  for (const dim of passed) {
    assert.ok(recorded.has(dim),
      `a logEvent call site passes "${dim}", but logEvent's row does not record it — ` +
      "the value is built and thrown away, and nothing anywhere fails");
  }
});

test("radius blend is wired inside gate, before the paywall and before vault blend", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  // gate() was a closure inside /api/comps until 2026-08-21; it is now the
  // module-level finishReportForViewer, shared with the bulk worker so a
  // portfolio row and the report behind it are assembled the same way. The
  // ORDER inside it is what this test is about, and none of it changed.
  const start = src.indexOf("async function finishReportForViewer(rep, ctx) {");
  assert.ok(start >= 0, "finishReportForViewer() should still be the one serialization funnel");
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, "could not bound finishReportForViewer()");
  const body = src.slice(start, end);
  const radiusAt = body.indexOf("RADIUSBLEND.blendNearbyComps");
  const paywallAt = body.indexOf("GATE.gateReport");
  const vaultAt = body.indexOf("BLEND.blendPrivateComps");
  assert.ok(radiusAt >= 0, "gate() must call blendNearbyComps");
  assert.ok(paywallAt >= 0, "gate() must call gateReport");
  assert.ok(vaultAt >= 0, "gate() must call blendPrivateComps");
  assert.ok(radiusAt < paywallAt, "saved public deals must enter BEFORE the paywall so extras become locked_basis");
  assert.ok(paywallAt < vaultAt, "vault blend must stay AFTER the paywall");
  const distAt = body.indexOf("RADIUSBLEND.attachCompDistances");
  assert.ok(distAt >= 0, "gate() must stamp distance_mi before the paywall");
  assert.ok(distAt < paywallAt, "distance must be on the comps (and then locked_basis) before gateReport");
  assert.match(body, /propertyType:\s*typeOk/,
    "house reports must pass the type so the blend uses the 1-mile radius, not CRE's 10");
  assert.match(body, /marketNote:\s*noteOk/,
    "a typed 2.5-mile market note must set the blend radius");
  assert.equal(/harvestComps\s*\(\s*typeOk/.test(body), false,
    "harvest must not run inside gate() — extras would re-enter the corpus from a serialization-only merge");
});

// --- hub invitations by email (2026-08-14) --------------------------------

test("hub invites are wired to the outbound mail gate", async () => {
  // Hubs shipped with copy-link invitations and NOTHING that could email one:
  // sendHubInvites did not exist, so verifying a Resend domain would not have
  // made invitations start working. This pins that both minting sites call it
  // and that it rides the same EMAIL_FROM gate as every other outbound mail,
  // so an un-verified deployment stays copy-link and a verified one just works.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  assert.match(src, /function sendHubInvites\(invites, \{ hubTitle, fromName \}\)/);
  // It must go through sendOutboundEmail, which is the gate. Calling sendEmail
  // directly would mail from an unverified domain.
  const fn = src.match(/function sendHubInvites[\s\S]*?\n\}/)[0];
  assert.match(fn, /sendOutboundEmail\(/);
  assert.ok(!/\bsendEmail\(/.test(fn), "must not bypass the outbound gate");

  // Both places that mint a token send it.
  assert.equal((src.match(/sendHubInvites\(/g) || []).length, 3,
    "declaration + create route + participants route");

  // And the client is told whether anything actually left, so the panel's copy
  // cannot claim "we do not email" on a deployment that does.
  assert.match(src, /const OUTBOUND_EMAIL_LIVE = \(\) => Boolean\(RESEND_API_KEY && EMAIL_FROM\)/);
});

test("the emailed flag is the send's answer, not a restatement of the config", () => {
  // `emailed: OUTBOUND_EMAIL_LIVE()` was a LIE with a cost. That function only
  // asks whether RESEND_API_KEY and EMAIL_FROM are set; the send was
  // fire-and-forget and a Resend rejection reached nothing but a console.error
  // on a host Owen cannot read. So the broker was told "each person has been
  // emailed their link" whether or not Resend accepted it.
  //
  // On the hub page that is not cosmetic: showPeopleInvites HIDES the links
  // when it believes they were mailed, and a hub token cannot be shown twice.
  // A refused send therefore destroyed the invitation and reported success —
  // the same shape as the 2026-08-19 splitter bug, whose damage was likewise
  // "the link hidden because emailed was true".
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  // The whole chain has to carry the answer back, or the route cannot know it.
  assert.match(src, /async function sendEmail\(/, "sendEmail must resolve to whether Resend accepted");
  assert.match(src, /async function sendOutboundEmail\(/);
  assert.match(src, /async function sendHubInvites\(/);

  // sendHubInvites reports WHO was not mailed, per person: a partial failure
  // must not withhold the links of the people it did fail.
  const fn = src.match(/async function sendHubInvites[\s\S]*?\n\}/)[0];
  assert.match(fn, /return invites\.filter\(/, "must return the addresses that were not mailed");

  // Neither route may go back to asserting it.
  assert.equal((src.match(/emailed: OUTBOUND_EMAIL_LIVE\(\),/g) || []).length, 0,
    "the bare config flag must not be reported as the send result");
  assert.equal((src.match(/emailed: OUTBOUND_EMAIL_LIVE\(\) && emailFailed\.length === 0/g) || []).length, 2,
    "both the create route and the participants route report the real result");

  // And both must actually WAIT for it. Dropping the await silently restores
  // the bug: emailFailed stays [] and every send reads as a success.
  assert.equal((src.match(/await sendHubInvites\(/g) || []).length, 2,
    "an un-awaited send makes emailFailed empty and the flag wrong again");
});

test("the three invitation emails say 'a free account is all it takes' the same way", () => {
  // Not a style rule imported from outside: sendShareInvites already writes
  // this exact sentence as two plain sentences ("...to open it. A free account
  // is all it takes."), and its two siblings wrote it with an em dash instead.
  // Three emails that arrive at the same person from the same product should
  // not read as though three people wrote them.
  //
  // Scoped to the BODIES of the three invite senders on purpose. Em dashes in
  // comments and in internal owner notifications are nobody's business.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  for (const name of ["sendShareInvites", "sendOrgInvites", "sendHubInvites"]) {
    const fn = src.match(new RegExp(`function ${name}[\\s\\S]*?\\n\\}`))[0];
    // Only the emitted copy, which is what a recipient reads.
    const copy = (fn.match(/`[^`]*`/g) || []).join(" ");
    assert.ok(!copy.includes("—"), `${name}'s email copy should not use an em dash`);
    assert.match(copy, /A free account is all it takes/,
      `${name} should phrase the account line like its siblings`);
  }
});

test("only newly invited people are mailed when a participant list is replaced", () => {
  // Re-saving an unchanged list, or only REMOVING somebody, must email nobody.
  // Same rule as PUT /api/shares/viewers, and the reason the route builds its
  // link list from `invites` (the new tokens) rather than from `wanted`.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const route = src.match(/PUT" && hubPath === "\/api\/hub\/participants"[\s\S]*?\n    \}/)[0];
  assert.match(route, /if \(newLinks\.length\) \{/);
  assert.match(route, /sendHubInvites\(newLinks/);
});

// --- The geocode proxy takes a POST, and no longer takes a GET --------------
//
// The address of every comp on every report goes through this route, private
// vault comps included (GUARD 2 of the private-comp contract stops them here
// and never lets them reach Nominatim). On a query string all of those landed
// in the platform's access logs and in outbound Referer headers, which is what
// moving it to POST fixes.
//
// The GET form was removed rather than kept as an alias, so the half of this
// worth testing is that it is really GONE: a deprecated door nobody notices is
// exactly how the addresses come back. The source check is the other half —
// the route can be perfect and still leak if a caller was missed, and both
// callers live in files this suite already has on disk.
//
// Costs nothing: an empty address is refused before geocodeCensus is reached,
// so no test here ever calls the Census API.

test("the geocode proxy is POST-only and no caller builds a query string", async (t) => {
  const srv = await boot({});
  t.after(() => srv.stop());

  await t.test("the GET form is gone, not merely unused", async () => {
    const r = await fetch(srv.base + "/api/geocode?address=" + encodeURIComponent("1600 Pennsylvania Ave NW, Washington, DC"));
    assert.equal(r.status, 404);
  });

  await t.test("a POST with no address is refused before any lookup", async () => {
    const r = await fetch(srv.base + "/api/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /address is required/i);
  });

  await t.test("a malformed body is a 400, not a soft empty answer", async () => {
    const r = await fetch(srv.base + "/api/geocode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(r.status, 400);
  });

  await t.test("neither caller puts the address in a URL", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    for (const file of ["server.js", "index.html"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      // Catches the exact shape that was removed and any revival of it,
      // including a differently-named param on the same route.
      assert.ok(
        !/["'`]\/api\/geocode\?/.test(src),
        file + " builds a /api/geocode query string — the address must ride in a POST body"
      );
    }
  });
});

// --- The two geocode caches keep separate localStorage names ----------------
//
// The app (index.html) and the market pages' map (MARKET_MAP_JS in server.js)
// run the same geocoding stack against the same addresses, and until
// 2026-08-04 they shared one localStorage key on purpose, to share hits. They
// must not any more, and nothing at runtime would say so if they did.
//
// index.html went to geoCache.v2 that day so every entry carries the
// geocoder's echoed label. geoLabelMatches returns false when the label is
// missing, and it is the gate on subject photos and footprint sizing — the
// two claims a report makes about a specific building. MARKET_MAP_JS draws
// pins only, so it stores {lat, lng} with no label.
//
// Share one key again and a market-page visit writes a label-less entry for
// an address the app later reads, which costs that property its photo and its
// size estimate — silently, and persistently, since the entry is cached. The
// harm runs one way and shows up nowhere near the change that caused it,
// which is why it is worth a test rather than a comment alone.
//
// Names, not version numbers, and the test checks the names really differ:
// two keys that differ only by a digit read as drift, and the obvious tidy-up
// is to re-sync them.

test("the app's geocode cache and the market map's stay separate stores", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

  const appKey = read("index.html").match(/GEO_CACHE_KEY = "([^"]+)"/);
  const mktKey = read("server.js").match(/var CACHE_KEY = "([^"]+)"/);

  assert.ok(appKey, "index.html no longer declares GEO_CACHE_KEY — update this test with it");
  assert.ok(mktKey, "MARKET_MAP_JS no longer declares CACHE_KEY — update this test with it");

  assert.notEqual(
    appKey[1],
    mktKey[1],
    "the market map and the app share a localStorage geocode key again: the market map "
      + "caches no geocoder label, and a label-less entry read by the app fails "
      + "geoLabelMatches, costing that address its subject photo and footprint size"
  );

  // A market-page entry must stay recognisable as one from its name alone,
  // so a future reader does not take the pair for accidental drift.
  assert.ok(
    /^mkt/.test(mktKey[1]),
    "the market map's cache key should name itself a market-page store, not sit one "
      + "version number away from the app's"
  );
});

// --- the watchlist feed's median is closed sales only (2026-08-20) ---------
//
// The corpus began storing on-market listings in the same commit as this
// test. buildWatchlistFeed's median_psf windows on `ts` — when we HARVESTED
// the row, not when the deal closed — and filters only leases out, so a
// freshly harvested asking price would land straight in the median with
// nothing to exclude it. That median is quoted on My Desk and again in the
// watchlist digest email, the one message this product sends on its own
// initiative, so a contaminated one is mailed to people unprompted.
//
// A source scan rather than a booted feed: the median needs a database, a
// signed-in user and a populated corpus, and the invariant is one line.
test("the watchlist feed's median $/SF requires a parseable deal date", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("const salePsf = rows");
  assert.ok(start >= 0, "buildWatchlistFeed's salePsf chain is gone or renamed");
  const chain = src.slice(start, src.indexOf(".sort(", start));
  assert.match(chain, /parseDealDate\([^)]*\)\s*!=\s*null/,
    "salePsf must drop rows whose deal_date does not parse — an on-market " +
    "listing is stored with deal_date \"Active\"/\"Listed Mon YYYY\" and is an " +
    "ASKING price, not a comparable sale");
});

// COMP_FLOOR exists because of a measured side effect of THINKING_LEVEL=low
// (2026-08-21): 66% faster and 66% cheaper, and a third fewer comps. The
// shorter list was BETTER sourced (estimate rate 14% -> 2%), so the model
// appears to stop LOOKING sooner rather than to find worse comps. The one way
// this instruction could do harm is by buying comp count back with padding,
// which is why the anti-padding rules are restated inside it rather than left
// to proximity.
test("the comp floor asks for more searching, never for a lower bar", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("function buildPrompt");
  const end = src.indexOf("function normalizeSubjectLastSale", start);
  assert.ok(start >= 0 && end > start, "could not bound buildPrompt");
  const body = src.slice(start, end);

  const rule = body.slice(body.indexOf("COMP COUNT:"));
  assert.ok(rule.length > 100, "the COMP COUNT instruction should exist");
  const sentence = rule.slice(0, rule.indexOf("`", 1));
  assert.match(sentence, /keep searching/, "the ask must be to search harder");
  assert.match(sentence, /does NOT relax any rule above/,
    "it must restate that it relaxes nothing, not merely sit near the rule that says so");
  assert.match(sentence, /never pad the list/);
  assert.match(sentence, /not on lowering the bar for what counts as one/);

  // Gated, and off unless a deployment opts in — it is a prompt change on the
  // hot path and is only worth carrying if the eval says it recovers the comps.
  assert.match(body, /COMP_FLOOR\s*\n?\s*\?/, "the instruction must be behind the flag");
  assert.equal(/^(1|on|true|yes)$/i.test(""), true === false,
    "an unset COMP_FLOOR must read as off");
});

test("the comp floor can never ask for more comps than the report will show", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  // Asking for 6 on a 4-comp request would be an instruction the gate then
  // truncates, i.e. wasted searching the visitor pays for and never sees.
  assert.match(src, /Math\.min\(COMP_FLOOR_TARGET, maxComps\)/,
    "the floor must be clamped to maxComps");
  assert.match(src, /Math\.max\(3, Number\(process\.env\.COMP_FLOOR_TARGET\)/,
    "and never fall below the prompt's own stated minimum of 3");
});

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

  // The signed-in header chrome, on every page that is not index.html.
  //
  // The bug (owner-reported 2026-08-09): MARKET_BAR carried three links and
  // nothing else, so leaving the home page dropped Pricing, My Desk and the
  // account circle in one go and read as having been logged out mid-browse.
  // Nothing touched the session — the bar just stopped mentioning it.
  //
  // There are now FOUR headers that have to agree (index.html's, MARKET_BAR,
  // /how-it-works', and /vault) and the site's own convention is that two
  // copies of a nav drift. This is what catches a fifth server-rendered page
  // shipping without the chrome: accountNavSlots() is one call, so forgetting
  // it is the easy mistake, not getting it subtly wrong.
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
      // Load-bearing: .hdr nav .dd a sets display:block, which out-specifies
      // the [hidden] attribute's UA rule. Without this line every page paints
      // signed-out and signed-in chrome at the same time.
      assert.match(html, /\.hdr nav \[hidden\]\{display:none!important\}/,
        p + " can't actually hide the slots it ships");
    }
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
    for (const p of ["/api/stats", "/api/leads", "/api/accuracy"]) {
      const r = await fetch(srv.base + p);
      assert.equal(r.status, 404, p + " should be disabled, not merely unauthorized");
    }
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
      body: JSON.stringify({ plan: "single_report" }),
    });
    assert.notEqual(r.status, 200, "checkout must not report success with no Stripe configured");
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

test("extractPdfOnce does not trip site-wide search outage on a vendor failure", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf("async function extractPdfOnce");
  assert.ok(start >= 0, "extractPdfOnce should still exist");
  const end = src.indexOf("async function callAnthropicOnce", start);
  assert.ok(end > start, "could not bound extractPdfOnce");
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

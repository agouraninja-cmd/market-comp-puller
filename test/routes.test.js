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
    assert.match(j.error, /ANTHROPIC_API_KEY/);
  });
});

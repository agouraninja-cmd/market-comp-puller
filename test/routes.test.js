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
const { spawn } = require("node:child_process");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "server.js");

// High ports, deliberately clear of the dev servers this repo uses (3000,
// 3117-3121) so a running session cannot collide with a test run.
let nextPort = 39140;

// Boot server.js with an explicit environment and wait for /healthz.
// `env` REPLACES rather than extends the parent environment for the keys that
// matter, so a developer's local .env cannot change what these tests prove.
async function boot(env) {
  const port = nextPort++;
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      // Cleared unless a test opts in: these decide whether whole routes exist.
      ANTHROPIC_API_KEY: "",
      ADMIN_KEY: "",
      APP_PASSWORD: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      STRIPE_SECRET_KEY: "",
      PRO_ENABLED: "",
      // Off by default here: this file's SPA-routing tests prove that / and
      // /desk MATCH on path, which needs a server that is not walling them.
      // The wall's own routing lives in test/account-wall.test.js.
      ACCOUNT_WALL: "off",
      ...env,
    },
    stdio: "ignore",
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error("server exited early, code " + child.exitCode);
    try {
      const r = await fetch(base + "/healthz");
      if (r.ok) return { base, stop: () => child.kill() };
    } catch (_) { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("server never became healthy on port " + port);
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

  await t.test("admin endpoints do not exist when ADMIN_KEY is unset", async () => {
    for (const p of ["/api/stats", "/api/leads"]) {
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

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

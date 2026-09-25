// The new-account Pro trial and the 2026-09-25 price change, against a real
// server.
//
// Run: npm test   (node --test, no dependencies, no database)
//
// entitlements.test.js proves the RULE. This file proves it is WIRED: that an
// account's created_at actually reaches the rule (getSessionUser narrows the
// user object, and a field left off it silently makes every account read as
// off-trial with nothing failing — the vault_beta story, told again), that the
// two settings do what they say, and that the price change retired what it
// meant to retire.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { boot } = require("./helpers/boot");

const SERVER_JS = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const DAY = 24 * 60 * 60 * 1000;

async function signUp(srv, label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const r = await fetch(srv.base + "/api/account/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: "Trial Tester" }),
  });
  assert.equal(r.status, 200, "signup must succeed");
  const cookie = String(r.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.startsWith("cn_session="), "expected a session cookie");
  return { cookie };
}

async function proConfig(srv, headers) {
  const r = await fetch(srv.base + "/api/config", { headers });
  assert.equal(r.status, 200);
  return (await r.json()).pro;
}

test("a new account is on a 14-day Pro trial", async (t) => {
  const srv = await boot({ PRO_ENABLED: "on", PRO_TRIAL_DAYS: "14" });
  t.after(() => srv.stop());
  const before = Date.now();
  const signed = await signUp(srv, "trial");

  const pro = await proConfig(srv, signed);
  assert.equal(pro.isPro, true, "a new account is Pro during its trial");
  assert.equal(pro.trial, true);
  assert.equal(pro.plan, "trial");
  assert.equal(pro.status, "trial", "never a Stripe status: there is no customer to manage");
  assert.equal(pro.canUseVault, true, "everything in Pro, the vault included");
  assert.equal(pro.canBulkValue, true, "bulk valuation included");

  // 14 days from signup, give or take the request itself.
  const ends = Date.parse(pro.trialEndsAt);
  assert.ok(Math.abs(ends - (before + 14 * DAY)) < 60 * 1000,
    `the trial should end 14 days from signup, got ${pro.trialEndsAt}`);
});

test("PRO_TRIAL_DAYS=0 is the off switch", async (t) => {
  const srv = await boot({ PRO_ENABLED: "on", PRO_TRIAL_DAYS: "0" });
  t.after(() => srv.stop());
  const pro = await proConfig(srv, await signUp(srv, "notrial"));
  assert.equal(pro.isPro, false);
  assert.equal(pro.trial, false);
  assert.equal(pro.trialEndsAt, null);
});

test("a launch date in the future means no trial yet", async (t) => {
  const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  const srv = await boot({ PRO_ENABLED: "on", PRO_TRIAL_DAYS: "14", PRO_TRIAL_START: tomorrow });
  t.after(() => srv.stop());
  const pro = await proConfig(srv, await signUp(srv, "early"));
  assert.equal(pro.trial, false, "setting PRO_TRIAL_START ahead of a deploy must not start the trial early");
});

test("a trial cannot switch a dark deployment on", async (t) => {
  const srv = await boot({ PRO_ENABLED: "", PRO_TRIAL_DAYS: "14" });
  t.after(() => srv.stop());
  const pro = await proConfig(srv, await signUp(srv, "dark"));
  assert.equal(pro.trial, false);
  assert.equal(pro.canUseVault, false, "PRO_ENABLED off still means the pre-Pro app");
});

// --- the settings refuse to boot on a value they cannot read ---------------
//
// The SEARCH_PROVIDER rule: a typo in either would otherwise silently hand
// out, or silently withhold, Pro. Spawned directly because the failure is the
// process exiting before it ever listens.
function bootExit(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      env: { ...process.env, PORT: "0", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "", ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); resolve({ code: "still running", err }); }, 8000);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, err }); });
  });
}

test("an unreadable PRO_TRIAL_DAYS refuses to boot", async () => {
  const { code, err } = await bootExit({ PRO_TRIAL_DAYS: "two weeks" });
  assert.equal(code, 1);
  assert.match(err, /PRO_TRIAL_DAYS/);
});

test("an unreadable PRO_TRIAL_START refuses to boot", async () => {
  const { code, err } = await bootExit({ PRO_TRIAL_DAYS: "14", PRO_TRIAL_START: "next monday" });
  assert.equal(code, 1);
  assert.match(err, /PRO_TRIAL_START/);
});

// --- source rules ----------------------------------------------------------

test("a trial is not exempt from the site-wide daily search cap", () => {
  // Accounts cost nothing to create. If a trial were exempt like a paying
  // subscriber, a scraper could sign up for a trial per burst and walk past
  // the one backstop DAILY_SEARCH_CAP exists to be.
  assert.match(SERVER_JS, /countsDailyCap: \(!ent\.pro \|\| ent\.trial === true\) && !internal/);
});

test("a trial yields to a firm seat", () => {
  // A colleague whose firm pays is a paying customer; reading them as "on a
  // trial" would hide their firm and tell them to upgrade.
  assert.match(SERVER_JS, /if \(own\.pro && !own\.trial\) return own;/);
});

test("checkout sells the yearly plan and no longer sells founding", () => {
  const plans = SERVER_JS.match(/const PLANS = \{[\s\S]*?\n\s*\};/);
  assert.ok(plans, "the PLANS map is where it was");
  assert.match(plans[0], /pro_annual:\s*\{ price: STRIPE_PRICES\.annual/);
  assert.doesNotMatch(plans[0], /^\s*pro_annual_founding\s*:/m,
    "founding was retired on 2026-09-25; selling it again is an owner decision, not a merge accident");
});

test("the webhook recognises every id a plan has been sold at", () => {
  // Every subscriptionRowFrom call reads the LISTS, never the single sold id:
  // an existing subscriber renews on the price they bought.
  const calls = SERVER_JS.match(/STRIPE\.subscriptionRowFrom\([^\n]*/g) || [];
  assert.ok(calls.length >= 4, "the webhook builds its rows where it did");
  for (const c of calls) {
    assert.match(c, /STRIPE_PRICE_IDS/, "a webhook row must be built from every recognised id: " + c);
  }
});

// POST /api/trial/notices against a real server, a stand-in database and a
// stand-in Resend.
//
// Run: npm test   (node --test, no dependencies, no network)
//
// Who is mailed, what they are sent, and the promise the ledger keeps: nobody
// gets either email twice. Built on the watchlist digest's run test, because
// it is the same kind of route.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ISO = (ms) => new Date(ms).toISOString();
const YEAR_OUT = ISO(now + 365 * DAY);

// Made 2 days ago: 12 days of trial left — the start email.
const FRESH = { id: "44444444-4444-4444-8444-444444444444", email: "fresh@example.com", name: "Fresh Account", created_at: ISO(now - 2 * DAY) };
// Made 12 days ago: 2 days left — the ending email.
const ENDING = { id: "55555555-5555-4555-8555-555555555555", email: "ending@example.com", name: "Ending Account", created_at: ISO(now - 12 * DAY) };
// On a trial by date, but paying: no trial email at all.
const PAYING = { id: "66666666-6666-4666-8666-666666666666", email: "paying@example.com", name: "Paying", created_at: ISO(now - DAY) };
// On a trial, but turned CompNinja emails off.
const QUIET = { id: "77777777-7777-4777-8777-777777777777", email: "quiet@example.com", name: "Quiet", created_at: ISO(now - DAY), digest_optout: true };
// Made months ago and no launch date: no trial, no email.
const OLD = { id: "88888888-8888-4888-8888-888888888888", email: "old@example.com", name: "Old", created_at: ISO(now - 200 * DAY) };

function tables() {
  const users = [FRESH, ENDING, PAYING, QUIET, OLD].map((u) => ({ pro_tester: false, vault_beta: false, digest_optout: false, ...u }));
  return {
    users,
    sessions: [],
    subscriptions: [{ user_id: PAYING.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false }],
    trial_notices: [], export_usage: [], report_purchases: [], org_members: [], orgs: [], org_subscriptions: [],
    analytics_events: [],
  };
}

async function bootWithDb(t, extraEnv = {}) {
  const db = await fake.start({ tables: tables() });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on", PRO_TRIAL_DAYS: "14",
    ADMIN_KEY: "trial-key",
    SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    RESEND_API_KEY: "resend-key", EMAIL_FROM: "CompNinja <reports@compninja.co>", RESEND_API_URL: db.resendUrl,
    SITE_URL: "https://compninja.co",
    ...extraEnv,
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  return { db, srv };
}

const runNotices = (srv, body) => fetch(srv.base + "/api/trial/notices", {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-key": "trial-key" },
  body: JSON.stringify(body || {}),
});

test("each account on a trial gets the one email it is due, once", async (t) => {
  const { db, srv } = await bootWithDb(t);

  const r = await runNotices(srv);
  assert.equal(r.status, 200, "the run must succeed before its mail means anything");
  const summary = await r.json();
  assert.deepEqual(summary.sent, { start: 1, ending: 1 });
  assert.equal(summary.optedOut, 1, "the account that turned emails off is counted, not mailed");

  const sent = await fake.waitForMail(db, 2);
  const to = sent.map((m) => [].concat(m.to)[0]).sort();
  assert.deepEqual(to, [ENDING.email, FRESH.email], "only the two trial accounts that want email are mailed");
  const byTo = Object.fromEntries(sent.map((m) => [[].concat(m.to)[0], m]));
  assert.match(byTo[FRESH.email].subject, /^You have CompNinja Pro until /);
  assert.match(byTo[ENDING.email].subject, /^Your CompNinja Pro trial ends on /);
  assert.match(byTo[FRESH.email].text, /\$49 a month/, "the email quotes PRICING, not a typed figure");

  // The ledger is the promise: a second run sends nothing.
  const kinds = db.tables.trial_notices.map((n) => `${n.user_id}:${n.kind}`).sort();
  assert.deepEqual(kinds, [`${FRESH.id}:start`, `${ENDING.id}:ending`].sort());
  const again = await (await runNotices(srv)).json();
  assert.deepEqual(again.sent, { start: 0, ending: 0 }, "nobody gets either email twice");
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(db.sent.length, 2, "and no third email left the building");
});

test("a dry run builds every email, sends none and marks nothing", async (t) => {
  const { db, srv } = await bootWithDb(t);
  const r = await runNotices(srv, { dryRun: true });
  assert.equal(r.status, 200);
  const summary = await r.json();
  assert.equal(summary.previews.length, 2);
  assert.ok(summary.previews.every((p) => p.subject && p.text && p.kind));
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(db.sent.length, 0);
  assert.equal(db.tables.trial_notices.length, 0);
});

test("it refuses to run blind without outbound mail", async (t) => {
  // sendOutboundEmail is a SILENT no-op without EMAIL_FROM/RESEND_API_KEY, so a
  // run would mark every account as mailed and lose the emails for good.
  const { db, srv } = await bootWithDb(t, { EMAIL_FROM: "", RESEND_API_KEY: "" });
  const r = await runNotices(srv);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /EMAIL_FROM/);
  assert.equal(db.tables.trial_notices.length, 0);
});

test("it needs the admin key", async (t) => {
  const { srv } = await bootWithDb(t);
  const r = await fetch(srv.base + "/api/trial/notices", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
});

test("a launch date reaches accounts made before it", async (t) => {
  // PRO_TRIAL_START is how existing accounts get their 14 days; the start
  // email is how they find out. Yesterday's launch reaches the 200-day-old
  // account too.
  const yesterday = ISO(now - DAY).slice(0, 10);
  const { db, srv } = await bootWithDb(t, { PRO_TRIAL_START: yesterday });
  const summary = await (await runNotices(srv, { dryRun: true })).json();
  const to = summary.previews.map((p) => p.to);
  assert.ok(to.includes(OLD.email), "the old account is on a trial from launch, and told so");
  assert.ok(!to.includes(PAYING.email), "a paying account is never mailed about a trial");
  assert.equal(db.sent.length, 0);
});

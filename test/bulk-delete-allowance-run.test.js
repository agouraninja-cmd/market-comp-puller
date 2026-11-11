// Deleting a bulk run must not hand back the addresses it spent today.
//
// Run: npm test
//
// BULK_DAILY_ADDRESSES is the one per-member spend bound on bulk valuation (Pro
// is exempt from the site-wide search cap). It is counted from bulk_job_items
// created today, and deleting a run cascades its items away in the database
// (migration 036: job_id ... on delete cascade). Until 2026-11-10 that meant a
// member at the limit could delete their finished runs from the ledger and
// have the whole allowance back, as often as they liked.
//
// The stand-in database does not cascade, so this test removes the run's
// items itself after the DELETE, the way Postgres would.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 864e5).toISOString();
const PAT = { id: "11111111-1111-4111-8111-111111111111", email: "pat@example.com", name: "Pat" };
const JOB = "22222222-2222-4222-8222-222222222222";
const NOW = new Date().toISOString();

const as = (init = {}) => ({ ...init, headers: { cookie: `cn_session=tok-${PAT.id}`, ...(init.headers || {}) } });

test("a deleted run still counts against the day it ran", async (t) => {
  const item = (n, status) => ({
    id: `33333333-3333-4333-8333-00000000000${n}`, job_id: JOB, user_id: PAT.id, line_no: n,
    address: `${n}00 First St, Boise, ID 83702`, status, created_at: NOW,
  });
  const tables = {
    users: [{ ...PAT, pro_tester: false, vault_beta: false }],
    sessions: [{ token_hash: sha256("tok-" + PAT.id), user_id: PAT.id, expires_at: YEAR_OUT }],
    subscriptions: [{ user_id: PAT.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false }],
    bulk_jobs: [{ id: JOB, user_id: PAT.id, status: "done", property_type: "Industrial", months: 24, created_at: NOW, finished_at: NOW }],
    // Three were run; the fourth was still queued when the run was stopped,
    // and a queued row was never searched, so it never counted.
    bulk_job_items: [item(1, "done"), item(2, "done"), item(3, "error"), item(4, "queued")],
    portfolio_items: [], recent_searches: [], analytics_events: [],
  };
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off", PRO_ENABLED: "on", SUPABASE_URL: db.url, SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co", BULK_DAILY_ADDRESSES: "10",
  });
  t.after(async () => { srv.stop(); await db.stop(); });
  const left = async () => (await (await fetch(srv.base + "/api/bulk", as())).json()).leftToday;

  assert.equal(await left(), 7, "three of today's ten are spent");

  const r = await fetch(`${srv.base}/api/bulk?id=${JOB}`, as({ method: "DELETE" }));
  assert.equal(r.status, 200);
  assert.equal(db.tables.bulk_jobs.length, 0, "the run is deleted");
  // The cascade the real database performs.
  db.tables.bulk_job_items.splice(0);

  assert.equal(await left(), 7, "and deleting it gave nothing back");
});

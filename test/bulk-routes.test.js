// Bulk valuation, actually running — the routes against a stand-in PostgREST.
//
// Why this exists, and why it is not bulk.test.js: bulk valuation deliberately
// has NO file fallback (migration 036), so on a bare server every route
// answers 503 and nothing past the refusals can be proven. Everything that
// actually matters here — that the gate ladder refuses in the right order,
// that a job is scoped to its owner, that one member cannot start two runs at
// once, that a run orphaned by a deploy is reported as interrupted rather than
// showing a progress bar forever — is arguable in a comment and only true if
// it executes. Same reason test/org-run.test.js and
// test/watchlist-digest-run.test.js exist, and the same fake.
//
// NOTHING HERE RUNS A SEARCH. boot.js blanks both provider keys, and the POST
// route refuses before creating a job when there is no key — which is itself
// one of the things this file pins, because callAnthropicOnce has no key guard
// of its own and a job that got past this would fire fifty outbound requests
// carrying an empty key.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const shared = require("./helpers/boot");
const fake = require("./helpers/fake-supabase");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const YEAR_OUT = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

// UUID-shaped throughout, because several routes guard an id with isUuidish()
// before it reaches a Postgres uuid cast — a `job-1` would be 404'd by the
// guard rather than by the scoping, and the test would prove the wrong thing.
const PAT = { id: "11111111-1111-4111-8111-111111111111", email: "pat@brokerage.com", name: "Pat" };
const SAM = { id: "22222222-2222-4222-8222-222222222222", email: "sam@nowhere.com", name: "Sam" };
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_2 = "55555555-5555-4555-8555-555555555555";
const PF_1 = "66666666-6666-4666-8666-666666666666";

function seedTables(extra) {
  return {
    users: [PAT, SAM].map((u) => ({ ...u, pro_tester: false, vault_beta: false })),
    sessions: [PAT, SAM].map((u) => ({
      token_hash: sha256("tok-" + u.id), user_id: u.id, expires_at: YEAR_OUT,
    })),
    subscriptions: [{
      user_id: PAT.id, plan: "pro_monthly", status: "active",
      current_period_end: YEAR_OUT, cancel_at_period_end: false,
    }],
    bulk_jobs: [], bulk_job_items: [],
    portfolio_items: [], analytics_events: [], export_usage: [], report_purchases: [],
    ...extra,
  };
}

async function bootWithDb(tables, extraEnv) {
  const db = await fake.start({ tables });
  const srv = await shared.boot({
    ACCOUNT_WALL: "off",
    PRO_ENABLED: "on",
    SUPABASE_URL: db.url,
    SUPABASE_SERVICE_KEY: "service-key",
    SITE_URL: "https://compninja.co",
    ...extraEnv,
  });
  return { db, srv, tables, stop: async () => { srv.stop(); await db.stop(); } };
}

const as = (user, init = {}) => ({
  ...init,
  headers: {
    "content-type": "application/json",
    cookie: `cn_session=tok-${user.id}`,
    ...(init.headers || {}),
  },
});

// ---------------------------------------------------------------------------

test("bulk routes on a bare server (no database)", async (t) => {
  const srv = await shared.boot({ ACCOUNT_WALL: "off", PRO_ENABLED: "on" });
  t.after(() => srv.stop());

  await t.test("every route refuses an anonymous caller with 401, never 404", async () => {
    // The ladder's first rung. A 404 here would tell somebody the feature
    // does not exist on a deployment where it does.
    for (const [method, path] of [
      ["GET", "/api/bulk"], ["POST", "/api/bulk"], ["DELETE", "/api/bulk?id=x"],
      ["POST", "/api/bulk/cancel"], ["GET", "/api/bulk/export.csv?id=x"],
    ]) {
      const r = await fetch(srv.base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" || method === "DELETE" ? undefined : "{}" });
      assert.equal(r.status, 401, `${method} ${path}`);
    }
  });

  await t.test("the page renders its own refusal rather than a working paste box", async () => {
    const r = await fetch(srv.base + "/bulk");
    const html = await r.text();
    assert.equal(r.status, 200, "the page itself always answers — it explains the refusal");
    assert.match(html, /BULKPAGE\.start\(\{"s":401/, "boot carries the refusal, so nothing paints first");
    assert.match(r.headers.get("x-robots-tag") || "", /noindex/);
    assert.match(r.headers.get("cache-control") || "", /no-store/,
      "a cached copy would outlive a sign-out");
  });
});

test("bulk, end to end", async (t) => {
  const ctx = await bootWithDb(seedTables());
  t.after(() => ctx.stop());
  const { srv, tables } = ctx;

  await t.test("a free account is refused with 403 and told it is Pro", async () => {
    const r = await fetch(srv.base + "/api/bulk", as(SAM));
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.code, "pro_required");
    assert.match(body.error, /Pro/, "this string reaches the screen verbatim");
  });

  await t.test("a Pro member gets the cap and the type list, not a bare list", async () => {
    // The page needs both before it can render a form, and neither may be a
    // second copy: the cap is the entitlement's and the types are the vault's.
    const r = await fetch(srv.base + "/api/bulk", as(PAT));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.jobs, []);
    assert.equal(body.maxAddresses, 50);
    assert.ok(body.types.includes("Industrial"));
  });

  await t.test("a run refuses before creating a job when there is no provider key", async () => {
    // The load-bearing one. callAnthropicOnce has NO key guard, so a job that
    // got past this would fire one outbound request per address carrying an
    // empty key. Refusing before the job exists is also what keeps a member
    // from being shown fifty failures for one server misconfiguration.
    const r = await fetch(srv.base + "/api/bulk", as(PAT, {
      method: "POST",
      body: JSON.stringify({ text: "1201 W Idaho St, Boise, ID", type: "Industrial", months: 24 }),
    }));
    assert.equal(r.status, 503);
    assert.equal(tables.bulk_jobs.length, 0, "no job, no rows, nothing to clean up");
    assert.equal(tables.bulk_job_items.length, 0);
  });

  await t.test("a list of nothing is refused with its reasons, and costs nothing", async () => {
    const r = await fetch(srv.base + "/api/bulk", as(PAT, {
      method: "POST",
      body: JSON.stringify({ text: "Downtown Boise\nFinancial District", type: "Industrial", months: 24 }),
    }));
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.skipped.length, 2, "each refused line is named, not silently dropped");
    assert.equal(tables.bulk_jobs.length, 0);
  });

  await t.test("an unknown property type is refused by name", async () => {
    const r = await fetch(srv.base + "/api/bulk", as(PAT, {
      method: "POST",
      body: JSON.stringify({ text: "1 A St, Boise, ID", type: "Warehouse", months: 24 }),
    }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Industrial/);
  });
});

// ---------------------------------------------------------------------------
// Reading a run. Rows are seeded rather than searched — this is about what the
// read paths do with them.
// ---------------------------------------------------------------------------

function seedJob(overrides, items) {
  const job = {
    id: JOB_ID, user_id: PAT.id, property_type: "Industrial", months: 24,
    note: "", label: "Q3 review", status: "done", total: 2, done_count: 2,
    heartbeat_at: new Date().toISOString(), created_at: "2026-08-20T10:00:00.000Z",
    finished_at: "2026-08-20T10:20:00.000Z",
    ...overrides,
  };
  return {
    bulk_jobs: [job],
    bulk_job_items: items || [
      {
        id: ITEM_1, job_id: job.id, user_id: PAT.id, position: 0,
        address: "1201 W Idaho St, Boise, ID", label: null, size_sqft: null,
        status: "done", error: null,
        value_low: 1000000, value_likely: 1200000, value_high: 1400000,
        psf_low: 100, psf_mid: 120, psf_high: 140,
        subject_size_sqft: 10000, size_source: "county records",
        sale_comps: 6, comp_count: 8, market: "Boise, ID", trimmed: true, cached: false,
        portfolio_item_id: PF_1, created_at: job.created_at, finished_at: job.finished_at,
      },
      {
        id: ITEM_2, job_id: job.id, user_id: PAT.id, position: 1,
        address: "900 N Cole Rd, Boise, ID", label: null, size_sqft: null,
        status: "failed", error: "No priced sale comps in this window.",
        value_low: null, value_likely: null, value_high: null,
        market: "Boise, ID", cached: false, portfolio_item_id: null,
        created_at: job.created_at, finished_at: job.finished_at,
      },
    ],
  };
}

test("the per-member daily ceiling", async (t) => {
  // The spend backstop. DAILY_SEARCH_CAP is site-wide and Pro deliberately
  // bypasses it, which was written for somebody typing one address at a time;
  // bulk multiplies that by fifty per click, so it needs a bound of its own.
  // Per MEMBER, so one person's ceiling never denies anyone else a search.
  const attempted = (n, status) => Array.from({ length: n }, (_, i) => ({
    id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
    job_id: JOB_ID, user_id: PAT.id, position: i, address: `${i} A St, Boise ID`,
    status, created_at: new Date().toISOString(),
  }));

  await t.test("a list that would cross it is refused, with the number left", async () => {
    const ctx = await bootWithDb(seedTables({
      bulk_jobs: [], bulk_job_items: attempted(8, "done"),
    }), { BULK_DAILY_ADDRESSES: "10" });
    try {
      const r = await fetch(ctx.srv.base + "/api/bulk", as(PAT, {
        method: "POST",
        body: JSON.stringify({
          text: Array.from({ length: 5 }, (_, i) => `${i + 1}00 B St, Boise ID`).join("\n"),
          type: "Industrial", months: 24,
        }),
      }));
      assert.equal(r.status, 429);
      const body = await r.json();
      assert.equal(body.code, "daily_limit");
      assert.equal(body.left_today, 2, "8 of 10 attempted today");
      assert.match(body.error, /2 left today/, "actionable, not just a wall");
      assert.match(body.error, /midnight UTC/, "and it says when it resets");
      assert.equal(ctx.tables.bulk_jobs.length, 0, "refused before anything is created");
    } finally { await ctx.stop(); }
  });

  await t.test("a queued row that never ran does not count against it", async () => {
    // Cancelling a fifty-address run after two rows must cost two, not fifty
    // — otherwise stopping a run is punished harder than letting it finish.
    const ctx = await bootWithDb(seedTables({
      bulk_jobs: [], bulk_job_items: attempted(40, "queued"),
    }), { BULK_DAILY_ADDRESSES: "10" });
    try {
      const r = await fetch(ctx.srv.base + "/api/bulk", as(PAT, {
        method: "POST",
        body: JSON.stringify({ text: "1 A St, Boise ID", type: "Industrial", months: 24 }),
      }));
      // 503 (no provider key), NOT 429 — the point is which refusal it is.
      assert.equal(r.status, 503);
    } finally { await ctx.stop(); }
  });

  await t.test("yesterday's addresses do not count against today", async () => {
    const old = attempted(40, "done").map((it) => ({
      ...it, created_at: "2020-01-01T00:00:00.000Z",
    }));
    const ctx = await bootWithDb(seedTables({ bulk_jobs: [], bulk_job_items: old }),
      { BULK_DAILY_ADDRESSES: "10" });
    try {
      const r = await fetch(ctx.srv.base + "/api/bulk", as(PAT, {
        method: "POST",
        body: JSON.stringify({ text: "1 A St, Boise ID", type: "Industrial", months: 24 }),
      }));
      assert.equal(r.status, 503, "not 429 — the window really is today only");
    } finally { await ctx.stop(); }
  });

  await t.test("another member's addresses do not count against yours", async () => {
    // The whole reason this is per-member rather than charged to
    // DAILY_SEARCH_CAP: one person's heavy day must never lock anybody else out.
    const theirs = attempted(40, "done").map((it) => ({ ...it, user_id: SAM.id }));
    const ctx = await bootWithDb(seedTables({ bulk_jobs: [], bulk_job_items: theirs }),
      { BULK_DAILY_ADDRESSES: "10" });
    try {
      const r = await fetch(ctx.srv.base + "/api/bulk", as(PAT, {
        method: "POST",
        body: JSON.stringify({ text: "1 A St, Boise ID", type: "Industrial", months: 24 }),
      }));
      assert.equal(r.status, 503, "not 429");
    } finally { await ctx.stop(); }
  });

  await t.test("the page is told the allowance up front, not only at the refusal", async () => {
    const ctx = await bootWithDb(seedTables({
      bulk_jobs: [], bulk_job_items: attempted(8, "done"),
    }), { BULK_DAILY_ADDRESSES: "10" });
    try {
      const body = await (await fetch(ctx.srv.base + "/api/bulk", as(PAT))).json();
      assert.equal(body.leftToday, 2);
      assert.equal(body.dailyLimit, 10);
      const html = await (await fetch(ctx.srv.base + "/bulk", as(PAT))).text();
      assert.match(html, /"leftToday":2/, "the boot payload carries it, so nothing pops in");
    } finally { await ctx.stop(); }
  });
});

test("reading a finished run", async (t) => {
  const seeded = seedJob();
  const ctx = await bootWithDb(seedTables(seeded));
  t.after(() => ctx.stop());
  const { srv } = ctx;

  await t.test("a job comes back with its rows and its totals", async () => {
    const r = await fetch(srv.base + "/api/bulk?id=" + JOB_ID, as(PAT));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.job.label, "Q3 review");
    assert.equal(body.items.length, 2);
    // The total sums what was VALUED and says so — a failed row is not $0.
    assert.equal(body.summary.valued, 1);
    assert.equal(body.summary.likely, 1200000);
    assert.equal(body.summary.failed, 1);
  });

  await t.test("an unvalued row exports blank, never $0", async () => {
    // Number(null) is 0, so a nullable column read back through a bare
    // Number() becomes a ZERO — and a zero here is a claim. The page survived
    // it (every display path tests > 0) and the CSV did not, which is the
    // failure worth a test: "a failure is not $0" is a rule this feature
    // states out loud, and it was broken one layer below the code that
    // enforces it.
    const body = await (await fetch(srv.base + "/api/bulk?id=" + JOB_ID, as(PAT))).json();
    const failed = body.items.find((it) => it.status === "failed");
    assert.equal(failed.value_likely, null, "not 0");
    assert.equal(failed.psf_mid, null, "not 0");
    assert.equal(failed.size_sqft, null, "not 0");

    const csv = await (await fetch(srv.base + "/api/bulk/export.csv?id=" + JOB_ID, as(PAT))).text();
    const line = csv.split("\n").find((l) => l.indexOf("900 N Cole Rd") >= 0);
    assert.ok(line, "the failed row must be in the file");
    assert.ok(!/,0,/.test(line), "an unvalued row must export blank cells, not zeros: " + line);
  });

  await t.test("the row shape is an allowlist, not the table row", async () => {
    // vault-api.js's rule: a storage column added later must not reach the
    // browser by default. user_id and job_id are plumbing.
    const body = await (await fetch(srv.base + "/api/bulk?id=" + JOB_ID, as(PAT))).json();
    const row = body.items[0];
    assert.equal(row.user_id, undefined);
    assert.equal(row.job_id, undefined);
    assert.equal(row.size_sqft, 10000, "subject_size_sqft is renamed for the page");
    assert.equal(row.portfolio_item_id, PF_1, "so the row can link to its own report");
  });

  await t.test("a retry is refused before it touches the row: not-failed, no key, and not yours", async () => {
    // The guards run BEFORE the row is put back in the queue, so a refusal
    // leaves the job exactly as it was — asserted on the table, not the
    // status code alone.
    const body = await (await fetch(srv.base + "/api/bulk?id=" + JOB_ID, as(PAT))).json();
    const doneRow = body.items.find((it) => it.status === "done");
    const failedRow = body.items.find((it) => it.status === "failed");
    const r1 = await fetch(srv.base + "/api/bulk/item/retry", as(PAT, { method: "POST", body: JSON.stringify({ id: doneRow.id }) }));
    assert.equal(r1.status, 409);
    assert.equal((await r1.json()).code, "not_failed");
    // This harness has no provider key, so the failed row is refused at the
    // key guard (503) — after the status and one-live-job checks, before the
    // queue write. The row must still read failed and the job done.
    const r2 = await fetch(srv.base + "/api/bulk/item/retry", as(PAT, { method: "POST", body: JSON.stringify({ id: failedRow.id }) }));
    assert.equal(r2.status, 503, await r2.text());
    assert.equal(ctx.tables.bulk_job_items.find((it) => it.id === failedRow.id).status, "failed");
    assert.equal(ctx.tables.bulk_jobs.find((j) => j.id === JOB_ID).status, "done");
    // Another member is refused at the gate (SAM is free) and touches nothing.
    const r3 = await fetch(srv.base + "/api/bulk/item/retry", as(SAM, { method: "POST", body: JSON.stringify({ id: failedRow.id }) }));
    assert.ok(r3.status === 403 || r3.status === 404, String(r3.status));
    assert.equal(ctx.tables.bulk_job_items.find((it) => it.id === failedRow.id).status, "failed");
  });

  await t.test("another member cannot read, export or delete it", async () => {
    // Scoped by user_id, like every other read in this app. Without it,
    // knowing a job id would be enough.
    assert.equal((await fetch(srv.base + "/api/bulk?id=" + JOB_ID, as(SAM))).status, 403,
      "Sam is not Pro, so the ladder stops him first");

    // And with a second Pro member, the scoping itself is what refuses.
    const ctx2 = await bootWithDb(seedTables({
      ...seedJob(),
      subscriptions: [
        { user_id: PAT.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false },
        { user_id: SAM.id, plan: "pro_monthly", status: "active", current_period_end: YEAR_OUT, cancel_at_period_end: false },
      ],
    }));
    try {
      assert.equal((await fetch(ctx2.srv.base + "/api/bulk?id=" + JOB_ID, as(SAM))).status, 404);
      assert.equal((await fetch(ctx2.srv.base + "/api/bulk/export.csv?id=" + JOB_ID, as(SAM))).status, 404);
      await fetch(ctx2.srv.base + "/api/bulk?id=" + JOB_ID, as(SAM, { method: "DELETE" }));
      assert.equal(ctx2.tables.bulk_jobs.length, 1, "a scoped delete must not reach another member's job");
    } finally { await ctx2.stop(); }
  });

  await t.test("the export is a spreadsheet that discloses what it is", async () => {
    const r = await fetch(srv.base + "/api/bulk/export.csv?id=" + JOB_ID, as(PAT));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /text\/csv/);
    // The run's label rides the filename as a slug (2026-09-04), before the date.
    assert.match(r.headers.get("content-disposition") || "", /compninja-bulk-q3-review-2026-08-20\.csv/);
    const csv = await r.text();
    assert.match(csv, /automated estimates, not appraisals/);
    assert.match(csv, /1 of 2 valued/);
    assert.match(csv, /"1201 W Idaho St, Boise, ID"/, "commas survive the round trip");
    assert.match(csv, /No priced sale comps/, "a failure travels with its reason");
  });

  await t.test("the list carries each run's total from one grouped read, and it matches the run's own", async () => {
    // The Earlier-runs ledger's figure (2026-09-04). One items read for the
    // whole list, grouped by job, summed by BULK.summarize — the same
    // arithmetic the open run's strip uses, so the two cannot disagree.
    const before = ctx.db.requests.length;
    const body = await (await fetch(srv.base + "/api/bulk", as(PAT))).json();
    const j = body.jobs.find((x) => x.id === JOB_ID);
    assert.ok(j.summary, "a listed run carries its summary");
    assert.equal(j.summary.valued, 1);
    assert.equal(j.summary.likely, 1200000);
    assert.equal(j.summary.low, 1000000);
    assert.equal(j.summary.high, 1400000);
    const own = await (await fetch(srv.base + "/api/bulk?id=" + JOB_ID, as(PAT))).json();
    assert.equal(j.summary.likely, own.summary.likely, "the ledger and the open run quote one total");
    const itemReads = ctx.db.requests.slice(before).filter((r) => r.table === "bulk_job_items" && r.method === "GET");
    assert.equal(itemReads.filter((r) => r.query.includes("job_id=in.(")).length, 1,
      "the list read groups every job's rows into ONE query, never one per job");
  });

  await t.test("a run can be renamed, and only by its owner", async () => {
    const r = await fetch(srv.base + "/api/bulk", as(PAT, {
      method: "PATCH", body: JSON.stringify({ id: JOB_ID, label: "  Q3 review — final  " }),
    }));
    assert.equal(r.status, 200);
    const { job } = await r.json();
    assert.equal(job.label, "Q3 review — final");
    assert.equal(ctx.tables.bulk_jobs.find((j) => j.id === JOB_ID).label, "Q3 review — final");
    // Over-long is cut, never refused; empty clears back to the type's default.
    const long = "x".repeat(200);
    const r2 = await fetch(srv.base + "/api/bulk", as(PAT, { method: "PATCH", body: JSON.stringify({ id: JOB_ID, label: long }) }));
    assert.equal((await r2.json()).job.label.length, 120);
    const r3 = await fetch(srv.base + "/api/bulk", as(PAT, { method: "PATCH", body: JSON.stringify({ id: JOB_ID, label: "" }) }));
    assert.equal((await r3.json()).job.label, null);
    // Another member's rename never lands (SAM is refused at the gate as a
    // free account; a Pro stranger would be scoped out as a 404), and the row
    // is untouched either way.
    const rs = await fetch(srv.base + "/api/bulk", as(SAM, { method: "PATCH", body: JSON.stringify({ id: JOB_ID, label: "mine now" }) }));
    assert.ok(rs.status === 403 || rs.status === 404, String(rs.status));
    assert.equal(ctx.tables.bulk_jobs.find((j) => j.id === JOB_ID).label, null);
  });

  await t.test("deleting the run leaves the valuations on the desk", async () => {
    // A run is a receipt. Deleting a receipt must not delete the work — the
    // valuations belong to the properties, not to the run that produced them.
    const before = ctx.tables.portfolio_items.length;
    const r = await fetch(srv.base + "/api/bulk?id=" + JOB_ID, as(PAT, { method: "DELETE" }));
    assert.equal(r.status, 200);
    assert.equal(ctx.tables.bulk_jobs.length, 0);
    assert.equal(ctx.tables.portfolio_items.length, before);
  });
});

test("a run orphaned by a restart is reported, not left spinning", async (t) => {
  // No timer and no boot sweep (migration 025's argument): a READ decides it
  // stalled. This process is not working the seeded job, and its heartbeat is
  // old, so the very next read must say so.
  const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const ctx = await bootWithDb(seedTables(seedJob({
    status: "running", done_count: 1, finished_at: null, heartbeat_at: stale,
  })));
  t.after(() => ctx.stop());

  await t.test("the job reads as interrupted, and the row is corrected once", async () => {
    const body = await (await fetch(ctx.srv.base + "/api/bulk?id=" + JOB_ID, as(PAT))).json();
    assert.equal(body.job.status, "interrupted");
    assert.equal(ctx.tables.bulk_jobs[0].status, "interrupted",
      "written, so the page is not recomputing a verdict on every poll");
    assert.ok(ctx.tables.bulk_jobs[0].finished_at, "and it has an end");
  });

  await t.test("and it no longer blocks a new run", async () => {
    // The one-job-at-a-time rule is read from the DATABASE, so without the
    // reaping a deploy mid-run would lock a member out of their own tool for
    // the whole stall window.
    const r = await fetch(ctx.srv.base + "/api/bulk", as(PAT, {
      method: "POST",
      body: JSON.stringify({ text: "1 A St, Boise, ID", type: "Industrial", months: 24 }),
    }));
    // 503 (no provider key), NOT 409 (a run is already going) — the point is
    // which refusal it is.
    assert.equal(r.status, 503);
  });
});

test("one run at a time", async (t) => {
  const ctx = await bootWithDb(seedTables(seedJob({
    status: "running", done_count: 1, finished_at: null,
    heartbeat_at: new Date().toISOString(),   // freshly beating: really alive
  })));
  t.after(() => ctx.stop());

  await t.test("a second run is refused by name, with the live job attached", async () => {
    // A member who starts the same list twice pays for it twice. The refusal
    // carries the running job so the page can show it rather than just
    // scolding.
    const r = await fetch(ctx.srv.base + "/api/bulk", as(PAT, {
      method: "POST",
      body: JSON.stringify({ text: "1 A St, Boise, ID", type: "Industrial", months: 24 }),
    }));
    assert.equal(r.status, 409);
    const body = await r.json();
    assert.equal(body.code, "job_running");
    assert.equal(body.job.id, JOB_ID);
  });

  await t.test("cancelling a job no process is working still ends it", async () => {
    // The orphan case again: nobody is left to write the final status, so the
    // route does it.
    const r = await fetch(ctx.srv.base + "/api/bulk/cancel", as(PAT, {
      method: "POST", body: JSON.stringify({ id: JOB_ID }),
    }));
    assert.equal(r.status, 200);
    assert.equal(ctx.tables.bulk_jobs[0].status, "cancelled");
  });
});

test("the workspace page", async (t) => {
  const ctx = await bootWithDb(seedTables(seedJob()));
  t.after(() => ctx.stop());

  await t.test("boots with the member's runs already in it", async () => {
    const html = await (await fetch(ctx.srv.base + "/bulk", as(PAT))).text();
    assert.match(html, /BULKPAGE\.start\(\{"s":200/);
    assert.match(html, /Q3 review/, "the boot payload carries the runs, so nothing pops in");
    assert.match(html, /automated estimate/, "the page says what these numbers are");
  });

  await t.test("its inline script actually parses", async () => {
    // The whole page is one template literal in bulk-page.js, so a stray
    // backtick or a single-backslash escape emits broken JavaScript and a
    // blank workspace rather than failing loudly. vault-page.js carries the
    // same rule and the same kind of test.
    const html = await (await fetch(ctx.srv.base + "/bulk", as(PAT))).text();
    const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    assert.ok(scripts.length, "the page must ship a script");
    for (const s of scripts) {
      const src = s.replace(/^<script>/, "").replace(/<\/script>$/, "");
      assert.doesNotThrow(() => new Function(src), "a page script failed to compile");
    }
  });

  await t.test("Tab fills the box from the placeholder, and only while it is empty", async () => {
    // Two rules, both of which fail SILENTLY if they drift.
    //
    // ONE SOURCE: the example addresses live in the textarea's placeholder and
    // are read back out of it. A second copy would let the greyed text and the
    // thing Tab inserts disagree about what a valid list looks like, which is
    // the one job this has.
    //
    // ONE STATE: Tab is how a keyboard user leaves a field. It is intercepted
    // only in an empty box and never with a modifier, so the key does its
    // ordinary job the moment there is anything to move on from. Losing either
    // guard traps somebody in the textarea, and nothing else would report it.
    const html = await (await fetch(ctx.srv.base + "/bulk", as(PAT))).text();
    const js = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).join("\n");

    assert.match(js, /ta\.placeholder/,
      "the examples must be read from the placeholder, not written out a second time");
    assert.ok(!/1201 W Idaho St[\s\S]{0,200}1201 W Idaho St/.test(html),
      "the example list appears twice — one copy is the placeholder, the other will drift");

    // Anchored on bulkText: there is a second keydown handler on the page now
    // (the editable size cells), and an unanchored match would happily prove
    // the wrong one.
    const handler = /\$\("bulkText"\)\.addEventListener\("keydown"[\s\S]{0,700}?preventDefault/.exec(js);
    assert.ok(handler, "the textarea must have its own keydown handler that can preventDefault");
    assert.match(handler[0], /e\.shiftKey/, "Shift+Tab must never be intercepted");
    assert.match(handler[0], /e\.key!=="Tab"|e\.key !== "Tab"/, "only Tab");
    assert.match(js, /if\(ta\.value!==""\)return false;/,
      "fillExamples must refuse a non-empty box, which is what releases the key");

    // And a mouse path to the same thing, so the shortcut is discoverable
    // rather than folklore.
    assert.match(html, /id="useExample"/);
  });

  await t.test("a non-Pro member sees the Pro door, never the paste box", async () => {
    const html = await (await fetch(ctx.srv.base + "/bulk", as(SAM))).text();
    assert.match(html, /BULKPAGE\.start\(\{"s":403/);
  });
});
